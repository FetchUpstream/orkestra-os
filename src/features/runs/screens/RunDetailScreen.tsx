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
import MarkdownContent from "../../../components/ui/MarkdownContent";
import { useRunDetailModel } from "../model/useRunDetailModel";
import { formatDateTime, formatRunStatus } from "../../tasks/utils/taskDetail";
import RunTerminal from "../components/RunTerminal";
import type { UiPart } from "../model/agentTypes";

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
  const isComposerEmpty = createMemo(() => composerValue().trim().length === 0);
  const isComposerSendDisabled = createMemo(
    () =>
      isComposerEmpty() ||
      model.agent.isSubmittingPrompt() ||
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

  const getMessageActorLabel = (role: string): string => {
    if (role === "assistant") return "Agent";
    if (role === "user") return "You";
    if (role === "system") return "System";
    return "Message";
  };

  const getPartTypeLabel = (part: UiPart): string => {
    if (part.kind === "unknown") {
      return part.rawType || "unknown";
    }
    return part.type || part.kind;
  };

  const formatPartSnippet = (payload: unknown): string => {
    const serialized = formatAgentPayload(payload);
    if (serialized.length <= 280) {
      return serialized;
    }
    return `${serialized.slice(0, 280)}...`;
  };

  const formatStepMetaValue = (value: unknown): string | null => {
    if (value === null || value === undefined) {
      return null;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      const normalized = String(value)
        .replace(INTERNAL_ID_PATTERN, "[internal-id]")
        .trim();
      return normalized.length > 0 ? normalized : null;
    }

    const formatted = formatPartSnippet(value).trim();
    return formatted.length > 0 ? formatted : null;
  };

  const formatStructuredTokenMeta = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const tokenMap = new Map<string, number>();

    const normalizeKey = (key: string): string =>
      key.toLowerCase().replace(/[^a-z0-9]/g, "");

    const visit = (node: unknown, depth: number): void => {
      if (
        !node ||
        typeof node !== "object" ||
        Array.isArray(node) ||
        depth > 3
      ) {
        return;
      }

      for (const [rawKey, rawValue] of Object.entries(
        node as Record<string, unknown>,
      )) {
        if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
          tokenMap.set(normalizeKey(rawKey), rawValue);
          continue;
        }

        if (
          rawValue &&
          typeof rawValue === "object" &&
          !Array.isArray(rawValue)
        ) {
          visit(rawValue, depth + 1);
        }
      }
    };

    visit(value, 0);

    const pick = (...candidates: string[]): number | null => {
      for (const key of candidates) {
        const tokenCount = tokenMap.get(key);
        if (tokenCount !== undefined) {
          return tokenCount;
        }
      }
      return null;
    };

    const parts: string[] = [];
    const total = pick("total", "totaltokens", "tokens");
    const input = pick("input", "inputtokens", "prompt", "prompttokens");
    const output = pick(
      "output",
      "outputtokens",
      "completion",
      "completiontokens",
    );
    const reasoning = pick("reasoning", "reasoningtokens");
    const cacheRead = pick("cacheread", "cachedinput", "cachedinputtokens");
    const cacheWrite = pick("cachewrite", "cachedoutput", "cachedoutputtokens");

    if (total !== null) {
      parts.push(`total: ${total}`);
    }
    if (input !== null) {
      parts.push(`input: ${input}`);
    }
    if (output !== null) {
      parts.push(`output: ${output}`);
    }
    if (reasoning !== null) {
      parts.push(`reasoning: ${reasoning}`);
    }
    if (cacheRead !== null) {
      parts.push(`cache read: ${cacheRead}`);
    }
    if (cacheWrite !== null) {
      parts.push(`cache write: ${cacheWrite}`);
    }

    return parts.length > 0 ? parts.join(" · ") : null;
  };

  const formatStepTokenValue = (value: unknown): string | null => {
    const structured = formatStructuredTokenMeta(value);
    if (structured) {
      return structured;
    }
    return formatStepMetaValue(value);
  };

  const extractSnapshotHash = (snapshot: unknown): string | null => {
    if (typeof snapshot === "string") {
      return formatStepMetaValue(snapshot);
    }

    if (snapshot && typeof snapshot === "object") {
      const record = snapshot as Record<string, unknown>;
      const directHash = formatStepMetaValue(record.hash);
      if (directHash) {
        return directHash;
      }

      const nestedSnapshot = record.snapshot;
      if (nestedSnapshot && typeof nestedSnapshot === "object") {
        const nestedRecord = nestedSnapshot as Record<string, unknown>;
        const nestedHash = formatStepMetaValue(nestedRecord.hash);
        if (nestedHash) {
          return nestedHash;
        }
      }
    }

    return null;
  };

  const getPartSnippet = (part: UiPart): string => {
    if (part.kind === "file") {
      return formatPartSnippet({
        filename: part.filename,
        mime: part.mime,
        url: part.url,
      });
    }

    if (part.kind === "patch") {
      return formatPartSnippet({
        hash: part.hash,
        files: Array.isArray(part.files) ? part.files.length : 0,
      });
    }

    if (part.kind === "step-start") {
      return formatPartSnippet({ snapshot: part.snapshot });
    }

    if (part.kind === "step-finish") {
      return formatPartSnippet({
        reason: part.reason,
        tokens: part.tokens,
        cost: part.cost,
      });
    }

    if (part.kind === "unknown") {
      return formatPartSnippet(part.raw ?? { type: part.rawType });
    }

    return formatPartSnippet(part);
  };

  const transcript = createMemo(() => {
    const store = model.agent.store();
    const entries: Array<{
      actor: string;
      time: number | null;
      parts: UiPart[];
      stepMeta: {
        snapshotHash?: string;
        reason?: string;
        tokens?: string;
        cost?: string;
      } | null;
    }> = [];

    for (const messageId of store.messageOrder) {
      const message = store.messagesById[messageId];
      if (!message) {
        continue;
      }

      const parts: UiPart[] = [];
      let snapshotHash: string | null = null;
      let finishReason: string | null = null;
      let finishTokens: string | null = null;
      let finishCost: string | null = null;

      for (const partId of message.partOrder) {
        const part = message.partsById[partId];
        if (!part) {
          continue;
        }

        if (part.kind === "step-start") {
          if (!snapshotHash) {
            snapshotHash = extractSnapshotHash(part.snapshot);
          }
          continue;
        }

        if (part.kind === "step-finish") {
          if (!snapshotHash) {
            snapshotHash = extractSnapshotHash(part.snapshot);
          }

          const reason = formatStepMetaValue(part.reason);
          if (reason) {
            finishReason = reason;
          }

          const tokens = formatStepTokenValue(part.tokens);
          if (tokens) {
            finishTokens = tokens;
          }

          const cost = formatStepMetaValue(part.cost);
          if (cost) {
            finishCost = cost;
          }
          continue;
        }

        parts.push(part);
      }

      entries.push({
        actor: getMessageActorLabel(message.role),
        time: message.updatedAt ?? message.createdAt ?? null,
        parts,
        stepMeta:
          snapshotHash || finishReason || finishTokens || finishCost
            ? {
                snapshotHash: snapshotHash || undefined,
                reason: finishReason || undefined,
                tokens: finishTokens || undefined,
                cost: finishCost || undefined,
              }
            : null,
      });
    }

    return entries;
  });
  createEffect(() => {
    const diffActive = activeTab() === "diff";
    model.setIsDiffTabActive(diffActive);
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
    const entries = transcript();
    if (entries.length === 0) {
      return;
    }

    queueMicrotask(() => {
      requestAnimationFrame(() => {
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
    });
  });

  createEffect(() => {
    if (!isAgentTabActive()) {
      return;
    }

    agentEvents();
    queueMicrotask(() => {
      if (!agentEventLogRef) {
        return;
      }
      agentEventLogRef.scrollTop = agentEventLogRef.scrollHeight;
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
                          when={transcript().length > 0}
                          fallback={
                            <p class="project-placeholder-text">
                              {model.agent.state() === "starting"
                                ? "Starting agent stream."
                                : "No agent messages yet."}
                            </p>
                          }
                        >
                          <For each={transcript()}>
                            {(entry) => (
                              <article class="run-detail-message">
                                <header>
                                  <strong>{entry.actor}</strong>
                                  <span>
                                    {formatAgentTimestamp(entry.time)}
                                  </span>
                                </header>
                                <Show when={entry.stepMeta}>
                                  {(meta) => (
                                    <dl class="run-detail-step-meta">
                                      <Show when={meta().snapshotHash}>
                                        <div>
                                          <dt>Snapshot</dt>
                                          <dd>{meta().snapshotHash}</dd>
                                        </div>
                                      </Show>
                                      <Show when={meta().reason}>
                                        <div>
                                          <dt>Reason</dt>
                                          <dd>{meta().reason}</dd>
                                        </div>
                                      </Show>
                                      <Show when={meta().tokens}>
                                        <div>
                                          <dt>Tokens</dt>
                                          <dd>{meta().tokens}</dd>
                                        </div>
                                      </Show>
                                      <Show when={meta().cost}>
                                        <div>
                                          <dt>Cost</dt>
                                          <dd>{meta().cost}</dd>
                                        </div>
                                      </Show>
                                    </dl>
                                  )}
                                </Show>
                                <Show
                                  when={entry.parts.length > 0}
                                  fallback={
                                    <p class="project-placeholder-text">
                                      No message parts yet.
                                    </p>
                                  }
                                >
                                  <div class="run-detail-message-parts">
                                    <For each={entry.parts}>
                                      {(part) => (
                                        <>
                                          <Show when={part.kind === "text"}>
                                            <MarkdownContent
                                              content={
                                                part.kind === "text"
                                                  ? part.text
                                                  : ""
                                              }
                                              class="run-detail-part run-detail-part--text"
                                            />
                                          </Show>

                                          <Show
                                            when={part.kind === "reasoning"}
                                          >
                                            <details
                                              class="run-detail-part run-detail-part--reasoning"
                                              open
                                            >
                                              <summary>Reasoning</summary>
                                              <MarkdownContent
                                                content={
                                                  part.kind === "reasoning"
                                                    ? part.text
                                                    : ""
                                                }
                                              />
                                            </details>
                                          </Show>

                                          <Show when={part.kind === "tool"}>
                                            <div class="run-detail-part run-detail-part--tool">
                                              <span>
                                                {part.kind === "tool"
                                                  ? part.toolName || "tool"
                                                  : "tool"}
                                              </span>
                                              <span class="run-detail-part-tool-status">
                                                {part.kind === "tool"
                                                  ? part.status || "pending"
                                                  : "pending"}
                                              </span>
                                            </div>
                                          </Show>

                                          <Show
                                            when={
                                              part.kind === "file" ||
                                              part.kind === "patch" ||
                                              part.kind === "unknown"
                                            }
                                          >
                                            <div class="run-detail-part run-detail-part--fallback">
                                              <p class="run-detail-part-fallback-label">
                                                {getPartTypeLabel(part)}
                                              </p>
                                              <pre>{getPartSnippet(part)}</pre>
                                            </div>
                                          </Show>
                                        </>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </article>
                            )}
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
                                          {model.agent.state() === "starting"
                                            ? "Starting agent stream."
                                            : "No agent events yet."}
                                        </p>
                                      }
                                    >
                                      <div
                                        class="run-agent-event-log"
                                        ref={agentEventLogRef}
                                      >
                                        <For each={agentEvents()}>
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
                                              <pre>
                                                {formatAgentPayload(item.data)}
                                              </pre>
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
