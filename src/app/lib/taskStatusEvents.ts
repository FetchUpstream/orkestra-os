import { listen } from "@tauri-apps/api/event";
import type { TaskStatus } from "./tasks";

export type TaskStatusChangedEvent = {
  taskId: string;
  projectId: string;
  runId?: string | null;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
  transitionSource: string;
  timestamp: string;
};

type RawTaskStatusChangedEvent = {
  task_id?: string;
  taskId?: string;
  project_id?: string;
  projectId?: string;
  run_id?: string | null;
  runId?: string | null;
  previous_status?: TaskStatus;
  previousStatus?: TaskStatus;
  new_status?: TaskStatus;
  newStatus?: TaskStatus;
  transition_source?: string;
  transitionSource?: string;
  timestamp?: string;
};

const TASK_STATUS_CHANGED_EVENT = "task-status-changed";

const normalizeTaskStatusChangedEvent = (
  payload: RawTaskStatusChangedEvent,
): TaskStatusChangedEvent | null => {
  const taskId = payload.task_id ?? payload.taskId ?? "";
  const projectId = payload.project_id ?? payload.projectId ?? "";
  const previousStatus = payload.previous_status ?? payload.previousStatus;
  const newStatus = payload.new_status ?? payload.newStatus;
  const transitionSource =
    payload.transition_source ?? payload.transitionSource ?? "";
  const timestamp = payload.timestamp ?? "";

  if (!taskId || !projectId || !previousStatus || !newStatus || !timestamp) {
    return null;
  }

  return {
    taskId,
    projectId,
    runId: payload.run_id ?? payload.runId ?? null,
    previousStatus,
    newStatus,
    transitionSource,
    timestamp,
  };
};

export const subscribeToTaskStatusChanged = async (
  onEvent: (event: TaskStatusChangedEvent) => void,
): Promise<() => void> =>
  listen<RawTaskStatusChangedEvent>(TASK_STATUS_CHANGED_EVENT, (event) => {
    const normalized = normalizeTaskStatusChangedEvent(event.payload);
    if (normalized) {
      onEvent(normalized);
    }
  });
