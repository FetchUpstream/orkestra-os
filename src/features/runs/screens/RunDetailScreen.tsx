import { A } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Component,
} from "solid-js";
import BackIconLink from "../../../components/ui/BackIconLink";
import MonacoDiffEditor from "../../../components/MonacoDiffEditor";
import { useRunDetailModel } from "../model/useRunDetailModel";
import { formatDateTime, formatRunStatus } from "../../tasks/utils/taskDetail";
import RunTerminal from "../components/RunTerminal";
import RunConversationMessage from "../components/RunConversationMessage";
import type { UiPart } from "../model/agentTypes";

type AgentReadinessPhase =
  | "warming_backend"
  | "creating_session"
  | "ready"
  | "reconnecting"
  | "submit_failed"
  | null;

const RunDetailScreen: Component = () => {
  const model = useRunDetailModel();
  const [activeTab, setActiveTab] = createSignal("operations");
  const [layoutMode, setLayoutMode] = createSignal<"split" | "info-focus">(
    "split",
  );
  const [expandedDiffPaths, setExpandedDiffPaths] = createSignal<
    Record<string, boolean>
  >({});
  const [composerValue, setComposerValue] = createSignal("");
  const [hasVisibleSubmitFailed, setHasVisibleSubmitFailed] =
    createSignal(false);
  const agentReadinessPhase = createMemo<AgentReadinessPhase>(() =>
    model.agent.readinessPhase(),
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
  const isComposerEmpty = createMemo(() => composerValue().trim().length === 0);
  const isComposerSendDisabled = createMemo(
    () =>
      isComposerEmpty() ||
      model.agent.isSubmittingPrompt() ||
      isComposerBlockedByReadiness() ||
      model.agent.state() === "unsupported",
  );
  const isInfoFocus = createMemo(() => layoutMode() === "info-focus");
  const isTerminalTabActive = createMemo(() => activeTab() === "terminal");
  const isAgentTabActive = createMemo(() => activeTab() === "agent");
  const agentEvents = createMemo(() => model.agent.events());
  const agentEventMax = createMemo<number | null>(() => {
    const candidates = [
      (model.agent as Record<string, unknown>).maxEvents,
      (model.agent as Record<string, unknown>).eventBufferLimit,
      (model.agent as Record<string, unknown>).eventsMax,
    ];

    for (const candidate of candidates) {
      if (
        typeof candidate === "number" &&
        Number.isFinite(candidate) &&
        candidate > 0
      ) {
        return Math.floor(candidate);
      }
    }

    return null;
  });
  const agentEventCountLabel = createMemo(() => {
    const count = agentEvents().length;
    const max = agentEventMax();
    return max !== null ? `Events: ${count}/${max}` : `Events: ${count}`;
  });
  let transcriptScrollRef: HTMLDivElement | undefined;
  let transcriptBottomRef: HTMLDivElement | undefined;
  let agentEventLogRef: HTMLDivElement | undefined;
  let transcriptScrollRaf: number | null = null;
  let agentEventLogScrollRaf: number | null = null;
  let transcriptProgrammaticScrollResetRaf: number | null = null;
  let agentEventLogProgrammaticScrollResetRaf: number | null = null;
  let isTranscriptProgrammaticScroll = false;
  let isAgentEventLogProgrammaticScroll = false;
  const TRANSCRIPT_WINDOW_CHUNK = 60;
  const AGENT_EVENT_WINDOW_CHUNK = 60;
  const [isTranscriptAutoFollowEnabled, setIsTranscriptAutoFollowEnabled] =
    createSignal(true);
  const [
    isAgentEventLogAutoFollowEnabled,
    setIsAgentEventLogAutoFollowEnabled,
  ] = createSignal(true);
  const AUTO_SCROLL_NEAR_BOTTOM_PX = 96;
  const [transcriptVisibleCount, setTranscriptVisibleCount] = createSignal(
    TRANSCRIPT_WINDOW_CHUNK,
  );
  const [agentEventVisibleCount, setAgentEventVisibleCount] = createSignal(
    AGENT_EVENT_WINDOW_CHUNK,
  );

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

  const markAgentEventLogProgrammaticScroll = () => {
    isAgentEventLogProgrammaticScroll = true;
    if (agentEventLogProgrammaticScrollResetRaf !== null) {
      cancelAnimationFrame(agentEventLogProgrammaticScrollResetRaf);
    }
    agentEventLogProgrammaticScrollResetRaf = requestAnimationFrame(() => {
      agentEventLogProgrammaticScrollResetRaf = null;
      isAgentEventLogProgrammaticScroll = false;
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

  const scheduleAgentEventLogScrollToBottom = () => {
    if (agentEventLogScrollRaf !== null) {
      return;
    }

    agentEventLogScrollRaf = requestAnimationFrame(() => {
      agentEventLogScrollRaf = null;
      if (!isAgentEventLogAutoFollowEnabled()) {
        return;
      }

      markAgentEventLogProgrammaticScroll();

      if (agentEventLogRef) {
        agentEventLogRef.scrollTop = agentEventLogRef.scrollHeight;
      }
    });
  };

  const INTERNAL_ID_PATTERN =
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

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
    () => model.agent.store().messageOrder,
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

  createEffect(() => {
    if (transcriptMessageOrder().length === 0) {
      setTranscriptVisibleCount(TRANSCRIPT_WINDOW_CHUNK);
    }
  });

  const transcriptScrollRevision = createMemo(() => {
    const store = model.agent.store();
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

  const agentEventLogScrollRevision = createMemo(() => {
    const events = agentEvents();
    const eventCount = events.length;
    if (eventCount === 0) {
      return "0";
    }

    const lastEvent = events[eventCount - 1];
    return [eventCount, lastEvent.event, String(lastEvent.ts || "")].join(":");
  });

  const agentEventHiddenCount = createMemo(() =>
    Math.max(0, agentEvents().length - agentEventVisibleCount()),
  );

  type AgentEventPayloadCacheEntry = {
    payloadRef: unknown;
    payloadSignature: string;
    formatted: string;
  };

  const agentEventPayloadCache = new Map<string, AgentEventPayloadCacheEntry>();
  const agentEventCollisionFallbackIds = new WeakMap<object, string>();
  let nextAgentEventCollisionFallbackId = 0;

  const getPayloadSignature = (payload: unknown): string => {
    const seenObjects = new WeakMap<object, number>();
    let nextSeenObjectId = 1;

    const serialize = (value: unknown): string => {
      if (value === null) {
        return "null";
      }

      switch (typeof value) {
        case "string":
          return `string:${JSON.stringify(value)}`;
        case "number":
          return Number.isFinite(value)
            ? `number:${String(value)}`
            : `number:${value.toString()}`;
        case "boolean":
        case "bigint":
        case "undefined":
          return `${typeof value}:${String(value)}`;
        case "symbol":
          return `symbol:${String(value)}`;
        case "function":
          return `function:${value.name || "anonymous"}`;
        case "object": {
          if (value instanceof Date) {
            return `date:${value.toISOString()}`;
          }

          const knownObjectId = seenObjects.get(value);
          if (knownObjectId !== undefined) {
            return `circular:${knownObjectId}`;
          }

          const objectId = nextSeenObjectId;
          nextSeenObjectId += 1;
          seenObjects.set(value, objectId);

          if (Array.isArray(value)) {
            return `array:[${value.map((item) => serialize(item)).join(",")}]`;
          }

          const record = value as Record<string, unknown>;
          const keys = Object.keys(record).sort();
          return `object:{${keys
            .map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`)
            .join(",")}}`;
        }
        default:
          return `unknown:${String(value)}`;
      }
    };

    return serialize(payload);
  };

  const getAgentEventCollisionFallback = (event: unknown): string => {
    if (
      event !== null &&
      (typeof event === "object" || typeof event === "function")
    ) {
      const entity = event as object;
      const existing = agentEventCollisionFallbackIds.get(entity);
      if (existing) {
        return existing;
      }

      nextAgentEventCollisionFallbackId += 1;
      const assigned = `ref-${nextAgentEventCollisionFallbackId}`;
      agentEventCollisionFallbackIds.set(entity, assigned);
      return assigned;
    }

    return "primitive-event";
  };

  const getAgentEventBaseKey = (event: {
    event: string;
    ts?: string | number | null;
    data?: unknown;
  }): string => {
    const timestampPart = String(event.ts ?? "");
    const eventPart = event.event;
    const payloadPart = getPayloadSignature(event.data);
    return `${timestampPart}:${eventPart}:${payloadPart}`;
  };

  const visibleAgentEvents = createMemo(() => {
    const events = agentEvents();
    const startIndex = Math.max(0, events.length - agentEventVisibleCount());
    const visibleEvents = events.slice(startIndex);
    const nextPayloadCache = new Map<string, AgentEventPayloadCacheEntry>();
    const keyCounts = new Map<string, number>();

    const rows = visibleEvents.map((event) => {
      const baseKey = getAgentEventBaseKey(event);
      const seenCount = (keyCounts.get(baseKey) ?? 0) + 1;
      keyCounts.set(baseKey, seenCount);
      const key =
        seenCount === 1
          ? baseKey
          : `${baseKey}#${getAgentEventCollisionFallback(event)}:${seenCount}`;
      const payloadSignature = getPayloadSignature(event.data);
      const cached = agentEventPayloadCache.get(key);

      let formattedPayload: string;
      if (
        cached &&
        cached.payloadRef === event.data &&
        cached.payloadSignature === payloadSignature
      ) {
        formattedPayload = cached.formatted;
        nextPayloadCache.set(key, cached);
      } else {
        formattedPayload = formatAgentPayload(event.data);
        nextPayloadCache.set(key, {
          payloadRef: event.data,
          payloadSignature,
          formatted: formattedPayload,
        });
      }

      return {
        key,
        ts: event.ts ?? null,
        event: event.event,
        payload: formattedPayload,
      };
    });

    agentEventPayloadCache.clear();
    nextPayloadCache.forEach((value, key) => {
      agentEventPayloadCache.set(key, value);
    });

    return rows;
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
    const diffActive = activeTab() === "diff";
    model.setIsDiffTabActive(diffActive);
  });

  createEffect(() => {
    if (agentEvents().length === 0) {
      setAgentEventVisibleCount(AGENT_EVENT_WINDOW_CHUNK);
    }
  });

  createEffect(() => {
    if (activeTab() !== "diff") {
      return;
    }

    const files = model.diffFiles();
    setExpandedDiffPaths((current) => {
      const next: Record<string, boolean> = {};
      let didChange = false;

      for (const file of files) {
        if (Object.prototype.hasOwnProperty.call(current, file.path)) {
          next[file.path] = current[file.path] === true;
          continue;
        }

        next[file.path] = true;
        didChange = true;
      }

      if (!didChange) {
        const currentPaths = Object.keys(current);
        if (currentPaths.length !== files.length) {
          didChange = true;
        } else {
          for (const path of currentPaths) {
            if (!Object.prototype.hasOwnProperty.call(next, path)) {
              didChange = true;
              break;
            }
            if (current[path] !== next[path]) {
              didChange = true;
              break;
            }
          }
        }
      }

      return didChange ? next : current;
    });
  });

  createEffect(() => {
    if (activeTab() !== "diff") {
      return;
    }

    const files = model.diffFiles();
    const expanded = expandedDiffPaths();
    const openPaths = files
      .map((file) => file.path)
      .filter((path) => expanded[path] === true);

    for (const path of openPaths) {
      void model.loadDiffFile(path);
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
    if (!isAgentTabActive()) {
      return;
    }

    const revision = agentEventLogScrollRevision();
    if (revision === "0") {
      return;
    }

    const container = agentEventLogRef;
    if (!container) {
      return;
    }

    if (isAgentEventLogAutoFollowEnabled()) {
      scheduleAgentEventLogScrollToBottom();
    }
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
            {(runValue) => (
              <section
                class="run-detail-workspace"
                aria-label="Run detail workspace"
              >
                <section
                  class="projects-panel run-detail-topbar"
                  aria-label="Run header"
                >
                  <BackIconLink
                    href={model.backHref()}
                    label={model.backLabel()}
                    class="project-detail-back-link project-detail-back-link--icon task-detail-back-link"
                  />
                  <div class="run-detail-topbar-main">
                    <p class="run-detail-task-context">
                      <Show
                        when={model.task()}
                        fallback={<span>Current task</span>}
                      >
                        {(taskValue) => (
                          <A
                            href={model.taskHref()}
                            class="run-detail-task-link"
                          >
                            {taskValue().displayKey?.trim() || "Current task"} -{" "}
                            {taskValue().title}
                          </A>
                        )}
                      </Show>
                    </p>
                    <span
                      class="run-detail-title"
                      role="heading"
                      aria-level="1"
                    >
                      {model.runLabel()}
                    </span>
                    <p class="run-detail-repo-summary">
                      {model.repositorySummary()}
                    </p>
                  </div>
                  <div class="run-detail-header-row">
                    <span
                      class={`project-task-status project-task-status--${runValue().status}`}
                    >
                      {formatRunStatus(runValue().status)}
                    </span>
                    <div
                      class="run-detail-header-actions"
                      role="group"
                      aria-label="Run actions"
                    >
                      <button
                        type="button"
                        class="run-detail-icon-button"
                        aria-label={
                          isInfoFocus()
                            ? "Return to split mode"
                            : "Expand info panel"
                        }
                        aria-pressed={isInfoFocus() ? "true" : "false"}
                        title={
                          isInfoFocus()
                            ? "Return to split mode"
                            : "Expand info panel"
                        }
                        onClick={() =>
                          setLayoutMode(isInfoFocus() ? "split" : "info-focus")
                        }
                      >
                        <Show
                          when={!isInfoFocus()}
                          fallback={
                            <svg viewBox="0 0 16 16" aria-hidden="true">
                              <path
                                d="M2.5 3.5h11v9h-11v-9Zm5.2 0v9"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.2"
                              />
                            </svg>
                          }
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path
                              d="M2.5 3.5h11v9h-11v-9Zm5.2 0v9M7.2 8h-3"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.2"
                              stroke-linecap="round"
                            />
                          </svg>
                        </Show>
                      </button>
                      <button
                        type="button"
                        class="run-detail-icon-button"
                        aria-label="Pause"
                        title="Pause"
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <rect x="4" y="3" width="3" height="10" rx="1" />
                          <rect x="9" y="3" width="3" height="10" rx="1" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="run-detail-icon-button run-detail-icon-button--danger"
                        aria-label="Cancel"
                        title="Cancel"
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <rect x="4" y="4" width="8" height="8" rx="1.5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="run-detail-icon-button"
                        aria-label="Retry"
                        title="Retry"
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M3 8a5 5 0 0 1 8.5-3.5V2h1.5v4H9V4.5h1.8A3.5 3.5 0 1 0 11.5 8H13a5 5 0 0 1-10 0Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="run-detail-icon-button"
                        aria-label="Open Diff"
                        title="Open Diff"
                        onClick={() => setActiveTab("diff")}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M5 3h1.5v10H5v-2H3v-2h2V7H3V5h2V3Zm5.5 0H12v2h2v2h-2v2h2v2h-2v2h-1.5V3Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="run-detail-icon-button"
                        aria-label="View Logs"
                        title="View Logs"
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <rect
                            x="3"
                            y="2.5"
                            width="10"
                            height="11"
                            rx="1.5"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.3"
                          />
                          <path
                            d="M5.5 6h5M5.5 8.5h5M5.5 11h3.5"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.3"
                            stroke-linecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </section>

                <section
                  class="run-detail-main-grid"
                  classList={{
                    "run-detail-main-grid--info-focus": isInfoFocus(),
                  }}
                  data-layout-mode={layoutMode()}
                >
                  <Show when={!isInfoFocus()}>
                    <section class="projects-panel run-detail-conversation-column">
                      <header class="run-detail-conversation-card-header">
                        <h2 class="run-detail-conversation-title">
                          Chat Workspace
                        </h2>
                      </header>
                      <section
                        class="run-detail-conversation-log"
                        aria-label="Conversation transcript"
                        ref={transcriptScrollRef}
                        onScroll={(event) => {
                          if (isTranscriptProgrammaticScroll) {
                            return;
                          }
                          setIsTranscriptAutoFollowEnabled(
                            isNearBottom(event.currentTarget),
                          );
                        }}
                      >
                        <Show when={model.agent.error().length > 0}>
                          <p class="projects-error">{model.agent.error()}</p>
                        </Show>
                        <Show when={model.agent.state() === "unsupported"}>
                          <p class="project-placeholder-text">
                            Agent stream is not available for this run.
                          </p>
                        </Show>
                        <Show
                          when={transcriptMessageOrder().length > 0}
                          fallback={
                            <p class="project-placeholder-text">
                              {agentReadinessCopy() ||
                                (model.agent.state() === "starting"
                                  ? "Starting agent stream."
                                  : "No agent messages yet.")}
                            </p>
                          }
                        >
                          <Show when={transcriptHiddenMessageCount() > 0}>
                            <button
                              type="button"
                              class="run-detail-load-older-button"
                              onClick={() => {
                                const container = transcriptScrollRef;
                                const previousScrollHeight =
                                  container?.scrollHeight ?? null;
                                setTranscriptVisibleCount(
                                  (current) =>
                                    current + TRANSCRIPT_WINDOW_CHUNK,
                                );
                                if (
                                  !container ||
                                  previousScrollHeight === null
                                ) {
                                  return;
                                }

                                requestAnimationFrame(() => {
                                  const nextScrollHeight =
                                    container.scrollHeight;
                                  const offset =
                                    nextScrollHeight - previousScrollHeight;
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
                          <For each={visibleTranscriptMessageIds()}>
                            {(messageId) => {
                              const message = createMemo(
                                () =>
                                  model.agent.store().messagesById[messageId],
                              );

                              return (
                                <Show when={message()}>
                                  {(messageValue) => (
                                    <RunConversationMessage
                                      message={messageValue()}
                                      formatTimestamp={formatAgentTimestamp}
                                      formatPayload={formatAgentPayload}
                                    />
                                  )}
                                </Show>
                              );
                            }}
                          </For>
                          <div ref={transcriptBottomRef} aria-hidden="true" />
                        </Show>
                      </section>
                      <form
                        class="run-detail-composer"
                        aria-label="Message composer"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void (async () => {
                            const success =
                              await model.agent.submitPrompt(composerValue());
                            if (success) {
                              setComposerValue("");
                            }
                          })();
                        }}
                      >
                        <label class="sr-only" for="run-detail-message-input">
                          Message agent
                        </label>
                        <input
                          id="run-detail-message-input"
                          type="text"
                          value={composerValue()}
                          onInput={(event) =>
                            setComposerValue(event.currentTarget.value)
                          }
                          placeholder="Message agent..."
                          aria-label="Message agent"
                        />
                        <button
                          type="submit"
                          class="projects-button-primary"
                          disabled={isComposerSendDisabled()}
                        >
                          Send
                        </button>
                      </form>
                      <Show when={agentReadinessCopy() !== null}>
                        <p class="project-placeholder-text" aria-live="polite">
                          {agentReadinessCopy()}
                        </p>
                      </Show>
                      <Show when={model.agent.submitError().length > 0}>
                        <p class="projects-error">
                          {model.agent.submitError()}
                        </p>
                      </Show>
                    </section>
                  </Show>

                  <aside
                    class="projects-panel run-detail-ops-sidebar"
                    aria-label="Run operations"
                  >
                    <div
                      role="tablist"
                      aria-label="Run detail tab list"
                      class="run-detail-tab-list"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab() === "operations"}
                        class="run-detail-tab"
                        onClick={() => setActiveTab("operations")}
                      >
                        Operations
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab() === "agent"}
                        class="run-detail-tab"
                        onClick={() => setActiveTab("agent")}
                      >
                        Agent
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab() === "files"}
                        class="run-detail-tab"
                        onClick={() => setActiveTab("files")}
                      >
                        Files Changed
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab() === "diff"}
                        class="run-detail-tab"
                        onClick={() => setActiveTab("diff")}
                      >
                        Diff
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab() === "git"}
                        class="run-detail-tab"
                        onClick={() => setActiveTab("git")}
                      >
                        Git
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab() === "terminal"}
                        class="run-detail-tab"
                        onClick={() => setActiveTab("terminal")}
                      >
                        Terminal
                      </button>
                    </div>
                    <div
                      role="tabpanel"
                      aria-label="Run detail tab panel"
                      class="run-detail-tab-panel"
                    >
                      <div
                        class="run-detail-tab-content"
                        classList={{
                          "run-detail-tab-content--hidden":
                            !isTerminalTabActive(),
                        }}
                      >
                        <RunTerminal
                          isVisible={isTerminalTabActive()}
                          isStarting={model.terminal.isStarting()}
                          isReady={model.terminal.isReady()}
                          error={model.terminal.error()}
                          writeTerminal={model.terminal.writeTerminal}
                          resizeTerminal={model.terminal.resizeTerminal}
                          setTerminalFrameHandler={
                            model.terminal.setTerminalFrameHandler
                          }
                        />
                      </div>
                      <Show when={!isTerminalTabActive()}>
                        <Show
                          when={activeTab() === "operations"}
                          fallback={
                            <Show
                              when={activeTab() === "diff"}
                              fallback={
                                <Show
                                  when={isAgentTabActive()}
                                  fallback={
                                    <p class="project-placeholder-text">
                                      {activeTab() === "files"
                                        ? "Files Changed"
                                        : activeTab().charAt(0).toUpperCase() +
                                          activeTab().slice(1)}{" "}
                                      panel placeholder.
                                    </p>
                                  }
                                >
                                  <section
                                    class="run-agent-panel"
                                    aria-label="Agent stream events"
                                  >
                                    <header class="run-agent-panel-header">
                                      <p class="run-agent-event-count">
                                        {agentEventCountLabel()}
                                      </p>
                                    </header>
                                    <Show when={model.agent.error().length > 0}>
                                      <p class="projects-error">
                                        {model.agent.error()}
                                      </p>
                                    </Show>
                                    <Show
                                      when={
                                        model.agent.state() === "unsupported"
                                      }
                                    >
                                      <p class="project-placeholder-text">
                                        Agent stream is not available for this
                                        run.
                                      </p>
                                    </Show>
                                    <Show
                                      when={agentEvents().length > 0}
                                      fallback={
                                        <p class="project-placeholder-text">
                                          {agentReadinessCopy() ||
                                            (model.agent.state() === "starting"
                                              ? "Starting agent stream."
                                              : "No agent events yet.")}
                                        </p>
                                      }
                                    >
                                      <Show when={agentEventHiddenCount() > 0}>
                                        <button
                                          type="button"
                                          class="run-detail-load-older-button"
                                          onClick={() => {
                                            const container = agentEventLogRef;
                                            const previousScrollHeight =
                                              container?.scrollHeight ?? null;
                                            setAgentEventVisibleCount(
                                              (current) =>
                                                current +
                                                AGENT_EVENT_WINDOW_CHUNK,
                                            );

                                            if (
                                              !container ||
                                              previousScrollHeight === null
                                            ) {
                                              return;
                                            }

                                            requestAnimationFrame(() => {
                                              const nextScrollHeight =
                                                container.scrollHeight;
                                              const offset =
                                                nextScrollHeight -
                                                previousScrollHeight;
                                              if (offset > 0) {
                                                markAgentEventLogProgrammaticScroll();
                                                container.scrollTop += offset;
                                              }
                                            });
                                          }}
                                        >
                                          {`Load older (${agentEventHiddenCount()} hidden)`}
                                        </button>
                                      </Show>
                                      <div
                                        class="run-agent-event-log"
                                        ref={agentEventLogRef}
                                        onScroll={(event) => {
                                          if (
                                            isAgentEventLogProgrammaticScroll
                                          ) {
                                            return;
                                          }
                                          setIsAgentEventLogAutoFollowEnabled(
                                            isNearBottom(event.currentTarget),
                                          );
                                        }}
                                      >
                                        <For each={visibleAgentEvents()}>
                                          {(item) => (
                                            <article class="run-agent-event-item">
                                              <header>
                                                <time>
                                                  {formatAgentTimestamp(
                                                    item.ts,
                                                  )}
                                                </time>
                                                <strong>{item.event}</strong>
                                              </header>
                                              <pre>{item.payload}</pre>
                                            </article>
                                          )}
                                        </For>
                                      </div>
                                    </Show>
                                  </section>
                                </Show>
                              }
                            >
                              <section aria-label="Run diff files">
                                <Show when={model.diffFilesError().length > 0}>
                                  <p class="projects-error">
                                    {model.diffFilesError()}
                                  </p>
                                </Show>
                                <Show
                                  when={model.diffFiles().length > 0}
                                  fallback={
                                    <Show when={!model.isDiffFilesLoading()}>
                                      <p class="project-placeholder-text">
                                        No changed files.
                                      </p>
                                    </Show>
                                  }
                                >
                                  <div class="run-diff-accordion">
                                    <For each={model.diffFiles()}>
                                      {(file) => {
                                        const expanded = () =>
                                          expandedDiffPaths()[file.path] ===
                                          true;
                                        const payload = () =>
                                          model.diffFilePayloads()[file.path];
                                        const isFileLoading = () =>
                                          model.diffFileLoadingPaths()[
                                            file.path
                                          ] === true;

                                        return (
                                          <article class="run-diff-item">
                                            <button
                                              type="button"
                                              class="run-diff-item-header"
                                              aria-expanded={
                                                expanded() ? "true" : "false"
                                              }
                                              onClick={() => {
                                                const previousExpanded =
                                                  expandedDiffPaths()[
                                                    file.path
                                                  ] === true;
                                                const nextExpanded =
                                                  !previousExpanded;
                                                setExpandedDiffPaths(
                                                  (current) => ({
                                                    ...current,
                                                    [file.path]: nextExpanded,
                                                  }),
                                                );
                                              }}
                                            >
                                              <span class="run-diff-item-path">
                                                {file.path}
                                              </span>
                                              <span class="run-diff-item-stats">
                                                <span class="run-diff-item-stat-additions">
                                                  +{file.additions}
                                                </span>
                                                <span class="run-diff-item-stat-deletions">
                                                  -{file.deletions}
                                                </span>
                                              </span>
                                            </button>
                                            <Show when={expanded()}>
                                              <div class="run-diff-item-body">
                                                <Show
                                                  when={!isFileLoading()}
                                                  fallback={
                                                    <p class="project-placeholder-text">
                                                      Loading diff.
                                                    </p>
                                                  }
                                                >
                                                  <Show
                                                    when={payload()}
                                                    fallback={
                                                      <p class="project-placeholder-text">
                                                        Diff unavailable.
                                                      </p>
                                                    }
                                                  >
                                                    {(filePayload) => (
                                                      <>
                                                        <p class="run-diff-item-meta">
                                                          {filePayload().status}
                                                          ,{" "}
                                                          {filePayload()
                                                            .isBinary
                                                            ? "binary"
                                                            : "text"}
                                                          {filePayload()
                                                            .truncated
                                                            ? ", truncated"
                                                            : ""}
                                                        </p>
                                                        <div class="run-detail-monaco-panel">
                                                          <MonacoDiffEditor
                                                            original={
                                                              filePayload()
                                                                .original
                                                            }
                                                            modified={
                                                              filePayload()
                                                                .modified
                                                            }
                                                            language={
                                                              filePayload()
                                                                .language
                                                            }
                                                          />
                                                        </div>
                                                      </>
                                                    )}
                                                  </Show>
                                                </Show>
                                              </div>
                                            </Show>
                                          </article>
                                        );
                                      }}
                                    </For>
                                  </div>
                                </Show>
                              </section>
                            </Show>
                          }
                        >
                          <dl class="task-detail-definition-list run-detail-metadata">
                            <div>
                              <dt>Status</dt>
                              <dd>{formatRunStatus(runValue().status)}</dd>
                            </div>
                            <div>
                              <dt>Duration</dt>
                              <dd>{model.durationLabel()}</dd>
                            </div>
                            <div>
                              <dt>Worktree</dt>
                              <dd>
                                {runValue().worktreeId?.trim() || "Unavailable"}
                              </dd>
                            </div>
                            <div>
                              <dt>Branch</dt>
                              <dd>
                                {runValue().status === "running"
                                  ? "active branch"
                                  : "Unavailable"}
                              </dd>
                            </div>
                            <div>
                              <dt>Model/agent</dt>
                              <dd>
                                {runValue().agentId?.trim() || "Unavailable"}
                              </dd>
                            </div>
                            <div>
                              <dt>Files changed</dt>
                              <dd>Placeholder</dd>
                            </div>
                            <div>
                              <dt>Tests</dt>
                              <dd>Placeholder</dd>
                            </div>
                          </dl>
                        </Show>
                      </Show>
                    </div>
                  </aside>
                </section>
              </section>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default RunDetailScreen;
