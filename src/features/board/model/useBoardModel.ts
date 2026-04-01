import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import {
  getProject,
  listProjects,
  type Project,
} from "../../../app/lib/projects";
import { subscribeToTaskStatusChanged } from "../../../app/lib/taskStatusEvents";
import { subscribeToRunStatusChanged } from "../../../app/lib/runStatusEvents";
import {
  listProjectTasks,
  searchProjectTasks,
  setTaskStatus,
  type Task,
  type TaskStatus,
} from "../../../app/lib/tasks";
import {
  createRun,
  listTaskRuns,
  startRunOpenCode,
} from "../../../app/lib/runs";
import type { RunModelOption, RunSelectionOption } from "../../../app/lib/runs";
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
import { useOpenCodeDependency } from "../../../app/contexts/OpenCodeDependencyContext";
import { canTransitionStatus } from "../../tasks/utils/taskDetail";
import { groupTasksByStatus } from "../utils/board";
import { isRunCommitPending } from "../../runs/model/commitUiState";

const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "preparing",
  "in_progress",
  "idle",
]);
const FINISHED_RUN_STATUSES = new Set(["complete", "failed", "cancelled"]);
const BOARD_SELECTED_PROJECT_STORAGE_KEY = "board.selectedProjectId";

const readRememberedBoardProjectId = (): string => {
  if (typeof window === "undefined") return "";
  try {
    return (
      window.localStorage.getItem(BOARD_SELECTED_PROJECT_STORAGE_KEY) ?? ""
    );
  } catch {
    return "";
  }
};

const persistBoardProjectId = (projectId: string) => {
  if (typeof window === "undefined") return;
  try {
    if (projectId) {
      window.localStorage.setItem(
        BOARD_SELECTED_PROJECT_STORAGE_KEY,
        projectId,
      );
      return;
    }
    window.localStorage.removeItem(BOARD_SELECTED_PROJECT_STORAGE_KEY);
  } catch {
    // Ignore storage failures and keep board usable.
  }
};

const readBoardProjectIdFromQuery = (): string => {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("projectId") ?? "";
};

const resolveInitialProjectSelection = (loadedProjects: Project[]): string => {
  if (loadedProjects.length === 0) return "";
  const availableProjectIds = new Set(
    loadedProjects.map((project) => project.id),
  );

  const rememberedProjectId = readRememberedBoardProjectId();
  if (rememberedProjectId && availableProjectIds.has(rememberedProjectId)) {
    return rememberedProjectId;
  }

  const queryProjectId = readBoardProjectIdFromQuery();
  if (queryProjectId && availableProjectIds.has(queryProjectId)) {
    return queryProjectId;
  }

  return loadedProjects[0]?.id ?? "";
};

const optimisticDoingMiniCard = (taskId: string): BoardTaskRunMiniCard => ({
  runId: `pending-${taskId}`,
  label: "Coding",
  state: "coding",
  isNavigable: false,
});

export type BoardTaskRunMiniCard = {
  runId: string;
  label: string;
  state: "coding" | "committing" | "waiting" | "waitingForMerge";
  isNavigable: boolean;
};

const resolveTaskRunMiniCard = (
  task: Task,
  runItems: Awaited<ReturnType<typeof listTaskRuns>>,
): BoardTaskRunMiniCard | null => {
  if (task.status === "done") return null;

  if (task.status === "review") {
    const activeRun = runItems.find((run) =>
      ACTIVE_RUN_STATUSES.has(run.status),
    );
    if (activeRun) {
      return {
        runId: activeRun.id,
        label: "Waiting",
        state: "waiting",
        isNavigable: true,
      };
    }

    const finishedRun = runItems.find((run) =>
      FINISHED_RUN_STATUSES.has(run.status),
    );
    if (!finishedRun) return null;
    return {
      runId: finishedRun.id,
      label:
        finishedRun.status === "complete" ? "Waiting for merge" : "Waiting",
      state: finishedRun.status === "complete" ? "waitingForMerge" : "waiting",
      isNavigable: true,
    };
  }

  const activeRun = runItems.find((run) => ACTIVE_RUN_STATUSES.has(run.status));
  if (activeRun) {
    return {
      runId: activeRun.id,
      label: isRunCommitPending(activeRun.id) ? "Committing changes" : "Coding",
      state: isRunCommitPending(activeRun.id) ? "committing" : "coding",
      isNavigable: true,
    };
  }

  return null;
};

