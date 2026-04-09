// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { useLocation, useNavigate, useParams } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { resolveProjectBoardHref } from "../../../app/lib/boardNavigation";
import { getProject } from "../../../app/lib/projects";
import { subscribeToRunStatusChanged } from "../../../app/lib/runStatusEvents";
import { subscribeToTaskStatusChanged } from "../../../app/lib/taskStatusEvents";
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
  listTaskRunSourceBranches,
  startRunOpenCode,
  type RunSelectionOption,
  type RunModelOption,
  type Run,
  type RunSourceBranchOption,
} from "../../../app/lib/runs";
import {
  getRunSelectionOptionsWithCache,
  readRunSelectionOptionsCache,
} from "../../../app/lib/runSelectionOptionsCache";
import {
  filterModelsForProvider,
  getProjectRunDefaultsMessage,
  initializeProjectRunDefaults,
  resolveProjectRunDefaults,
} from "../../../app/lib/projectRunDefaults";
import {
  filterDependencyCandidates,
  getActionErrorMessage,
  getValidTransitionTargets,
  isDependencyCandidateLinkable,
} from "../utils/taskDetail";
import { useOpenCodeDependency } from "../../../app/contexts/OpenCodeDependencyContext";
import {
  getDefaultRunSourceBranch,
  isRunSourceBranchAvailable,
} from "../../runs/utils/sourceBranches";
import {
  dependencyBadgeState,
  isTaskBlocked,
  type DependencyBadgeState,
} from "../../projects/utils/projectDetail";

export type DependencyCreateDirection = "parent" | "child";

