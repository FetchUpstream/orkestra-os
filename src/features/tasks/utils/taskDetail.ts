import type {
  Task,
  TaskDependencyTask,
  TaskStatus,
} from "../../../app/lib/tasks";

export const formatStatus = (status: Task["status"]) => {
  if (status === "todo") return "To do";
  if (status === "doing") return "In progress";
  if (status === "review") return "In review";
  return "Done";
};

export const formatDateTime = (value?: string | null) => {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
};

export const repositoryLabel = (taskValue: Task) =>
  taskValue.targetRepositoryName ||
  taskValue.targetRepositoryPath ||
  "Project-wide";

export const projectLabel = (name: string | null) => name || "Current project";

export const dependencyScopeLabel = (dependencyTask: TaskDependencyTask) =>
  dependencyTask.targetRepositoryName ||
  dependencyTask.targetRepositoryPath ||
  "Project-wide";

export const dependencyDisplayLabel = (dependencyTask: TaskDependencyTask) => {
  const key = dependencyTask.displayKey.trim();
  return key ? `${key} - ${dependencyTask.title}` : dependencyTask.title;
};

export const nextStatus = (status: TaskStatus): TaskStatus => {
  if (status === "todo") return "doing";
  if (status === "doing") return "review";
  if (status === "review") return "done";
  return "todo";
};

export const getActionErrorMessage = (
  prefix: string,
  error: unknown,
): string => {
  const message =
    typeof error === "string"
      ? error
      : error &&
          typeof error === "object" &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : "Please try again.";
  return `${prefix} ${message}`;
};
