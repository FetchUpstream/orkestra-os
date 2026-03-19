import { createMemo, createSignal, onMount } from "solid-js";
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

const ACTIVE_RUN_STATUSES = new Set(["queued", "preparing", "running"]);
const FINISHED_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

const activeRunLabelForTask = (displayKey?: string | null) => {
  const normalizedDisplayKey = displayKey?.trim();
  return normalizedDisplayKey || "Current run";
};

export type BoardTaskRunMiniCard = {
  runId: string;
  label: string;
  state: "active" | "awaitingReview";
};

const resolveTaskRunMiniCard = (
  task: Task,
  runItems: Awaited<ReturnType<typeof listTaskRuns>>,
): BoardTaskRunMiniCard | null => {
  if (task.status === "done") return null;

  const activeRun = runItems.find((run) => ACTIVE_RUN_STATUSES.has(run.status));
  if (activeRun) {
    return {
      runId: activeRun.id,
      label: activeRunLabelForTask(activeRun.displayKey),
      state: "active",
    };
  }

  if (task.status !== "review") return null;

  const finishedRun = runItems.find((run) =>
    FINISHED_RUN_STATUSES.has(run.status),
  );
  if (!finishedRun) return null;
  return {
    runId: finishedRun.id,
    label: activeRunLabelForTask(finishedRun.displayKey),
    state: "awaitingReview",
  };
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

  const onProjectChange = async (projectId: string) => {
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
      setError("Failed to update task status. Please try again.");
    } finally {
      setUpdatingTaskIds((current) => current.filter((id) => id !== taskId));
    }
  };

  onMount(async () => {
    setError("");
    try {
      const loadedProjects = await listProjects();
      setProjects(loadedProjects);

      const firstProjectId = loadedProjects[0]?.id;
      if (!firstProjectId) {
        setSelectedProjectId("");
        setSelectedProjectDetail(null);
        setTasks([]);
        setTaskRunMiniCards({});
        return;
      }

      await onProjectChange(firstProjectId);
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
