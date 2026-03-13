import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal } from "solid-js";
import { getProject } from "../../../app/lib/projects";
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
  type Task,
  type TaskStatus,
} from "../../../app/lib/tasks";
import {
  createRun,
  deleteRun,
  listTaskRuns,
  type Run,
} from "../../../app/lib/runs";
import {
  getActionErrorMessage,
  getValidTransitionTargets,
} from "../utils/taskDetail";

export type DependencyCreateDirection = "parent" | "child";

export const useTaskDetailModel = () => {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
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
  const [runs, setRuns] = createSignal<Run[]>([]);
  const [runsError, setRunsError] = createSignal("");
  const [isLoadingRuns, setIsLoadingRuns] = createSignal(false);
  const [isCreatingRun, setIsCreatingRun] = createSignal(false);
  const [deletingRunId, setDeletingRunId] = createSignal("");

  const taskDetailOrigin = createMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get("origin")?.trim().toLowerCase() || "";
  });
  const taskDetailRunId = createMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get("runId")?.trim() || "";
  });
  const backHref = createMemo(() => {
    if (taskDetailOrigin() === "run" && taskDetailRunId()) {
      return `/runs/${taskDetailRunId()}`;
    }
    if (taskDetailOrigin() === "board") return "/board";
    return projectId() ? `/projects/${projectId()}` : "/projects";
  });
  const backLabel = createMemo(() => {
    if (taskDetailOrigin() === "run" && taskDetailRunId()) return "run";
    if (taskDetailOrigin() === "board") return "board";
    return projectId() ? "project" : "projects";
  });
  const canMoveTask = createMemo(() => projectRepositories().length > 1);
  const validTransitionOptions = createMemo(() => {
    const taskValue = task();
    if (!taskValue) return [];
    return getValidTransitionTargets(taskValue.status);
  });

  const dependencyTaskHref = (dependencyTaskId: string) => {
    const scopedProjectId =
      projectId() || task()?.projectId || params.projectId;
    const baseHref = scopedProjectId
      ? `/projects/${scopedProjectId}/tasks/${dependencyTaskId}`
      : `/tasks/${dependencyTaskId}`;
    if (taskDetailOrigin() === "run" && taskDetailRunId()) {
      return `${baseHref}?origin=run&runId=${encodeURIComponent(taskDetailRunId())}`;
    }
    if (taskDetailOrigin() === "board") {
      return `${baseHref}?origin=board`;
    }
    return baseHref;
  };

  const navigateToDependencyTask = (dependencyTaskId: string) => {
    navigate(dependencyTaskHref(dependencyTaskId));
  };

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

  const refreshRuns = async (taskId: string) => {
    setIsLoadingRuns(true);
    setRunsError("");
    try {
      const loadedRuns = await listTaskRuns(taskId);
      setRuns(loadedRuns);
    } catch {
      setRunsError("Failed to load runs.");
      setRuns([]);
    } finally {
      setIsLoadingRuns(false);
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
          refreshRuns(detail.id),
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

  const onSetStatus = async (status: TaskStatus) => {
    const taskValue = task();
    if (!taskValue) return;
    setActionError("");
    setIsChangingStatus(true);
    try {
      const updated = await setTaskStatus(taskValue.id, { status });
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

  const onCreateRun = async () => {
    const taskValue = task();
    if (!taskValue) return;
    setActionError("");
    setIsCreatingRun(true);
    try {
      await createRun(taskValue.id);
      await refreshRuns(taskValue.id);
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage("Failed to create run.", mutationError),
      );
    } finally {
      setIsCreatingRun(false);
    }
  };

  const onDeleteRun = async (runId: string) => {
    const taskValue = task();
    if (!taskValue || !runId || deletingRunId()) return;
    setActionError("");
    setDeletingRunId(runId);
    try {
      await deleteRun(runId);
      setRuns((currentRuns) =>
        currentRuns.filter((runItem) => runItem.id !== runId),
      );
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage("Failed to delete run.", mutationError),
      );
    } finally {
      setDeletingRunId("");
    }
  };

  return {
    params,
    task,
    projectId,
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
  };
};
