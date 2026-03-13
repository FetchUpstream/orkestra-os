import { For, Show, createSignal, type Component } from "solid-js";
import BackIconLink from "../../../components/ui/BackIconLink";
import { A } from "@solidjs/router";
import type { TaskStatus } from "../../../app/lib/tasks";
import MarkdownContent from "../../../components/ui/MarkdownContent";
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

const EditIcon: Component = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 17.25V21h3.75L18.81 8.94l-3.75-3.75L3 17.25zm17.71-10.04a.996.996 0 0 0 0-1.41L18.2 3.29a.996.996 0 1 0-1.41 1.41l2.5 2.5c.39.39 1.03.39 1.42.01z" />
  </svg>
);

const StatusTransitionIcon: Component = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 11h11.17l-3.58-3.59L14 6l6 6-6 6-1.41-1.41L16.17 13H5z" />
  </svg>
);

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
    deletingRunId,
    selectedParentTaskId,
    selectedChildTaskId,
    isAddingParent,
    isAddingChild,
    removingDependencyKey,
    isEditing,
    editTitle,
    editDescription,
    isSavingEdit,
    isChangingStatus,
    moveRepositoryId,
    isMoving,
    isDeleting,
    isDeleteModalOpen,
    isCreateDependencyModalOpen,
    createDependencyDirection,
    createDependencyTitle,
    createDependencyDescription,
    createDependencyStatus,
    isCreatingDependency,
    backHref,
    backLabel,
    canMoveTask,
    validTransitionOptions,
    availableParentCandidates,
    availableChildCandidates,
    navigateToDependencyTask,
    refreshDependencies,
    refreshRuns,
    setActionError,
    setIsEditing,
    setEditTitle,
    setEditDescription,
    setMoveRepositoryId,
    setSelectedParentTaskId,
    setSelectedChildTaskId,
    setCreateDependencyTitle,
    setCreateDependencyDescription,
    setCreateDependencyStatus,
    onOpenCreateDependencyModal,
    onCancelCreateDependency,
    onSubmitCreateDependency,
    onSaveEdit,
    onCancelEdit,
    onSetStatus,
    onMoveTask,
    onRequestDeleteTask,
    onCancelDeleteTask,
    onConfirmDeleteTask,
    onAddParentDependency,
    onAddChildDependency,
    onRemoveDependency,
    onCreateRun,
    onDeleteRun,
  } = useTaskDetailModel();
  const [isTransitionMenuOpen, setIsTransitionMenuOpen] = createSignal(false);

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
                        <BackIconLink
                          href={backHref()}
                          label={backLabel()}
                          class="project-detail-back-link project-detail-back-link--icon task-detail-back-link"
                        />
                        <Show when={actionError()}>
                          <div
                            class="projects-error"
                            role="alert"
                            aria-live="polite"
                          >
                            {actionError()}
                          </div>
                        </Show>
                        <Show
                          when={!isEditing()}
                          fallback={
                            <input
                              class="task-detail-title-input"
                              value={editTitle()}
                              onInput={(event) =>
                                setEditTitle(event.currentTarget.value)
                              }
                              aria-label="Task title"
                            />
                          }
                        >
                          <h1 class="task-detail-title">{taskValue().title}</h1>
                        </Show>
                        <div class="task-detail-meta-row">
                          <Show when={taskValue().displayKey?.trim()}>
                            {(displayKey) => (
                              <span class="projects-list-meta">
                                {displayKey()}
                              </span>
                            )}
                          </Show>
                          <span
                            class={`project-task-status project-task-status--${taskValue().status}`}
                          >
                            {formatStatus(taskValue().status)}
                          </span>
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
                          <Show
                            when={isEditing()}
                            fallback={
                              <Show
                                when={taskValue().description?.trim()}
                                fallback={
                                  <p class="project-placeholder-text task-detail-description-text">
                                    No description yet
                                  </p>
                                }
                              >
                                {(description) => (
                                  <MarkdownContent
                                    content={description()}
                                    class="task-detail-description-text"
                                  />
                                )}
                              </Show>
                            }
                          >
                            <TaskMarkdownEditor
                              value={editDescription()}
                              onChange={setEditDescription}
                              ariaLabel="Task description"
                              disabled={isSavingEdit()}
                            />
                          </Show>
                        </div>
                      </section>
                    </div>

                    <aside class="task-detail-inspector-column">
                      <section class="projects-panel task-detail-inspector-panel">
                        <div class="task-detail-panel-section">
                          <h2 class="project-section-title">Task controls</h2>
                          <div class="task-detail-header-actions task-detail-controls-actions">
                            <Show
                              when={isEditing()}
                              fallback={
                                <button
                                  type="button"
                                  class="task-control-icon-button"
                                  onClick={() => {
                                    setActionError("");
                                    setIsEditing(true);
                                  }}
                                  aria-label="Edit task"
                                  title="Edit task"
                                >
                                  <EditIcon />
                                </button>
                              }
                            >
                              <button
                                type="button"
                                class="projects-button-primary"
                                onClick={onSaveEdit}
                                disabled={isSavingEdit()}
                              >
                                {isSavingEdit() ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                class="projects-button-muted"
                                onClick={onCancelEdit}
                                disabled={isSavingEdit()}
                              >
                                Cancel
                              </button>
                            </Show>
                            <button
                              type="button"
                              class="task-control-icon-button"
                              onClick={() =>
                                setIsTransitionMenuOpen((current) => !current)
                              }
                              disabled={isChangingStatus()}
                              aria-label={
                                isChangingStatus()
                                  ? "Updating task status"
                                  : "Open status transitions"
                              }
                              title={
                                isChangingStatus()
                                  ? "Updating task status"
                                  : "Change task status"
                              }
                              aria-haspopup="menu"
                              aria-expanded={isTransitionMenuOpen()}
                            >
                              <StatusTransitionIcon />
                            </button>
                            <Show
                              when={
                                isTransitionMenuOpen() && !isChangingStatus()
                              }
                            >
                              <div
                                class="task-status-transition-menu"
                                role="menu"
                                aria-label="Valid status transitions"
                              >
                                <Show
                                  when={validTransitionOptions().length > 0}
                                  fallback={
                                    <p class="task-status-transition-empty">
                                      No transitions available.
                                    </p>
                                  }
                                >
                                  <For each={validTransitionOptions()}>
                                    {(statusOption) => (
                                      <button
                                        type="button"
                                        class="task-status-transition-option"
                                        role="menuitem"
                                        onClick={() => {
                                          setIsTransitionMenuOpen(false);
                                          void onSetStatus(statusOption);
                                        }}
                                      >
                                        {formatStatus(statusOption)}
                                      </button>
                                    )}
                                  </For>
                                </Show>
                              </div>
                            </Show>
                            <button
                              type="button"
                              class="task-control-icon-button task-control-icon-button-danger"
                              onClick={onRequestDeleteTask}
                              disabled={isDeleting()}
                              aria-label={
                                isDeleting() ? "Deleting task" : "Delete task"
                              }
                              title={
                                isDeleting() ? "Deleting task" : "Delete task"
                              }
                            >
                              <DeleteIcon />
                            </button>
                          </div>
                          <div class="task-detail-quick-actions">
                            <Show when={canMoveTask()}>
                              <label class="projects-field">
                                <span class="field-label">
                                  <span class="field-label-text">
                                    Move task to repository
                                  </span>
                                </span>
                                <select
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
                                class="projects-button-muted"
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
                              class="projects-button-primary"
                              onClick={onCreateRun}
                              disabled={isCreatingRun()}
                            >
                              {isCreatingRun() ? "Starting..." : "New Run"}
                            </button>
                          </div>
                          <Show
                            when={!runsError()}
                            fallback={
                              <div class="task-dependencies-error-block">
                                <p class="project-placeholder-text">
                                  {runsError()}
                                </p>
                                <button
                                  type="button"
                                  class="projects-button-muted"
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
                                <p class="project-placeholder-text">
                                  Loading runs.
                                </p>
                              }
                            >
                              <Show
                                when={runs().length > 0}
                                fallback={
                                  <p class="project-placeholder-text">
                                    No runs yet.
                                  </p>
                                }
                              >
                                <ul class="task-runs-list">
                                  <For each={runs()}>
                                    {(runItem) => (
                                      <li class="task-runs-item">
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
                                          class="task-runs-link task-runs-link--with-action"
                                        >
                                          <span class="task-runs-link-copy">
                                            Open run details
                                          </span>
                                          <span
                                            class={`project-task-status project-task-status--${runItem.status}`}
                                          >
                                            {formatRunStatus(runItem.status)}
                                          </span>
                                          <span class="task-runs-created-at">
                                            {formatDateTime(runItem.createdAt)}
                                          </span>
                                        </A>
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
                                  class="projects-button-muted"
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
                                        class="task-dependencies-add-button"
                                        onClick={() =>
                                          onOpenCreateDependencyModal("parent")
                                        }
                                        aria-label="Create and add parent dependency"
                                        title="Create parent dependency"
                                      >
                                        +
                                      </button>
                                    </div>
                                    <Show
                                      when={
                                        dependencyState().parents.length > 0
                                      }
                                      fallback={
                                        <p class="project-placeholder-text">
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
                                                class="projects-button-muted task-dependency-action"
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
                                    <div class="task-dependency-controls">
                                      <label class="projects-field task-dependency-selector-field">
                                        <span class="field-label">
                                          <span class="field-label-text">
                                            Add parent dependency
                                          </span>
                                        </span>
                                        <select
                                          value={selectedParentTaskId()}
                                          onChange={(event) =>
                                            setSelectedParentTaskId(
                                              event.currentTarget.value,
                                            )
                                          }
                                          disabled={isAddingParent()}
                                          aria-label="Add parent dependency"
                                        >
                                          <option value="">Select task</option>
                                          <For
                                            each={availableParentCandidates()}
                                          >
                                            {(candidateTask) => (
                                              <option value={candidateTask.id}>
                                                {dependencyDisplayLabel({
                                                  id: candidateTask.id,
                                                  displayKey:
                                                    candidateTask.displayKey ||
                                                    "",
                                                  title: candidateTask.title,
                                                  status: candidateTask.status,
                                                  targetRepositoryName:
                                                    candidateTask.targetRepositoryName,
                                                  targetRepositoryPath:
                                                    candidateTask.targetRepositoryPath,
                                                  updatedAt:
                                                    candidateTask.updatedAt,
                                                })}
                                              </option>
                                            )}
                                          </For>
                                        </select>
                                      </label>
                                      <button
                                        type="button"
                                        class="projects-button-muted"
                                        onClick={onAddParentDependency}
                                        disabled={
                                          !selectedParentTaskId() ||
                                          isAddingParent()
                                        }
                                      >
                                        {isAddingParent()
                                          ? "Adding..."
                                          : "Add parent"}
                                      </button>
                                    </div>
                                  </div>

                                  <div class="task-dependencies-section">
                                    <div class="task-dependencies-heading-row">
                                      <h3 class="task-dependencies-heading">
                                        Blocking
                                      </h3>
                                      <button
                                        type="button"
                                        class="task-dependencies-add-button"
                                        onClick={() =>
                                          onOpenCreateDependencyModal("child")
                                        }
                                        aria-label="Create and add blocked task"
                                        title="Create blocked task"
                                      >
                                        +
                                      </button>
                                    </div>
                                    <Show
                                      when={
                                        dependencyState().children.length > 0
                                      }
                                      fallback={
                                        <p class="project-placeholder-text">
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
                                                class="projects-button-muted task-dependency-action"
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
                                    <div class="task-dependency-controls">
                                      <label class="projects-field task-dependency-selector-field">
                                        <span class="field-label">
                                          <span class="field-label-text">
                                            Add blocked task
                                          </span>
                                        </span>
                                        <select
                                          value={selectedChildTaskId()}
                                          onChange={(event) =>
                                            setSelectedChildTaskId(
                                              event.currentTarget.value,
                                            )
                                          }
                                          disabled={isAddingChild()}
                                          aria-label="Add child dependency"
                                        >
                                          <option value="">Select task</option>
                                          <For
                                            each={availableChildCandidates()}
                                          >
                                            {(candidateTask) => (
                                              <option value={candidateTask.id}>
                                                {dependencyDisplayLabel({
                                                  id: candidateTask.id,
                                                  displayKey:
                                                    candidateTask.displayKey ||
                                                    "",
                                                  title: candidateTask.title,
                                                  status: candidateTask.status,
                                                  targetRepositoryName:
                                                    candidateTask.targetRepositoryName,
                                                  targetRepositoryPath:
                                                    candidateTask.targetRepositoryPath,
                                                  updatedAt:
                                                    candidateTask.updatedAt,
                                                })}
                                              </option>
                                            )}
                                          </For>
                                        </select>
                                      </label>
                                      <button
                                        type="button"
                                        class="projects-button-muted"
                                        onClick={onAddChildDependency}
                                        disabled={
                                          !selectedChildTaskId() ||
                                          isAddingChild()
                                        }
                                      >
                                        {isAddingChild()
                                          ? "Adding..."
                                          : "Add child"}
                                      </button>
                                    </div>
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
              class="projects-modal task-delete-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="task-delete-modal-title"
              aria-describedby="task-delete-modal-copy"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="task-delete-modal-title" class="task-delete-modal-title">
                Delete task?
              </h2>
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
                  class="projects-button-muted"
                  onClick={onCancelDeleteTask}
                  disabled={isDeleting()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="projects-button-danger"
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
            class="projects-modal task-create-dependency-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-create-dependency-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="task-create-dependency-modal-title"
              class="task-delete-modal-title"
            >
              {createDependencyDirection() === "parent"
                ? "Create blocking prerequisite"
                : "Create blocked task"}
            </h2>
            <label class="projects-field">
              <span class="field-label">
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
              <span class="field-label">
                <span class="field-label-text">Description</span>
                <span class="field-optional">Optional</span>
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
              <span class="field-label">
                <span class="field-label-text">Status</span>
                <span class="field-optional">Optional</span>
              </span>
              <select
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
                class="projects-button-muted"
                onClick={onCancelCreateDependency}
                disabled={isCreatingDependency()}
              >
                Cancel
              </button>
              <button
                type="button"
                class="projects-button-primary"
                onClick={onSubmitCreateDependency}
                disabled={isCreatingDependency()}
              >
                {isCreatingDependency() ? "Creating..." : "Create and link"}
              </button>
            </div>
          </section>
        </div>
      </Show>
    </>
  );
};

export default TaskDetailScreen;
