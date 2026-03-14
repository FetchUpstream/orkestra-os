import { A } from "@solidjs/router";
import { For, Show, createMemo, createSignal, type Component } from "solid-js";
import BackIconLink from "../../../components/ui/BackIconLink";
import { useRunDetailModel } from "../model/useRunDetailModel";
import { formatDateTime, formatRunStatus } from "../../tasks/utils/taskDetail";

const RunDetailScreen: Component = () => {
  const model = useRunDetailModel();
  const [activeTab, setActiveTab] = createSignal("conversation");
  const [composerValue, setComposerValue] = createSignal("");
  const transcript = createMemo(() => {
    const runValue = model.run();
    const taskValue = model.task();
    return [
      {
        actor: "System",
        text: `Run created ${formatDateTime(runValue?.createdAt)}.`,
        time: runValue?.createdAt,
        isEvent: true,
      },
      {
        actor: "Planner",
        text: taskValue
          ? `Task context loaded: ${taskValue.title}`
          : "Task context is still resolving.",
        time: runValue?.startedAt ?? runValue?.createdAt,
      },
      {
        actor: "Builder",
        text: "Workspace ready. Waiting for next instruction.",
        time: runValue?.startedAt ?? runValue?.createdAt,
      },
      {
        actor: "Reviewer",
        text: "No review feedback yet.",
        time: runValue?.finishedAt ?? runValue?.startedAt,
      },
      {
        actor: "You",
        text: "Message agent...",
        time: runValue?.finishedAt ?? runValue?.createdAt,
      },
    ];
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

                <section class="run-detail-main-grid">
                  <section class="projects-panel run-detail-conversation-column">
                    <section
                      class="run-detail-conversation-log"
                      aria-label="Conversation transcript"
                    >
                      <For each={transcript()}>
                        {(entry) => (
                          <article
                            class={`run-detail-message${entry.isEvent ? "run-detail-message--event" : ""}`}
                          >
                            <header>
                              <strong>{entry.actor}</strong>
                              <span>{formatDateTime(entry.time || null)}</span>
                            </header>
                            <p>{entry.text}</p>
                          </article>
                        )}
                      </For>
                    </section>
                    <form
                      class="run-detail-composer"
                      aria-label="Message composer"
                      onSubmit={(event) => {
                        event.preventDefault();
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
                      <button type="submit" class="projects-button-primary">
                        Send
                      </button>
                    </form>
                  </section>

                  <aside
                    class="projects-panel run-detail-ops-sidebar"
                    aria-label="Run operations"
                  >
                    <h2 class="projects-section-title">Operations</h2>
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
                        <dd>{runValue().agentId?.trim() || "Unavailable"}</dd>
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
                  </aside>
                </section>

                <section
                  class="projects-panel run-detail-bottom-tabs"
                  aria-label="Run detail tabs"
                >
                  <div
                    role="tablist"
                    aria-label="Run detail tab list"
                    class="run-detail-tab-list"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab() === "conversation"}
                      class="run-detail-tab"
                      onClick={() => setActiveTab("conversation")}
                    >
                      Conversation
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab() === "logs"}
                      class="run-detail-tab"
                      onClick={() => setActiveTab("logs")}
                    >
                      Logs
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
                      aria-selected={activeTab() === "timeline"}
                      class="run-detail-tab"
                      onClick={() => setActiveTab("timeline")}
                    >
                      Timeline
                    </button>
                  </div>
                  <div
                    role="tabpanel"
                    aria-label="Run detail tab panel"
                    class="run-detail-tab-panel"
                  >
                    <Show
                      when={activeTab() === "conversation"}
                      fallback={
                        <p class="project-placeholder-text">
                          {activeTab().charAt(0).toUpperCase() +
                            activeTab().slice(1)}{" "}
                          panel placeholder.
                        </p>
                      }
                    >
                      <p class="project-placeholder-text">
                        Conversation is active in the center workspace.
                      </p>
                    </Show>
                  </div>
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
