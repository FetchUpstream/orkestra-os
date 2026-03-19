import { createSignal, type Accessor } from "solid-js";
import { createTask, type TaskStatus } from "../../../app/lib/tasks";
import type { Project } from "../../../app/lib/projects";
import { getCreateTaskErrorMessage } from "../utils/projectDetail";

type Options = {
  project: Accessor<Project | null>;
  projectId: Accessor<string | null | undefined>;
  onTaskCreated: (projectId: string) => Promise<void>;
};

export const useCreateTaskModalModel = (options: Options) => {
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [isSubmittingTask, setIsSubmittingTask] = createSignal(false);
  const [taskFormError, setTaskFormError] = createSignal("");
  const [taskTitle, setTaskTitle] = createSignal("");
  const [taskDescription, setTaskDescription] = createSignal("");
  const [taskImplementationGuide, setTaskImplementationGuide] =
    createSignal("");
  const [taskStatus, setTaskStatus] = createSignal<TaskStatus>("todo");
  const [targetRepositoryId, setTargetRepositoryId] = createSignal("");

  const resetTaskForm = () => {
    setTaskTitle("");
    setTaskDescription("");
    setTaskImplementationGuide("");
    setTaskStatus("todo");
    setTaskFormError("");
    const selectedProject = options.project();
    const defaultRepository = selectedProject?.repositories.find(
      (repo) => repo.is_default,
    );
    const fallbackRepository = selectedProject?.repositories[0];
    setTargetRepositoryId(
      defaultRepository?.id ?? fallbackRepository?.id ?? "",
    );
  };

  const onCreateTask: (event: Event) => Promise<void> = async (event) => {
    event.preventDefault();
    const projectId = options.projectId();
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
        implementationGuide: taskImplementationGuide().trim() || undefined,
        status: taskStatus(),
        targetRepositoryId: targetRepositoryId() || undefined,
      });
      setIsModalOpen(false);
      resetTaskForm();
      await options.onTaskCreated(projectId);
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
    isModalOpen,
    isSubmittingTask,
    taskFormError,
    taskTitle,
    taskDescription,
    taskImplementationGuide,
    taskStatus,
    targetRepositoryId,
    setIsModalOpen,
    setTaskTitle,
    setTaskDescription,
    setTaskImplementationGuide,
    setTaskStatus,
    setTargetRepositoryId,
    resetTaskForm,
    onCreateTask,
  };
};
