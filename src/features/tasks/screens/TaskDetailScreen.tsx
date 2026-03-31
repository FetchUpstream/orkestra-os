import { For, Show, createEffect, onCleanup, type Component } from "solid-js";
import { A } from "@solidjs/router";
import type { TaskStatus } from "../../../app/lib/tasks";
import { AppIcon } from "../../../components/ui/icons";
import RunSettingsModal from "../../runs/components/RunSettingsModal";
import {
  TaskDependenciesSidebar,
  TaskLinkDependencyModal,
} from "../components/TaskDependenciesSidebar";
import TaskEditorPanel from "../components/TaskEditorPanel";
import {
  TaskDetailErrorState,
  TaskDetailLoadingState,
  TaskDetailNotFoundState,
} from "../components/TaskDetailStates";
import { useTaskDetailModel } from "../model/useTaskDetailModel";
import {
  dependencyDisplayLabel,
  formatDateTime,
  formatRunStatus,
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

const TaskDetailScreen: Component = () => {
  const {
    params,
    task,
    projectName,
    projectKey,
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
    projectRunDefaultsError,
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
    onSetLinkDependencyDirection,
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
          mode: "detail",
          title: projectName()?.trim() || "Current project",
          projectKey: projectKey()?.trim() || undefined,
          subtitle: task()?.title?.trim() || "Untitled task",
          backHref: backHref(),
          backLabel: backLabel(),
          autosaveState: autosaveState(),
          isCreatingRun: isCreatingRun(),
          isBlocked: isBlocked(),
          isChangingStatus: isChangingStatus(),
          isTransitionMenuOpen: isTransitionMenuOpen(),
          isDeleting: isDeleting(),
          validTransitionOptions: validTransitionOptions(),
          onOpenRunSettingsModal,
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
                      <Show when={actionError()}>
                        <div
                          class="projects-error"
                          role="alert"
                          aria-live="polite"
                        >
                          {actionError()}
                        </div>
                      </Show>
                      <TaskEditorPanel
                        mode="detail"
                        title={editTitle}
                        description={editDescription}
                        implementationGuide={editImplementationGuide}
                        status={() => taskValue().status}
                        displayKey={() => taskValue().displayKey || ""}
                        projectName={projectName}
                        repositoryScope={() => repositoryLabel(taskValue())}
                        projectId={() => taskValue().projectId ?? undefined}
                        repositoryId={() =>
                          taskValue().targetRepositoryId ?? undefined
                        }
                        updatedAt={() => taskValue().updatedAt}
                        dependencyBadgeState={taskDependencyBadgeState}
                        onTitleInput={onEditTitleInput}
                        onDescriptionInput={onEditDescriptionInput}
                        onImplementationGuideInput={
                          onEditImplementationGuideInput
                        }
                        onTitleBlur={() => {
                          void flushTaskDetailsAutosave("blur");
                        }}
                        onDescriptionBlur={() => {
                          void flushTaskDetailsAutosave("blur");
                        }}
                        onImplementationGuideBlur={() => {
                          void flushTaskDetailsAutosave("blur");
                        }}
                      />
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
                                          <AppIcon
                                            name="action.delete"
                                            size={14}
                                            stroke={1.5}
                                          />
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
                                              <div class="task-runs-left-cluster">
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
                                                <span class="task-runs-created-at">
                                                  {formatDateTime(
                                                    runItem.createdAt,
                                                  )}
                                                </span>
                                                <Show
                                                  when={getRunTimingCopy(
                                                    runItem,
                                                  )}
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
                        <TaskDependenciesSidebar
                          dependencies={dependencies}
                          error={dependenciesError}
                          isLoading={isLoadingDependencies}
                          onRetry={() =>
                            void refreshDependencies(taskValue().id)
                          }
                          onOpenCreateDependencyModal={
                            onOpenCreateDependencyModal
                          }
                          onOpenLinkDependencyModal={onOpenLinkDependencyModal}
                          onNavigateToDependencyTask={navigateToDependencyTask}
                          onRemoveParentDependency={(dependencyTask) => {
                            void onRemoveDependency(
                              dependencyTask.id,
                              taskValue().id,
                            );
                          }}
                          onRemoveChildDependency={(dependencyTask) => {
                            void onRemoveDependency(
                              taskValue().id,
                              dependencyTask.id,
                            );
                          }}
                          removingParentDependencyId={() => {
                            const key = removingDependencyKey();
                            return key?.endsWith(`:${taskValue().id}`)
                              ? key.slice(0, key.indexOf(":"))
                              : null;
                          }}
                          removingChildDependencyId={() => {
                            const key = removingDependencyKey();
                            const prefix = `${taskValue().id}:`;
                            return key?.startsWith(prefix)
                              ? key.slice(prefix.length)
                              : null;
                          }}
                        />
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
      <TaskLinkDependencyModal
        isOpen={isLinkDependencyModalOpen}
        linkDependencyDirection={linkDependencyDirection}
        linkDependencySearch={linkDependencySearch}
        showDoneLinkCandidates={showDoneLinkCandidates}
        filteredLinkCandidates={filteredLinkCandidates}
        isLinkingDependency={isLinkingDependency}
        onCancelLinkDependency={onCancelLinkDependency}
        onSetLinkDependencyDirection={onSetLinkDependencyDirection}
        setLinkDependencySearch={setLinkDependencySearch}
        setShowDoneLinkCandidates={setShowDoneLinkCandidates}
        onLinkDependency={onLinkDependency}
      />
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
        runSelectionOptionsError={() =>
          projectRunDefaultsError() || runSelectionOptionsError()
        }
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
