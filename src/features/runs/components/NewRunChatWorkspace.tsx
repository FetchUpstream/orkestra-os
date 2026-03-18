import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
  type JSX,
} from "solid-js";
import {
  RunChatAssistantMessage,
  RunChatComposer,
  RunChatMarkdown,
  RunChatMessage,
  RunChatSystemMessage,
  RunChatToolRail,
  RunChatTranscript,
  RunChatUserMessage,
  type RunChatToolRailItem,
} from "./chat";
import type { UiPart } from "../model/agentTypes";
import { useRunDetailModel } from "../model/useRunDetailModel";
import { formatDateTime } from "../../tasks/utils/taskDetail";

type AgentReadinessPhase =
  | "warming_backend"
  | "creating_session"
  | "ready"
  | "reconnecting"
  | "submit_failed"
  | null;

type NewRunChatWorkspaceProps = {
  model: ReturnType<typeof useRunDetailModel>;
};

const TRANSCRIPT_WINDOW_CHUNK = 60;
const AUTO_SCROLL_NEAR_BOTTOM_PX = 96;
const INTERNAL_ID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toSingleLine = (value: unknown, maxLength = 140): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const asText =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : null;

  if (asText === null) {
    return null;
  }

  const normalized = asText
    .replace(INTERNAL_ID_PATTERN, "[internal-id]")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`;
};

const getNestedValueByKeys = (
  value: unknown,
  keys: readonly string[],
  depth = 0,
): unknown => {
  if (!isRecord(value) || depth > 3) {
    return undefined;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      return value[key];
    }
  }

  for (const nestedValue of Object.values(value)) {
    const candidate = getNestedValueByKeys(nestedValue, keys, depth + 1);
    if (candidate !== undefined) {
      return candidate;
    }
  }

  return undefined;
};

const toToolLabel = (toolName: string | null | undefined): string => {
  const raw = toolName?.trim();
  if (!raw) {
    return "Tool";
  }

  const leaf = raw.includes(".")
    ? (() => {
        const segments = raw.split(".");
        return segments[segments.length - 1] || raw;
      })()
    : raw;
  const normalized = leaf.replace(/[-_]+/g, " ").trim();
  if (normalized.length === 0) {
    return "Tool";
  }

  return normalized
    .split(/\s+/)
    .map(
      (segment: string) => segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join(" ");
};

const buildToolSummary = (part: UiPart): string => {
  if (part.kind !== "tool") {
    return "";
  }

  const toolName = toToolLabel(part.toolName);
  const normalizedToolName = (part.toolName || "").trim().toLowerCase();
  const input = part.input;
  const include = toSingleLine(getNestedValueByKeys(input, ["include"]), 60);

  const asPath = toSingleLine(
    getNestedValueByKeys(input, ["filePath", "path", "filename"]),
  );
  const asCommand = toSingleLine(
    getNestedValueByKeys(input, ["command", "bash", "script", "cmd"]),
  );
  const asUrl = toSingleLine(getNestedValueByKeys(input, ["url", "href"]));
  const asQuery = toSingleLine(
    getNestedValueByKeys(input, ["query", "searchQuery", "q", "keywords"]),
  );
  const asPattern = toSingleLine(
    getNestedValueByKeys(input, ["pattern", "glob"]),
  );
  const asHeader = toSingleLine(getNestedValueByKeys(input, ["header"]));

  let focused =
    toSingleLine(part.title) ||
    asCommand ||
    asUrl ||
    asPath ||
    asQuery ||
    asPattern ||
    asHeader;

  if (normalizedToolName.includes("read") && asPath) {
    focused = asPath;
  } else if (normalizedToolName.includes("bash") && asCommand) {
    focused = asCommand;
  } else if (normalizedToolName.includes("webfetch") && asUrl) {
    focused = asUrl;
  } else if (normalizedToolName.includes("websearch") && asQuery) {
    focused = asQuery;
  } else if (normalizedToolName.includes("glob") && asPattern) {
    focused = asPattern;
  } else if (normalizedToolName.includes("grep")) {
    const grepPattern = asPattern;
    if (grepPattern && include) {
      focused = `${grepPattern} in ${include}`;
    } else if (grepPattern) {
      focused = grepPattern;
    }
  } else if (normalizedToolName.includes("question") && asHeader) {
    focused = asHeader;
  } else if (normalizedToolName.includes("todowrite")) {
    const todos = getNestedValueByKeys(input, ["todos"]);
    if (Array.isArray(todos)) {
      const firstTodo = todos[0];
      const firstText = toSingleLine(
        isRecord(firstTodo)
          ? firstTodo.content || firstTodo.text || firstTodo.title
          : firstTodo,
      );
      focused =
        firstText || `${todos.length} todo${todos.length === 1 ? "" : "s"}`;
    }
  } else if (normalizedToolName.includes("apply_patch")) {
    const patchText = toSingleLine(
      getNestedValueByKeys(input, ["patchText"]),
      4000,
    );
    if (patchText) {
      const matches = patchText.match(/\*\*\*\s(?:Add|Update|Delete)\sFile:/g);
      focused =
        matches && matches.length > 0
          ? `${matches.length} file${matches.length === 1 ? "" : "s"}`
          : "patch";
    }
  } else if (normalizedToolName.includes("background_task")) {
    focused =
      toSingleLine(getNestedValueByKeys(input, ["description", "task"])) ||
      focused;
  } else if (normalizedToolName.includes("background_output")) {
    focused =
      toSingleLine(getNestedValueByKeys(input, ["task_id", "taskId"])) ||
      focused;
  } else if (normalizedToolName.includes("background_cancel")) {
    focused =
      toSingleLine(getNestedValueByKeys(input, ["task_id", "target"])) ||
      (getNestedValueByKeys(input, ["all"]) === true ? "all tasks" : focused);
  } else if (normalizedToolName.includes("lsp_")) {
    focused =
      toSingleLine(
        getNestedValueByKeys(input, ["filePath", "newName", "line"]),
      ) || focused;
  } else if (normalizedToolName.includes("ast_grep_")) {
    focused = toSingleLine(getNestedValueByKeys(input, ["pattern"])) || focused;
  }

  return `-> ${toolName}${focused ? ` ${focused}` : ""}`;
};

const NewRunChatWorkspace: Component<NewRunChatWorkspaceProps> = (props) => {
  const [composerValue, setComposerValue] = createSignal("");
  const [hasVisibleSubmitFailed, setHasVisibleSubmitFailed] =
    createSignal(false);
  const [isTranscriptAutoFollowEnabled, setIsTranscriptAutoFollowEnabled] =
    createSignal(true);
  const [transcriptVisibleCount, setTranscriptVisibleCount] = createSignal(
    TRANSCRIPT_WINDOW_CHUNK,
  );
  const [runChatComposerOffsetPx, setRunChatComposerOffsetPx] =
    createSignal("0px");

  let transcriptScrollRef: HTMLDivElement | undefined;
  let transcriptBottomRef: HTMLDivElement | undefined;
  let runChatComposerRef: HTMLDivElement | undefined;
  let transcriptScrollRaf: number | null = null;
  let transcriptProgrammaticScrollResetRaf: number | null = null;
  let isTranscriptProgrammaticScroll = false;

  const agentReadinessPhase = createMemo<AgentReadinessPhase>(() =>
    props.model.agent.readinessPhase(),
  );
  const visibleAgentReadinessPhase = createMemo<AgentReadinessPhase>(() => {
    if (hasVisibleSubmitFailed()) {
      const phase = agentReadinessPhase();
      if (phase !== "ready") {
        return "submit_failed";
      }
    }

    return agentReadinessPhase();
  });
  const agentReadinessCopy = createMemo<string | null>(() => {
    switch (visibleAgentReadinessPhase()) {
      case "warming_backend":
        return "Warming backend.";
      case "creating_session":
        return "Creating session.";
      case "ready":
        return "Ready.";
      case "reconnecting":
        return "Reconnecting stream.";
      case "submit_failed":
        return "Submit failed.";
      default:
        return null;
    }
  });
  const isComposerBlockedByReadiness = createMemo(() => {
    const phase = visibleAgentReadinessPhase();
    return (
      phase === "warming_backend" ||
      phase === "creating_session" ||
      phase === "reconnecting"
    );
  });
  const isTranscriptWaitingForAgentOutput = createMemo(() => {
    const phase = agentReadinessPhase();
    return (
      props.model.agent.state() === "starting" ||
      phase === "warming_backend" ||
      phase === "creating_session" ||
      phase === "reconnecting"
    );
  });

  const isNearBottom = (
    element: HTMLElement,
    thresholdPx = AUTO_SCROLL_NEAR_BOTTOM_PX,
  ): boolean =>
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    thresholdPx;

  const markTranscriptProgrammaticScroll = () => {
    isTranscriptProgrammaticScroll = true;
    if (transcriptProgrammaticScrollResetRaf !== null) {
      cancelAnimationFrame(transcriptProgrammaticScrollResetRaf);
    }
    transcriptProgrammaticScrollResetRaf = requestAnimationFrame(() => {
      transcriptProgrammaticScrollResetRaf = null;
      isTranscriptProgrammaticScroll = false;
    });
  };

  const scheduleTranscriptScrollToBottom = () => {
    if (transcriptScrollRaf !== null) {
      return;
    }

    transcriptScrollRaf = requestAnimationFrame(() => {
      transcriptScrollRaf = null;
      if (!isTranscriptAutoFollowEnabled()) {
        return;
      }

      markTranscriptProgrammaticScroll();

      if (transcriptBottomRef) {
        transcriptBottomRef.scrollIntoView({
          block: "end",
          inline: "nearest",
          behavior: "auto",
        });
        return;
      }

      if (transcriptScrollRef) {
        transcriptScrollRef.scrollTop = transcriptScrollRef.scrollHeight;
      }
    });
  };

  const getPartScrollRevision = (part: UiPart): string => {
    if (part.kind === "text" || part.kind === "reasoning") {
      const streamChunkCount = Array.isArray(part.streamChunks)
        ? part.streamChunks.length
        : 0;
      const streamTextLength =
        typeof part.streamTextLength === "number"
          ? part.streamTextLength
          : typeof part.streamText === "string"
            ? part.streamText.length
            : part.text.length;
      const streamRevision =
        typeof part.streamRevision === "number" ? part.streamRevision : 0;
      return `${part.kind}:${part.streaming ? 1 : 0}:${part.text.length}:${streamChunkCount}:${streamTextLength}:${streamRevision}`;
    }

    if (part.kind === "tool") {
      return [
        part.kind,
        part.toolName || "",
        part.status || "",
        typeof part.title === "string" ? part.title.length : "",
      ].join("|");
    }

    if (part.kind === "file") {
      return `${part.kind}:${part.filename}`;
    }

    if (part.kind === "patch") {
      return `${part.kind}:${part.hash}`;
    }

    if (part.kind === "step-start") {
      return part.kind;
    }

    if (part.kind === "step-finish") {
      const reason =
        part.reason === undefined || part.reason === null
          ? ""
          : String(part.reason).replace(INTERNAL_ID_PATTERN, "[internal-id]");
      return `${part.kind}:${reason}`;
    }

    if (part.kind === "unknown") {
      return `${part.kind}:${part.rawType || ""}`;
    }

    return "";
  };

  const transcriptMessageOrder = createMemo(
    () => props.model.agent.store().messageOrder,
  );

  const transcriptHiddenMessageCount = createMemo(() => {
    return Math.max(
      0,
      transcriptMessageOrder().length - transcriptVisibleCount(),
    );
  });

  const visibleTranscriptMessageIds = createMemo(() => {
    const order = transcriptMessageOrder();
    const startIndex = Math.max(0, order.length - transcriptVisibleCount());
    return order.slice(startIndex);
  });

  const formatAgentPayload = (payload: unknown): string => {
    if (payload === undefined) {
      return "undefined";
    }

    try {
      const serialized = JSON.stringify(
        payload,
        (_key, value) =>
          typeof value === "string"
            ? value.replace(INTERNAL_ID_PATTERN, "[internal-id]")
            : value,
        2,
      );
      if (typeof serialized === "string") {
        return serialized;
      }
    } catch {}

    if (typeof payload === "string") {
      return payload.replace(INTERNAL_ID_PATTERN, "[internal-id]");
    }

    return String(payload);
  };

  const formatAgentTimestamp = (value: string | number | null): string => {
    if (value === null) {
      return "Unavailable";
    }

    let normalizedValue: string;
    if (typeof value === "number") {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return String(value);
      }
      normalizedValue = parsed.toISOString();
    } else {
      normalizedValue = value;
    }

    const formatted = formatDateTime(normalizedValue);
    return formatted === "Unavailable" ? String(value) : formatted;
  };

  const resolvePartText = (part: UiPart): string => {
    if (part.kind !== "text" && part.kind !== "reasoning") {
      return "";
    }

    if (typeof part.streamText === "string") {
      return part.streamText;
    }

    const streamTail = part.streamTail;
    if (!streamTail) {
      return part.text;
    }

    const deltas: string[] = [];
    let cursor: typeof streamTail | undefined = streamTail;
    while (cursor) {
      deltas.push(cursor.delta);
      cursor = cursor.prev;
    }
    deltas.reverse();

    const baseText =
      typeof part.streamBaseText === "string" ? part.streamBaseText : part.text;
    return `${baseText}${deltas.join("")}`;
  };

  const getStepDetailsSummary = (part: UiPart): string | null => {
    if (part.kind === "step-start") {
      const snapshot = formatAgentPayload(part.snapshot).trim();
      return snapshot.length > 0 ? `Step started: ${snapshot}` : "Step started";
    }

    if (part.kind === "step-finish") {
      const fields = [
        part.reason !== undefined
          ? `reason=${formatAgentPayload(part.reason)}`
          : null,
        part.tokens !== undefined
          ? `tokens=${formatAgentPayload(part.tokens)}`
          : null,
        part.cost !== undefined
          ? `cost=${formatAgentPayload(part.cost)}`
          : null,
      ].filter((value): value is string => value !== null);
      return fields.length > 0
        ? `Step finished: ${fields.join(" | ")}`
        : "Step finished";
    }

    return null;
  };

  const buildChatRows = createMemo(() => {
    return visibleTranscriptMessageIds().map((messageId) => {
      const message = props.model.agent.store().messagesById[messageId];
      if (!message) {
        return null;
      }

      const textParts: string[] = [];
      const reasoningParts: string[] = [];
      const toolItems: RunChatToolRailItem[] = [];

      for (const partId of message.partOrder) {
        const part = message.partsById[partId];
        if (!part) {
          continue;
        }

        if (part.kind === "text") {
          const text = resolvePartText(part);
          if (text.trim().length > 0 || part.streaming) {
            textParts.push(text);
          }
          continue;
        }

        if (part.kind === "reasoning") {
          const text = resolvePartText(part);
          if (text.trim().length > 0 || part.streaming) {
            reasoningParts.push(text);
          }
          continue;
        }

        if (part.kind === "tool") {
          const summary = buildToolSummary(part);
          toolItems.push({
            id: part.id,
            label: part.title?.trim() || part.toolName || "Tool",
            summary,
            status: part.status,
          });
          continue;
        }

        if (part.kind === "patch") {
          continue;
        }

        if (part.kind === "file") {
          continue;
        }

        const stepSummary = getStepDetailsSummary(part);
        if (stepSummary) {
          continue;
        }

        if (part.kind === "unknown") {
          continue;
        }
      }

      const content = textParts.join("\n\n").trim();
      const reasoningContent = reasoningParts.join("\n\n").trim();
      const timestamp = formatAgentTimestamp(
        message.updatedAt ?? message.createdAt ?? null,
      );

      return {
        key: message.id,
        role: message.role,
        content,
        reasoningContent,
        toolItems,
        timestamp,
        hasRenderableContent:
          content.length > 0 ||
          reasoningContent.length > 0 ||
          toolItems.length > 0,
      };
    });
  });

  const chatTranscriptItems = createMemo<JSX.Element[]>(() => {
    const waitingRow = (
      <p
        class="run-inline-loading-row"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span class="run-inline-spinner" aria-hidden="true" />
        <span>Waiting for agent output...</span>
      </p>
    );

    return buildChatRows()
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .map((row) => {
        const reasoningNode =
          row.reasoningContent.length > 0 ? (
            <div class="run-chat-assistant-message__reasoning-inline">
              <RunChatMarkdown
                content={`*Thinking:* ${row.reasoningContent}`}
              />
            </div>
          ) : undefined;

        const toolRailNode =
          row.toolItems.length > 0 ? (
            <RunChatToolRail items={row.toolItems} />
          ) : undefined;

        if (row.role === "assistant") {
          return (
            <RunChatMessage role="assistant" class="run-chat-message-item">
              <RunChatAssistantMessage
                content={row.content.length > 0 ? row.content : " "}
                reasoning={reasoningNode}
                toolRail={toolRailNode}
              />
              <Show when={!row.hasRenderableContent}>{waitingRow}</Show>
            </RunChatMessage>
          );
        }

        if (row.role === "user") {
          return (
            <RunChatMessage role="user" class="run-chat-message-item">
              <RunChatUserMessage>
                <RunChatMarkdown
                  content={row.content.length > 0 ? row.content : "(empty)"}
                />
              </RunChatUserMessage>
            </RunChatMessage>
          );
        }

        return (
          <RunChatMessage role="system" class="run-chat-message-item">
            <RunChatSystemMessage>
              <RunChatMarkdown
                content={row.content.length > 0 ? row.content : row.timestamp}
              />
            </RunChatSystemMessage>
          </RunChatMessage>
        );
      });
  });

  createEffect(() => {
    if (transcriptMessageOrder().length === 0) {
      setTranscriptVisibleCount(TRANSCRIPT_WINDOW_CHUNK);
    }
  });

  const transcriptScrollRevision = createMemo(() => {
    const store = props.model.agent.store();
    const messageCount = store.messageOrder.length;
    if (messageCount === 0) {
      return "0";
    }

    const lastMessageId = store.messageOrder[messageCount - 1];
    const lastMessage = store.messagesById[lastMessageId];
    if (!lastMessage) {
      return `${messageCount}:${lastMessageId}:missing`;
    }

    const lastPartCount = lastMessage.partOrder.length;
    const lastPartId = lastMessage.partOrder[lastPartCount - 1];
    const lastPart = lastPartId ? lastMessage.partsById[lastPartId] : undefined;
    const lastPartRevision = lastPart
      ? getPartScrollRevision(lastPart)
      : "no-part";

    return [
      messageCount,
      lastMessageId,
      lastPartCount,
      lastMessage.updatedAt || lastMessage.createdAt || 0,
      lastPartId || "",
      lastPartRevision,
    ].join(":");
  });

  createEffect(() => {
    const phase = agentReadinessPhase();
    if (phase === "submit_failed") {
      setHasVisibleSubmitFailed(true);
      return;
    }

    if (phase === "ready") {
      setHasVisibleSubmitFailed(false);
    }
  });

  createEffect(() => {
    const revision = transcriptScrollRevision();
    if (revision === "0") {
      return;
    }

    const container = transcriptScrollRef;
    if (!container) {
      return;
    }

    if (isTranscriptAutoFollowEnabled()) {
      scheduleTranscriptScrollToBottom();
    }
  });

  createEffect(() => {
    const composerElement = runChatComposerRef;
    if (!composerElement || typeof ResizeObserver === "undefined") {
      setRunChatComposerOffsetPx("0px");
      return;
    }

    const updateOffset = () => {
      const composerHeight = Math.ceil(
        composerElement.getBoundingClientRect().height,
      );
      setRunChatComposerOffsetPx(`${Math.max(0, composerHeight)}px`);
      if (isTranscriptAutoFollowEnabled()) {
        scheduleTranscriptScrollToBottom();
      }
    };

    updateOffset();
    const observer = new ResizeObserver(() => updateOffset());
    observer.observe(composerElement);

    onCleanup(() => {
      observer.disconnect();
    });
  });

  onCleanup(() => {
    if (transcriptScrollRaf !== null) {
      cancelAnimationFrame(transcriptScrollRaf);
    }
    if (transcriptProgrammaticScrollResetRaf !== null) {
      cancelAnimationFrame(transcriptProgrammaticScrollResetRaf);
    }
  });

  return (
    <section
      class="run-detail-workspace run-chat-only-workspace"
      aria-label="Run chat workspace"
    >
      <section
        class="run-chat-workspace"
        style={{
          "--run-chat-composer-offset": runChatComposerOffsetPx(),
        }}
      >
        <section
          class="run-chat-transcript-scroll"
          aria-label="Conversation transcript"
          ref={transcriptScrollRef}
          style={{
            "padding-bottom": runChatComposerOffsetPx(),
          }}
          onScroll={(event) => {
            if (isTranscriptProgrammaticScroll) {
              return;
            }
            setIsTranscriptAutoFollowEnabled(isNearBottom(event.currentTarget));
          }}
        >
          <Show when={props.model.agent.error().length > 0}>
            <p class="projects-error">{props.model.agent.error()}</p>
          </Show>
          <Show when={props.model.agent.state() === "unsupported"}>
            <p class="project-placeholder-text">
              Agent stream is not available for this run.
            </p>
          </Show>
          <Show
            when={transcriptMessageOrder().length > 0}
            fallback={
              <Show
                when={isTranscriptWaitingForAgentOutput()}
                fallback={
                  <p class="project-placeholder-text">
                    {agentReadinessCopy() || "No agent messages yet."}
                  </p>
                }
              >
                <p
                  class="run-inline-loading-row"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <span class="run-inline-spinner" aria-hidden="true" />
                  <span>Waiting for agent output...</span>
                </p>
              </Show>
            }
          >
            <RunChatTranscript
              class="run-chat-transcript"
              items={chatTranscriptItems()}
              olderAffordance={
                <Show when={transcriptHiddenMessageCount() > 0}>
                  <button
                    type="button"
                    class="run-detail-load-older-button run-chat-load-older"
                    onClick={() => {
                      const container = transcriptScrollRef;
                      const previousScrollHeight =
                        container?.scrollHeight ?? null;
                      setTranscriptVisibleCount(
                        (current) => current + TRANSCRIPT_WINDOW_CHUNK,
                      );
                      if (!container || previousScrollHeight === null) {
                        return;
                      }

                      requestAnimationFrame(() => {
                        const nextScrollHeight = container.scrollHeight;
                        const offset = nextScrollHeight - previousScrollHeight;
                        if (offset > 0) {
                          markTranscriptProgrammaticScroll();
                          container.scrollTop += offset;
                        }
                      });
                    }}
                  >
                    {`Load older (${transcriptHiddenMessageCount()} hidden)`}
                  </button>
                </Show>
              }
            />
            <div ref={transcriptBottomRef} aria-hidden="true" />
          </Show>
        </section>
        <div
          class="run-chat-floating-toolbar"
          role="toolbar"
          aria-label="Run chat tools"
        >
          <button
            type="button"
            class="run-chat-floating-toolbar__button"
            disabled
            aria-label="Files (coming soon)"
            title="Files (coming soon)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.75 2A1.75 1.75 0 0 0 1 3.75v8.5C1 13.216 1.784 14 2.75 14h10.5A1.75 1.75 0 0 0 15 12.25v-6.5A1.75 1.75 0 0 0 13.25 4H8.91a1.5 1.5 0 0 1-1.06-.44l-.41-.41A2.5 2.5 0 0 0 5.67 2H2.75Zm0 1.5h2.92c.265 0 .52.105.707.293l.41.41A3 3 0 0 0 8.91 5.5h4.34a.25.25 0 0 1 .25.25v6.5a.25.25 0 0 1-.25.25H2.75a.25.25 0 0 1-.25-.25v-8.5a.25.25 0 0 1 .25-.25Z" />
            </svg>
          </button>
          <button
            type="button"
            class="run-chat-floating-toolbar__button"
            disabled
            aria-label="Terminal (coming soon)"
            title="Terminal (coming soon)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.75 2A1.75 1.75 0 0 0 1 3.75v8.5C1 13.216 1.784 14 2.75 14h10.5A1.75 1.75 0 0 0 15 12.25v-8.5A1.75 1.75 0 0 0 13.25 2H2.75Zm0 1.5h10.5a.25.25 0 0 1 .25.25v8.5a.25.25 0 0 1-.25.25H2.75a.25.25 0 0 1-.25-.25v-8.5a.25.25 0 0 1 .25-.25Zm1.24 2.09a.75.75 0 0 0-.98 1.14l1.75 1.5a.25.25 0 0 1 0 .38l-1.75 1.5a.75.75 0 1 0 .98 1.14l1.75-1.5a1.75 1.75 0 0 0 0-2.66l-1.75-1.5Zm4.26 4.66a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z" />
            </svg>
          </button>
          <button
            type="button"
            class="run-chat-floating-toolbar__button"
            disabled
            aria-label="Diff viewer (coming soon)"
            title="Diff viewer (coming soon)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5.75 2a.75.75 0 0 1 .75.75V5h2.5V2.75a.75.75 0 0 1 1.5 0V5h.75a1.75 1.75 0 0 1 1.75 1.75v6.5A1.75 1.75 0 0 1 11.75 15h-7A1.75 1.75 0 0 1 3 13.25v-6.5A1.75 1.75 0 0 1 4.75 5h.75V2.75A.75.75 0 0 1 5.75 2Zm0 4.5h-1a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25h7a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25h-1v1.75a.75.75 0 0 1-1.5 0V6.5H6.5v1.75a.75.75 0 0 1-1.5 0V6.5Z" />
            </svg>
          </button>
          <button
            type="button"
            class="run-chat-floating-toolbar__button"
            disabled
            aria-label="Git (coming soon)"
            title="Git (coming soon)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 1.5a2.5 2.5 0 0 0-1.25 4.665v3.17A2.5 2.5 0 1 0 8.5 11.7v-1.35h2.17a2.5 2.5 0 1 0 0-1.5H8.5v-2.68A2.5 2.5 0 1 0 8 1.5Zm0 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM5 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm7-3a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
            </svg>
          </button>
        </div>
        <div
          ref={runChatComposerRef}
          class="run-chat-composer-shell run-chat-composer-shell--pinned"
        >
          <RunChatComposer
            class="run-chat-composer"
            value={composerValue()}
            onInput={setComposerValue}
            onSubmit={(value) => {
              void (async () => {
                const success = await props.model.agent.submitPrompt(value);
                if (success) {
                  setComposerValue("");
                }
              })();
            }}
            disabled={
              isComposerBlockedByReadiness() ||
              props.model.agent.state() === "unsupported"
            }
            submitting={props.model.agent.isSubmittingPrompt()}
            placeholder="What do you want to do?"
            textareaLabel="Message agent"
            submitLabel="Send"
          />
          <Show when={agentReadinessCopy() !== null}>
            <p class="project-placeholder-text" aria-live="polite">
              {agentReadinessCopy()}
            </p>
          </Show>
          <Show when={props.model.agent.submitError().length > 0}>
            <p class="projects-error">{props.model.agent.submitError()}</p>
          </Show>
        </div>
      </section>
    </section>
  );
};

export default NewRunChatWorkspace;
