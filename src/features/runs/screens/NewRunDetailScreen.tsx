import {
  For,
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  type Component,
} from "solid-js";
import NewRunChatWorkspace from "../components/NewRunChatWorkspace";
import RunDiffDrawerPanel from "../components/RunDiffDrawerPanel";
import { formatGitStateLabel } from "./gitStateLabels";
import { useRunDetailModel } from "../model/useRunDetailModel";

const RunTerminal = lazy(() => import("../components/RunTerminal"));

type OverlayState =
  | "none"
  | "drawer-logs"
  | "drawer-diff"
  | "drawer-git"
  | "sheet-terminal";

type OverlaySize = "normal" | "maximized";

type LogLine = {
  id: string;
  timestamp: string;
  event: string;
  message: string;
  text: string;
  completed: boolean;
  searchText: string;
};

const LOG_NEAR_BOTTOM_THRESHOLD = 32;
const LOG_NEW_ROW_HIGHLIGHT_MS = 1_000;
const LOG_RENDER_CHUNK_SIZE = 100;
const LOG_PREPEND_TRIGGER_THRESHOLD = 96;

const INTERNAL_ID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const redactInternalIds = (value: string): string =>
  value.replace(INTERNAL_ID_PATTERN, "[internal-id]");

const normalizeLogText = (value: string): string =>
  redactInternalIds(value).replace(/\r\n|\r|\n/g, "\\n");

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const isCompletedDebugEvent = (name: string, payload: unknown): boolean => {
  if (name === "session.idle") {
    return true;
  }

  if (name !== "message.updated") {
    return false;
  }

  const parsedPayload = parseMaybeJson(payload);
  if (!isRecord(parsedPayload)) {
    return false;
  }

  const properties = isRecord(parsedPayload.properties)
    ? parsedPayload.properties
    : parsedPayload;
  const info = isRecord(properties.info) ? properties.info : null;
  const time = info && isRecord(info.time) ? info.time : null;
  return time?.completed !== undefined;
};

const summarizeEventPayload = (payload: unknown): string => {
  if (payload === undefined || payload === null) {
    return "";
  }

  if (typeof payload === "string") {
    return normalizeLogText(payload);
  }

  if (typeof payload === "number" || typeof payload === "boolean") {
    return String(payload);
  }

  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const summaryFields = [
      record.message,
      record.text,
      record.error,
      record.status,
      record.type,
      record.reason,
    ];

    for (const field of summaryFields) {
      if (typeof field === "string" && field.trim().length > 0) {
        return normalizeLogText(field.trim());
      }
    }
  }

  try {
    const serialized = JSON.stringify(payload);
    if (typeof serialized === "string") {
      return normalizeLogText(serialized);
    }
  } catch {
    return normalizeLogText(String(payload));
  }

  return normalizeLogText(String(payload));
};

const formatLogTimestamp = (ts: string | number | null): string => {
  if (ts === null || ts === undefined) {
    return "";
  }

  if (typeof ts === "number") {
    const parsed = new Date(ts);
    return Number.isNaN(parsed.getTime()) ? String(ts) : parsed.toISOString();
  }

  return ts;
};

