import { A, useNavigate, useParams } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  type Component,
} from "solid-js";
import { getProject } from "../app/lib/projects";
import {
  addTaskDependency,
  createTask,
  deleteTask,
  getTask,
  listProjectTasks,
  listTaskDependencies,
  moveTask,
  removeTaskDependency,
  setTaskStatus,
  updateTask,
  type TaskDependencies,
  type TaskDependencyTask,
  type Task,
  type TaskStatus,
} from "../app/lib/tasks";
import MarkdownContent from "../components/ui/MarkdownContent";
import TaskMarkdownEditor from "../components/ui/TaskMarkdownEditor";

const formatStatus = (status: Task["status"]) => {
  if (status === "todo") return "To do";
  if (status === "doing") return "In progress";
  if (status === "review") return "In review";
  return "Done";
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
};

const repositoryLabel = (taskValue: Task) =>
  taskValue.targetRepositoryName ||
  taskValue.targetRepositoryPath ||
  "Project-wide";

const projectLabel = (name: string | null) => name || "Current project";

const dependencyScopeLabel = (dependencyTask: TaskDependencyTask) =>
  dependencyTask.targetRepositoryName ||
  dependencyTask.targetRepositoryPath ||
  "Project-wide";

const dependencyDisplayLabel = (dependencyTask: TaskDependencyTask) => {
  const key = dependencyTask.displayKey.trim();
  return key ? `${key} - ${dependencyTask.title}` : dependencyTask.title;
};

const nextStatus = (status: TaskStatus): TaskStatus => {
  if (status === "todo") return "doing";
  if (status === "doing") return "review";
  if (status === "review") return "done";
  return "todo";
};

const getActionErrorMessage = (prefix: string, error: unknown): string => {
  const message =
    typeof error === "string"
      ? error
      : error &&
          typeof error === "object" &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : "Please try again.";
  return `${prefix} ${message}`;
};

const EditIcon: Component = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 17.25V21h3.75L18.81 8.94l-3.75-3.75L3 17.25zm17.71-10.04a.996.996 0 0 0 0-1.41L18.2 3.29a.996.996 0 1 0-1.41 1.41l2.5 2.5c.39.39 1.03.39 1.42.01z" />
  </svg>
);

const StatusIcon: Component = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 12.65-5.65z" />
  </svg>
);

const DeleteIcon: Component = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z" />
  </svg>
);

type DependencyCreateDirection = "parent" | "child";

