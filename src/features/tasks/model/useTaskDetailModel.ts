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
  startRunOpenCode,
  type RunSelectionOption,
  type RunModelOption,
  type Run,
} from "../../../app/lib/runs";
import {
  getRunSelectionOptionsWithCache,
  readRunSelectionOptionsCache,
} from "../../../app/lib/runSelectionOptionsCache";
import {
  filterDependencyCandidates,
  getActionErrorMessage,
  getValidTransitionTargets,
  isDependencyCandidateLinkable,
} from "../utils/taskDetail";
import {
  dependencyBadgeState,
  isTaskBlocked,
  type DependencyBadgeState,
} from "../../projects/utils/projectDetail";

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
  const [removingDependencyKey, setRemovingDependencyKey] = createSignal("");
  const [isEditing, setIsEditing] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal("");
  const [editDescription, setEditDescription] = createSignal("");
  const [editImplementationGuide, setEditImplementationGuide] =
    createSignal("");
  const [isSavingEdit, setIsSavingEdit] = createSignal(false);
  const [isChangingStatus, setIsChangingStatus] = createSignal(false);
  const [isTransitionMenuOpen, setIsTransitionMenuOpen] = createSignal(false);
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
  const [
    createDependencyImplementationGuide,
    setCreateDependencyImplementationGuide,
  ] = createSignal("");
  const [createDependencyStatus, setCreateDependencyStatus] =
    createSignal<TaskStatus>("todo");
  const [isCreatingDependency, setIsCreatingDependency] = createSignal(false);
  const [isLinkDependencyModalOpen, setIsLinkDependencyModalOpen] =
    createSignal(false);
  const [linkDependencyDirection, setLinkDependencyDirection] =
    createSignal<DependencyCreateDirection>("parent");
  const [linkDependencySearch, setLinkDependencySearch] = createSignal("");
  const [showDoneLinkCandidates, setShowDoneLinkCandidates] =
    createSignal(false);
  const [isLinkingDependency, setIsLinkingDependency] = createSignal(false);
  const [defaultProjectRepositoryId, setDefaultProjectRepositoryId] =
    createSignal("");
  const [runs, setRuns] = createSignal<Run[]>([]);
  const [runsError, setRunsError] = createSignal("");
  const [isLoadingRuns, setIsLoadingRuns] = createSignal(false);
  const [isCreatingRun, setIsCreatingRun] = createSignal(false);
  const [isRunSettingsModalOpen, setIsRunSettingsModalOpen] =
    createSignal(false);
  const [isBlockedRunWarningOpen, setIsBlockedRunWarningOpen] =
    createSignal(false);
  const [deletingRunId, setDeletingRunId] = createSignal("");
  const [startingRunId, setStartingRunId] = createSignal("");
  const [runAgentOptions, setRunAgentOptions] = createSignal<
    RunSelectionOption[]
  >([]);
  const [runProviderOptions, setRunProviderOptions] = createSignal<
    RunSelectionOption[]
  >([]);
  const [runModelOptions, setRunModelOptions] = createSignal<RunModelOption[]>(
    [],
  );
  const [runSelectionOptionsError, setRunSelectionOptionsError] =
    createSignal("");
  const [isLoadingRunSelectionOptions, setIsLoadingRunSelectionOptions] =
    createSignal(false);
  const [selectedRunAgentId, setSelectedRunAgentId] = createSignal("");
  const [selectedRunProviderId, setSelectedRunProviderIdSignal] =
    createSignal("");
  const [selectedRunModelId, setSelectedRunModelIdSignal] = createSignal("");
  const [warmingRunIds, setWarmingRunIds] = createSignal<
    Record<string, boolean>
  >({});
  const [runStartErrors, setRunStartErrors] = createSignal<
    Record<string, string>
  >({});
  let runSelectionOptionsRequestVersion = 0;

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
  const isAnyRunStarting = createMemo(() => Boolean(startingRunId()));
  const validTransitionOptions = createMemo(() => {
    const taskValue = task();
    if (!taskValue) return [];
    return getValidTransitionTargets(taskValue.status);
  });
  const blockingParentTasks = createMemo(() =>
    (dependencies()?.parents || []).filter(
      (dependencyTask) => dependencyTask.status !== "done",
    ),
  );
  const isBlocked = createMemo(() => {
    const taskValue = task();
    if (!taskValue) return false;
    if (taskValue.isBlocked != null) return taskValue.isBlocked;
    return isTaskBlocked(taskValue) || blockingParentTasks().length > 0;
  });
  const taskDependencyBadgeState = createMemo<DependencyBadgeState>(() => {
    const taskValue = task();
    if (!taskValue) return "none";
    if (isBlocked()) return "blocked";
    return dependencyBadgeState(taskValue);
  });
  const visibleRunModelOptions = createMemo(() => {
    const providerId = selectedRunProviderId().trim();
    if (!providerId) {
      return runModelOptions();
    }
    return runModelOptions().filter(
      (option) => !option.providerId || option.providerId === providerId,
    );
  });

  const doesModelMatchProvider = (
    modelId: string,
    providerId: string,
  ): boolean => {
    if (!modelId || !providerId) {
      return true;
    }

    const selectedModel = runModelOptions().find(
      (option) => option.id === modelId,
    );
    if (!selectedModel || !selectedModel.providerId) {
      return true;
    }

    return selectedModel.providerId === providerId;
  };

  createEffect(() => {
    const providerId = selectedRunProviderId().trim();
    const modelId = selectedRunModelId().trim();
    if (!modelId) {
      return;
    }
    if (!doesModelMatchProvider(modelId, providerId)) {
      setSelectedRunModelIdSignal("");
    }
  });

  const setSelectedRunProviderId = (providerId: string) => {
    setSelectedRunProviderIdSignal(providerId);
  };

  const setSelectedRunModelId = (modelId: string) => {
    setSelectedRunModelIdSignal(modelId);
    if (!modelId) {
      return;
    }

    const selectedModel = runModelOptions().find(
      (option) => option.id === modelId,
    );
    const providerId = selectedModel?.providerId?.trim() || "";
    if (providerId && providerId !== selectedRunProviderId().trim()) {
      setSelectedRunProviderIdSignal(providerId);
    }
  };

  const hasRunSelectionOptions = createMemo(() => {
    return (
      runAgentOptions().length > 0 ||
      runProviderOptions().length > 0 ||
      runModelOptions().length > 0
    );
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
    const linkedTaskIds = new Set(
      currentDependencies.parents.map((dependencyTask) => dependencyTask.id),
    );
    return candidateTasks().filter((candidateTask) =>
      isDependencyCandidateLinkable(candidateTask, taskValue.id, linkedTaskIds),
    );
  });

  const availableChildCandidates = createMemo(() => {
    const taskValue = task();
    const currentDependencies = dependencies();
    if (!taskValue || !currentDependencies) return [];
    const linkedTaskIds = new Set(
      currentDependencies.children.map((dependencyTask) => dependencyTask.id),
    );
    return candidateTasks().filter((candidateTask) =>
      isDependencyCandidateLinkable(candidateTask, taskValue.id, linkedTaskIds),
    );
  });

  const filteredLinkCandidates = createMemo(() => {
    const candidates =
      linkDependencyDirection() === "parent"
        ? availableParentCandidates()
        : availableChildCandidates();
    return filterDependencyCandidates(candidates, {
      searchTerm: linkDependencySearch(),
      includeDone: showDoneLinkCandidates(),
    });
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

  const refreshRunSelectionOptions = async (activeTaskId: string) => {
    const requestVersion = ++runSelectionOptionsRequestVersion;
    const cachedOptions = readRunSelectionOptionsCache();
    if (cachedOptions) {
      setRunSelectionOptionsError("");
      setIsLoadingRunSelectionOptions(false);
      setRunAgentOptions(cachedOptions.agents);
      setRunProviderOptions(cachedOptions.providers);
      setRunModelOptions(cachedOptions.models);
      return;
    }

    setIsLoadingRunSelectionOptions(true);
    setRunSelectionOptionsError("");
    try {
      const options = await getRunSelectionOptionsWithCache();
      if (
        requestVersion !== runSelectionOptionsRequestVersion ||
        params.taskId !== activeTaskId
      ) {
        return;
      }
      setRunAgentOptions(options.agents);
      setRunProviderOptions(options.providers);
      setRunModelOptions(options.models);
    } catch {
      if (
        requestVersion !== runSelectionOptionsRequestVersion ||
        params.taskId !== activeTaskId
      ) {
        return;
      }
      setRunSelectionOptionsError("Failed to load run options.");
      setRunAgentOptions([]);
      setRunProviderOptions([]);
      setRunModelOptions([]);
    } finally {
      if (
        requestVersion === runSelectionOptionsRequestVersion &&
        params.taskId === activeTaskId
      ) {
        setIsLoadingRunSelectionOptions(false);
      }
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
    setCreateDependencyImplementationGuide("");
    setCreateDependencyStatus("todo");
    setIsCreateDependencyModalOpen(true);
  };

  const onCancelCreateDependency = () => {
    if (isCreatingDependency()) return;
    setIsCreateDependencyModalOpen(false);
  };

  const onOpenLinkDependencyModal = (direction: DependencyCreateDirection) => {
    setActionError("");
    setLinkDependencyDirection(direction);
    setLinkDependencySearch("");
    setShowDoneLinkCandidates(false);
    setIsLinkDependencyModalOpen(true);
  };

  const onCancelLinkDependency = () => {
    if (isLinkingDependency()) return;
    setIsLinkDependencyModalOpen(false);
  };

  const onLinkDependency = async (dependencyTaskId: string) => {
    const taskValue = task();
    if (!taskValue || !dependencyTaskId || isLinkingDependency()) return;
    const currentLinkedTasks =
      linkDependencyDirection() === "parent"
        ? (dependencies()?.parents ?? [])
        : (dependencies()?.children ?? []);
    const linkedTaskIds = new Set(
      currentLinkedTasks.map((dependencyTask) => dependencyTask.id),
    );
    if (
      !isDependencyCandidateLinkable(
        { id: dependencyTaskId, title: "", status: "todo" },
        taskValue.id,
        linkedTaskIds,
      )
    ) {
      return;
    }

    setActionError("");
    setIsLinkingDependency(true);
    try {
      if (linkDependencyDirection() === "parent") {
        await addTaskDependency(dependencyTaskId, taskValue.id);
      } else {
        await addTaskDependency(taskValue.id, dependencyTaskId);
      }
      await refreshDependencies(taskValue.id);
      setIsLinkDependencyModalOpen(false);
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage("Failed to add dependency.", mutationError),
      );
    } finally {
      setIsLinkingDependency(false);
    }
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
        implementationGuide:
          createDependencyImplementationGuide().trim() || undefined,
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
        setEditImplementationGuide(detail.implementationGuide || "");
        const resolvedProjectId = detail.projectId || params.projectId || null;
        void refreshRunSelectionOptions(activeTaskId);
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
        implementationGuide: editImplementationGuide().trim() || undefined,
      });
      setTask(updated);
      setEditTitle(updated.title);
      setEditDescription(updated.description || "");
      setEditImplementationGuide(updated.implementationGuide || "");
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
    setEditImplementationGuide(taskValue.implementationGuide || "");
    setActionError("");
    setIsEditing(false);
  };

  const onSetStatus = async (status: TaskStatus) => {
    const taskValue = task();
    if (!taskValue) return;
    setActionError("");
    setIsTransitionMenuOpen(false);
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
    if (!taskValue) return false;
    if (isBlocked()) {
      setIsRunSettingsModalOpen(false);
      setIsBlockedRunWarningOpen(true);
      return false;
    }
    setActionError("");
    setIsCreatingRun(true);
    try {
      await createRun(taskValue.id, {
        agentId: selectedRunAgentId().trim() || undefined,
        providerId: selectedRunProviderId().trim() || undefined,
        modelId: selectedRunModelId().trim() || undefined,
      });
      await refreshRuns(taskValue.id);
      return true;
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage("Failed to create run.", mutationError),
      );
      return false;
    } finally {
      setIsCreatingRun(false);
    }
  };

  const onOpenRunSettingsModal = () => {
    if (isCreatingRun()) return;
    setActionError("");
    setIsRunSettingsModalOpen(true);
  };

  const onCancelRunSettingsModal = () => {
    if (isCreatingRun()) return;
    setIsRunSettingsModalOpen(false);
  };

  const onConfirmCreateRun = async () => {
    const created = await onCreateRun();
    if (created) {
      setIsRunSettingsModalOpen(false);
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

  const clearRunStartError = (runId: string) => {
    setRunStartErrors((current) => {
      if (!current[runId]) return current;
      const next = { ...current };
      delete next[runId];
      return next;
    });
  };

  const onStartRun = async (runId: string) => {
    const taskValue = task();
    if (
      !taskValue ||
      isBlocked() ||
      !runId ||
      isAnyRunStarting() ||
      deletingRunId() === runId
    ) {
      return;
    }

    setActionError("");
    clearRunStartError(runId);
    setStartingRunId(runId);
    setWarmingRunIds((current) => ({ ...current, [runId]: false }));

    try {
      const startResult = await startRunOpenCode(runId);
      if (
        startResult.state === "unsupported" ||
        startResult.state === "error"
      ) {
        setRunStartErrors((current) => ({
          ...current,
          [runId]: "Failed to start. Try again.",
        }));
        return;
      }

      const phase = startResult.readyPhase?.toLowerCase() ?? "";
      const isWarmingPhase =
        phase.includes("cold") ||
        phase.includes("boot") ||
        phase.includes("warm") ||
        phase.includes("start");
      setWarmingRunIds((current) => ({ ...current, [runId]: isWarmingPhase }));
      await refreshRuns(taskValue.id);
      setWarmingRunIds((current) => ({ ...current, [runId]: false }));
    } catch {
      setRunStartErrors((current) => ({
        ...current,
        [runId]: "Failed to start. Try again.",
      }));
    } finally {
      setStartingRunId("");
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
    isRunSettingsModalOpen,
    isBlockedRunWarningOpen,
    isBlocked,
    taskDependencyBadgeState,
    blockingParentTasks,
    deletingRunId,
    startingRunId,
    isAnyRunStarting,
    warmingRunIds,
    runStartErrors,
    runAgentOptions,
    runProviderOptions,
    runModelOptions,
    visibleRunModelOptions,
    runSelectionOptionsError,
    isLoadingRunSelectionOptions,
    hasRunSelectionOptions,
    selectedRunAgentId,
    selectedRunProviderId,
    selectedRunModelId,
    removingDependencyKey,
    isEditing,
    editTitle,
    editDescription,
    editImplementationGuide,
    isSavingEdit,
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
    setActionError,
    setIsEditing,
    setIsTransitionMenuOpen,
    setSelectedRunAgentId,
    setSelectedRunProviderId,
    setSelectedRunModelId,
    setEditTitle,
    setEditDescription,
    setEditImplementationGuide,
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
    onOpenLinkDependencyModal,
    onCancelLinkDependency,
    onLinkDependency,
    onSaveEdit,
    onCancelEdit,
    onSetStatus,
    onMoveTask,
    onRequestDeleteTask,
    onCancelDeleteTask,
    onConfirmDeleteTask,
    onRemoveDependency,
    onCreateRun,
    onOpenRunSettingsModal,
    onCancelRunSettingsModal,
    onConfirmCreateRun,
    onStartRun,
    onDeleteRun,
  };
};
