import type {
  Task,
  TaskDependencyTask,
  TaskStatus,
} from "../../../app/lib/tasks";
import type { RunStatus } from "../../../app/lib/runs";

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

type DependencyCandidateLike = {
  id: string;
  title: string;
  status: TaskStatus;
  displayKey?: string | null;
  targetRepositoryName?: string | null;
  targetRepositoryPath?: string | null;
};

export const isDependencyCandidateLinkable = (
  candidateTask: DependencyCandidateLike,
  currentTaskId: string,
  linkedTaskIds: Set<string>,
) => {
  if (!candidateTask.id || candidateTask.id === currentTaskId) return false;
  return !linkedTaskIds.has(candidateTask.id);
};

export const filterDependencyCandidates = <T extends DependencyCandidateLike>(
  candidateTasks: T[],
  options: { searchTerm: string; includeDone: boolean },
) => {
  const query = options.searchTerm.trim().toLowerCase();
  return candidateTasks.filter((candidateTask) => {
    if (!options.includeDone && candidateTask.status === "done") return false;
    if (!query) return true;

    const key = candidateTask.displayKey?.trim().toLowerCase() || "";
    const title = candidateTask.title.trim().toLowerCase();
    const repository =
      candidateTask.targetRepositoryName?.trim().toLowerCase() ||
      candidateTask.targetRepositoryPath?.trim().toLowerCase() ||
      "";
    return (
      key.includes(query) || title.includes(query) || repository.includes(query)
    );
  });
};

export const nextStatus = (status: TaskStatus): TaskStatus => {
  if (status === "todo") return "doing";
  if (status === "doing") return "review";
  if (status === "review") return "done";
  return "todo";
};

export const canTransitionStatus = (
  from: TaskStatus,
  to: TaskStatus,
): boolean => {
  if (from === "review") {
    return ["todo", "doing", "done"].includes(to);
  }

  if (from === "doing") {
    return ["review", "todo"].includes(to);
  }

  return nextStatus(from) === to;
};

const TASK_STATUS_ORDER: TaskStatus[] = ["todo", "doing", "review", "done"];

export const getValidTransitionTargets = (status: TaskStatus): TaskStatus[] =>
  TASK_STATUS_ORDER.filter(
    (candidateStatus) =>
      candidateStatus !== status &&
      canTransitionStatus(status, candidateStatus),
  );

export const formatRunStatus = (status: RunStatus) => {
  if (status === "queued") return "Queued";
  if (status === "preparing") return "Preparing";
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Cancelled";
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
