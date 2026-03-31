import { useParams } from "@solidjs/router";
import { createSignal, onCleanup, onMount } from "solid-js";
import { getProject, type Project } from "../../../app/lib/projects";
import { subscribeToTaskStatusChanged } from "../../../app/lib/taskStatusEvents";
import { listProjectTasks, type Task } from "../../../app/lib/tasks";

export const useProjectDetailModel = () => {
  const params = useParams();
  const [project, setProject] = createSignal<Project | null>(null);
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(true);
  const [isTasksLoading, setIsTasksLoading] = createSignal(false);
  const [taskError, setTaskError] = createSignal("");
  let removeTaskStatusSubscription: (() => void) | null = null;
  let taskStatusSubscriptionDisposed = false;

  const loadTasks = async (projectId: string) => {
    setIsTasksLoading(true);
    try {
      const list = await listProjectTasks(projectId);
      setTasks(list);
    } catch {
      setTaskError("Failed to load project tasks. Please refresh.");
    } finally {
      setIsTasksLoading(false);
    }
  };

  onMount(async () => {
    const currentProjectId = params.projectId?.trim() ?? "";
    void (async () => {
      const unlisten = await subscribeToTaskStatusChanged((event) => {
        if (
          taskStatusSubscriptionDisposed ||
          event.projectId !== currentProjectId
        ) {
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

      if (taskStatusSubscriptionDisposed) {
        unlisten();
        return;
      }

      removeTaskStatusSubscription = unlisten;
    })();

    if (!params.projectId) {
      setError("Missing project ID.");
      setIsLoading(false);
      return;
    }
    try {
      const detail = await getProject(params.projectId);
      setProject(detail);
      setTaskError("");
      await loadTasks(params.projectId);
    } catch {
      setError("Failed to load project. Please try again.");
    } finally {
      setIsLoading(false);
    }
  });

  onCleanup(() => {
    taskStatusSubscriptionDisposed = true;
    removeTaskStatusSubscription?.();
  });

  return {
    params,
    project,
    tasks,
    error,
    isLoading,
    isTasksLoading,
    taskError,
  };
};
