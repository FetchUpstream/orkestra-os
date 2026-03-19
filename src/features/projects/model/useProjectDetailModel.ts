import { useParams } from "@solidjs/router";
import { createSignal, onMount } from "solid-js";
import { getProject, type Project } from "../../../app/lib/projects";
import { listProjectTasks, type Task } from "../../../app/lib/tasks";
import { useCreateTaskModalModel } from "./useCreateTaskModalModel";

export const useProjectDetailModel = () => {
  const params = useParams();
  const [project, setProject] = createSignal<Project | null>(null);
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(true);
  const [isTasksLoading, setIsTasksLoading] = createSignal(false);
  const [taskError, setTaskError] = createSignal("");

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

  const taskCreateModel = useCreateTaskModalModel({
    project,
    projectId: () => params.projectId,
    onTaskCreated: async (projectId) => {
      setTaskError("");
      await loadTasks(projectId);
    },
  });

  onMount(async () => {
    if (!params.projectId) {
      setError("Missing project ID.");
      setIsLoading(false);
      return;
    }
    try {
      const detail = await getProject(params.projectId);
      setProject(detail);
      setTaskError("");
      taskCreateModel.resetTaskForm();
      await loadTasks(params.projectId);
    } catch {
      setError("Failed to load project. Please try again.");
    } finally {
      setIsLoading(false);
    }
  });

  return {
    params,
    project,
    tasks,
    error,
    isLoading,
    isTasksLoading,
    taskError,
    ...taskCreateModel,
  };
};