export const useTaskDetailModel = () => {
  const AUTOSAVE_DEBOUNCE_MS = 900;
  const AUTOSAVE_MAX_WAIT_MS = 5000;

  const navigate = useNavigate();
  const openCodeDependency = useOpenCodeDependency();
  const params = useParams();
  const location = useLocation();
  const [task, setTask] = createSignal<Task | null>(null);
  const [projectId, setProjectId] = createSignal<string | null>(null);
  const [projectName, setProjectName] = createSignal<string | null>(null);
  const [projectKey, setProjectKey] = createSignal<string | null>(null);
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
  const [editTitle, setEditTitle] = createSignal("");
  const [editDescription, setEditDescription] = createSignal("");
  const [editImplementationGuide, setEditImplementationGuide] =
    createSignal("");
  const [autosaveState, setAutosaveState] = createSignal<
    "idle" | "saving" | "saved" | "error"
  >("idle");
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
  const [runSourceBranchOptions, setRunSourceBranchOptions] = createSignal<
    RunSourceBranchOption[]
  >([]);
  const [runSourceBranchError, setRunSourceBranchError] = createSignal("");
  const [isLoadingRunSourceBranches, setIsLoadingRunSourceBranches] =
    createSignal(false);
  const [projectRunDefaultsError, setProjectRunDefaultsError] =
    createSignal("");
  const [projectDefaultRunAgentId, setProjectDefaultRunAgentId] =
    createSignal("");
  const [projectDefaultRunProviderId, setProjectDefaultRunProviderId] =
    createSignal("");
  const [projectDefaultRunModelId, setProjectDefaultRunModelId] =
    createSignal("");
  const [selectedRunAgentId, setSelectedRunAgentId] = createSignal("");
  const [selectedRunProviderId, setSelectedRunProviderIdSignal] =
    createSignal("");
  const [selectedRunModelId, setSelectedRunModelIdSignal] = createSignal("");
  const [selectedRunSourceBranch, setSelectedRunSourceBranch] =
    createSignal("");
  const [
    pendingRunSettingsDefaultsInitialization,
    setPendingRunSettingsDefaultsInitialization,
  ] = createSignal(false);
  const [warmingRunIds, setWarmingRunIds] = createSignal<
    Record<string, boolean>
  >({});
  const [runStartErrors, setRunStartErrors] = createSignal<
    Record<string, string>
  >({});
  let runSelectionOptionsRequestVersion = 0;
  let runSourceBranchesRequestVersion = 0;
  let editMutationVersion = 0;
  let removeTaskStatusSubscription: (() => void) | null = null;
  let removeRunStatusSubscription: (() => void) | null = null;
  let taskStatusSubscriptionDisposed = false;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let autosaveMaxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let autosaveInFlight = false;
  let autosaveQueued = false;
  let lastPersistedDraftSignature = "";

  const normalizeImplementationGuide = (value: string) =>
    value.trim() || undefined;

  const buildAutosavePayload = () => ({
    title: editTitle().trim(),
    description: editDescription().trim() || undefined,
    implementationGuide: normalizeImplementationGuide(
      editImplementationGuide(),
    ),
  });

  const draftSignature = (payload: {
    title: string;
    description?: string;
    implementationGuide?: string;
  }) => JSON.stringify(payload);

  const clearTaskDetailsAutosaveTimers = () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (autosaveMaxWaitTimer) {
      clearTimeout(autosaveMaxWaitTimer);
      autosaveMaxWaitTimer = null;
    }
  };

  const clearTaskDetailsAutosaveState = () => {
    clearTaskDetailsAutosaveTimers();
    autosaveQueued = false;
    setAutosaveState("idle");
  };

  const flushTaskDetailsAutosave = async (
    _reason: "debounced" | "max-wait" | "blur",
  ) => {
    clearTaskDetailsAutosaveTimers();

    const taskValue = task();
    if (!taskValue) return;

    const payload = buildAutosavePayload();
    if (!payload.title) return;

    const nextSignature = draftSignature(payload);
    if (nextSignature === lastPersistedDraftSignature) return;

    if (autosaveInFlight) {
      autosaveQueued = true;
      return;
    }

    const requestVersion = ++editMutationVersion;
    const activeTaskId = taskValue.id;
    autosaveInFlight = true;
    setAutosaveState("saving");

    const requestPromise = (async () => {
      try {
        const updated = await updateTask(activeTaskId, payload);

        if (requestVersion !== editMutationVersion) return;
        if (params.taskId !== activeTaskId) return;
        if (task()?.id !== activeTaskId) return;

        setTask((currentTask) => {
          if (!currentTask || currentTask.id !== activeTaskId)
            return currentTask;
          return {
            ...currentTask,
            title: updated.title,
            description: updated.description,
            implementationGuide: updated.implementationGuide,
            updatedAt: updated.updatedAt,
          };
        });

        const persistedPayload = {
          title: updated.title.trim(),
          description: updated.description?.trim() || undefined,
          implementationGuide: normalizeImplementationGuide(
            updated.implementationGuide || "",
          ),
        };
        lastPersistedDraftSignature = draftSignature(persistedPayload);
        setAutosaveState("saved");
        setActionError("");
      } catch {
        if (requestVersion !== editMutationVersion) return;
        if (params.taskId !== activeTaskId) return;
        setAutosaveState("error");
        setActionError("Failed to autosave task details.");
      } finally {
        if (requestVersion === editMutationVersion) {
          autosaveInFlight = false;
        }
      }
    })();

    await requestPromise;

    if (requestVersion !== editMutationVersion) return;

    if (autosaveQueued) {
      autosaveQueued = false;
      void flushTaskDetailsAutosave("debounced");
    }
  };

  const scheduleTaskDetailsAutosave = () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
    }
    autosaveTimer = setTimeout(() => {
      void flushTaskDetailsAutosave("debounced");
    }, AUTOSAVE_DEBOUNCE_MS);

    if (!autosaveMaxWaitTimer) {
      autosaveMaxWaitTimer = setTimeout(() => {
        void flushTaskDetailsAutosave("max-wait");
      }, AUTOSAVE_MAX_WAIT_MS);
    }
  };

  const onEditTitleInput = (value: string) => {
    setEditTitle(value);
    scheduleTaskDetailsAutosave();
  };

  const onEditDescriptionInput = (value: string) => {
    setEditDescription(value);
    scheduleTaskDetailsAutosave();
  };

  const onEditImplementationGuideInput = (markdown: string) => {
    setEditImplementationGuide(markdown);
    scheduleTaskDetailsAutosave();
  };

  const taskDetailOrigin = createMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get("origin")?.trim().toLowerCase() || "";
  });
  const taskDetailRunId = createMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get("runId")?.trim() || "";
  });
  const backHref = createMemo(() =>
    resolveProjectBoardHref(projectId(), task()?.projectId, params.projectId),
  );
  const backLabel = createMemo(() => "board");
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
    return filterModelsForProvider(
      runModelOptions(),
      selectedRunProviderId().trim(),
    );
  });

  const initializeRunSettingsSelectionsFromProjectDefaults = () => {
    const resolved = initializeProjectRunDefaults({
      persisted: {
        agentId: projectDefaultRunAgentId(),
        providerId: projectDefaultRunProviderId(),
        modelId: projectDefaultRunModelId(),
      },
      agents: runAgentOptions(),
      providers: runProviderOptions(),
      models: runModelOptions(),
    });

    setSelectedRunAgentId(resolved.agentId);
    setSelectedRunProviderIdSignal(resolved.providerId);
    setSelectedRunModelIdSignal(resolved.modelId);
    setProjectRunDefaultsError(
      getProjectRunDefaultsMessage(resolved, "creating a run"),
    );
  };

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

  createEffect(() => {
    const modelId = selectedRunModelId().trim();
    const availableModelOptions = runModelOptions();
    if (!modelId) {
      setProjectRunDefaultsError("");
      return;
    }

    if (availableModelOptions.length === 0) {
      return;
    }

    const selectedModel = availableModelOptions.find(
      (option) => option.id === modelId,
    );
    if (selectedModel) {
      setProjectRunDefaultsError("");
      return;
    }

    setSelectedRunModelIdSignal("");
    setProjectRunDefaultsError(
      "Project default model is no longer available. Please reselect before creating a run.",
    );
  });

  createEffect(() => {
    const agentId = selectedRunAgentId().trim();
    const availableAgentOptions = runAgentOptions();
    if (!agentId || availableAgentOptions.length === 0) {
      return;
    }

    if (availableAgentOptions.some((option) => option.id === agentId)) {
      return;
    }

    setSelectedRunAgentId("");
  });

  const setSelectedRunProviderId = (providerId: string) => {
    setPendingRunSettingsDefaultsInitialization(false);
    setSelectedRunProviderIdSignal(providerId);
  };

  const setSelectedRunAgentIdForSelection = (agentId: string) => {
    setPendingRunSettingsDefaultsInitialization(false);
    setSelectedRunAgentId(agentId);
  };

  const setSelectedRunModelId = (modelId: string) => {
    setPendingRunSettingsDefaultsInitialization(false);
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

  const refreshRunSelectionOptions = async (
    activeTaskId: string,
    resolvedProjectIdOverride?: string | null,
  ) => {
    const resolvedProjectId =
      resolvedProjectIdOverride?.trim() || projectId()?.trim() || "";
    if (!resolvedProjectId) {
      setRunSelectionOptionsError("Missing project context for run options.");
      setRunAgentOptions([]);
      setRunProviderOptions([]);
      setRunModelOptions([]);
      setIsLoadingRunSelectionOptions(false);
      return;
    }

    const requestVersion = ++runSelectionOptionsRequestVersion;
    const cachedOptions = readRunSelectionOptionsCache(resolvedProjectId);
    if (cachedOptions) {
      setRunSelectionOptionsError("");
      setIsLoadingRunSelectionOptions(false);
      setRunAgentOptions(cachedOptions.agents);
      setRunProviderOptions(cachedOptions.providers);
      setRunModelOptions(cachedOptions.models);
      if (pendingRunSettingsDefaultsInitialization()) {
        initializeRunSettingsSelectionsFromProjectDefaults();
        setPendingRunSettingsDefaultsInitialization(false);
      }
      return;
    }

    setIsLoadingRunSelectionOptions(true);
    setRunSelectionOptionsError("");
    try {
      const options = await getRunSelectionOptionsWithCache(resolvedProjectId);
      if (
        requestVersion !== runSelectionOptionsRequestVersion ||
        params.taskId !== activeTaskId
      ) {
        return;
      }
      setRunAgentOptions(options.agents);
      setRunProviderOptions(options.providers);
      setRunModelOptions(options.models);
      if (pendingRunSettingsDefaultsInitialization()) {
        initializeRunSettingsSelectionsFromProjectDefaults();
        setPendingRunSettingsDefaultsInitialization(false);
      }
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

  const refreshRunSourceBranches = async (activeTaskId: string) => {
    const normalizedTaskId = activeTaskId.trim();
    if (!normalizedTaskId) {
      setRunSourceBranchOptions([]);
      setRunSourceBranchError("Missing task context for source branches.");
      setIsLoadingRunSourceBranches(false);
      return;
    }

    const requestVersion = ++runSourceBranchesRequestVersion;
    setIsLoadingRunSourceBranches(true);
    setRunSourceBranchError("");
    try {
      const branches = await listTaskRunSourceBranches(normalizedTaskId);
      if (requestVersion !== runSourceBranchesRequestVersion) {
        return;
      }

      setRunSourceBranchOptions(branches);
      if (branches.length === 0) {
        setSelectedRunSourceBranch("");
        setRunSourceBranchError("No local branches are available.");
        return;
      }

      const currentSelection = selectedRunSourceBranch();
      if (!isRunSourceBranchAvailable(currentSelection, branches)) {
        setSelectedRunSourceBranch(getDefaultRunSourceBranch(branches));
      }
    } catch {
      if (requestVersion !== runSourceBranchesRequestVersion) {
        return;
      }
      setRunSourceBranchOptions([]);
      setRunSourceBranchError("Failed to load local branches.");
    } finally {
      if (requestVersion === runSourceBranchesRequestVersion) {
        setIsLoadingRunSourceBranches(false);
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
      setProjectKey(null);
      setProjectRepositories([]);
      setMoveRepositoryId("");
      setDefaultProjectRepositoryId("");
      return;
    }
    try {
      const project = await getProject(resolvedProjectId);
      const name = project.name.trim();
      const key = project.key.trim();
      setProjectName(name || null);
      setProjectKey(key || null);
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
      const defaultRunAgentId = project.defaultRunAgent?.trim() || "";
      const defaultRunProviderId = project.defaultRunProvider?.trim() || "";
      const defaultRunModelId = project.defaultRunModel?.trim() || "";
      setProjectDefaultRunAgentId(defaultRunAgentId);
      setProjectDefaultRunProviderId(defaultRunProviderId);
      setProjectDefaultRunModelId(defaultRunModelId);
      initializeRunSettingsSelectionsFromProjectDefaults();
    } catch {
      setProjectName(null);
      setProjectKey(null);
      setProjectRepositories([]);
      setMoveRepositoryId("");
      setDefaultProjectRepositoryId("");
      setProjectDefaultRunAgentId("");
      setProjectDefaultRunProviderId("");
      setProjectDefaultRunModelId("");
      setSelectedRunAgentId("");
      setSelectedRunProviderIdSignal("");
      setSelectedRunModelIdSignal("");
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

  const onSetLinkDependencyDirection = (
    direction: DependencyCreateDirection,
  ) => {
    setLinkDependencyDirection(direction);
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
        lastPersistedDraftSignature = draftSignature({
          title: detail.title.trim(),
          description: detail.description?.trim() || undefined,
          implementationGuide: normalizeImplementationGuide(
            detail.implementationGuide || "",
          ),
        });
        clearTaskDetailsAutosaveState();
        const resolvedProjectId = detail.projectId || params.projectId || null;
        void refreshRunSelectionOptions(activeTaskId, resolvedProjectId);
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

  onMount(() => {
    void (async () => {
      const unlisten = await subscribeToTaskStatusChanged((event) => {
        if (taskStatusSubscriptionDisposed) {
          return;
        }

        setTask((current) =>
          current && current.id === event.taskId
            ? {
                ...current,
                status: event.newStatus,
                updatedAt: event.timestamp,
              }
            : current,
        );
      });

      if (taskStatusSubscriptionDisposed) {
        unlisten();
        return;
      }

      removeTaskStatusSubscription = unlisten;
    })();

    void (async () => {
      const unlisten = await subscribeToRunStatusChanged((event) => {
        if (taskStatusSubscriptionDisposed) {
          return;
        }

        const activeTaskId = params.taskId?.trim() ?? "";
        if (!activeTaskId || event.taskId !== activeTaskId) {
          return;
        }

        void refreshRuns(activeTaskId);
      });

      if (taskStatusSubscriptionDisposed) {
        unlisten();
        return;
      }

      removeRunStatusSubscription = unlisten;
    })();
  });

  onCleanup(() => {
    taskStatusSubscriptionDisposed = true;
    removeTaskStatusSubscription?.();
    removeRunStatusSubscription?.();
    clearTaskDetailsAutosaveState();
    editMutationVersion += 1;
  });

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

  const onCreateRun = async (): Promise<Run | null> => {
    const taskValue = task();
    if (!taskValue) return null;
    if (isBlocked()) {
      setIsRunSettingsModalOpen(false);
      setIsBlockedRunWarningOpen(true);
      return null;
    }

    const resolvedSelections = resolveProjectRunDefaults({
      persisted: {
        agentId: selectedRunAgentId(),
        providerId: selectedRunProviderId(),
        modelId: selectedRunModelId(),
      },
      agents: runAgentOptions(),
      providers: runProviderOptions(),
      models: runModelOptions(),
    });
    if (resolvedSelections.requiresUserAction) {
      setActionError(
        "Run defaults are unavailable. Select a valid provider and model before creating a run.",
      );
      return null;
    }

    setActionError("");
    setIsCreatingRun(true);
    try {
      const createdRun = await createRun(taskValue.id, {
        agentId: selectedRunAgentId().trim() || undefined,
        providerId:
          selectedRunProviderId().trim() ||
          resolvedSelections.providerId ||
          undefined,
        modelId:
          selectedRunModelId().trim() ||
          resolvedSelections.modelId ||
          undefined,
        sourceBranch: selectedRunSourceBranch().trim() || undefined,
      });
      await refreshRuns(taskValue.id);
      return createdRun;
    } catch (mutationError) {
      setActionError(
        getActionErrorMessage("Failed to create run.", mutationError),
      );
      return null;
    } finally {
      setIsCreatingRun(false);
    }
  };

  const onOpenRunSettingsModal = () => {
    if (isCreatingRun()) return;

    const openRunSettingsModal = () => {
      setActionError("");
      setPendingRunSettingsDefaultsInitialization(!hasRunSelectionOptions());
      initializeRunSettingsSelectionsFromProjectDefaults();
      setIsRunSettingsModalOpen(true);
      void refreshRunSourceBranches(params.taskId);
    };

    if (openCodeDependency.state() === "available") {
      openRunSettingsModal();
      return;
    }

    void (async () => {
      const isAvailable =
        await openCodeDependency.ensureAvailableForRequiredFlow();
      if (!isAvailable) {
        return;
      }

      openRunSettingsModal();
    })();
  };

  const onCancelRunSettingsModal = () => {
    if (isCreatingRun()) return;
    setIsRunSettingsModalOpen(false);
  };

  const onConfirmCreateRun = async () => {
    const createdRun = await onCreateRun();
    if (createdRun) {
      setIsRunSettingsModalOpen(false);
      await onStartRun(createdRun.id);
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

    if (!(await openCodeDependency.ensureAvailableForRequiredFlow())) {
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
        if (startResult.state === "unsupported") {
          openCodeDependency.showRequiredModal();
        }
        setRunStartErrors((current) => ({
          ...current,
          [runId]: startResult.reason?.trim() || "Failed to start. Try again.",
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
    projectRunDefaultsError,
    isLoadingRunSelectionOptions,
    runSourceBranchOptions,
    runSourceBranchError,
    isLoadingRunSourceBranches,
    hasRunSelectionOptions,
    isOpenCodeMissing: () => openCodeDependency.state() !== "available",
    openCodeDependencyReason: openCodeDependency.reason,
    selectedRunAgentId,
    selectedRunProviderId,
    selectedRunModelId,
    selectedRunSourceBranch,
    removingDependencyKey,
    editTitle,
    editDescription,
    editImplementationGuide,
    autosaveState,
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
    setIsTransitionMenuOpen,
    setSelectedRunAgentId: setSelectedRunAgentIdForSelection,
    setSelectedRunProviderId,
    setSelectedRunModelId,
    setSelectedRunSourceBranch,
    setEditImplementationGuide,
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
    onOpenLinkDependencyModal,
    onCancelLinkDependency,
    onLinkDependency,
    onEditImplementationGuideInput,
    flushTaskDetailsAutosave,
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
