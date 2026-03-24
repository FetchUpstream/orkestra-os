import { For, Show, createEffect, onCleanup, type Component } from "solid-js";
import { A } from "@solidjs/router";
import type { TaskStatus } from "../../../app/lib/tasks";
import RunSettingsModal from "../../runs/components/RunSettingsModal";
import TaskImplementationGuideCrepeEditor from "../../../components/ui/TaskImplementationGuideCrepeEditor";
import TaskMarkdownEditor from "../../../components/ui/TaskMarkdownEditor";
import {
  TaskDetailErrorState,
  TaskDetailLoadingState,
  TaskDetailNotFoundState,
} from "../components/TaskDetailStates";
import { useTaskDetailModel } from "../model/useTaskDetailModel";
import {
  dependencyDisplayLabel,
  dependencyScopeLabel,
  formatDateTime,
  formatRunStatus,
  formatStatus,
  projectLabel,
  repositoryLabel,
} from "../utils/taskDetail";

const formatRunDuration = (milliseconds: number) => {
  if (milliseconds <= 0) return "<1s";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const getRunTimingCopy = (runItem: {
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  status: string;
}) => {
  if (runItem.status === "queued") {
    return null;
  }
  const startedAt = runItem.startedAt ? new Date(runItem.startedAt) : null;
  const finishedAt = runItem.finishedAt ? new Date(runItem.finishedAt) : null;
  if (
    startedAt &&
    finishedAt &&
    !Number.isNaN(startedAt.getTime()) &&
    !Number.isNaN(finishedAt.getTime())
  ) {
    return `Duration ${formatRunDuration(finishedAt.getTime() - startedAt.getTime())}`;
  }
  if (startedAt && !Number.isNaN(startedAt.getTime())) {
    return `Elapsed ${formatRunDuration(Date.now() - startedAt.getTime())}`;
  }
  return null;
};

const getRunSummaryFallback = (status: string) => {
  if (status === "queued") {
    return "Waiting for an available runner to start execution.";
  }
  if (status === "preparing") {
    return "Preparing runtime context and workspace before execution.";
  }
  if (status === "running") {
    return "Execution is in progress and actively processing steps.";
  }
  if (status === "completed") {
    return "Execution completed successfully and outputs are ready.";
  }
  if (status === "failed") {
    return "Execution stopped after an error during run stages.";
  }
  return "Execution was stopped before completion.";
};

const getRunPrimaryLabel = (runItem: {
  runNumber?: number | null;
  displayKey?: string | null;
}) => {
  if (typeof runItem.runNumber === "number") return `Run #${runItem.runNumber}`;
  const displayKey = runItem.displayKey?.trim();
  if (displayKey) return displayKey;
  return "Run";
};

const DeleteIcon: Component = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z" />
  </svg>
);