const formatCompactLogTimestamp = (ts: string | number | null): string => {
  const raw = formatLogTimestamp(ts);
  if (!raw) {
    return "--:--:--.---";
  }

  const asDate = new Date(raw);
  if (!Number.isNaN(asDate.getTime())) {
    const hour = String(asDate.getHours()).padStart(2, "0");
    const minute = String(asDate.getMinutes()).padStart(2, "0");
    const second = String(asDate.getSeconds()).padStart(2, "0");
    const ms = String(asDate.getMilliseconds()).padStart(3, "0");
    return `${hour}:${minute}:${second}.${ms}`;
  }

  const compactMatch = raw.match(/(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/);
  if (compactMatch?.[1]) {
    const [base, fraction = ""] = compactMatch[1].split(".");
    return `${base}.${fraction.padEnd(3, "0").slice(0, 3)}`;
  }

  return raw;
};

const resolveTaskTitle = (
  taskTitleValue: string | undefined,
  runValue: ReturnType<typeof useRunDetailModel>["run"] extends () => infer T
    ? T
    : never,
): string => {
  const taskTitle = taskTitleValue?.trim();
  if (taskTitle) {
    return taskTitle;
  }

  const runWithTaskTitle = runValue as {
    taskTitle?: unknown;
    task_title?: unknown;
  } | null;
  const candidateTaskTitle =
    typeof runWithTaskTitle?.taskTitle === "string"
      ? runWithTaskTitle.taskTitle
      : typeof runWithTaskTitle?.task_title === "string"
        ? runWithTaskTitle.task_title
        : "";

  return candidateTaskTitle.trim();
};

const NewRunDetailScreen: Component = () => {
  const model = useRunDetailModel();
  const [overlayState, setOverlayState] = createSignal<OverlayState>("none");
  const [overlaySize, setOverlaySize] = createSignal<OverlaySize>("normal");
  const [isDiffSideBySide, setIsDiffSideBySide] = createSignal(true);
  const [isCommitModalOpen, setIsCommitModalOpen] = createSignal(false);
  const [commitPromptDraft, setCommitPromptDraft] = createSignal("");
  const [isCommitPrefillLoading, setIsCommitPrefillLoading] =
    createSignal(false);
  const [logsSearchQuery, setLogsSearchQuery] = createSignal("");
  const [isFollowingLogs, setIsFollowingLogs] = createSignal(true);
  const [hasUnseenLogs, setHasUnseenLogs] = createSignal(false);
  const [newlyArrivedLogIds, setNewlyArrivedLogIds] = createSignal<Set<string>>(
    new Set(),
  );
  const [renderedLogWindowStart, setRenderedLogWindowStart] = createSignal(0);
  const [renderedLogWindowEnd, setRenderedLogWindowEnd] = createSignal(0);
  const [isPrependingOlderLogs, setIsPrependingOlderLogs] = createSignal(false);
  let drawerOverlayCloseButtonRef: HTMLButtonElement | undefined;
  let terminalOverlayCloseButtonRef: HTMLButtonElement | undefined;
  let commitModalTextareaRef: HTMLTextAreaElement | undefined;
  let logsScrollContainerRef: HTMLDivElement | undefined;
  const newLogHighlightTimeouts = new Map<string, number>();
  let pendingPrependScrollHeight: number | null = null;
  let pendingPrependFrame: number | undefined;

  const isOverlayOpen = createMemo(() => overlayState() !== "none");
  const isTerminalOverlayOpen = createMemo(
    () => overlayState() === "sheet-terminal",
  );
  const isDrawerOverlay = createMemo(
    () =>
      overlayState() === "drawer-logs" ||
      overlayState() === "drawer-diff" ||
      overlayState() === "drawer-git",
  );
  const isLogsDrawerOpen = createMemo(() => overlayState() === "drawer-logs");
  const overlaySizeLabel = createMemo(() =>
    overlaySize() === "maximized" ? "Restore panel" : "Maximize panel",
  );
  const gitStatus = createMemo(() => model.git.status());
  const baseBranchName = createMemo(() => {
    const status = gitStatus();
    const name = status?.sourceBranch.name?.trim();
    return name && name.length > 0 ? name : "main";
  });
  const isWorkflowCompleted = createMemo(() => {
    const status = gitStatus();
    if (!status) {
      return false;
    }
    return (
      status.state === "merged" ||
      status.state === "completing" ||
      status.state === "completed" ||
      model.postMergeCompletionMessage().trim().length > 0
    );
  });
  const summaryCopy = createMemo(() => {
    const status = gitStatus();
    if (!status) {
      return {
        headline: "Checking repository status",
        support: "Fetching branch and working tree details.",
      };
    }

    if (isWorkflowCompleted()) {
      return {
        headline: "Integration complete",
        support: `Current branch has been integrated into ${baseBranchName()}.`,
      };
    }

    if (status.isWorktreeClean === false) {
      return {
        headline: "Commit required",
        support: "Commit local changes before moving on to rebase or merge.",
      };
    }

    if (status.requiresRebase) {
      return {
        headline: "Rebase required",
        support: `Rebase current branch onto ${baseBranchName()} before merge.`,
      };
    }

    if (status.isMergeAllowed) {
      return {
        headline: "Ready to merge",
        support: `Current branch is ready to merge into ${baseBranchName()}.`,
      };
    }

    return {
      headline: "Review required",
      support: "Complete the next available sync step to continue.",
    };
  });
  const changedFilePaths = createMemo(() => {
    const files = model.diffFiles();
    const uniquePaths = new Set<string>();
    for (const file of files) {
      const path = file.path.trim();
      if (path.length > 0) {
        uniquePaths.add(path);
      }
    }
    return Array.from(uniquePaths);
  });
  const commitPromptPrefill = createMemo(() => {
    if (isCommitPrefillLoading() || model.isDiffFilesLoading()) {
      return "There are still uncommited changes, please attomically commit the following changes\n- Loading changed files...";
    }
    const fileList = changedFilePaths();
    const renderedFiles =
      fileList.length > 0
        ? fileList.map((path) => `- ${path}`).join("\n")
        : "- (Unable to determine changed files)";
    return `There are still uncommited changes, please attomically commit the following changes\n${renderedFiles}`;
  });
  const isCommitDisabled = createMemo(() => model.agent.isSubmittingPrompt());
  const mergeRequiresRebase = createMemo(() => {
    const status = gitStatus();
    return status?.requiresRebase === true;
  });
  const primaryAction = createMemo<"commit" | "rebase" | "merge" | null>(() => {
    const status = gitStatus();
    if (!status || isWorkflowCompleted()) {
      return null;
    }

    if (status.isWorktreeClean === false) {
      return "commit";
    }

    if (status.requiresRebase) {
      return "rebase";
    }

    if (status.isMergeAllowed) {
      return "merge";
    }

    if (status.isRebaseAllowed) {
      return "rebase";
    }

    return null;
  });
  const isRebaseDisabled = createMemo(() => {
    const status = gitStatus();
    if (!status) {
      return true;
    }
    return (
      model.isRunCompleted() ||
      model.git.isRebasePending() ||
      !status.isRebaseAllowed
    );
  });
  const isMergeDisabled = createMemo(() => {
    const status = gitStatus();
    if (!status) {
      return true;
    }
    return (
      model.isRunCompleted() ||
      model.git.isMergePending() ||
      status.requiresRebase ||
      !status.isMergeAllowed
    );
  });
  const rebaseDisabledReason = createMemo(() => {
    const status = gitStatus();
    if (!status) {
      return "Git status unavailable.";
    }
    if (model.git.isRebasePending()) {
      return "Rebase already running.";
    }
    if (model.isRunCompleted()) {
      return "Run already completed.";
    }
    if (status.isRebaseAllowed) {
      return "";
    }
    return status.rebaseDisabledReason || "Rebase is currently unavailable.";
  });
  const mergeDisabledReason = createMemo(() => {
    const status = gitStatus();
    if (!status) {
      return "Git status unavailable.";
    }
    if (model.git.isMergePending()) {
      return "Merge already running.";
    }
    if (model.isRunCompleted()) {
      return "Run already completed.";
    }
    if (mergeRequiresRebase()) {
      return "Rebase worktree onto source before merge.";
    }
    if (status.isMergeAllowed) {
      return "";
    }
    return status.mergeDisabledReason || "Merge is currently unavailable.";
  });
  const runTopbarTitle = createMemo(() => {
    const runValue = model.run();
    const taskTitle = resolveTaskTitle(model.task()?.title, runValue);
    return taskTitle || "Current task";
  });
  const runTopbarSubtitle = createMemo(
    () =>
      model.task()?.targetRepositoryName ||
      model.task()?.targetRepositoryPath ||
      "Run workspace",
  );

  const logsLines = createMemo<LogLine[]>(() => {
    if (model.agent.error().trim().length > 0) {
      return [
        {
          id: "agent-error",
          timestamp: "--:--:--.---",
          event: "error",
          message: normalizeLogText(model.agent.error().trim()),
          text: `error ${normalizeLogText(model.agent.error().trim())}`,
          completed: false,
          searchText: normalizeLogText(
            model.agent.error().trim(),
          ).toLowerCase(),
        },
      ];
    }

    if (model.agent.state() === "unsupported") {
      return [
        {
          id: "agent-stream-unsupported",
          timestamp: "--:--:--.---",
          event: "status",
          message: "agent stream unsupported",
          text: "agent stream unsupported",
          completed: false,
          searchText: "agent stream unsupported",
        },
      ];
    }

    const events = model.agent.events();
    if (events.length === 0) {
      return [
        {
          id:
            model.agent.state() === "starting"
              ? "waiting-for-logs"
              : "no-logs-yet",
          timestamp: "--:--:--.---",
          event: "status",
          message:
            model.agent.state() === "starting"
              ? "waiting for logs..."
              : "no logs yet",
          text:
            model.agent.state() === "starting"
              ? "waiting for logs..."
              : "no logs yet",
          completed: false,
          searchText:
            model.agent.state() === "starting"
              ? "waiting for logs..."
              : "no logs yet",
        },
      ];
    }

    return events.map((event, index) => {
      const compactTs = formatCompactLogTimestamp(event.ts);
      const name = event.event?.trim() || "event";
      const payload = summarizeEventPayload(event.data);
      const parts = [compactTs, name, payload].filter(
        (part) => part.length > 0,
      );
      const text = parts.join(" ");
      return {
        id: `${index}:${compactTs}:${name}:${payload}`,
        timestamp: compactTs,
        event: name,
        message: payload,
        text,
        completed: isCompletedDebugEvent(name, event.data),
        searchText: text.toLowerCase(),
      };
    });
  });
  const filteredLogRows = createMemo(() => {
    const query = logsSearchQuery().trim().toLowerCase();
    return logsLines().map((line) => ({
      ...line,
      isSearchMatch: query.length > 0 && line.searchText.includes(query),
    }));
  });
  const mountedLogRows = createMemo(() => {
    const rows = filteredLogRows();
    const total = rows.length;
    const end = Math.min(renderedLogWindowEnd(), total);
    const start = Math.min(renderedLogWindowStart(), end);
    return rows.slice(start, end);
  });

  const overlayTitle = createMemo(() => {
    switch (overlayState()) {
      case "drawer-logs":
        return "Agent Logs";
      case "drawer-diff":
        return "Review";
      case "drawer-git":
        return "Source Control";
      case "sheet-terminal":
        return "Terminal";
      default:
        return "";
    }
  });
  const overlayCloseLabel = createMemo(() => {
    switch (overlayState()) {
      case "drawer-logs":
        return "Close Logs panel";
      case "drawer-diff":
        return "Close Review panel";
      case "drawer-git":
        return "Close Source Control panel";
      case "sheet-terminal":
        return "Close Terminal panel";
      default:
        return "Close panel";
    }
  });

  const toggleOverlay = (nextState: Exclude<OverlayState, "none">) => {
    setOverlayState((current) => {
      const next = current === nextState ? "none" : nextState;
      setOverlaySize("normal");
      return next;
    });
  };

  const toggleOverlaySize = () => {
    if (overlayState() === "none") {
      return;
    }

    setOverlaySize((current) =>
      current === "normal" ? "maximized" : "normal",
    );
  };

  const closeOverlay = () => {
    if (overlayState() === "none") {
      return;
    }
    setOverlayState("none");
    setOverlaySize("normal");
  };

  const isNearLogsBottom = (): boolean => {
    const container = logsScrollContainerRef;
    if (!container) {
      return true;
    }
    const distanceFromBottom =
      container.scrollHeight - container.clientHeight - container.scrollTop;
    return distanceFromBottom <= LOG_NEAR_BOTTOM_THRESHOLD;
  };

  const scrollLogsToLatest = (behavior: ScrollBehavior = "auto") => {
    const container = logsScrollContainerRef;
    if (!container) {
      return;
    }

    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: container.scrollHeight, behavior });
      return;
    }

    container.scrollTop = container.scrollHeight;
  };

  const resolveLatestLogWindow = (totalRows: number) => {
    const end = totalRows;
    const start = Math.max(0, end - LOG_RENDER_CHUNK_SIZE);
    return { start, end };
  };

  const mountLatestLogWindow = () => {
    const { start, end } = resolveLatestLogWindow(filteredLogRows().length);
    setRenderedLogWindowStart(start);
    setRenderedLogWindowEnd(end);
  };

  const prependOlderLogChunk = () => {
    const container = logsScrollContainerRef;
    if (!container || isPrependingOlderLogs()) {
      return;
    }

    if (container.scrollTop > LOG_PREPEND_TRIGGER_THRESHOLD) {
      return;
    }

    const currentStart = renderedLogWindowStart();
    if (currentStart <= 0) {
      return;
    }

    const nextStart = Math.max(0, currentStart - LOG_RENDER_CHUNK_SIZE);
    if (nextStart === currentStart) {
      return;
    }

    pendingPrependScrollHeight = container.scrollHeight;
    setIsPrependingOlderLogs(true);
    setRenderedLogWindowStart(nextStart);

    if (pendingPrependFrame !== undefined) {
      cancelAnimationFrame(pendingPrependFrame);
    }

    pendingPrependFrame = requestAnimationFrame(() => {
      const activeContainer = logsScrollContainerRef;
      const previousScrollHeight = pendingPrependScrollHeight;
      pendingPrependScrollHeight = null;

      if (activeContainer && previousScrollHeight !== null) {
        const heightDelta = activeContainer.scrollHeight - previousScrollHeight;
        if (heightDelta > 0) {
          activeContainer.scrollTop += heightDelta;
        }
      }

      setIsPrependingOlderLogs(false);
      pendingPrependFrame = undefined;
    });
  };

  const onLogsScroll = () => {
    const nearBottom = isNearLogsBottom();
    if (nearBottom) {
      if (!isFollowingLogs()) {
        mountLatestLogWindow();
      }
      setIsFollowingLogs(true);
      setHasUnseenLogs(false);
      return;
    }

    setIsFollowingLogs(false);
    prependOlderLogChunk();
  };

  const jumpToLatestLogs = () => {
    mountLatestLogWindow();
    setIsFollowingLogs(true);
    setHasUnseenLogs(false);
    requestAnimationFrame(() => {
      scrollLogsToLatest("smooth");
    });
  };

  const openCommitModal = () => {
    const loadingPrefill =
      "There are still uncommited changes, please attomically commit the following changes\n- Loading changed files...";
    setIsCommitPrefillLoading(true);
    setCommitPromptDraft(loadingPrefill);
    setIsCommitModalOpen(true);

    void model
      .refreshDiffFiles()
      .catch(() => {
        // Keep existing fallback text when refresh fails.
      })
      .finally(() => {
        setIsCommitPrefillLoading(false);
        if (!isCommitModalOpen()) {
          return;
        }
        setCommitPromptDraft(commitPromptPrefill());
      });
  };

  const closeCommitModal = () => {
    setIsCommitModalOpen(false);
  };

  const confirmCommitPrompt = async () => {
    if (isCommitDisabled()) {
      return;
    }

    const accepted = await model.agent.submitPrompt(commitPromptDraft(), {
      markCommitPending: true,
    });
    if (accepted) {
      closeCommitModal();
      closeOverlay();
    }
  };

  createEffect(() => {
    model.setIsDiffTabActive(overlayState() === "drawer-diff");
  });

  createEffect((wasLogsDrawerOpen = false) => {
    const isOpen = isLogsDrawerOpen();
    if (!isOpen || wasLogsDrawerOpen) {
      return isOpen;
    }

    mountLatestLogWindow();
    setIsFollowingLogs(true);
    setHasUnseenLogs(false);

    const frame = requestAnimationFrame(() => {
      scrollLogsToLatest("auto");
    });

    onCleanup(() => {
      cancelAnimationFrame(frame);
    });

    return isOpen;
  });

  createEffect((previousIds: string[] = []) => {
    const currentIds = logsLines().map((line) => line.id);
    if (!isLogsDrawerOpen()) {
      return currentIds;
    }

    const hasAppendedRows =
      previousIds.length > 0 && currentIds.length > previousIds.length;
    if (hasAppendedRows) {
      const appendedIds = currentIds.slice(previousIds.length);
      if (appendedIds.length > 0) {
        setNewlyArrivedLogIds((current) => {
          const next = new Set(current);
          for (const id of appendedIds) {
            next.add(id);

            const existingTimeout = newLogHighlightTimeouts.get(id);
            if (existingTimeout !== undefined) {
              clearTimeout(existingTimeout);
            }

            const timeoutId = window.setTimeout(() => {
              setNewlyArrivedLogIds((active) => {
                const updated = new Set(active);
                updated.delete(id);
                return updated;
              });
              newLogHighlightTimeouts.delete(id);
            }, LOG_NEW_ROW_HIGHLIGHT_MS);
            newLogHighlightTimeouts.set(id, timeoutId);
          }
          return next;
        });
      }

      if (isFollowingLogs()) {
        requestAnimationFrame(() => {
          scrollLogsToLatest("auto");
        });
      } else {
        setHasUnseenLogs(true);
      }
    }

    return currentIds;
  });

  createEffect(() => {
    if (!isLogsDrawerOpen()) {
      return;
    }

    const rows = filteredLogRows();
    const totalRows = rows.length;

    if (isFollowingLogs()) {
      const { start, end } = resolveLatestLogWindow(totalRows);
      setRenderedLogWindowStart(start);
      setRenderedLogWindowEnd(end);
      return;
    }

    if (renderedLogWindowEnd() > totalRows) {
      setRenderedLogWindowEnd(totalRows);
    }

    const end = Math.min(renderedLogWindowEnd(), totalRows);
    if (renderedLogWindowStart() >= end && end > 0) {
      setRenderedLogWindowStart(Math.max(0, end - LOG_RENDER_CHUNK_SIZE));
    }
  });

  onCleanup(() => {
    if (pendingPrependFrame !== undefined) {
      cancelAnimationFrame(pendingPrependFrame);
      pendingPrependFrame = undefined;
    }
    for (const timeoutId of newLogHighlightTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    newLogHighlightTimeouts.clear();
  });

  createEffect(() => {
    const backHref = model.backHref();
    const backLabel = model.backLabel();
    const isLogsOpen = overlayState() === "drawer-logs";
    const isTerminalOpen = overlayState() === "sheet-terminal";
    const isReviewOpen = overlayState() === "drawer-diff";
    const isGitOpen = overlayState() === "drawer-git";
    const isReadOnlyChatMode = model.agent.chatMode() === "read_only";

    window.dispatchEvent(
      new CustomEvent("run-detail:topbar-config", {
        detail: {
          title: runTopbarTitle(),
          subtitle: runTopbarSubtitle(),
          backHref,
          backLabel,
          actions: [
            ...(!isReadOnlyChatMode
              ? [
                  {
                    key: "logs",
                    label: "Logs",
                    icon: "run.logs",
                    pressed: isLogsOpen,
                    onClick: () => toggleOverlay("drawer-logs"),
                  },
                ]
              : []),
            ...(!isReadOnlyChatMode
              ? [
                  {
                    key: "terminal",
                    label: "Terminal",
                    icon: "run.terminal",
                    pressed: isTerminalOpen,
                    onClick: () => toggleOverlay("sheet-terminal"),
                  },
                  {
                    key: "review",
                    label: "Review",
                    icon: "run.review",
                    pressed: isReviewOpen,
                    onClick: () => toggleOverlay("drawer-diff"),
                  },
                ]
              : []),
            {
              key: "git",
              label: "Git",
              icon: "run.git",
              pressed: isGitOpen,
              onClick: () => toggleOverlay("drawer-git"),
            },
          ],
        },
      }),
    );
  });

  onCleanup(() => {
    window.dispatchEvent(new CustomEvent("run-detail:topbar-clear"));
  });

  createEffect((previousOverlayState: OverlayState | undefined) => {
    const currentOverlayState = overlayState();
    if (
      currentOverlayState === "drawer-git" &&
      previousOverlayState !== "drawer-git"
    ) {
      void model.git.refreshStatus();
      void model.refreshDiffFiles().catch(() => {
        // Preserve existing non-crashing behavior when refresh fails.
      });
    }

    return currentOverlayState;
  });

  createEffect(() => {
    if (!isOverlayOpen()) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (isDrawerOverlay()) {
        drawerOverlayCloseButtonRef?.focus();
        return;
      }

      if (isTerminalOverlayOpen()) {
        terminalOverlayCloseButtonRef?.focus();
      }
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isCommitModalOpen()) {
          return;
        }
        event.preventDefault();
        closeOverlay();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  createEffect(() => {
    if (!isCommitModalOpen()) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      commitModalTextareaRef?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCommitModal();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <div class="run-detail-page">
      <Show
        when={!model.error()}
        fallback={
          <section class="projects-panel run-detail-card">
            <p class="projects-error">{model.error()}</p>
          </section>
        }
      >
        <Show
          when={!model.isLoading()}
          fallback={
            <section class="projects-panel run-detail-card">
              <p class="project-placeholder-text">Loading run details.</p>
            </section>
          }
        >
          <Show
            when={model.run()}
            fallback={
              <section class="projects-panel run-detail-card">
                <p class="project-placeholder-text">Run not found.</p>
              </section>
            }
          >
            <>
              <NewRunChatWorkspace
                model={model}
                hideTranscriptScrollbar={isDrawerOverlay()}
              />
              <Show when={isOverlayOpen()}>
                <div
                  class="run-chat-overlay-backdrop"
                  aria-hidden="true"
                  onClick={() => closeOverlay()}
                />
              </Show>
              <Show when={isDrawerOverlay()}>
                <section
                  classList={{
                    "run-chat-overlay-panel": true,
                    "run-chat-overlay-panel--drawer": true,
                    "run-chat-overlay-panel--maximized":
                      overlaySize() === "maximized",
                  }}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="run-chat-overlay-title"
                >
                  <header class="run-chat-overlay-panel__header">
                    <h2
                      id="run-chat-overlay-title"
                      class="run-chat-overlay-panel__title"
                    >
                      {overlayTitle()}
                    </h2>
                    <div class="run-chat-overlay-panel__header-actions">
                      <div class="run-chat-overlay-panel__header-action-row">
                        <button
                          type="button"
                          class="run-chat-overlay-panel__control btn btn-xs btn-square border-base-content/15 bg-base-100 text-base-content/70 hover:bg-base-100 rounded-none border"
                          aria-label={overlaySizeLabel()}
                          title={overlaySizeLabel()}
                          onClick={() => toggleOverlaySize()}
                        >
                          <Show
                            when={overlaySize() === "maximized"}
                            fallback={
                              <svg viewBox="0 0 16 16" aria-hidden="true">
                                <path d="M3.75 2A1.75 1.75 0 0 0 2 3.75v8.5C2 13.216 2.784 14 3.75 14h8.5A1.75 1.75 0 0 0 14 12.25v-8.5A1.75 1.75 0 0 0 12.25 2h-8.5Zm0 1.5h8.5a.25.25 0 0 1 .25.25v8.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-8.5a.25.25 0 0 1 .25-.25Z" />
                              </svg>
                            }
                          >
                            <svg viewBox="0 0 16 16" aria-hidden="true">
                              <path d="M2.75 3A1.75 1.75 0 0 1 4.5 1.25H9a.75.75 0 0 1 0 1.5H4.5a.25.25 0 0 0-.25.25V7.5a.75.75 0 0 1-1.5 0V3Zm4.25 5.5A1.75 1.75 0 0 1 8.75 6.75h4.5A1.75 1.75 0 0 1 15 8.5v4.5a1.75 1.75 0 0 1-1.75 1.75h-4.5A1.75 1.75 0 0 1 7 13V8.5Zm1.75-.25a.25.25 0 0 0-.25.25V13c0 .138.112.25.25.25h4.5a.25.25 0 0 0 .25-.25V8.5a.25.25 0 0 0-.25-.25h-4.5Z" />
                            </svg>
                          </Show>
                        </button>
                        <button
                          ref={drawerOverlayCloseButtonRef}
                          type="button"
                          class="run-chat-overlay-panel__close btn btn-xs btn-square border-base-content/15 bg-base-100 text-base-content/70 hover:bg-base-100 rounded-none border"
                          aria-label={overlayCloseLabel()}
                          title={overlayCloseLabel()}
                          onClick={() => closeOverlay()}
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path
                              d="M4 4l8 8M12 4l-8 8"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.3"
                              stroke-linecap="round"
                            />
                          </svg>
                        </button>
                      </div>
                      <Show when={overlayState() === "drawer-diff"}>
                        <div
                          class="run-chat-overlay-panel__layout-toggle join"
                          role="group"
                          aria-label="Review layout"
                        >
                          <button
                            type="button"
                            class="run-chat-overlay-panel__layout-button join-item btn btn-xs btn-square border-base-content/15 bg-base-100 text-base-content/70 hover:bg-base-100 rounded-none border"
                            aria-label="Unified diff layout"
                            title="Unified diff layout"
                            aria-pressed={!isDiffSideBySide()}
                            onClick={() => setIsDiffSideBySide(false)}
                          >
                            <svg viewBox="0 0 16 16" aria-hidden="true">
                              <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h7A1.5 1.5 0 0 1 13 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-11Zm1.5 0v11h7v-11h-7Zm1 2.25a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Zm0 3a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Zm0 3a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            class="run-chat-overlay-panel__layout-button join-item btn btn-xs btn-square border-base-content/15 bg-base-100 text-base-content/70 hover:bg-base-100 rounded-none border"
                            aria-label="Side-by-side diff layout"
                            title="Side-by-side diff layout"
                            aria-pressed={isDiffSideBySide()}
                            onClick={() => setIsDiffSideBySide(true)}
                          >
                            <svg viewBox="0 0 16 16" aria-hidden="true">
                              <path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1h-11Zm0 1.5h5v11h-5v-11Zm6.5 0h4.5v11H9v-11Zm1 2.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1-.75-.75Zm0 3a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1-.75-.75Zm-7 0a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 3 7.75Zm0-3a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 3 4.75Z" />
                            </svg>
                          </button>
                        </div>
                      </Show>
                    </div>
                  </header>
                  <div
                    classList={{
                      "run-chat-overlay-panel__body": true,
                      "run-chat-overlay-panel__body--logs":
                        overlayState() === "drawer-logs",
                      "run-chat-overlay-panel__body--diff":
                        overlayState() === "drawer-diff",
                      "run-chat-overlay-panel__body--git":
                        overlayState() === "drawer-git",
                    }}
                  >
                    <Show when={overlayState() === "drawer-logs"}>
                      <div class="run-chat-log-viewer">
                        <div class="run-chat-log-viewer__toolbar">
                          <label
                            class="run-chat-log-viewer__search"
                            for="run-chat-log-search"
                          >
                            <span class="sr-only">Find in logs</span>
                            <input
                              id="run-chat-log-search"
                              type="search"
                              placeholder="Find in logs"
                              value={logsSearchQuery()}
                              onInput={(event) =>
                                setLogsSearchQuery(event.currentTarget.value)
                              }
                            />
                          </label>
                          <Show when={isFollowingLogs()}>
                            <span class="run-chat-log-viewer__live-indicator">
                              Live
                            </span>
                          </Show>
                        </div>
                        <div
                          ref={logsScrollContainerRef}
                          class="run-chat-log-stream"
                          role="log"
                          aria-live="polite"
                          aria-atomic="false"
                          onScroll={() => onLogsScroll()}
                        >
                          <For each={mountedLogRows()}>
                            {(line) => (
                              <div
                                classList={{
                                  "run-chat-log-stream__line": true,
                                  "run-chat-log-stream__line--completed":
                                    line.completed,
                                  "run-chat-log-stream__line--match":
                                    line.isSearchMatch,
                                  "run-chat-log-stream__line--new":
                                    newlyArrivedLogIds().has(line.id),
                                }}
                              >
                                <span class="run-chat-log-stream__time">
                                  {line.timestamp}
                                </span>
                                <div class="run-chat-log-stream__content">
                                  <span class="run-chat-log-stream__event">
                                    {line.event}
                                  </span>
                                  <Show when={line.message.length > 0}>
                                    <span class="run-chat-log-stream__message">
                                      {line.message}
                                    </span>
                                  </Show>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                        <Show when={!isFollowingLogs() || hasUnseenLogs()}>
                          <div class="run-chat-log-viewer__jump-wrap">
                            <button
                              type="button"
                              class="run-chat-log-viewer__jump"
                              onClick={() => jumpToLatestLogs()}
                            >
                              Jump to latest
                            </button>
                          </div>
                        </Show>
                      </div>
                    </Show>
                    <Show when={overlayState() === "drawer-diff"}>
                      <RunDiffDrawerPanel
                        model={model}
                        isActive={overlayState() === "drawer-diff"}
                        isSideBySide={isDiffSideBySide()}
                      />
                    </Show>
                    <Show when={overlayState() === "drawer-git"}>
                      <section
                        class="run-chat-git-drawer"
                        aria-label="Source control workflow"
                      >
                        <Show when={model.git.isLoading()}>
                          <p class="project-placeholder-text">
                            Loading git status.
                          </p>
                        </Show>
                        <Show when={model.git.statusError().length > 0}>
                          <p class="projects-error">
                            {model.git.statusError()}
                          </p>
                        </Show>
                        <Show when={gitStatus()}>
                          {(status) => (
                            <>
                              <section class="run-chat-git-drawer__summary">
                                <p class="run-chat-git-drawer__summary-headline">
                                  {summaryCopy().headline}
                                </p>
                                <p class="run-chat-git-drawer__summary-support">
                                  {summaryCopy().support}
                                </p>
                              </section>
                              <div class="run-chat-git-drawer__branches">
                                <article class="run-chat-git-drawer__branch-row">
                                  <p class="run-chat-git-drawer__branch-label">
                                    Source
                                  </p>
                                  <p class="run-chat-git-drawer__branch-name">
                                    {status().sourceBranch.name}
                                  </p>
                                  <p class="run-chat-git-drawer__branch-sync">
                                    <span class="run-chat-git-drawer__branch-sync-positive">
                                      +{status().sourceBranch.ahead}
                                    </span>
                                    <span class="run-chat-git-drawer__branch-sync-separator">
                                      /
                                    </span>
                                    <span class="run-chat-git-drawer__branch-sync-negative">
                                      -{status().sourceBranch.behind}
                                    </span>
                                  </p>
                                </article>
                                <article class="run-chat-git-drawer__branch-row">
                                  <p class="run-chat-git-drawer__branch-label">
                                    Current
                                  </p>
                                  <p class="run-chat-git-drawer__branch-name">
                                    {status().worktreeBranch.name}
                                  </p>
                                  <p class="run-chat-git-drawer__branch-sync">
                                    <span class="run-chat-git-drawer__branch-sync-positive">
                                      +{status().worktreeBranch.ahead}
                                    </span>
                                    <span class="run-chat-git-drawer__branch-sync-separator">
                                      /
                                    </span>
                                    <span class="run-chat-git-drawer__branch-sync-negative">
                                      -{status().worktreeBranch.behind}
                                    </span>
                                  </p>
                                </article>
                              </div>
                              <p class="run-chat-git-drawer__state-row">
                                <span class="run-chat-git-drawer__state-label">
                                  Repository status
                                </span>
                                <span class="run-chat-git-drawer__state-value">
                                  {formatGitStateLabel(
                                    status().state,
                                    status().rawState,
                                  )}
                                </span>
                              </p>
                              <p class="run-chat-git-drawer__state-row">
                                <span class="run-chat-git-drawer__state-label">
                                  Working tree status
                                </span>
                                <span class="run-chat-git-drawer__state-value">
                                  {status().isWorktreeClean === true
                                    ? "Clean"
                                    : status().isWorktreeClean === false
                                      ? "Changes detected"
                                      : "Unknown"}
                                </span>
                              </p>
                              <Show
                                when={model.git.lastActionMessage().length > 0}
                              >
                                <p class="project-placeholder-text">
                                  {model.git.lastActionMessage()}
                                </p>
                              </Show>
                              <Show
                                when={
                                  model.postMergeCompletionMessage().length > 0
                                }
                              >
                                <p
                                  class="project-placeholder-text"
                                  aria-live="polite"
                                >
                                  {model.postMergeCompletionMessage()}
                                </p>
                              </Show>
                              <Show when={model.git.actionError().length > 0}>
                                <p class="projects-error">
                                  {model.git.actionError()}
                                </p>
                              </Show>
                              <div class="run-chat-git-drawer__footer">
                                <Show when={isWorkflowCompleted()}>
                                  <p
                                    class="run-chat-git-drawer__button run-chat-git-drawer__button--success"
                                    aria-live="polite"
                                  >
                                    MERGED
                                  </p>
                                </Show>
                                <Show when={primaryAction() === "rebase"}>
                                  <button
                                    type="button"
                                    class="run-chat-git-drawer__button"
                                    disabled={isRebaseDisabled()}
                                    title={rebaseDisabledReason() || undefined}
                                    onClick={() => {
                                      void model.git.rebaseWorktreeOntoSource();
                                    }}
                                  >
                                    Rebase onto {baseBranchName()}
                                  </button>
                                  <Show
                                    when={rebaseDisabledReason().length > 0}
                                  >
                                    <p class="project-placeholder-text">
                                      {rebaseDisabledReason()}
                                    </p>
                                  </Show>
                                </Show>
                                <Show when={primaryAction() === "merge"}>
                                  <button
                                    type="button"
                                    class="run-chat-git-drawer__button"
                                    disabled={isMergeDisabled()}
                                    title={mergeDisabledReason() || undefined}
                                    onClick={() => {
                                      void model.git.mergeWorktreeIntoSource();
                                    }}
                                  >
                                    Merge into {baseBranchName()}
                                  </button>
                                  <Show when={mergeDisabledReason().length > 0}>
                                    <p class="project-placeholder-text">
                                      {mergeDisabledReason()}
                                    </p>
                                  </Show>
                                </Show>
                                <Show when={primaryAction() === "commit"}>
                                  <button
                                    type="button"
                                    class="run-chat-git-drawer__button"
                                    onClick={() => openCommitModal()}
                                  >
                                    Commit changes
                                  </button>
                                </Show>
                              </div>
                            </>
                          )}
                        </Show>
                      </section>
                    </Show>
                  </div>
                </section>
              </Show>
              <section
                classList={{
                  "run-chat-overlay-panel": true,
                  "run-chat-overlay-panel--sheet": true,
                  "run-chat-overlay-panel--maximized":
                    overlaySize() === "maximized",
                  "run-chat-overlay-panel--hidden": !isTerminalOverlayOpen(),
                }}
                role="dialog"
                aria-modal={isTerminalOverlayOpen() ? "true" : undefined}
                aria-hidden={!isTerminalOverlayOpen()}
                aria-labelledby="run-chat-overlay-title-terminal"
              >
                <header class="run-chat-overlay-panel__header">
                  <h2
                    id="run-chat-overlay-title-terminal"
                    class="run-chat-overlay-panel__title"
                  >
                    {overlayTitle()}
                  </h2>
                  <div class="run-chat-overlay-panel__header-actions">
                    <button
                      type="button"
                      class="run-chat-overlay-panel__control btn btn-xs btn-square border-base-content/15 bg-base-100 text-base-content/70 hover:bg-base-100 rounded-none border"
                      aria-label={overlaySizeLabel()}
                      title={overlaySizeLabel()}
                      onClick={() => toggleOverlaySize()}
                    >
                      <Show
                        when={overlaySize() === "maximized"}
                        fallback={
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M3.75 2A1.75 1.75 0 0 0 2 3.75v8.5C2 13.216 2.784 14 3.75 14h8.5A1.75 1.75 0 0 0 14 12.25v-8.5A1.75 1.75 0 0 0 12.25 2h-8.5Zm0 1.5h8.5a.25.25 0 0 1 .25.25v8.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-8.5a.25.25 0 0 1 .25-.25Z" />
                          </svg>
                        }
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M2.75 3A1.75 1.75 0 0 1 4.5 1.25H9a.75.75 0 0 1 0 1.5H4.5a.25.25 0 0 0-.25.25V7.5a.75.75 0 0 1-1.5 0V3Zm4.25 5.5A1.75 1.75 0 0 1 8.75 6.75h4.5A1.75 1.75 0 0 1 15 8.5v4.5a1.75 1.75 0 0 1-1.75 1.75h-4.5A1.75 1.75 0 0 1 7 13V8.5Zm1.75-.25a.25.25 0 0 0-.25.25V13c0 .138.112.25.25.25h4.5a.25.25 0 0 0 .25-.25V8.5a.25.25 0 0 0-.25-.25h-4.5Z" />
                        </svg>
                      </Show>
                    </button>
                    <button
                      ref={terminalOverlayCloseButtonRef}
                      type="button"
                      class="run-chat-overlay-panel__close btn btn-xs btn-square border-base-content/15 bg-base-100 text-base-content/70 hover:bg-base-100 rounded-none border"
                      aria-label={overlayCloseLabel()}
                      title={overlayCloseLabel()}
                      onClick={() => closeOverlay()}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M4 4l8 8M12 4l-8 8"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                </header>
                <div class="run-chat-overlay-panel__body run-chat-overlay-panel__body--terminal">
                  <Suspense
                    fallback={
                      <p class="project-placeholder-text">Loading terminal.</p>
                    }
                  >
                    <RunTerminal
                      isVisible={overlayState() === "sheet-terminal"}
                      isStarting={model.terminal.isStarting()}
                      isReady={model.terminal.isReady()}
                      isInputEnabled={model.terminal.isInputEnabled()}
                      error={model.terminal.error()}
                      writeTerminal={model.terminal.writeTerminal}
                      resizeTerminal={model.terminal.resizeTerminal}
                      setTerminalFrameHandler={
                        model.terminal.setTerminalFrameHandler
                      }
                    />
                  </Suspense>
                </div>
              </section>
              <Show when={isCommitModalOpen()}>
                <div
                  class="projects-modal-backdrop"
                  role="presentation"
                  onClick={() => closeCommitModal()}
                >
                  <section
                    class="projects-modal task-create-dependency-modal border-base-content/15 bg-base-200 rounded-none border"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="run-commit-modal-title"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div class="border-base-content/10 mb-4 border-b pb-3">
                      <h2
                        id="run-commit-modal-title"
                        class="task-delete-modal-title"
                      >
                        Ask agent to commit changes
                      </h2>
                      <p class="text-base-content/55 mt-1 text-xs">
                        Send a commit request to the active run with the current
                        changed files.
                      </p>
                    </div>
                    <label
                      class="projects-field"
                      for="run-commit-modal-message"
                    >
                      <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                        <span class="field-label-text">Message</span>
                      </span>
                      <textarea
                        ref={commitModalTextareaRef}
                        id="run-commit-modal-message"
                        rows={8}
                        aria-label="Commit request message"
                        value={commitPromptDraft()}
                        onInput={(event) =>
                          setCommitPromptDraft(event.currentTarget.value)
                        }
                      />
                    </label>
                    <Show when={model.agent.submitError().length > 0}>
                      <p class="projects-error">{model.agent.submitError()}</p>
                    </Show>
                    <div class="task-delete-modal-actions">
                      <button
                        type="button"
                        class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                        onClick={() => closeCommitModal()}
                        disabled={isCommitDisabled()}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                        onClick={() => {
                          void confirmCommitPrompt();
                        }}
                        disabled={
                          isCommitDisabled() ||
                          commitPromptDraft().trim().length === 0
                        }
                      >
                        {isCommitDisabled()
                          ? "Committing changes"
                          : "Send to agent"}
                      </button>
                    </div>
                  </section>
                </div>
              </Show>
            </>
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default NewRunDetailScreen;
