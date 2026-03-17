import {
  For,
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
  RunChatDetailsDisclosure,
  RunChatMarkdown,
  RunChatMessage,
  RunChatReasoningDisclosure,
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
      const detailsItems: string[] = [];

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
          toolItems.push({
            id: part.id,
            label: part.title?.trim() || part.toolName || "Tool",
            status: part.status,
            detail: formatAgentPayload({
              input: part.input,
              output: part.output,
              error: part.error,
              metadata: part.metadata,
            }),
            open: false,
          });
          continue;
        }

        if (part.kind === "patch") {
          continue;
        }

        if (part.kind === "file") {
          detailsItems.push(
            `File: ${formatAgentPayload({ filename: part.filename, mime: part.mime, url: part.url })}`,
          );
          continue;
        }

        const stepSummary = getStepDetailsSummary(part);
        if (stepSummary) {
          detailsItems.push(stepSummary);
          continue;
        }

        if (part.kind === "unknown") {
          detailsItems.push(
            `Unknown part (${part.rawType || "unknown"}): ${formatAgentPayload(part.raw)}`,
          );
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
        detailsItems,
        timestamp,
        hasRenderableContent:
          content.length > 0 ||
          reasoningContent.length > 0 ||
          toolItems.length > 0 ||
          detailsItems.length > 0,
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
            <RunChatReasoningDisclosure
              summary="Reasoning"
              open={false}
              content={<RunChatMarkdown content={row.reasoningContent} />}
            />
          ) : undefined;

        const toolRailNode =
          row.toolItems.length > 0 ? (
            <RunChatDetailsDisclosure summary="Tools" open={false}>
              <RunChatToolRail items={row.toolItems} />
            </RunChatDetailsDisclosure>
          ) : undefined;

        const detailsNode =
          row.detailsItems.length > 0 ? (
            <RunChatDetailsDisclosure summary="Details" open={false}>
              <div class="run-chat-message__details-block">
                <p>{`Timestamp: ${row.timestamp}`}</p>
                <For each={row.detailsItems}>{(item) => <p>{item}</p>}</For>
              </div>
            </RunChatDetailsDisclosure>
          ) : undefined;

        if (row.role === "assistant") {
          return (
            <RunChatMessage role="assistant" class="run-chat-message-item">
              <RunChatAssistantMessage
                content={row.content.length > 0 ? row.content : " "}
                reasoning={reasoningNode}
                toolRail={toolRailNode}
                details={detailsNode}
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
              <Show when={detailsNode}>{detailsNode}</Show>
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
            placeholder="Message agent..."
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
