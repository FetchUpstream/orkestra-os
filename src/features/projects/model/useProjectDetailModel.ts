import { useParams } from "@solidjs/router";
import { createSignal, onMount } from "solid-js";
import { getProject, type Project } from "../../../app/lib/projects";
import {
  createTask,
  listProjectTasks,
  type Task,
  type TaskStatus,
} from "../../../app/lib/tasks";
import { getCreateTaskErrorMessage } from "../utils/projectDetail";

export const useProjectDetailModel = () => {
  const params = useParams();
  const [project, setProject] = createSignal<Project | null>(null);
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(true);
  const [isTasksLoading, setIsTasksLoading] = createSignal(false);
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [isSubmittingTask, setIsSubmittingTask] = createSignal(false);
  const [taskError, setTaskError] = createSignal("");
  const [taskFormError, setTaskFormError] = createSignal("");
  const [taskTitle, setTaskTitle] = createSignal("");
  const [taskDescription, setTaskDescription] = createSignal("");
  const [taskStatus, setTaskStatus] = createSignal<TaskStatus>("todo");
  const [targetRepositoryId, setTargetRepositoryId] = createSignal("");

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

  const resetTaskForm = () => {
    setTaskTitle("");
    setTaskDescription("");
    setTaskStatus("todo");
    setTaskFormError("");
    const selectedProject = project();
    const defaultRepository = selectedProject?.repositories.find(
      (repo) => repo.is_default,
    );
    const fallbackRepository = selectedProject?.repositories[0];
    setTargetRepositoryId(
      defaultRepository?.id ?? fallbackRepository?.id ?? "",
    );
  };

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
      await loadTasks(params.projectId);
      const defaultRepository = detail.repositories.find(
        (repo) => repo.is_default,
      );
      setTargetRepositoryId(
        defaultRepository?.id ?? detail.repositories[0]?.id ?? "",
      );
    } catch {
      setError("Failed to load project. Please try again.");
    } finally {
      setIsLoading(false);
    }
  });

  const onCreateTask: (event: Event) => Promise<void> = async (event) => {
    event.preventDefault();
    const projectId = params.projectId;
    if (!projectId) return;
    if (!taskTitle().trim()) {
      setTaskFormError("Title is required.");
      return;
    }
    setTaskFormError("");
    setIsSubmittingTask(true);
    try {
      await createTask({
        projectId,
        title: taskTitle().trim(),
        description: taskDescription().trim() || undefined,
        status: taskStatus(),
        targetRepositoryId: targetRepositoryId() || undefined,
      });
      setIsModalOpen(false);
      resetTaskForm();
      setTaskError("");
      await loadTasks(projectId);
    } catch (createError) {
      const backendMessage = getCreateTaskErrorMessage(createError);
      setTaskFormError(
        backendMessage
          ? `Failed to create task. ${backendMessage}`
          : "Failed to create task. Please try again.",
      );
    } finally {
      setIsSubmittingTask(false);
    }
  };

  return {
    params,
    project,
    tasks,
    error,
    isLoading,
    isTasksLoading,
    isModalOpen,
    isSubmittingTask,
    taskError,
    taskFormError,
    taskTitle,
    taskDescription,
    taskStatus,
    targetRepositoryId,
    setIsModalOpen,
    setTaskTitle,
    setTaskDescription,
    setTaskStatus,
    setTargetRepositoryId,
    resetTaskForm,
    onCreateTask,
  };
};
