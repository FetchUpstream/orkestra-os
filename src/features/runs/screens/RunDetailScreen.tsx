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
  const isInfoFocus = createMemo(() => layoutMode() === "info-focus");
  const transcript = createMemo(() => {
    const runValue = model.run();
    const taskValue = model.task();
    return [
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
                          SESSION TITLE
                        </h2>
                      </header>
                      <section
                        class="run-detail-conversation-log"
                        aria-label="Conversation transcript"
                      >
                        <For each={transcript()}>
                          {(entry) => (
                            <article class="run-detail-message">
                              <header>
                                <strong>{entry.actor}</strong>
                                <span>
                                  {formatDateTime(entry.time || null)}
                                </span>
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
                      <Show
                        when={activeTab() === "operations"}
                        fallback={
                          <Show
                            when={activeTab() === "diff"}
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
                                        expandedDiffPaths()[file.path] === true;
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
                                                        {filePayload().status},{" "}
                                                        {filePayload().isBinary
                                                          ? "binary"
                                                          : "text"}
                                                        {filePayload().truncated
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
