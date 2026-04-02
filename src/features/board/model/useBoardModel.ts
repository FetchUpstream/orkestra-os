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

import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import {
  BOARD_SELECTED_PROJECT_STORAGE_KEY,
  getBoardProjectIdFromSearch,
  readRememberedBoardProjectId,
} from "../../../app/lib/boardNavigation";
import {
  getProject,
  listProjects,
  type Project,
} from "../../../app/lib/projects";
import { subscribeToTaskStatusChanged } from "../../../app/lib/taskStatusEvents";
import { subscribeToRunStateChanged } from "../../../app/lib/runStateEvents";
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
  type Run,
  type RunState,
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
const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "preparing",
  "in_progress",
  "idle",
]);

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
  return getBoardProjectIdFromSearch(window.location.search);
};

const resolveInitialProjectSelection = (loadedProjects: Project[]): string => {
  if (loadedProjects.length === 0) return "";
  const availableProjectIds = new Set(
    loadedProjects.map((project) => project.id),
  );

  const queryProjectId = readBoardProjectIdFromQuery();
  if (queryProjectId && availableProjectIds.has(queryProjectId)) {
    return queryProjectId;
  }

  const rememberedProjectId = readRememberedBoardProjectId();
  if (rememberedProjectId && availableProjectIds.has(rememberedProjectId)) {
    return rememberedProjectId;
  }

  return loadedProjects[0]?.id ?? "";
};

const optimisticDoingMiniCard = (taskId: string): BoardTaskRunMiniCard => ({
  runId: `pending-${taskId}`,
  label: "Busy Coding",
  state: "busy_coding",
  isNavigable: false,
});

export type BoardTaskRunMiniCard = {
  runId: string;
  label: string;
  state: RunState;
  isNavigable: boolean;
  createdAt?: string;
  runNumber?: number | null;
  isOptimistic?: boolean;
};

const boardLabelForRunState = (state: RunState): string => {
  switch (state) {
    case "warming_up":
      return "Warming Up";
    case "busy_coding":
      return "Busy Coding";
    case "waiting_for_input":
      return "Waiting for Input";
    case "permission_requested":
      return "Permission Requested";
    case "committing_changes":
      return "Committing Changes";
    case "resolving_rebase_conflicts":
      return "Resolving Rebase Conflicts";
    case "ready_to_merge":
      return "Ready to Merge";
  }
};

const fallbackRunState = (status: string): RunState | null => {
  switch (status) {
    case "queued":
    case "preparing":
      return "warming_up";
    case "in_progress":
      return "busy_coding";
    case "idle":
      return "waiting_for_input";
    default:
      return null;
  }
};