export const useBoardModel = () => {
  const openCodeDependency = useOpenCodeDependency();
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = createSignal("");
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = createSignal("");
  const [matchedTaskIds, setMatchedTaskIds] = createSignal<Set<string>>(
    new Set(),
  );
  const [isSearchLoading, setIsSearchLoading] = createSignal(false);
  const [selectedProjectDetail, setSelectedProjectDetail] =
    createSignal<Project | null>(null);
  const [updatingTaskIds, setUpdatingTaskIds] = createSignal<string[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = createSignal(true);
  const [isTasksLoading, setIsTasksLoading] = createSignal(false);
  const [taskRunMiniCards, setTaskRunMiniCards] = createSignal<
    Record<string, BoardTaskRunMiniCard>
  >({});
  const [error, setError] = createSignal("");
  const [isRunSettingsModalOpen, setIsRunSettingsModalOpen] =
    createSignal(false);
  const [pendingInProgressTaskId, setPendingInProgressTaskId] =
    createSignal("");
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
  const [
    pendingRunSettingsDefaultsInitialization,
    setPendingRunSettingsDefaultsInitialization,
  ] = createSignal(false);
  let activeTasksRequestVersion = 0;
  let activeProjectDetailRequestVersion = 0;
  let activeTaskRunsRequestVersion = 0;
  let activeTaskSearchRequestVersion = 0;
  let runSelectionOptionsRequestVersion = 0;
  let boardEventSubscriptionDisposed = false;
  let removeBoardEventSubscription: (() => void) | null = null;
  let removeBoardRunStatusSubscription: (() => void) | null = null;

  const selectedProject = createMemo(
    () =>
      projects().find((project) => project.id === selectedProjectId()) ?? null,
  );

  const normalizedSearchQuery = createMemo(() => searchQuery().trim());
  const isSearchActive = createMemo(() => normalizedSearchQuery().length > 0);
  const visibleTasks = createMemo(() => {
    if (!isSearchActive()) {
      return tasks();
    }
    const matchedIds = matchedTaskIds();
    return tasks().filter((task) => matchedIds.has(task.id));
  });
  const groupedTasks = createMemo(() => groupTasksByStatus(visibleTasks()));
  const searchMatchCount = createMemo(() => visibleTasks().length);
  const visibleRunModelOptions = createMemo(() => {
    return filterModelsForProvider(
      runModelOptions(),
      selectedRunProviderId().trim(),
    );
  });
  const hasRunSelectionOptions = createMemo(() => {
    return (
      runAgentOptions().length > 0 ||
      runProviderOptions().length > 0 ||
      runModelOptions().length > 0
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

  const setSelectedRunProviderId = (providerId: string) => {
    setPendingRunSettingsDefaultsInitialization(false);
    setSelectedRunProviderIdSignal(providerId);
    const modelId = selectedRunModelId().trim();
    if (modelId && !doesModelMatchProvider(modelId, providerId.trim())) {
      setSelectedRunModelIdSignal("");
    }
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

  const setSelectedRunAgentIdForSelection = (agentId: string) => {
    setPendingRunSettingsDefaultsInitialization(false);
    setSelectedRunAgentId(agentId);
  };

  const applyProjectRunDefaults = (project: Project | null) => {
    if (!project) {
      setSelectedRunAgentId("");
      setSelectedRunProviderIdSignal("");
      setSelectedRunModelIdSignal("");
      setRunSelectionOptionsError("");
      return;
    }

    const resolved = initializeProjectRunDefaults({
      persisted: {
        agentId: project.defaultRunAgent,
        providerId: project.defaultRunProvider,
        modelId: project.defaultRunModel,
      },
      agents: runAgentOptions(),
      providers: runProviderOptions(),
      models: runModelOptions(),
    });
    setSelectedRunAgentId(resolved.agentId);
    setSelectedRunProviderIdSignal(resolved.providerId);
    setSelectedRunModelIdSignal(resolved.modelId);
    setRunSelectionOptionsError(
      getProjectRunDefaultsMessage(resolved, "starting a run"),
    );
  };

  const refreshRunSelectionOptions = async () => {
    const projectId = selectedProjectId().trim();
    if (!projectId) {
      setRunAgentOptions([]);
      setRunProviderOptions([]);
      setRunModelOptions([]);
      setRunSelectionOptionsError("Select a project to load run options.");
      return;
    }

    const requestVersion = ++runSelectionOptionsRequestVersion;
    const cachedOptions = readRunSelectionOptionsCache(projectId);
    if (cachedOptions) {
      setRunSelectionOptionsError("");
      setIsLoadingRunSelectionOptions(false);
      setRunAgentOptions(cachedOptions.agents);
      setRunProviderOptions(cachedOptions.providers);
      setRunModelOptions(cachedOptions.models);
      if (pendingRunSettingsDefaultsInitialization()) {
        applyProjectRunDefaults(selectedProjectDetail());
        setPendingRunSettingsDefaultsInitialization(false);
      }
      return;
    }

    setIsLoadingRunSelectionOptions(true);
    setRunSelectionOptionsError("");
    try {
      const options = await getRunSelectionOptionsWithCache(projectId);
      if (requestVersion !== runSelectionOptionsRequestVersion) {
        return;
      }
      setRunAgentOptions(options.agents);
      setRunProviderOptions(options.providers);
      setRunModelOptions(options.models);
      if (pendingRunSettingsDefaultsInitialization()) {
        applyProjectRunDefaults(selectedProjectDetail());
        setPendingRunSettingsDefaultsInitialization(false);
      }
    } catch {
      if (requestVersion !== runSelectionOptionsRequestVersion) {
        return;
      }
      setRunSelectionOptionsError("Failed to load run options.");
      setRunAgentOptions([]);
      setRunProviderOptions([]);
      setRunModelOptions([]);
    } finally {
      if (requestVersion === runSelectionOptionsRequestVersion) {
        setIsLoadingRunSelectionOptions(false);
      }
    }
  };

  const loadSelectedProjectDetail = async (projectId: string) => {
    const requestVersion = ++activeProjectDetailRequestVersion;
    setSelectedProjectDetail(null);

    try {
      const loadedProject = await getProject(projectId);
      if (
        requestVersion !== activeProjectDetailRequestVersion ||
        selectedProjectId() !== projectId
      ) {
        return;
      }
      setSelectedProjectDetail(loadedProject);
      if (pendingRunSettingsDefaultsInitialization()) {
        applyProjectRunDefaults(loadedProject);
        setPendingRunSettingsDefaultsInitialization(false);
      }
    } catch {
      if (
        requestVersion !== activeProjectDetailRequestVersion ||
        selectedProjectId() !== projectId
      ) {
        return;
      }
      setSelectedProjectDetail(null);
      if (pendingRunSettingsDefaultsInitialization()) {
        applyProjectRunDefaults(null);
        setPendingRunSettingsDefaultsInitialization(false);
      }
    }
  };

  const loadTasks = async (projectId: string) => {
    const requestVersion = ++activeTasksRequestVersion;
    const runRequestVersion = ++activeTaskRunsRequestVersion;
    setIsTasksLoading(true);
    setError("");

    try {
      const loadedTasks = await listProjectTasks(projectId);
      if (
        requestVersion !== activeTasksRequestVersion ||
        selectedProjectId() !== projectId
      ) {
        return;
      }
      setTasks(loadedTasks);
      const nonDoneTasks = loadedTasks.filter((task) => task.status !== "done");
      if (nonDoneTasks.length === 0) {
        if (runRequestVersion === activeTaskRunsRequestVersion) {
          setTaskRunMiniCards({});
        }
        return;
      }

      const taskRunMiniCardEntries = await Promise.all(
        nonDoneTasks.map(async (task) => {
          try {
            const runs = await listTaskRuns(task.id);
            const miniCard = resolveTaskRunMiniCard(task, runs);
            if (!miniCard) return null;
            return [task.id, miniCard] as const;
          } catch {
            return null;
          }
        }),
      );

      if (
        runRequestVersion !== activeTaskRunsRequestVersion ||
        requestVersion !== activeTasksRequestVersion ||
        selectedProjectId() !== projectId
      ) {
        return;
      }

      setTaskRunMiniCards(
        Object.fromEntries(
          taskRunMiniCardEntries.filter((entry) => entry !== null),
        ),
      );
    } catch {
      if (
        requestVersion !== activeTasksRequestVersion ||
        selectedProjectId() !== projectId
      ) {
        return;
      }
      setTasks([]);
      setTaskRunMiniCards({});
      setError("Failed to load project tasks. Please refresh.");
    } finally {
      if (requestVersion === activeTasksRequestVersion) {
        setIsTasksLoading(false);
      }
    }
  };

  createEffect(() => {
    const query = searchQuery().trim();
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchQuery(query);
    }, 150);
    onCleanup(() => window.clearTimeout(timeoutId));
  });

  createEffect(() => {
    const projectId = selectedProjectId();
    const query = debouncedSearchQuery();
    const requestVersion = ++activeTaskSearchRequestVersion;

    if (!projectId || !query) {
      setMatchedTaskIds(new Set<string>());
      setIsSearchLoading(false);
      return;
    }

    setIsSearchLoading(true);
    void searchProjectTasks(projectId, query)
      .then((results) => {
        if (
          requestVersion !== activeTaskSearchRequestVersion ||
          selectedProjectId() !== projectId ||
          debouncedSearchQuery() !== query
        ) {
          return;
        }
        setMatchedTaskIds(new Set(results.map((task) => task.id)));
      })
      .catch(() => {
        if (
          requestVersion !== activeTaskSearchRequestVersion ||
          selectedProjectId() !== projectId ||
          debouncedSearchQuery() !== query
        ) {
          return;
        }
        setMatchedTaskIds(new Set<string>());
      })
      .finally(() => {
        if (requestVersion === activeTaskSearchRequestVersion) {
          setIsSearchLoading(false);
        }
      });
  });

  const onProjectChange = async (
    projectId: string,
    options?: { persistSelection?: boolean },
  ) => {
    if (options?.persistSelection !== false) {
      persistBoardProjectId(projectId);
    }
    setSelectedProjectId(projectId);
    activeTaskSearchRequestVersion += 1;
    setMatchedTaskIds(new Set<string>());
    setIsSearchLoading(false);
    if (!projectId) {
      activeProjectDetailRequestVersion += 1;
      activeTaskRunsRequestVersion += 1;
      setSelectedProjectDetail(null);
      setTasks([]);
      setTaskRunMiniCards({});
      return;
    }
    await Promise.allSettled([
      loadTasks(projectId),
      loadSelectedProjectDetail(projectId),
    ]);
  };

  const refreshSelectedProjectTasks = async () => {
    const projectId = selectedProjectId();
    if (!projectId) return;
    await loadTasks(projectId);
  };

  const isTaskStatusUpdating = (taskId: string): boolean =>
    updatingTaskIds().includes(taskId);

  const isConfirmingMoveTaskToInProgress = createMemo(() => {
    const taskId = pendingInProgressTaskId();
    return Boolean(taskId && isTaskStatusUpdating(taskId));
  });

  const canTaskTransitionToStatus = (
    taskId: string,
    targetStatus: TaskStatus,
  ): boolean => {
    const taskToMove = tasks().find((task) => task.id === taskId);
    if (!taskToMove || taskToMove.status === targetStatus) return false;
    return canTransitionStatus(taskToMove.status, targetStatus);
  };

  const moveTaskToStatus = async (
    taskId: string,
    targetStatus: TaskStatus,
  ): Promise<boolean> => {
    if (isTaskStatusUpdating(taskId)) return false;

    const currentTasks = tasks();
    const taskToMove = currentTasks.find((task) => task.id === taskId);
    if (!taskToMove || taskToMove.status === targetStatus) return false;
    if (!canTransitionStatus(taskToMove.status, targetStatus)) return false;
    const previousStatus = taskToMove.status;
    const previousMiniCard = taskRunMiniCards()[taskId];

    setUpdatingTaskIds((current) => [...current, taskId]);
    setError("");
    setTasks(
      currentTasks.map((task) =>
        task.id === taskId ? { ...task, status: targetStatus } : task,
      ),
    );
    if (targetStatus === "done") {
      setTaskRunMiniCards((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    } else if (targetStatus === "doing") {
      setTaskRunMiniCards((current) => ({
        ...current,
        [taskId]: optimisticDoingMiniCard(taskId),
      }));
    }

    try {
      const updatedTask = await setTaskStatus(taskId, {
        status: targetStatus,
        sourceAction: "board_manual_move",
      });
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === taskId ? { ...task, ...updatedTask } : task,
        ),
      );
      if (updatedTask.status === "done") {
        setTaskRunMiniCards((current) => {
          const next = { ...current };
          delete next[taskId];
          return next;
        });
      } else {
        try {
          const runs = await listTaskRuns(taskId);
          const miniCard = resolveTaskRunMiniCard(updatedTask, runs);
          setTaskRunMiniCards((current) => {
            const next = { ...current };
            if (!miniCard) {
              delete next[taskId];
            } else {
              next[taskId] = miniCard;
            }
            return next;
          });
        } catch {
          // Preserve current mini-card state when run refresh fails.
        }
      }
    } catch {
      setTasks((currentAfterFailure) =>
        currentAfterFailure.map((task) =>
          task.id === taskId ? { ...task, status: previousStatus } : task,
        ),
      );
      setTaskRunMiniCards((current) => {
        const next = { ...current };
        if (previousMiniCard) {
          next[taskId] = previousMiniCard;
        } else {
          delete next[taskId];
        }
        return next;
      });
      setError("Failed to update task status. Please try again.");
      return false;
    } finally {
      setUpdatingTaskIds((current) => current.filter((id) => id !== taskId));
    }

    return true;
  };

  const onRequestMoveTaskToInProgress = (taskId: string) => {
    if (isTaskStatusUpdating(taskId)) return;
    if (!canTaskTransitionToStatus(taskId, "doing")) return;

    const openRunSettingsModal = () => {
      setPendingRunSettingsDefaultsInitialization(!hasRunSelectionOptions());
      applyProjectRunDefaults(selectedProjectDetail());
      setPendingInProgressTaskId(taskId);
      setIsRunSettingsModalOpen(true);
      void refreshRunSelectionOptions();
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

  const onCancelMoveTaskToInProgress = () => {
    const pendingTaskId = pendingInProgressTaskId();
    if (pendingTaskId && isTaskStatusUpdating(pendingTaskId)) {
      return;
    }
    setIsRunSettingsModalOpen(false);
    setPendingInProgressTaskId("");
  };

  const onConfirmMoveTaskToInProgress = async () => {
    const taskId = pendingInProgressTaskId();
    if (!taskId || isTaskStatusUpdating(taskId)) return;
    const statusUpdated = await moveTaskToStatus(taskId, "doing");
    if (statusUpdated) {
      try {
        const resolved = resolveProjectRunDefaults({
          persisted: {
            providerId: selectedRunProviderId(),
            modelId: selectedRunModelId(),
          },
          providers: runProviderOptions(),
          models: runModelOptions(),
        });
        if (resolved.requiresUserAction) {
          setError(
            "Task moved, but no runnable provider/model is available. Update run settings and try again.",
          );
          return;
        }
        const createdRun = await createRun(taskId, {
          agentId: selectedRunAgentId().trim() || undefined,
          providerId:
            selectedRunProviderId().trim() || resolved.providerId || undefined,
          modelId: selectedRunModelId().trim() || resolved.modelId || undefined,
        });
        const startResult = await startRunOpenCode(createdRun.id);
        if (startResult.state === "unsupported") {
          openCodeDependency.showRequiredModal();
          setError(
            startResult.reason?.trim() ||
              "Task moved, but OpenCode is required before the run can start.",
          );
          return;
        }
        if (startResult.state === "error") {
          setError(
            startResult.reason?.trim() ||
              "Task moved, but failed to start run. Please try again.",
          );
          return;
        }
      } catch {
        setError("Task moved, but failed to create run. Please try again.");
      }
    }
    setIsRunSettingsModalOpen(false);
    setPendingInProgressTaskId("");
  };

  onMount(async () => {
    boardEventSubscriptionDisposed = false;
    void (async () => {
      const unlisten = await subscribeToTaskStatusChanged((event) => {
        if (boardEventSubscriptionDisposed) {
          return;
        }

        const currentProjectId = selectedProjectId();
        if (!currentProjectId || event.projectId !== currentProjectId) {
          return;
        }

        setTasks((current) =>
          current.map((task) =>
            task.id === event.taskId
              ? { ...task, status: event.newStatus, updatedAt: event.timestamp }
              : task,
          ),
        );
      });

      if (boardEventSubscriptionDisposed) {
        unlisten();
        return;
      }
      removeBoardEventSubscription = unlisten;
    })();

    void (async () => {
      const unlisten = await subscribeToRunStatusChanged((event) => {
        if (boardEventSubscriptionDisposed) {
          return;
        }

        const currentProjectId = selectedProjectId();
        if (!currentProjectId || event.projectId !== currentProjectId) {
          return;
        }

        void (async () => {
          const taskValue = tasks().find((task) => task.id === event.taskId);
          if (!taskValue) {
            return;
          }

          try {
            const runs = await listTaskRuns(event.taskId);
            const miniCard = resolveTaskRunMiniCard(taskValue, runs);
            setTaskRunMiniCards((current) => {
              const next = { ...current };
              if (!miniCard) {
                delete next[event.taskId];
              } else {
                next[event.taskId] = miniCard;
              }
              return next;
            });
          } catch {
            // Ignore transient run refresh failures.
          }
        })();
      });

      if (boardEventSubscriptionDisposed) {
        unlisten();
        return;
      }

      removeBoardRunStatusSubscription = unlisten;
    })();

    setError("");
    try {
      const loadedProjects = await listProjects();
      setProjects(loadedProjects);

      const initialProjectId = resolveInitialProjectSelection(loadedProjects);
      if (!initialProjectId) {
        setSelectedProjectId("");
        setSelectedProjectDetail(null);
        setTasks([]);
        setTaskRunMiniCards({});
        return;
      }

      await onProjectChange(initialProjectId, { persistSelection: false });
    } catch {
      setError("Failed to load projects. Please refresh.");
      setProjects([]);
      setSelectedProjectId("");
      setSelectedProjectDetail(null);
      setTasks([]);
      setTaskRunMiniCards({});
    } finally {
      setIsProjectsLoading(false);
    }
  });

  onCleanup(() => {
    boardEventSubscriptionDisposed = true;
    if (removeBoardEventSubscription) {
      removeBoardEventSubscription();
      removeBoardEventSubscription = null;
    }
    if (removeBoardRunStatusSubscription) {
      removeBoardRunStatusSubscription();
      removeBoardRunStatusSubscription = null;
    }
  });

  return {
    projects,
    selectedProjectId,
    selectedProject,
    selectedProjectDetail,
    groupedTasks,
    isProjectsLoading,
    isTasksLoading,
    taskRunMiniCards,
    error,
    searchQuery,
    isSearchActive,
    isSearchLoading,
    searchMatchCount,
    isRunSettingsModalOpen,
    hasRunSelectionOptions,
    isLoadingRunSelectionOptions,
    runSelectionOptionsError,
    runAgentOptions,
    runProviderOptions,
    visibleRunModelOptions,
    isConfirmingMoveTaskToInProgress,
    isOpenCodeMissing: () => openCodeDependency.state() !== "available",
    openCodeDependencyReason: openCodeDependency.reason,
    selectedRunAgentId,
    selectedRunProviderId,
    selectedRunModelId,
    onProjectChange,
    refreshSelectedProjectTasks,
    isTaskStatusUpdating,
    canTaskTransitionToStatus,
    moveTaskToStatus,
    setSearchQuery,
    setSelectedRunAgentId: setSelectedRunAgentIdForSelection,
    setSelectedRunProviderId,
    setSelectedRunModelId,
    onRequestMoveTaskToInProgress,
    onCancelMoveTaskToInProgress,
    onConfirmMoveTaskToInProgress,
  };
};
