import { invoke } from "@tauri-apps/api/core";

export type TaskStatus = "todo" | "doing" | "review" | "done";

export type Task = {
  id: string;
  title: string;
  description?: string | null;
  implementationGuide?: string | null;
  status: TaskStatus;
  blockedByCount?: number | null;
  isBlocked?: boolean | null;
  taskNumber?: number | null;
  displayKey?: string | null;
  projectId?: string;
  targetRepositoryId?: string | null;
  targetRepositoryName?: string | null;
  targetRepositoryPath?: string | null;
  updatedAt?: string | null;
};

export type TaskDependencyTask = {
  id: string;
  displayKey: string;
  title: string;
  status: TaskStatus;
  targetRepositoryName?: string | null;
  targetRepositoryPath?: string | null;
  updatedAt?: string | null;
};

export type TaskDependencies = {
  taskId: string;
  parents: TaskDependencyTask[];
  children: TaskDependencyTask[];
};

export type CreateTaskInput = {
  projectId: string;
  title: string;
  description?: string;
  implementationGuide?: string;
  status: TaskStatus;
  targetRepositoryId?: string;
};

export type UpdateTaskInput = {
  title: string;
  description?: string;
  implementationGuide?: string;
};

export type SetTaskStatusInput = {
  status: TaskStatus;
  sourceAction?: "board_manual_move";
  runDefaults?: {
    agentId?: string;
    providerId?: string;
    modelId?: string;
  };
};

export type MoveTaskInput = {
  targetRepositoryId: string;
};

type TaskResponse = {
  id: string;
  title: string;
  description?: string | null;
  implementation_guide?: string | null;
  implementationGuide?: string | null;
  status: TaskStatus;
  blocked_by_count?: number | null;
  blockedByCount?: number | null;
  is_blocked?: boolean | null;
  isBlocked?: boolean | null;
  task_number?: number;
  taskNumber?: number;
  display_key?: string;
  displayKey?: string;
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

type TaskDependencyTaskResponse = {
  id: string;
  display_key?: string | null;
  displayKey?: string | null;
  title: string;
  status: TaskStatus;
  target_repository_name?: string | null;
  targetRepositoryName?: string | null;
  target_repository_path?: string | null;
  targetRepositoryPath?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
};

type TaskDependenciesResponse = {
  task_id?: string;
  taskId?: string;
  parents?: TaskDependencyTaskResponse[];
  children?: TaskDependencyTaskResponse[];
};

const toTask = (task: TaskResponse): Task => ({
  id: task.id,
  title: task.title,
  description: task.description,
  implementationGuide: task.implementation_guide ?? task.implementationGuide,
  status: task.status,
  blockedByCount: task.blocked_by_count ?? task.blockedByCount,
  isBlocked: task.is_blocked ?? task.isBlocked,
  taskNumber: task.task_number ?? task.taskNumber,
  displayKey: task.display_key ?? task.displayKey,
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

const toDependencyTask = (
  dependencyTask: TaskDependencyTaskResponse,
): TaskDependencyTask => ({
  id: dependencyTask.id,
  displayKey: (
    dependencyTask.display_key ??
    dependencyTask.displayKey ??
    ""
  ).trim(),
  title: dependencyTask.title,
  status: dependencyTask.status,
  targetRepositoryName:
    dependencyTask.target_repository_name ??
    dependencyTask.targetRepositoryName,
  targetRepositoryPath:
    dependencyTask.target_repository_path ??
    dependencyTask.targetRepositoryPath,
  updatedAt: dependencyTask.updated_at ?? dependencyTask.updatedAt,
});

export const createTask = async (input: CreateTaskInput): Promise<Task> => {
  const response = await invoke<TaskResponse>("create_task", {
    input: {
      project_id: input.projectId,
      title: input.title,
      description: input.description,
      implementation_guide: input.implementationGuide,
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

export const searchProjectTasks = async (
  projectId: string,
  query: string,
): Promise<Task[]> => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }
  const response = await invoke<TaskResponse[]>("search_project_tasks", {
    project_id: projectId,
    query: normalizedQuery,
  });
  return response.map(toTask);
};

export const getTask = async (taskId: string): Promise<Task> => {
  const response = await invoke<TaskResponse>("get_task", { id: taskId });
  return toTask(response);
};

export const updateTask = async (
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> => {
  const response = await invoke<TaskResponse>("update_task", {
    id: taskId,
    input: {
      title: input.title,
      description: input.description,
      implementation_guide: input.implementationGuide,
    },
  });
  return toTask(response);
};

export const setTaskStatus = async (
  taskId: string,
  input: SetTaskStatusInput,
): Promise<Task> => {
  const normalizedAgentId = input.runDefaults?.agentId?.trim();
  const normalizedProviderId = input.runDefaults?.providerId?.trim();
  const normalizedModelId = input.runDefaults?.modelId?.trim();

  const response = await invoke<TaskResponse>("set_task_status", {
    id: taskId,
    input: {
      status: input.status,
      source_action: input.sourceAction,
      ...(normalizedAgentId ? { agent_id: normalizedAgentId } : {}),
      ...(normalizedProviderId ? { provider_id: normalizedProviderId } : {}),
      ...(normalizedModelId ? { model_id: normalizedModelId } : {}),
    },
  });
  return toTask(response);
};

export const moveTask = async (
  taskId: string,
  input: MoveTaskInput,
): Promise<Task> => {
  const response = await invoke<TaskResponse>("move_task", {
    id: taskId,
    input: {
      repository_id: input.targetRepositoryId,
    },
  });
  return toTask(response);
};

export const deleteTask = async (taskId: string): Promise<void> => {
  await invoke("delete_task", { id: taskId });
};

export const listTaskDependencies = async (
  taskId: string,
): Promise<TaskDependencies> => {
  const response = await invoke<TaskDependenciesResponse>(
    "list_task_dependencies",
    { taskId },
  );
  return {
    taskId: response.task_id ?? response.taskId ?? taskId,
    parents: (response.parents ?? []).map(toDependencyTask),
    children: (response.children ?? []).map(toDependencyTask),
  };
};

export const addTaskDependency = async (
  parentTaskId: string,
  childTaskId: string,
): Promise<void> => {
  await invoke("add_task_dependency", {
    input: {
      parent_task_id: parentTaskId,
      child_task_id: childTaskId,
    },
  });
};

export const removeTaskDependency = async (
  parentTaskId: string,
  childTaskId: string,
): Promise<void> => {
  await invoke("remove_task_dependency", {
    input: {
      parent_task_id: parentTaskId,
      child_task_id: childTaskId,
    },
  });
};