const TaskDetailScreen: Component = () => {
  const {
    params,
    task,
    projectName,
    projectRepositories,
    isLoading,
    error,
    actionError,
    dependencies,
    dependenciesError,
    isLoadingDependencies,
    runs,
    runsError,
    isLoadingRuns,
    isCreatingRun,
    isRunSettingsModalOpen,
    isBlocked,
    taskDependencyBadgeState,
    blockingParentTasks,
    isBlockedRunWarningOpen,
    deletingRunId,
    startingRunId,
    isAnyRunStarting,
    warmingRunIds,
    runStartErrors,
    runAgentOptions,
    runProviderOptions,
    visibleRunModelOptions,
    runSelectionOptionsError,
    isLoadingRunSelectionOptions,
    hasRunSelectionOptions,
    selectedRunAgentId,
    selectedRunProviderId,
    selectedRunModelId,
    removingDependencyKey,
    autosaveState,
    editTitle,
    editDescription,
    editImplementationGuide,
    isChangingStatus,
    isTransitionMenuOpen,
    moveRepositoryId,
    isMoving,
    isDeleting,
    isDeleteModalOpen,
    isCreateDependencyModalOpen,
    createDependencyDirection,
    createDependencyTitle,
    createDependencyDescription,
    createDependencyImplementationGuide,
    createDependencyStatus,
    isCreatingDependency,
    isLinkDependencyModalOpen,
    linkDependencyDirection,
    linkDependencySearch,
    showDoneLinkCandidates,
    filteredLinkCandidates,
    isLinkingDependency,
    backHref,
    backLabel,
    canMoveTask,
    validTransitionOptions,
    navigateToDependencyTask,
    refreshDependencies,
    refreshRuns,
    setIsTransitionMenuOpen,
    setSelectedRunAgentId,
    setSelectedRunProviderId,
    setSelectedRunModelId,
    onEditTitleInput,
    onEditDescriptionInput,
    setMoveRepositoryId,
    setCreateDependencyTitle,
    setCreateDependencyDescription,
    setCreateDependencyImplementationGuide,
    setCreateDependencyStatus,
    setLinkDependencySearch,
    setShowDoneLinkCandidates,
    setIsBlockedRunWarningOpen,
    onOpenCreateDependencyModal,
    onCancelCreateDependency,
    onSubmitCreateDependency,
    onEditImplementationGuideInput,
    flushTaskDetailsAutosave,
    onSetStatus,
    onMoveTask,
    onRequestDeleteTask,
    onCancelDeleteTask,
    onConfirmDeleteTask,
    onOpenLinkDependencyModal,
    onCancelLinkDependency,
    onLinkDependency,
    onRemoveDependency,
    onOpenRunSettingsModal,
    onCancelRunSettingsModal,
    onConfirmCreateRun,
    onStartRun,
    onDeleteRun,
  } = useTaskDetailModel();

  createEffect(() => {
    window.dispatchEvent(
      new CustomEvent("task-detail:topbar-config", {
        detail: {
          backHref: backHref(),
          backLabel: backLabel(),
          autosaveState: autosaveState(),
          isChangingStatus: isChangingStatus(),
          isTransitionMenuOpen: isTransitionMenuOpen(),
          isDeleting: isDeleting(),
          validTransitionOptions: validTransitionOptions(),
          onToggleTransitionMenu: () =>
            setIsTransitionMenuOpen((current) => !current),
          onCloseTransitionMenu: () => setIsTransitionMenuOpen(false),
          onSetStatus,
          onRequestDeleteTask,
        },
      }),
    );
  });

  onCleanup(() => {
    window.dispatchEvent(new CustomEvent("task-detail:topbar-clear"));
  });

  createEffect(() => {
    if (!isLinkDependencyModalOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelLinkDependency();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <>
      <div class="task-detail-page">
        <Show
          when={!error()}
          fallback={<TaskDetailErrorState error={error()} />}
        >
          <Show when={!isLoading()} fallback={<TaskDetailLoadingState />}>
            <Show
              when={task()}
              fallback={
                <TaskDetailNotFoundState
                  paramsProjectId={params.projectId}
                  backLabel={backLabel()}
                />
              }
            >
              {(taskValue) => (
                <div class="task-detail-workspace">
                  <div class="task-detail-columns">
                    <div class="task-detail-main-column">
                      <section class="projects-panel task-detail-main-card">
                        <Show when={actionError()}>
                          <div
                            class="projects-error"
                            role="alert"
                            aria-live="polite"
                          >
                            {actionError()}
                          </div>
                        </Show>
                        <input
                          class="task-detail-title-input"
                          value={editTitle()}
                          onInput={(event) =>
                            onEditTitleInput(event.currentTarget.value)
                          }
                          onBlur={() => {
                            void flushTaskDetailsAutosave("blur");
                          }}
                          aria-label="Task title"
                        />
                        <div class="task-detail-meta-row">
                          <Show when={taskValue().displayKey?.trim()}>
                            {(displayKey) => (
                              <span class="projects-list-meta task-detail-display-key">
                                {displayKey()}
                              </span>
                            )}
                          </Show>
                          <span
                            class={`project-task-status project-task-status--${taskValue().status}`}
                          >
                            {formatStatus(taskValue().status)}
                          </span>
                          <Show when={taskDependencyBadgeState() !== "none"}>
                            <span
                              class={
                                taskDependencyBadgeState() === "blocked"
                                  ? "project-task-blocked"
                                  : "project-task-ready"
                              }
                            >
                              {taskDependencyBadgeState() === "blocked"
                                ? "Blocked"
                                : "Ready"}
                            </span>
                          </Show>
                        </div>
                        <div class="task-detail-summary-strip">
                          <div class="task-detail-summary-item">
                            <span class="task-detail-summary-label">
                              Project
                            </span>
                            <span class="task-detail-summary-value">
                              {projectLabel(projectName())}
                            </span>
                          </div>
                          <div class="task-detail-summary-item">
                            <span class="task-detail-summary-label">
                              Repository scope
                            </span>
                            <span class="task-detail-summary-value">
                              {repositoryLabel(taskValue())}
                            </span>
                          </div>
                          <div class="task-detail-summary-item">
                            <span class="task-detail-summary-label">
                              Updated
                            </span>
                            <span class="task-detail-summary-value">
                              {formatDateTime(taskValue().updatedAt)}
                            </span>
                          </div>
                        </div>
                        <div class="task-detail-description-block">
                          <h2 class="project-section-title task-detail-description-title">
                            Description
                          </h2>
                          <TaskMarkdownEditor
                            value={editDescription()}
                            onChange={onEditDescriptionInput}
                            onBlur={() => {
                              void flushTaskDetailsAutosave("blur");
                            }}
                            ariaLabel="Task description"
                          />
                        </div>
                        <div class="task-detail-description-block task-detail-description-block--guide">
                          <h2 class="project-section-title task-detail-description-title">
                            Implementation guide
                          </h2>
                          <TaskImplementationGuideCrepeEditor
                            value={editImplementationGuide()}
                            onChange={onEditImplementationGuideInput}
                            onBlur={() => {
                              void flushTaskDetailsAutosave("blur");
                            }}
                            ariaLabel="Task implementation guide"
                          />
                        </div>
                      </section>
                    </div>

                    <aside class="task-detail-inspector-column">
                      <section class="projects-panel task-detail-inspector-panel">
                        <div class="task-detail-panel-section">
                          <div class="task-detail-quick-actions">
                            <Show when={canMoveTask()}>
                              <label class="projects-field">
                                <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                                  <span class="field-label-text">
                                    Move task to repository
                                  </span>
                                </span>
                                <select
                                  class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
                                  value={moveRepositoryId()}
                                  onChange={(event) =>
                                    setMoveRepositoryId(
                                      event.currentTarget.value,
                                    )
                                  }
                                  disabled={isMoving()}
                                  aria-label="Move task repository"
                                >
                                  <For each={projectRepositories()}>
                                    {(repository) => (
                                      <option value={repository.id}>
                                        {repository.name}
                                      </option>
                                    )}
                                  </For>
                                </select>
                              </label>
                              <button
                                type="button"
                                class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                                onClick={onMoveTask}
                                disabled={!moveRepositoryId() || isMoving()}
                              >
                                {isMoving() ? "Moving..." : "Move"}
                              </button>
                            </Show>
                          </div>
                        </div>
                        <div
                          class="task-detail-panel-separator"
                          aria-hidden="true"
                        />
                        <div class="task-detail-panel-section task-runs-panel">
                          <div class="task-dependencies-heading-row">
                            <h2 class="project-section-title">Runs</h2>
                            <button
                              type="button"
                              class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                              onClick={onOpenRunSettingsModal}
                              disabled={isCreatingRun()}
                              aria-label={
                                isBlocked()
                                  ? "New run blocked by dependencies"
                                  : "New run"
                              }
                            >
                              New Run
                            </button>
                          </div>
                          <Show when={runSelectionOptionsError()}>
                            <p class="project-placeholder-text">
                              {runSelectionOptionsError()}
                            </p>
                          </Show>
                          <Show
                            when={!runsError()}
                            fallback={
                              <div class="task-dependencies-error-block">
                                <p class="project-placeholder-text">
                                  {runsError()}
                                </p>
                                <button
                                  type="button"
                                  class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                                  onClick={() => {
                                    const currentTask = task();
                                    if (!currentTask) return;
                                    void refreshRuns(currentTask.id);
                                  }}
                                >
                                  Retry
                                </button>
                              </div>
                            }
                          >
                            <Show
                              when={!isLoadingRuns()}
                              fallback={
                                <p class="project-placeholder-text task-detail-sidebar-empty-state">
                                  Loading runs.
                                </p>
                              }
                            >
                              <Show
                                when={runs().length > 0}
                                fallback={
                                  <p class="project-placeholder-text task-detail-sidebar-empty-state">
                                    No runs yet.
                                  </p>
                                }
                              >
                                <ul class="task-runs-list">
                                  <For each={runs()}>
                                    {(runItem) => (
                                      <li class="task-runs-item">
                                        {(() => {
                                          const isLocallyStarting =
                                            startingRunId() === runItem.id;
                                          const canShowStartAction =
                                            runItem.status === "queued" &&
                                            !isLocallyStarting &&
                                            !isBlocked() &&
                                            !isAnyRunStarting() &&
                                            deletingRunId() !== runItem.id &&
                                            !warmingRunIds()[runItem.id];

                                          return (
                                            <Show when={canShowStartAction}>
                                              <button
                                                type="button"
                                                class="task-runs-start-button btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-3 text-[11px] font-medium"
                                                onClick={(event) => {
                                                  event.preventDefault();
                                                  event.stopPropagation();
                                                  void onStartRun(runItem.id);
                                                }}
                                              >
                                                Start
                                              </button>
                                            </Show>
                                          );
                                        })()}
                                        <button
                                          type="button"
                                          class="task-control-icon-button task-control-icon-button-danger task-runs-delete-button"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            void onDeleteRun(runItem.id);
                                          }}
                                          disabled={
                                            deletingRunId() === runItem.id
                                          }
                                          aria-label={
                                            deletingRunId() === runItem.id
                                              ? "Deleting run"
                                              : "Delete run"
                                          }
                                          title={
                                            deletingRunId() === runItem.id
                                              ? "Deleting run"
                                              : "Delete run"
                                          }
                                        >
                                          <DeleteIcon />
                                        </button>
                                        <A
                                          href={`/runs/${runItem.id}`}
                                          class={`task-runs-link ${
                                            runItem.status === "queued" &&
                                            startingRunId() !== runItem.id &&
                                            !isBlocked() &&
                                            !isAnyRunStarting() &&
                                            deletingRunId() !== runItem.id &&
                                            !warmingRunIds()[runItem.id]
                                              ? "task-runs-link--with-start-action"
                                              : "task-runs-link--with-delete-action"
                                          }`}
                                        >
                                          <div class="task-runs-content">
                                            <div class="task-runs-primary-row">
                                              <span class="task-runs-label">
                                                {getRunPrimaryLabel(runItem)}
                                              </span>
                                              <span
                                                class={`project-task-status project-task-status--${runItem.status}`}
                                              >
                                                {formatRunStatus(
                                                  runItem.status,
                                                )}
                                              </span>
                                            </div>
                                            <div class="task-runs-secondary-row">
                                              <span class="task-runs-created-at">
                                                {formatDateTime(
                                                  runItem.createdAt,
                                                )}
                                              </span>
                                              <Show
                                                when={getRunTimingCopy(runItem)}
                                              >
                                                {(timingCopy) => (
                                                  <span class="task-runs-timing-copy">
                                                    {timingCopy()}
                                                  </span>
                                                )}
                                              </Show>
                                            </div>
                                            <p class="task-runs-summary-row">
                                              {(
                                                runItem.errorMessage ||
                                                runItem.summary ||
                                                ""
                                              ).trim() ||
                                                getRunSummaryFallback(
                                                  runItem.status,
                                                )}
                                            </p>
                                          </div>
                                        </A>
                                        <Show
                                          when={runStartErrors()[runItem.id]}
                                        >
                                          {(runStartError) => (
                                            <p
                                              class="task-runs-start-error"
                                              role="alert"
                                            >
                                              {runStartError()}
                                            </p>
                                          )}
                                        </Show>
                                      </li>
                                    )}
                                  </For>
                                </ul>
                              </Show>
                            </Show>
                          </Show>
                        </div>
                        <div
                          class="task-detail-panel-separator"
                          aria-hidden="true"
                        />
                        <div class="task-detail-panel-section task-dependencies-panel">
                          <h2 class="project-section-title">Dependencies</h2>
                          <Show
                            when={!dependenciesError()}
                            fallback={
                              <div class="task-dependencies-error-block">
                                <p class="project-placeholder-text">
                                  {dependenciesError()}
                                </p>
                                <button
                                  type="button"
                                  class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                                  onClick={() => {
                                    const currentTask = task();
                                    if (!currentTask) return;
                                    void refreshDependencies(currentTask.id);
                                  }}
                                >
                                  Retry
                                </button>
                              </div>
                            }
                          >
                            <Show
                              when={!isLoadingDependencies() && dependencies()}
                              fallback={
                                <p class="project-placeholder-text">
                                  Loading dependencies.
                                </p>
                              }
                            >
                              {(dependencyState) => (
                                <div class="task-dependencies-content">
                                  <div class="task-dependencies-section">
                                    <div class="task-dependencies-heading-row">
                                      <h3 class="task-dependencies-heading">
                                        Blocked by
                                      </h3>
                                      <button
                                        type="button"
                                        class="btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-3 text-[11px] font-medium"
                                        onClick={() =>
                                          onOpenCreateDependencyModal("parent")
                                        }
                                        aria-label="Create parent dependency"
                                      >
                                        Create
                                      </button>
                                      <button
                                        type="button"
                                        class="btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-3 text-[11px] font-medium"
                                        onClick={() =>
                                          onOpenLinkDependencyModal("parent")
                                        }
                                        aria-label="Link parent dependency"
                                      >
                                        Link
                                      </button>
                                    </div>
                                    <Show
                                      when={
                                        dependencyState().parents.length > 0
                                      }
                                      fallback={
                                        <p class="project-placeholder-text task-detail-sidebar-empty-state">
                                          No prerequisites yet.
                                        </p>
                                      }
                                    >
                                      <ul class="task-dependencies-list">
                                        <For each={dependencyState().parents}>
                                          {(dependencyTask) => (
                                            <li
                                              class="task-dependency-row task-dependency-row--clickable"
                                              role="button"
                                              tabindex={0}
                                              onClick={() =>
                                                navigateToDependencyTask(
                                                  dependencyTask.id,
                                                )
                                              }
                                              onKeyDown={(event) => {
                                                if (
                                                  event.currentTarget !==
                                                  event.target
                                                )
                                                  return;
                                                if (
                                                  event.key === "Enter" ||
                                                  event.key === " "
                                                ) {
                                                  event.preventDefault();
                                                  navigateToDependencyTask(
                                                    dependencyTask.id,
                                                  );
                                                }
                                              }}
                                            >
                                              <div class="task-dependency-main task-dependency-link">
                                                <p class="task-dependency-title">
                                                  {dependencyDisplayLabel(
                                                    dependencyTask,
                                                  )}
                                                </p>
                                                <div class="task-dependency-meta">
                                                  <span
                                                    class={`project-task-status project-task-status--${dependencyTask.status}`}
                                                  >
                                                    {formatStatus(
                                                      dependencyTask.status,
                                                    )}
                                                  </span>
                                                  <span class="task-dependency-scope">
                                                    {dependencyScopeLabel(
                                                      dependencyTask,
                                                    )}
                                                  </span>
                                                </div>
                                              </div>
                                              <button
                                                type="button"
                                                class="task-dependency-action btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-3 text-[11px] font-medium"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  void onRemoveDependency(
                                                    dependencyTask.id,
                                                    taskValue().id,
                                                  );
                                                }}
                                                onKeyDown={(event) => {
                                                  if (
                                                    event.key === "Enter" ||
                                                    event.key === " "
                                                  ) {
                                                    event.stopPropagation();
                                                  }
                                                }}
                                                disabled={
                                                  removingDependencyKey() ===
                                                  `${dependencyTask.id}:${taskValue().id}`
                                                }
                                              >
                                                Remove
                                              </button>
                                            </li>
                                          )}
                                        </For>
                                      </ul>
                                    </Show>
                                  </div>

                                  <div class="task-dependencies-section">
                                    <div class="task-dependencies-heading-row">
                                      <h3 class="task-dependencies-heading">
                                        Blocking
                                      </h3>
                                      <button
                                        type="button"
                                        class="btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-3 text-[11px] font-medium"
                                        onClick={() =>
                                          onOpenCreateDependencyModal("child")
                                        }
                                        aria-label="Create blocked task"
                                      >
                                        Create
                                      </button>
                                      <button
                                        type="button"
                                        class="btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-3 text-[11px] font-medium"
                                        onClick={() =>
                                          onOpenLinkDependencyModal("child")
                                        }
                                        aria-label="Link blocked task"
                                      >
                                        Link
                                      </button>
                                    </div>
                                    <Show
                                      when={
                                        dependencyState().children.length > 0
                                      }
                                      fallback={
                                        <p class="project-placeholder-text task-detail-sidebar-empty-state">
                                          No downstream tasks yet.
                                        </p>
                                      }
                                    >
                                      <ul class="task-dependencies-list">
                                        <For each={dependencyState().children}>
                                          {(dependencyTask) => (
                                            <li
                                              class="task-dependency-row task-dependency-row--clickable"
                                              role="button"
                                              tabindex={0}
                                              onClick={() =>
                                                navigateToDependencyTask(
                                                  dependencyTask.id,
                                                )
                                              }
                                              onKeyDown={(event) => {
                                                if (
                                                  event.currentTarget !==
                                                  event.target
                                                )
                                                  return;
                                                if (
                                                  event.key === "Enter" ||
                                                  event.key === " "
                                                ) {
                                                  event.preventDefault();
                                                  navigateToDependencyTask(
                                                    dependencyTask.id,
                                                  );
                                                }
                                              }}
                                            >
                                              <div class="task-dependency-main task-dependency-link">
                                                <p class="task-dependency-title">
                                                  {dependencyDisplayLabel(
                                                    dependencyTask,
                                                  )}
                                                </p>
                                                <div class="task-dependency-meta">
                                                  <span
                                                    class={`project-task-status project-task-status--${dependencyTask.status}`}
                                                  >
                                                    {formatStatus(
                                                      dependencyTask.status,
                                                    )}
                                                  </span>
                                                  <span class="task-dependency-scope">
                                                    {dependencyScopeLabel(
                                                      dependencyTask,
                                                    )}
                                                  </span>
                                                </div>
                                              </div>
                                              <button
                                                type="button"
                                                class="task-dependency-action btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-3 text-[11px] font-medium"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  void onRemoveDependency(
                                                    taskValue().id,
                                                    dependencyTask.id,
                                                  );
                                                }}
                                                onKeyDown={(event) => {
                                                  if (
                                                    event.key === "Enter" ||
                                                    event.key === " "
                                                  ) {
                                                    event.stopPropagation();
                                                  }
                                                }}
                                                disabled={
                                                  removingDependencyKey() ===
                                                  `${taskValue().id}:${dependencyTask.id}`
                                                }
                                              >
                                                Remove
                                              </button>
                                            </li>
                                          )}
                                        </For>
                                      </ul>
                                    </Show>
                                  </div>
                                </div>
                              )}
                            </Show>
                          </Show>
                        </div>
                      </section>
                    </aside>
                  </div>
                </div>
              )}
            </Show>
          </Show>
        </Show>
      </div>
      <Show when={isDeleteModalOpen() && task()}>
        {(taskValue) => (
          <div
            class="projects-modal-backdrop"
            role="presentation"
            onClick={onCancelDeleteTask}
          >
            <section
              class="projects-modal task-delete-modal border-base-content/15 bg-base-200 rounded-none border"
              role="dialog"
              aria-modal="true"
              aria-labelledby="task-delete-modal-title"
              aria-describedby="task-delete-modal-copy"
              onClick={(event) => event.stopPropagation()}
            >
              <div class="border-base-content/10 border-b pb-3">
                <h2
                  id="task-delete-modal-title"
                  class="task-delete-modal-title"
                >
                  Delete task?
                </h2>
              </div>
              <p
                id="task-delete-modal-copy"
                class="project-placeholder-text task-delete-modal-copy"
              >
                This permanently removes "{taskValue().title}" and cannot be
                undone.
              </p>
              <div class="task-delete-modal-actions">
                <button
                  type="button"
                  class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                  onClick={onCancelDeleteTask}
                  disabled={isDeleting()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn btn-sm border-error/25 bg-error/10 text-error hover:bg-error/15 rounded-none border px-4 text-xs font-medium"
                  onClick={onConfirmDeleteTask}
                  disabled={isDeleting()}
                >
                  {isDeleting() ? "Deleting..." : "Delete"}
                </button>
              </div>
            </section>
          </div>
        )}
      </Show>
      <Show when={isCreateDependencyModalOpen()}>
        <div
          class="projects-modal-backdrop"
          role="presentation"
          onClick={onCancelCreateDependency}
        >
          <section
            class="projects-modal task-create-dependency-modal border-base-content/15 bg-base-200 rounded-none border"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-create-dependency-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="border-base-content/10 mb-4 border-b pb-3">
              <h2
                id="task-create-dependency-modal-title"
                class="task-delete-modal-title"
              >
                {createDependencyDirection() === "parent"
                  ? "Create blocking prerequisite"
                  : "Create blocked task"}
              </h2>
              <p class="text-base-content/55 mt-1 text-xs">
                Create a new task and attach the dependency immediately.
              </p>
            </div>
            <label class="projects-field">
              <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                <span class="field-label-text">Title</span>
              </span>
              <input
                value={createDependencyTitle()}
                onInput={(event) =>
                  setCreateDependencyTitle(event.currentTarget.value)
                }
                aria-label="Dependency task title"
              />
            </label>
            <label class="projects-field">
              <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                <span class="field-label-text">Description</span>
                <span class="field-optional">optional</span>
              </span>
              <textarea
                rows={3}
                value={createDependencyDescription()}
                onInput={(event) =>
                  setCreateDependencyDescription(event.currentTarget.value)
                }
                aria-label="Dependency task description"
              />
            </label>
            <label class="projects-field">
              <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                <span class="field-label-text">Implementation guide</span>
                <span class="field-optional">optional</span>
              </span>
              <textarea
                rows={3}
                value={createDependencyImplementationGuide()}
                onInput={(event) =>
                  setCreateDependencyImplementationGuide(
                    event.currentTarget.value,
                  )
                }
                aria-label="Dependency task implementation guide"
              />
            </label>
            <label class="projects-field">
              <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                <span class="field-label-text">Status</span>
                <span class="field-optional">optional</span>
              </span>
              <select
                class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
                value={createDependencyStatus()}
                onChange={(event) =>
                  setCreateDependencyStatus(
                    event.currentTarget.value as TaskStatus,
                  )
                }
                aria-label="Dependency task status"
              >
                <option value="todo">To do</option>
                <option value="doing">In progress</option>
                <option value="review">In review</option>
                <option value="done">Done</option>
              </select>
            </label>
            <div class="task-delete-modal-actions">
              <button
                type="button"
                class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                onClick={onCancelCreateDependency}
                disabled={isCreatingDependency()}
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                onClick={onSubmitCreateDependency}
                disabled={isCreatingDependency()}
              >
                {isCreatingDependency() ? "Creating..." : "Create and link"}
              </button>
            </div>
          </section>
        </div>
      </Show>
      <Show when={isLinkDependencyModalOpen()}>
        <div
          class="projects-modal-backdrop"
          role="presentation"
          onClick={onCancelLinkDependency}
        >
          <section
            class="projects-modal task-create-dependency-modal border-base-content/15 bg-base-200 rounded-none border"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-link-dependency-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="border-base-content/10 mb-4 border-b pb-3">
              <h2
                id="task-link-dependency-modal-title"
                class="task-delete-modal-title"
              >
                {linkDependencyDirection() === "parent"
                  ? "Link blocking prerequisite"
                  : "Link blocked task"}
              </h2>
              <p class="text-base-content/55 mt-1 text-xs">
                Search existing tasks and attach them as dependencies.
              </p>
            </div>
            <label class="projects-field">
              <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                <span class="field-label-text">Search tasks</span>
              </span>
              <input
                value={linkDependencySearch()}
                onInput={(event) =>
                  setLinkDependencySearch(event.currentTarget.value)
                }
                placeholder="Search by key, title, or repository"
                aria-label="Search dependency tasks"
              />
            </label>
            <label class="task-link-dependency-toggle">
              <input
                type="checkbox"
                checked={showDoneLinkCandidates()}
                onChange={(event) =>
                  setShowDoneLinkCandidates(event.currentTarget.checked)
                }
              />
              Show done tasks
            </label>
            <Show
              when={filteredLinkCandidates().length > 0}
              fallback={
                <p class="project-placeholder-text">
                  No tasks match your filters.
                </p>
              }
            >
              <ul class="task-link-candidate-list" aria-label="Link candidates">
                <For each={filteredLinkCandidates()}>
                  {(candidateTask) => (
                    <li class="task-link-candidate-item">
                      <div class="task-dependency-main">
                        <p class="task-dependency-title">
                          {dependencyDisplayLabel({
                            id: candidateTask.id,
                            displayKey: candidateTask.displayKey || "",
                            title: candidateTask.title,
                            status: candidateTask.status,
                            targetRepositoryName:
                              candidateTask.targetRepositoryName,
                            targetRepositoryPath:
                              candidateTask.targetRepositoryPath,
                            updatedAt: candidateTask.updatedAt,
                          })}
                        </p>
                        <div class="task-dependency-meta">
                          <span
                            class={`project-task-status project-task-status--${candidateTask.status}`}
                          >
                            {formatStatus(candidateTask.status)}
                          </span>
                          <span class="task-dependency-scope">
                            {dependencyScopeLabel({
                              id: candidateTask.id,
                              displayKey: candidateTask.displayKey || "",
                              title: candidateTask.title,
                              status: candidateTask.status,
                              targetRepositoryName:
                                candidateTask.targetRepositoryName,
                              targetRepositoryPath:
                                candidateTask.targetRepositoryPath,
                              updatedAt: candidateTask.updatedAt,
                            })}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                        onClick={() => void onLinkDependency(candidateTask.id)}
                        disabled={isLinkingDependency()}
                        aria-label={`Link ${dependencyDisplayLabel({
                          id: candidateTask.id,
                          displayKey: candidateTask.displayKey || "",
                          title: candidateTask.title,
                          status: candidateTask.status,
                          targetRepositoryName:
                            candidateTask.targetRepositoryName,
                          targetRepositoryPath:
                            candidateTask.targetRepositoryPath,
                          updatedAt: candidateTask.updatedAt,
                        })}`}
                      >
                        {isLinkingDependency() ? "Linking..." : "Link"}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <div class="task-delete-modal-actions">
              <button
                type="button"
                class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                onClick={onCancelLinkDependency}
                disabled={isLinkingDependency()}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      </Show>
      <Show when={isBlockedRunWarningOpen()}>
        <div
          class="projects-modal-backdrop"
          role="presentation"
          onClick={() => setIsBlockedRunWarningOpen(false)}
        >
          <section
            class="projects-modal task-create-dependency-modal border-base-content/15 bg-base-200 rounded-none border"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-blocked-run-modal-title"
            aria-describedby="task-blocked-run-modal-copy"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="border-base-content/10 border-b pb-3">
              <h2
                id="task-blocked-run-modal-title"
                class="task-delete-modal-title"
              >
                Run blocked
              </h2>
            </div>
            <p
              id="task-blocked-run-modal-copy"
              class="project-placeholder-text task-delete-modal-copy"
            >
              This task is blocked. Wait for{" "}
              {(() => {
                const blockers = blockingParentTasks().map((dependencyTask) =>
                  dependencyDisplayLabel(dependencyTask),
                );
                const visible = blockers.slice(0, 3);
                const hiddenCount = blockers.length - visible.length;
                const blockerCopy =
                  visible.length > 0
                    ? visible.join(", ") +
                      (hiddenCount > 0 ? ` +${hiddenCount} more` : "")
                    : "prerequisite tasks";
                return blockerCopy;
              })()}{" "}
              to complete first.
            </p>
            <div class="task-delete-modal-actions">
              <button
                type="button"
                class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                onClick={() => setIsBlockedRunWarningOpen(false)}
              >
                Got it
              </button>
            </div>
          </section>
        </div>
      </Show>
      <RunSettingsModal
        isOpen={isRunSettingsModalOpen}
        isSubmitting={isCreatingRun}
        hasRunSelectionOptions={hasRunSelectionOptions}
        isLoadingRunSelectionOptions={isLoadingRunSelectionOptions}
        runSelectionOptionsError={runSelectionOptionsError}
        runAgentOptions={runAgentOptions}
        runProviderOptions={runProviderOptions}
        visibleRunModelOptions={visibleRunModelOptions}
        selectedRunAgentId={selectedRunAgentId}
        selectedRunProviderId={selectedRunProviderId}
        selectedRunModelId={selectedRunModelId}
        setSelectedRunAgentId={setSelectedRunAgentId}
        setSelectedRunProviderId={setSelectedRunProviderId}
        setSelectedRunModelId={setSelectedRunModelId}
        onCancel={onCancelRunSettingsModal}
        onConfirm={onConfirmCreateRun}
      />
    </>
  );
};

export default TaskDetailScreen;
