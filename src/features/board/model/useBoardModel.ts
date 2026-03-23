import { listen } from "@tauri-apps/api/event";
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  getProject,
  listProjects,
  type Project,
} from "../../../app/lib/projects";
import {
  listProjectTasks,
  setTaskStatus,
  type Task,
  type TaskStatus,
} from "../../../app/lib/tasks";
import { listTaskRuns } from "../../../app/lib/runs";
import { canTransitionStatus } from "../../tasks/utils/taskDetail";
import { groupTasksByStatus } from "../utils/board";
import { isRunCommitPending } from "../../runs/model/commitUiState";

const ACTIVE_RUN_STATUSES = new Set(["queued", "preparing", "running"]);
const FINISHED_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
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
        finishedRun.status === "completed" ? "Waiting for merge" : "Waiting",
      state: finishedRun.status === "completed" ? "waitingForMerge" : "waiting",
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
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = createSignal("");
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [selectedProjectDetail, setSelectedProjectDetail] =
    createSignal<Project | null>(null);
  const [updatingTaskIds, setUpdatingTaskIds] = createSignal<string[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = createSignal(true);
  const [isTasksLoading, setIsTasksLoading] = createSignal(false);
  const [taskRunMiniCards, setTaskRunMiniCards] = createSignal<
    Record<string, BoardTaskRunMiniCard>
  >({});
  const [error, setError] = createSignal("");
  let activeTasksRequestVersion = 0;
  let activeProjectDetailRequestVersion = 0;
  let activeTaskRunsRequestVersion = 0;
  let boardEventSubscriptionDisposed = false;
  let removeBoardEventSubscription: (() => void) | null = null;

  const selectedProject = createMemo(
    () =>
      projects().find((project) => project.id === selectedProjectId()) ?? null,
  );

  const groupedTasks = createMemo(() => groupTasksByStatus(tasks()));

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
    } catch {
      if (
        requestVersion !== activeProjectDetailRequestVersion ||
        selectedProjectId() !== projectId
      ) {
        return;
      }
      setSelectedProjectDetail(null);
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

  const onProjectChange = async (
    projectId: string,
    options?: { persistSelection?: boolean },
  ) => {
    if (options?.persistSelection !== false) {
      persistBoardProjectId(projectId);
    }
    setSelectedProjectId(projectId);
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
  ): Promise<void> => {
    if (isTaskStatusUpdating(taskId)) return;

    const currentTasks = tasks();
    const taskToMove = currentTasks.find((task) => task.id === taskId);
    if (!taskToMove || taskToMove.status === targetStatus) return;
    if (!canTransitionStatus(taskToMove.status, targetStatus)) return;
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
    } finally {
      setUpdatingTaskIds((current) => current.filter((id) => id !== taskId));
    }
  };

  onMount(async () => {
    boardEventSubscriptionDisposed = false;
    void (async () => {
      const unlisten = await listen<{
        task_id?: string;
        taskId?: string;
        project_id?: string;
        projectId?: string;
        status?: TaskStatus;
      }>("task-updated", (event) => {
        if (boardEventSubscriptionDisposed) {
          return;
        }

        const payloadProjectId =
          event.payload.project_id ?? event.payload.projectId ?? "";
        const currentProjectId = selectedProjectId();
        if (!currentProjectId || payloadProjectId !== currentProjectId) {
          return;
        }

        void loadTasks(currentProjectId);
      });

      if (boardEventSubscriptionDisposed) {
        unlisten();
        return;
      }
      removeBoardEventSubscription = unlisten;
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
    onProjectChange,
    refreshSelectedProjectTasks,
    isTaskStatusUpdating,
    canTaskTransitionToStatus,
    moveTaskToStatus,
  };
};