const TaskDetailPage: Component = () => {
  const navigate = useNavigate();
  const params = useParams();
  const [task, setTask] = createSignal<Task | null>(null);
  const [projectId, setProjectId] = createSignal<string | null>(null);
  const [projectName, setProjectName] = createSignal<string | null>(null);
  const [projectRepositories, setProjectRepositories] = createSignal<
    Array<{ id: string; name: string }>
  >([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [actionError, setActionError] = createSignal("");
  const [dependencies, setDependencies] = createSignal<TaskDependencies | null>(
    null,
  );
  const [dependenciesError, setDependenciesError] = createSignal("");
  const [isLoadingDependencies, setIsLoadingDependencies] = createSignal(false);
  const [candidateTasks, setCandidateTasks] = createSignal<Task[]>([]);
  const [selectedParentTaskId, setSelectedParentTaskId] = createSignal("");
  const [selectedChildTaskId, setSelectedChildTaskId] = createSignal("");
  const [isAddingParent, setIsAddingParent] = createSignal(false);
  const [isAddingChild, setIsAddingChild] = createSignal(false);
  const [removingDependencyKey, setRemovingDependencyKey] = createSignal("");

  const [isEditing, setIsEditing] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal("");
  const [editDescription, setEditDescription] = createSignal("");
  const [isSavingEdit, setIsSavingEdit] = createSignal(false);
  const [isChangingStatus, setIsChangingStatus] = createSignal(false);
  const [moveRepositoryId, setMoveRepositoryId] = createSignal("");
  const [isMoving, setIsMoving] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = createSignal(false);
  const [isCreateDependencyModalOpen, setIsCreateDependencyModalOpen] =
    createSignal(false);
  const [createDependencyDirection, setCreateDependencyDirection] =
    createSignal<DependencyCreateDirection>("parent");
  const [createDependencyTitle, setCreateDependencyTitle] = createSignal("");
  const [createDependencyDescription, setCreateDependencyDescription] =
    createSignal("");
  const [createDependencyStatus, setCreateDependencyStatus] =
    createSignal<TaskStatus>("todo");
  const [isCreatingDependency, setIsCreatingDependency] = createSignal(false);
  const [defaultProjectRepositoryId, setDefaultProjectRepositoryId] =
    createSignal("");

  const backHref = createMemo(() =>
    projectId() ? `/projects/${projectId()}` : "/projects",
  );

  const dependencyTaskHref = (dependencyTaskId: string) => {
    const scopedProjectId =
      projectId() || task()?.projectId || params.projectId;
    return scopedProjectId
      ? `/projects/${scopedProjectId}/tasks/${dependencyTaskId}`
      : `/tasks/${dependencyTaskId}`;
  };

  const navigateToDependencyTask = (dependencyTaskId: string) => {
    navigate(dependencyTaskHref(dependencyTaskId));
  };

  const backLabel = createMemo(() => (projectId() ? "project" : "projects"));
  const canMoveTask = createMemo(() => projectRepositories().length > 1);
  const availableParentCandidates = createMemo(() => {
    const taskValue = task();
    const currentDependencies = dependencies();
    if (!taskValue || !currentDependencies) return [];
    const blockedIds = new Set([
      taskValue.id,
      ...currentDependencies.parents.map((dependencyTask) => dependencyTask.id),
    ]);
    return candidateTasks().filter(
      (candidateTask) => !blockedIds.has(candidateTask.id),
    );
  });
  const availableChildCandidates = createMemo(() => {
    const taskValue = task();
    const currentDependencies = dependencies();
    if (!taskValue || !currentDependencies) return [];
    const blockedIds = new Set([
      taskValue.id,
      ...currentDependencies.children.map(
        (dependencyTask) => dependencyTask.id,
      ),
    ]);
    return candidateTasks().filter(
      (candidateTask) => !blockedIds.has(candidateTask.id),
    );
  });

  const refreshDependencies = async (taskId: string) => {
    setIsLoadingDependencies(true);
    setDependenciesError("");
    try {
      const loadedDependencies = await listTaskDependencies(taskId);
      setDependencies(loadedDependencies);
    } catch {
      setDependenciesError("Failed to load dependencies.");
    } finally {
      setIsLoadingDependencies(false);
    }
  };

  const loadDependencyCandidates = async (resolvedProjectId: string | null) => {
    if (!resolvedProjectId) {
      setCandidateTasks([]);
      return;
    }
    try {
      const tasks = await listProjectTasks(resolvedProjectId);
      setCandidateTasks(tasks);
    } catch {
      setCandidateTasks([]);
    }
  };

  const loadProjectContext = async (resolvedProjectId: string | null) => {
    setProjectId(resolvedProjectId);
    if (!resolvedProjectId) {
      setProjectName(null);
      setProjectRepositories([]);
      setMoveRepositoryId("");
      setDefaultProjectRepositoryId("");
      return;
    }

    try {
      const project = await getProject(resolvedProjectId);
      const name = project.name.trim();
      const key = project.key.trim();
      setProjectName(key ? `${name} (${key})` : name || null);
      const repositories = project.repositories
        .filter(
          (
            repository,
          ): repository is { id: string; name?: string | null; path: string } =>
            Boolean(repository.id),
        )
        .map((repository) => ({
          id: repository.id,
          name: repository.name?.trim() || repository.path,
        }));
      setProjectRepositories(repositories);
      if (task()?.targetRepositoryId) {
        setMoveRepositoryId(task()?.targetRepositoryId || "");
      } else {
        const defaultRepository = project.repositories.find(
          (repository) => repository.is_default && repository.id,
        );
        setMoveRepositoryId(defaultRepository?.id || repositories[0]?.id || "");
      }
      const defaultRepository = project.repositories.find(
        (repository) => repository.is_default && repository.id,
      );
      setDefaultProjectRepositoryId(
        defaultRepository?.id || repositories[0]?.id || "",
      );
    } catch {
      setProjectName(null);
      setProjectRepositories([]);
      setMoveRepositoryId("");
      setDefaultProjectRepositoryId("");
    }
  };

  const onOpenCreateDependencyModal = (
    direction: DependencyCreateDirection,
  ) => {
    setActionError("");
    setCreateDependencyDirection(direction);
    setCreateDependencyTitle("");
    setCreateDependencyDescription("");
    setCreateDependencyStatus("todo");
    setIsCreateDependencyModalOpen(true);
  };

  const onCancelCreateDependency = () => {
    if (isCreatingDependency()) return;
    setIsCreateDependencyModalOpen(false);
  };

  const onSubmitCreateDependency = async () => {
    const taskValue = task();
    const resolvedProjectId = projectId() || taskValue?.projectId || null;
    if (!taskValue || !resolvedProjectId) return;

    const title = createDependencyTitle().trim();
    if (!title) {
      setActionError("Title is required.");
      return;
    }

    const targetRepositoryId =
      taskValue.targetRepositoryId || defaultProjectRepositoryId();
    if (!targetRepositoryId) {
      setActionError(
        "Failed to create dependency task. No repository available.",
      );
      return;
    }

    setActionError("");
    setIsCreatingDependency(true);
    try {
      const created = await createTask({
        projectId: resolvedProjectId,
        title,
        description: createDependencyDescription().trim() || undefined,
        status: createDependencyStatus(),
        targetRepositoryId,
      });
      if (createDependencyDirection() === "parent") {
        await addTaskDependency(created.id, taskValue.id);
      } else {
        await addTaskDependency(taskValue.id, created.id);
      }
      await Promise.all([
        refreshDependencies(taskValue.id),
        loadDependencyCandidates(resolvedProjectId),
      ]);
      setIsCreateDependencyModalOpen(false);
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage(
          "Failed to create dependency task.",
          mutationError,
        ),
      );
    } finally {
      setIsCreatingDependency(false);
    }
  };

  createEffect(() => {
    const activeTaskId = params.taskId;
    if (!activeTaskId) {
      setError("Missing task ID.");
      setIsLoading(false);
      return;
    }

    void (async () => {
      setIsLoading(true);
      setError("");
      setActionError("");
      try {
        const detail = await getTask(activeTaskId);
        setTask(detail);
        setEditTitle(detail.title);
        setEditDescription(detail.description || "");

        const resolvedProjectId = detail.projectId || params.projectId || null;
        await Promise.all([
          loadProjectContext(resolvedProjectId),
          refreshDependencies(detail.id),
          loadDependencyCandidates(resolvedProjectId),
        ]);
      } catch {
        setError("Failed to load task details.");
      } finally {
        setIsLoading(false);
      }
    })();
  });

  const onSaveEdit = async () => {
    const taskValue = task();
    if (!taskValue) return;
    const title = editTitle().trim();
    if (!title) {
      setActionError("Title is required.");
      return;
    }

    setActionError("");
    setIsSavingEdit(true);
    try {
      const updated = await updateTask(taskValue.id, {
        title,
        description: editDescription().trim() || undefined,
      });
      setTask(updated);
      setEditTitle(updated.title);
      setEditDescription(updated.description || "");
      setIsEditing(false);
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage("Failed to save task.", mutationError),
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const onCancelEdit = () => {
    const taskValue = task();
    if (!taskValue) return;
    setEditTitle(taskValue.title);
    setEditDescription(taskValue.description || "");
    setActionError("");
    setIsEditing(false);
  };

  const onAdvanceStatus = async () => {
    const taskValue = task();
    if (!taskValue) return;

    setActionError("");
    setIsChangingStatus(true);
    try {
      const updated = await setTaskStatus(taskValue.id, {
        status: nextStatus(taskValue.status),
      });
      setTask(updated);
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage("Failed to update status.", mutationError),
      );
    } finally {
      setIsChangingStatus(false);
    }
  };

  const onMoveTask = async () => {
    const taskValue = task();
    const targetRepositoryId = moveRepositoryId();
    if (!taskValue || !targetRepositoryId) return;

    setActionError("");
    setIsMoving(true);
    try {
      const updated = await moveTask(taskValue.id, { targetRepositoryId });
      setTask(updated);
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage("Failed to move task.", mutationError),
      );
    } finally {
      setIsMoving(false);
    }
  };

  const onRequestDeleteTask = () => {
    if (isDeleting()) return;
    setActionError("");
    setIsDeleteModalOpen(true);
  };

  const onCancelDeleteTask = () => {
    if (isDeleting()) return;
    setIsDeleteModalOpen(false);
  };

  const onConfirmDeleteTask = async () => {
    const taskValue = task();
    if (!taskValue) return;

    setActionError("");
    setIsDeleting(true);
    try {
      await deleteTask(taskValue.id);
      navigate(backHref());
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage("Failed to delete task.", mutationError),
      );
      setIsDeleting(false);
      setIsDeleteModalOpen(false);
    }
  };

  const onAddParentDependency = async () => {
    const taskValue = task();
    const parentTaskId = selectedParentTaskId();
    if (!taskValue || !parentTaskId) return;

    setActionError("");
    setIsAddingParent(true);
    try {
      await addTaskDependency(parentTaskId, taskValue.id);
      await refreshDependencies(taskValue.id);
      setSelectedParentTaskId("");
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage("Failed to add dependency.", mutationError),
      );
    } finally {
      setIsAddingParent(false);
    }
  };

  const onAddChildDependency = async () => {
    const taskValue = task();
    const childTaskId = selectedChildTaskId();
    if (!taskValue || !childTaskId) return;

    setActionError("");
    setIsAddingChild(true);
    try {
      await addTaskDependency(taskValue.id, childTaskId);
      await refreshDependencies(taskValue.id);
      setSelectedChildTaskId("");
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage("Failed to add dependency.", mutationError),
      );
    } finally {
      setIsAddingChild(false);
    }
  };

  const onRemoveDependency = async (
    parentTaskId: string,
    childTaskId: string,
  ) => {
    const taskValue = task();
    if (!taskValue) return;

    setActionError("");
    setRemovingDependencyKey(`${parentTaskId}:${childTaskId}`);
    try {
      await removeTaskDependency(parentTaskId, childTaskId);
      await refreshDependencies(taskValue.id);
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage("Failed to remove dependency.", mutationError),
      );
    } finally {
      setRemovingDependencyKey("");
    }
  };

  return (
    <>
      <div class="task-detail-page">
        <Show
          when={!error()}
          fallback={
            <section class="projects-panel task-detail-state-card">
              <h3 class="project-section-title">Unable to load task</h3>
              <p class="project-placeholder-text">{error()}</p>
              <p class="project-placeholder-text">
                Try going back to projects and reopening this task.
              </p>
            </section>
          }
        >
          <Show
            when={!isLoading()}
            fallback={
              <section class="projects-panel task-detail-state-card">
                <h3 class="project-section-title">Loading task</h3>
                <p class="project-placeholder-text">
                  Pulling task details and context.
                </p>
              </section>
            }
          >
            <Show
              when={task()}
              fallback={
                <section class="projects-panel task-detail-state-card">
                  <h3 class="project-section-title">Task not found</h3>
                  <p class="project-placeholder-text">
                    This task may have been removed or the link is no longer
                    valid.
                  </p>
                  <A
                    href={
                      params.projectId
                        ? `/projects/${params.projectId}`
                        : "/projects"
                    }
                    class="project-detail-back-link project-detail-back-link--icon"
                    aria-label={`Back to ${backLabel()}`}
                    title={`Back to ${backLabel()}`}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M10 12L6 8L10 4"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </A>
                </section>
              }
            >
              {(taskValue) => (
                <div class="task-detail-workspace">
                  <div class="task-detail-columns">
                    <div class="task-detail-main-column">
                      <section class="projects-panel task-detail-main-card">
                        <A
                          href={backHref()}
                          class="project-detail-back-link project-detail-back-link--icon task-detail-back-link"
                          aria-label={`Back to ${backLabel()}`}
                          title={`Back to ${backLabel()}`}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M10 12L6 8L10 4"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            />
                          </svg>
                        </A>
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
                              onClick={onAdvanceStatus}
                              disabled={isChangingStatus()}
                              aria-label={
                                isChangingStatus()
                                  ? "Updating task status"
                                  : `Move task status to ${formatStatus(nextStatus(taskValue().status))}`
                              }
                              title={
                                isChangingStatus()
                                  ? "Updating task status"
                                  : `Move status to ${formatStatus(nextStatus(taskValue().status))}`
                              }
                            >
                              <StatusIcon />
                            </button>
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
                                    const taskValue = task();
                                    if (!taskValue) return;
                                    void refreshDependencies(taskValue.id);
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

export default TaskDetailPage;
