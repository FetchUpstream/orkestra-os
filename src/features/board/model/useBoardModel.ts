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
import { canTransitionStatus } from "../../tasks/utils/taskDetail";
import { groupTasksByStatus } from "../utils/board";

export const useBoardModel = () => {
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = createSignal("");
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [selectedProjectDetail, setSelectedProjectDetail] =
    createSignal<Project | null>(null);
  const [updatingTaskIds, setUpdatingTaskIds] = createSignal<string[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = createSignal(true);
  const [isTasksLoading, setIsTasksLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  let activeTasksRequestVersion = 0;
  let activeProjectDetailRequestVersion = 0;

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
    } catch {
      if (
        requestVersion !== activeTasksRequestVersion ||
        selectedProjectId() !== projectId
      ) {
        return;
      }
      setTasks([]);
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
      setSelectedProjectDetail(null);
      setTasks([]);
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

    try {
      const updatedTask = await setTaskStatus(taskId, { status: targetStatus });
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === taskId ? { ...task, ...updatedTask } : task,
        ),
      );
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
        return;
      }

      await onProjectChange(firstProjectId);
    } catch {
      setError("Failed to load projects. Please refresh.");
      setProjects([]);
      setSelectedProjectId("");
      setSelectedProjectDetail(null);
      setTasks([]);
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
    error,
    onProjectChange,
    refreshSelectedProjectTasks,
    isTaskStatusUpdating,
    canTaskTransitionToStatus,
    moveTaskToStatus,
  };
};