const resolveRunTimestamp = (run: Run): number => {
  const timestamp = Date.parse(
    run.createdAt || run.startedAt || run.finishedAt || "",
  );
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const resolveMiniCardTimestamp = (miniCard: BoardTaskRunMiniCard): number => {
  const timestamp = Date.parse(miniCard.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const sortRunsForBoard = (runItems: Run[]): Run[] => {
  return [...runItems].sort((a, b) => {
    const timestampDiff = resolveRunTimestamp(b) - resolveRunTimestamp(a);
    if (timestampDiff !== 0) return timestampDiff;

    const runNumberDiff = (b.runNumber ?? -1) - (a.runNumber ?? -1);
    if (runNumberDiff !== 0) return runNumberDiff;

    return b.id.localeCompare(a.id);
  });
};

const sortMiniCardsForBoard = (
  miniCards: BoardTaskRunMiniCard[],
): BoardTaskRunMiniCard[] => {
  return [...miniCards].sort((a, b) => {
    if (a.isOptimistic && !b.isOptimistic) return -1;
    if (!a.isOptimistic && b.isOptimistic) return 1;

    const timestampDiff =
      resolveMiniCardTimestamp(b) - resolveMiniCardTimestamp(a);
    if (timestampDiff !== 0) return timestampDiff;

    const runNumberDiff = (b.runNumber ?? -1) - (a.runNumber ?? -1);
    if (runNumberDiff !== 0) return runNumberDiff;

    if (a.runId === b.runId) return 0;
    return a.runId > b.runId ? -1 : 1;
  });
};

const areMiniCardsEquivalent = (
  previous: BoardTaskRunMiniCard,
  next: BoardTaskRunMiniCard,
): boolean => {
  return (
    previous.runId === next.runId &&
    previous.label === next.label &&
    previous.state === next.state &&
    previous.isNavigable === next.isNavigable &&
    previous.createdAt === next.createdAt &&
    previous.runNumber === next.runNumber &&
    previous.isOptimistic === next.isOptimistic
  );
};

const reconcileMiniCards = (
  previous: BoardTaskRunMiniCard[] | undefined,
  next: BoardTaskRunMiniCard[],
): BoardTaskRunMiniCard[] => {
  if (!previous || previous.length === 0) {
    return next;
  }

  const previousByRunId = new Map(
    previous.map((miniCard) => [miniCard.runId, miniCard]),
  );
  return next.map((miniCard) => {
    const previousMiniCard = previousByRunId.get(miniCard.runId);
    return previousMiniCard &&
      areMiniCardsEquivalent(previousMiniCard, miniCard)
      ? previousMiniCard
      : miniCard;
  });
};

const runToBoardTaskRunMiniCard = (run: Run): BoardTaskRunMiniCard | null => {
  const runState = run.runState ?? fallbackRunState(run.status);
  if (!runState) {
    return null;
  }

  return {
    runId: run.id,
    label: boardLabelForRunState(runState),
    state: runState,
    isNavigable: true,
    createdAt: run.createdAt,
    runNumber: run.runNumber,
  };
};

const optimisticRunIdForTask = (taskId: string) => `pending-${taskId}`;

const mergeTaskRunMiniCards = (
  current: Record<string, BoardTaskRunMiniCard[]>,
  taskId: string,
  nextMiniCards: BoardTaskRunMiniCard[],
): Record<string, BoardTaskRunMiniCard[]> => {
  const next = { ...current };
  if (nextMiniCards.length === 0) {
    delete next[taskId];
    return next;
  }

  next[taskId] = reconcileMiniCards(current[taskId], nextMiniCards);
  return next;
};

const resolveTaskRunMiniCards = (
  task: Task,
  runItems: Awaited<ReturnType<typeof listTaskRuns>>,
): BoardTaskRunMiniCard[] => {
  if (task.status === "done") return [];

  return sortRunsForBoard(runItems)
    .filter((run) => ACTIVE_RUN_STATUSES.has(run.status))
    .flatMap((run) => {
      const miniCard = runToBoardTaskRunMiniCard(run);
      return miniCard ? [miniCard] : [];
    });
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
    Record<string, BoardTaskRunMiniCard[]>
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
  const [projectDefaultRunAgentId, setProjectDefaultRunAgentId] =
    createSignal("");
  const [projectDefaultRunProviderId, setProjectDefaultRunProviderId] =
    createSignal("");
  const [projectDefaultRunModelId, setProjectDefaultRunModelId] =
    createSignal("");
  const [
    pendingRunSettingsDefaultsInitialization,
    setPendingRunSettingsDefaultsInitialization,
  ] = createSignal(false);
  let activeTasksRequestVersion = 0;
  let activeProjectDetailRequestVersion = 0;
  let activeTaskRunsRequestVersion = 0;
  let activeTaskSearchRequestVersion = 0;
  let runSelectionOptionsRequestVersion = 0;
  const taskRunRequestVersions: Record<string, number> = {};
  let boardEventSubscriptionDisposed = false;
  let removeBoardEventSubscription: (() => void) | null = null;
  let removeBoardRunStatusSubscription: (() => void) | null = null;
  let removeBoardRunStateSubscription: (() => void) | null = null;

  const beginTaskRunRequest = (taskId: string): number => {
    const nextVersion = (taskRunRequestVersions[taskId] ?? 0) + 1;
    taskRunRequestVersions[taskId] = nextVersion;
    return nextVersion;
  };

  const isTaskRunRequestCurrent = (taskId: string, requestVersion: number) => {
    return taskRunRequestVersions[taskId] === requestVersion;
  };

  const applyTaskRunMiniCards = (
    taskId: string,
    miniCards: BoardTaskRunMiniCard[],
  ) => {
    setTaskRunMiniCards((current) =>
      mergeTaskRunMiniCards(current, taskId, miniCards),
    );
  };

  const refreshMiniCardForTask = async (taskId: string) => {
    const taskValue = tasks().find((task) => task.id === taskId);
    if (!taskValue) {
      return;
    }

    const taskRunRequestVersion = beginTaskRunRequest(taskId);

    try {
      const runs = await listTaskRuns(taskId);
      if (!isTaskRunRequestCurrent(taskId, taskRunRequestVersion)) {
        return;
      }

      const miniCards = resolveTaskRunMiniCards(taskValue, runs);
      applyTaskRunMiniCards(taskId, miniCards);
    } catch {
      // Ignore transient run refresh failures.
    }
  };

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

  const applyProjectRunDefaults = () => {
    if (
      !projectDefaultRunAgentId().trim() &&
      !projectDefaultRunProviderId().trim() &&
      !projectDefaultRunModelId().trim() &&
      !selectedProjectDetail()
    ) {
      setSelectedRunAgentId("");
      setSelectedRunProviderIdSignal("");
      setSelectedRunModelIdSignal("");
      setRunSelectionOptionsError("");
      return;
    }

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
    setRunSelectionOptionsError(
      getProjectRunDefaultsMessage(resolved, "starting a run"),
    );
  };

  const initializePendingRunSettingsDefaultsIfReady = () => {
    if (!pendingRunSettingsDefaultsInitialization()) {
      return false;
    }

    applyProjectRunDefaults();
    setPendingRunSettingsDefaultsInitialization(false);
    return true;
  };

  createEffect(() => {
    if (!pendingRunSettingsDefaultsInitialization()) {
      return;
    }

    selectedProjectDetail();
    hasRunSelectionOptions();
    initializePendingRunSettingsDefaultsIfReady();
  });

  createEffect(() => {
    if (!isRunSettingsModalOpen()) {
      return;
    }

    const hasAnyExplicitSelection = Boolean(
      selectedRunAgentId().trim() ||
      selectedRunProviderId().trim() ||
      selectedRunModelId().trim(),
    );
    if (hasAnyExplicitSelection) {
      return;
    }

    applyProjectRunDefaults();
  });

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
      initializePendingRunSettingsDefaultsIfReady();
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
      initializePendingRunSettingsDefaultsIfReady();
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

  const loadSelectedProjectDetail = async (
    projectId: string,
    options?: { clearBeforeLoad?: boolean },
  ) => {
    const requestVersion = ++activeProjectDetailRequestVersion;
    if (options?.clearBeforeLoad !== false) {
      setSelectedProjectDetail(null);
    }

    try {
      const loadedProject = await getProject(projectId);
      if (
        requestVersion !== activeProjectDetailRequestVersion ||
        selectedProjectId() !== projectId
      ) {
        return;
      }
      setSelectedProjectDetail(loadedProject);
      setProjectDefaultRunAgentId(loadedProject.defaultRunAgent?.trim() || "");
      setProjectDefaultRunProviderId(
        loadedProject.defaultRunProvider?.trim() || "",
      );
      setProjectDefaultRunModelId(loadedProject.defaultRunModel?.trim() || "");
      initializePendingRunSettingsDefaultsIfReady();
    } catch {
      if (
        requestVersion !== activeProjectDetailRequestVersion ||
        selectedProjectId() !== projectId
      ) {
        return;
      }
      setSelectedProjectDetail(null);
      setProjectDefaultRunAgentId("");
      setProjectDefaultRunProviderId("");
      setProjectDefaultRunModelId("");
      if (pendingRunSettingsDefaultsInitialization()) {
        applyProjectRunDefaults();
        setPendingRunSettingsDefaultsInitialization(false);
      }
    }
  };

  const hydrateRunDefaultsFromSelectedProject = async () => {
    const projectId = selectedProjectId().trim();
    if (!projectId) {
      applyProjectRunDefaults();
      return;
    }

    const existingProject = selectedProjectDetail();
    if (existingProject) {
      setProjectDefaultRunAgentId(
        existingProject.defaultRunAgent?.trim() || "",
      );
      setProjectDefaultRunProviderId(
        existingProject.defaultRunProvider?.trim() || "",
      );
      setProjectDefaultRunModelId(
        existingProject.defaultRunModel?.trim() || "",
      );
      applyProjectRunDefaults();
      return;
    }

    try {
      const loadedProject = await getProject(projectId);
      if (selectedProjectId().trim() !== projectId) {
        return;
      }
      setSelectedProjectDetail(loadedProject);
      setProjectDefaultRunAgentId(loadedProject.defaultRunAgent?.trim() || "");
      setProjectDefaultRunProviderId(
        loadedProject.defaultRunProvider?.trim() || "",
      );
      setProjectDefaultRunModelId(loadedProject.defaultRunModel?.trim() || "");
      applyProjectRunDefaults();
    } catch {
      // Keep modal usable even if project details fail to reload.
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
          const taskRunRequestVersion = beginTaskRunRequest(task.id);
          try {
            const runs = await listTaskRuns(task.id);
            if (!isTaskRunRequestCurrent(task.id, taskRunRequestVersion)) {
              return null;
            }

            const miniCards = resolveTaskRunMiniCards(task, runs);
            return { taskId: task.id, miniCards, taskRunRequestVersion };
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

      setTaskRunMiniCards((current) => {
        let next = { ...current };
        const activeTaskIds = new Set(nonDoneTasks.map((task) => task.id));

        for (const taskId of Object.keys(next)) {
          if (!activeTaskIds.has(taskId)) {
            delete next[taskId];
          }
        }

        for (const entry of taskRunMiniCardEntries) {
          if (!entry) continue;
          if (
            !isTaskRunRequestCurrent(entry.taskId, entry.taskRunRequestVersion)
          ) {
            continue;
          }

          next = mergeTaskRunMiniCards(next, entry.taskId, entry.miniCards);
        }

        return next;
      });
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
    const previousMiniCards = taskRunMiniCards()[taskId];

    setUpdatingTaskIds((current) => [...current, taskId]);
    setError("");
    setTasks(
      currentTasks.map((task) =>
        task.id === taskId ? { ...task, status: targetStatus } : task,
      ),
    );
    if (targetStatus === "done") {
      beginTaskRunRequest(taskId);
      setTaskRunMiniCards((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    } else if (targetStatus === "doing") {
      beginTaskRunRequest(taskId);
      setTaskRunMiniCards((current) => {
        const optimisticMiniCard: BoardTaskRunMiniCard = {
          ...optimisticDoingMiniCard(taskId),
          isOptimistic: true,
        };
        const preservedMiniCards = (current[taskId] ?? []).filter(
          (miniCard) => miniCard.runId !== optimisticRunIdForTask(taskId),
        );

        return mergeTaskRunMiniCards(current, taskId, [
          optimisticMiniCard,
          ...sortMiniCardsForBoard(preservedMiniCards),
        ]);
      });
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
        beginTaskRunRequest(taskId);
        setTaskRunMiniCards((current) => {
          const next = { ...current };
          delete next[taskId];
          return next;
        });
      } else if (updatedTask.status !== "doing") {
        try {
          const taskRunRequestVersion = beginTaskRunRequest(taskId);
          const runs = await listTaskRuns(taskId);
          if (!isTaskRunRequestCurrent(taskId, taskRunRequestVersion)) {
            return true;
          }

          const miniCards = resolveTaskRunMiniCards(updatedTask, runs);
          applyTaskRunMiniCards(taskId, miniCards);
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
      beginTaskRunRequest(taskId);
      setTaskRunMiniCards((current) => {
        const next = { ...current };
        if (previousMiniCards && previousMiniCards.length > 0) {
          next[taskId] = previousMiniCards;
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
      const projectId = selectedProjectId().trim();

      setPendingRunSettingsDefaultsInitialization(true);
      if (!selectedProjectDetail() && projectId) {
        void loadSelectedProjectDetail(projectId, { clearBeforeLoad: false });
      }
      void hydrateRunDefaultsFromSelectedProject();
      initializePendingRunSettingsDefaultsIfReady();
      setError("");
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
        const createdRunMiniCard = runToBoardTaskRunMiniCard(createdRun);
        if (createdRunMiniCard) {
          beginTaskRunRequest(taskId);
          setTaskRunMiniCards((current) => {
            const remainingMiniCards = (current[taskId] ?? []).filter(
              (miniCard) =>
                miniCard.runId !== optimisticRunIdForTask(taskId) &&
                miniCard.runId !== createdRun.id,
            );

            return mergeTaskRunMiniCards(
              current,
              taskId,
              sortMiniCardsForBoard([
                createdRunMiniCard,
                ...remainingMiniCards,
              ]),
            );
          });
        }
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
        void refreshMiniCardForTask(taskId);
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

        void refreshMiniCardForTask(event.taskId);
      });

      if (boardEventSubscriptionDisposed) {
        unlisten();
        return;
      }

      removeBoardRunStatusSubscription = unlisten;
    })();

    void (async () => {
      const unlisten = await subscribeToRunStateChanged((event) => {
        if (boardEventSubscriptionDisposed) {
          return;
        }

        const currentProjectId = selectedProjectId();
        if (!currentProjectId || event.projectId !== currentProjectId) {
          return;
        }

        void refreshMiniCardForTask(event.taskId);
      });

      if (boardEventSubscriptionDisposed) {
        unlisten();
        return;
      }

      removeBoardRunStateSubscription = unlisten;
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
    if (removeBoardRunStateSubscription) {
      removeBoardRunStateSubscription();
      removeBoardRunStateSubscription = null;
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
