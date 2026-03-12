import { invoke } from "@tauri-apps/api/core";

export type TaskStatus = "todo" | "doing" | "review" | "done";

export type Task = {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  projectId?: string;
  targetRepositoryId?: string | null;
  targetRepositoryName?: string | null;
  targetRepositoryPath?: string | null;
  updatedAt?: string | null;
};

export type CreateTaskInput = {
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  targetRepositoryId?: string;
};

type TaskResponse = {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  repository_id?: string | null;
  repositoryId?: string | null;
  project_id?: string;
  projectId?: string;
  target_repository_id?: string | null;
  targetRepositoryId?: string | null;
  target_repository_name?: string | null;
  targetRepositoryName?: string | null;
  target_repository_path?: string | null;
  targetRepositoryPath?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
};

const toTask = (task: TaskResponse): Task => ({
  id: task.id,
  title: task.title,
  description: task.description,
  status: task.status,
  projectId: task.project_id ?? task.projectId,
  targetRepositoryId:
    task.target_repository_id ??
    task.targetRepositoryId ??
    task.repository_id ??
    task.repositoryId,
  targetRepositoryName:
    task.target_repository_name ?? task.targetRepositoryName,
  targetRepositoryPath:
    task.target_repository_path ?? task.targetRepositoryPath,
  updatedAt: task.updated_at ?? task.updatedAt,
});

export const createTask = async (input: CreateTaskInput): Promise<Task> => {
  const response = await invoke<TaskResponse>("create_task", {
    input: {
      project_id: input.projectId,
      title: input.title,
      description: input.description,
      status: input.status,
      repository_id: input.targetRepositoryId,
    },
  });
  return toTask(response);
};

export const listProjectTasks = async (projectId: string): Promise<Task[]> => {
  const response = await invoke<TaskResponse[]>("list_project_tasks", {
    projectId,
  });
  return response.map(toTask);
};

export const getTask = async (taskId: string): Promise<Task> => {
  const response = await invoke<TaskResponse>("get_task", { id: taskId });
  return toTask(response);
};
