import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from "solid-js";
import BackIconLink from "../../../components/ui/BackIconLink";
import NewRunChatWorkspace from "../components/NewRunChatWorkspace";
import RunDiffDrawerPanel from "../components/RunDiffDrawerPanel";
import RunTerminal from "../components/RunTerminal";
import { formatGitStateLabel } from "./gitStateLabels";
import { useRunDetailModel } from "../model/useRunDetailModel";

type OverlayState =
  | "none"
  | "drawer-logs"
  | "drawer-diff"
  | "drawer-git"
  | "sheet-terminal";

type OverlaySize = "normal" | "maximized";

const INTERNAL_ID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const redactInternalIds = (value: string): string =>
  value.replace(INTERNAL_ID_PATTERN, "[internal-id]");

const normalizeLogText = (value: string): string =>
  redactInternalIds(value).replace(/\r\n|\r|\n/g, "\\n");

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

const formatBranchDirection = (ahead: number, behind: number): string => {
  return `ahead ${ahead} / behind ${behind}`;
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
  const [lastTriggerButton, setLastTriggerButton] =
    createSignal<HTMLButtonElement | null>(null);
  let drawerOverlayCloseButtonRef: HTMLButtonElement | undefined;
  let terminalOverlayCloseButtonRef: HTMLButtonElement | undefined;
  let commitModalTextareaRef: HTMLTextAreaElement | undefined;

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
  const overlaySizeLabel = createMemo(() =>
    overlaySize() === "maximized" ? "Restore panel" : "Maximize panel",
  );
  const gitStatus = createMemo(() => model.git.status());
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
  const isCommitActionVisible = createMemo(() => {
    const status = gitStatus();
    return status?.isWorktreeClean === false;
  });
  const mergeRequiresRebase = createMemo(() => {
    const status = gitStatus();
    return status?.requiresRebase === true;
  });
  const isRebaseActionVisible = createMemo(() => {
    const status = gitStatus();
    if (!status) {
      return false;
    }
    return status.isRebaseAllowed || status.requiresRebase;
  });
  const isMergeActionVisible = createMemo(() => {
    const status = gitStatus();
    if (!status) {
      return false;
    }
    return status.isMergeAllowed && !status.requiresRebase;
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

  const logsLines = createMemo(() => {
    if (model.agent.error().trim().length > 0) {
      return [`error ${normalizeLogText(model.agent.error().trim())}`];
    }

    if (model.agent.state() === "unsupported") {
      return ["agent stream unsupported"];
    }

    const events = model.agent.events();
    if (events.length === 0) {
      return [
        model.agent.state() === "starting"
          ? "waiting for logs..."
          : "no logs yet",
      ];
    }

    return events.map((event) => {
      const ts = formatLogTimestamp(event.ts);
      const name = event.event?.trim() || "event";
      const payload = summarizeEventPayload(event.data);
      const parts = [ts, name, payload].filter((part) => part.length > 0);
      return parts.join(" ");
    });
  });

  const overlayTitle = createMemo(() => {
    switch (overlayState()) {
      case "drawer-logs":
        return "Logs";
      case "drawer-diff":
        return "Review";
      case "drawer-git":
        return "Git";
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
        return "Close Git panel";
      case "sheet-terminal":
        return "Close Terminal panel";
      default:
        return "Close panel";
    }
  });

  const toggleOverlay = (
    nextState: Exclude<OverlayState, "none">,
    triggerButton: HTMLButtonElement,
  ) => {
    setLastTriggerButton(triggerButton);
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

    const accepted = await model.agent.submitPrompt(commitPromptDraft());
    if (accepted) {
      closeCommitModal();
      closeOverlay();
    }
  };

  createEffect(() => {
    model.setIsDiffTabActive(overlayState() === "drawer-diff");
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
      const trigger = lastTriggerButton();
      if (trigger) {
        trigger.focus();
      }
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
              <section class="run-chat-back-nav" aria-label="Run navigation">
                <BackIconLink
                  href={model.backHref()}
                  label={model.backLabel()}
                  class="project-detail-back-link project-detail-back-link--icon task-detail-back-link"
                />
              </section>
              <NewRunChatWorkspace
                model={model}
                hideTranscriptScrollbar={isDrawerOverlay()}
              />
              <div
                class="run-chat-floating-toolbar"
                role="toolbar"
                aria-label="Run chat tools"
              >
                <button
                  type="button"
                  class="run-chat-floating-toolbar__button"
                  aria-label="Logs"
                  aria-pressed={overlayState() === "drawer-logs"}
                  title="Logs"
                  onClick={(event) =>
                    toggleOverlay("drawer-logs", event.currentTarget)
                  }
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.75 1A1.75 1.75 0 0 0 2 2.75v10.5C2 14.216 2.784 15 3.75 15h8.5A1.75 1.75 0 0 0 14 13.25V4.81a2.5 2.5 0 0 0-.732-1.768L11.958 1.73A2.5 2.5 0 0 0 10.19 1H3.75Zm0 1.5h6v2.75c0 .966.784 1.75 1.75 1.75h1v6.25a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25V2.75a.25.25 0 0 1 .25-.25Zm7.5.56.68.68a1 1 0 0 1 .294.707v1.053h-.723a.25.25 0 0 1-.25-.25V3.06ZM4.75 8a.75.75 0 0 1 .75-.75h5a.75.75 0 0 1 0 1.5h-5A.75.75 0 0 1 4.75 8Zm0 2.5a.75.75 0 0 1 .75-.75h5a.75.75 0 0 1 0 1.5h-5a.75.75 0 0 1-.75-.75Zm0 2.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1-.75-.75Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="run-chat-floating-toolbar__button"
                  aria-label="Terminal"
                  aria-pressed={overlayState() === "sheet-terminal"}
                  title="Terminal"
                  onClick={(event) =>
                    toggleOverlay("sheet-terminal", event.currentTarget)
                  }
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M2.75 2A1.75 1.75 0 0 0 1 3.75v8.5C1 13.216 1.784 14 2.75 14h10.5A1.75 1.75 0 0 0 15 12.25v-8.5A1.75 1.75 0 0 0 13.25 2H2.75Zm0 1.5h10.5a.25.25 0 0 1 .25.25v8.5a.25.25 0 0 1-.25.25H2.75a.25.25 0 0 1-.25-.25v-8.5a.25.25 0 0 1 .25-.25Zm1.24 2.09a.75.75 0 0 0-.98 1.14l1.75 1.5a.25.25 0 0 1 0 .38l-1.75 1.5a.75.75 0 1 0 .98 1.14l1.75-1.5a1.75 1.75 0 0 0 0-2.66l-1.75-1.5Zm4.26 4.66a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="run-chat-floating-toolbar__button"
                  aria-label="Review"
                  aria-pressed={overlayState() === "drawer-diff"}
                  title="Review"
                  onClick={(event) =>
                    toggleOverlay("drawer-diff", event.currentTarget)
                  }
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M5.75 2a.75.75 0 0 1 .75.75V5h2.5V2.75a.75.75 0 0 1 1.5 0V5h.75a1.75 1.75 0 0 1 1.75 1.75v6.5A1.75 1.75 0 0 1 11.75 15h-7A1.75 1.75 0 0 1 3 13.25v-6.5A1.75 1.75 0 0 1 4.75 5h.75V2.75A.75.75 0 0 1 5.75 2Zm0 4.5h-1a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25h7a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25h-1v1.75a.75.75 0 0 1-1.5 0V6.5H6.5v1.75a.75.75 0 0 1-1.5 0V6.5Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="run-chat-floating-toolbar__button"
                  aria-label="Git"
                  aria-pressed={overlayState() === "drawer-git"}
                  title="Git"
                  onClick={(event) =>
                    toggleOverlay("drawer-git", event.currentTarget)
                  }
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 1.5a2.5 2.5 0 0 0-1.25 4.665v3.17A2.5 2.5 0 1 0 8.5 11.7v-1.35h2.17a2.5 2.5 0 1 0 0-1.5H8.5v-2.68A2.5 2.5 0 1 0 8 1.5Zm0 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM5 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm7-3a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
                  </svg>
                </button>
              </div>
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
                          class="run-chat-overlay-panel__control"
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
                          class="run-chat-overlay-panel__close"
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
                          class="run-chat-overlay-panel__layout-toggle"
                          role="group"
                          aria-label="Review layout"
                        >
                          <button
                            type="button"
                            class="run-chat-overlay-panel__layout-button"
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
                            class="run-chat-overlay-panel__layout-button"
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
                      <div
                        class="run-chat-log-stream"
                        role="log"
                        aria-live="polite"
                        aria-atomic="false"
                      >
                        <For each={logsLines()}>{(line) => <p>{line}</p>}</For>
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
                        aria-label="Git merge workflow"
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
                              <div class="run-chat-git-drawer__branches">
                                <article class="run-chat-git-drawer__branch-card">
                                  <h3>
                                    Source branch to{" "}
                                    {status().sourceBranch.name}
                                  </h3>
                                  <p>
                                    {formatBranchDirection(
                                      status().sourceBranch.ahead,
                                      status().sourceBranch.behind,
                                    )}
                                  </p>
                                </article>
                                <article class="run-chat-git-drawer__branch-card">
                                  <h3>
                                    Worktree branch to{" "}
                                    {status().worktreeBranch.name}
                                  </h3>
                                  <p>
                                    {formatBranchDirection(
                                      status().worktreeBranch.ahead,
                                      status().worktreeBranch.behind,
                                    )}
                                  </p>
                                </article>
                              </div>
                              <p class="run-chat-git-drawer__state">
                                Backend state:{" "}
                                {formatGitStateLabel(
                                  status().state,
                                  status().rawState,
                                )}
                              </p>
                              <p class="run-chat-git-drawer__state">
                                Worktree:{" "}
                                {status().isWorktreeClean === true
                                  ? "Clean"
                                  : status().isWorktreeClean === false
                                    ? "Dirty"
                                    : "Unknown"}
                              </p>
                              <p class="project-placeholder-text">
                                Ahead/behind counts reflect committed branch
                                divergence only. Worktree cleanliness is shown
                                separately. Review diffs can still include
                                uncommitted worktree changes.
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
                              <div class="run-chat-git-drawer__actions">
                                <Show when={isRebaseActionVisible()}>
                                  <button
                                    type="button"
                                    class="run-chat-git-drawer__button"
                                    disabled={isRebaseDisabled()}
                                    title={rebaseDisabledReason() || undefined}
                                    onClick={() => {
                                      void model.git.rebaseWorktreeOntoSource();
                                    }}
                                  >
                                    Rebase Worktree onto Source
                                  </button>
                                  <Show
                                    when={rebaseDisabledReason().length > 0}
                                  >
                                    <p class="project-placeholder-text">
                                      {rebaseDisabledReason()}
                                    </p>
                                  </Show>
                                </Show>
                                <Show when={isMergeActionVisible()}>
                                  <button
                                    type="button"
                                    class="run-chat-git-drawer__button"
                                    disabled={isMergeDisabled()}
                                    title={mergeDisabledReason() || undefined}
                                    onClick={() => {
                                      void model.git.mergeWorktreeIntoSource();
                                    }}
                                  >
                                    Merge Worktree into Source
                                  </button>
                                  <Show when={mergeDisabledReason().length > 0}>
                                    <p class="project-placeholder-text">
                                      {mergeDisabledReason()}
                                    </p>
                                  </Show>
                                </Show>
                                <Show when={isCommitActionVisible()}>
                                  <button
                                    type="button"
                                    class="run-chat-git-drawer__button"
                                    onClick={() => openCommitModal()}
                                  >
                                    Commit Changes
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
                      class="run-chat-overlay-panel__control"
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
                      class="run-chat-overlay-panel__close"
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
                </div>
              </section>
              <Show when={isCommitModalOpen()}>
                <div
                  class="projects-modal-backdrop"
                  role="presentation"
                  onClick={() => closeCommitModal()}
                >
                  <section
                    class="projects-modal task-create-dependency-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="run-commit-modal-title"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <h2
                      id="run-commit-modal-title"
                      class="task-delete-modal-title"
                    >
                      Ask agent to commit changes
                    </h2>
                    <label
                      class="projects-field"
                      for="run-commit-modal-message"
                    >
                      <span class="field-label">
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
                        class="projects-button-muted"
                        onClick={() => closeCommitModal()}
                        disabled={isCommitDisabled()}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        class="projects-button-primary"
                        onClick={() => {
                          void confirmCommitPrompt();
                        }}
                        disabled={
                          isCommitDisabled() ||
                          commitPromptDraft().trim().length === 0
                        }
                      >
                        {isCommitDisabled() ? "Sending..." : "Send to agent"}
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
