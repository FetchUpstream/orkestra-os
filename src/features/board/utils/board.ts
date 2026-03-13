import type { Task, TaskStatus } from "../../../app/lib/tasks";

export const BOARD_COLUMNS: ReadonlyArray<{
  status: TaskStatus;
  label: string;
}> = [
  { status: "todo", label: "Todo" },
  { status: "doing", label: "In Progress" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
];

export const groupTasksByStatus = (
  tasks: Task[],
): Record<TaskStatus, Task[]> => {
  const grouped: Record<TaskStatus, Task[]> = {
    todo: [],
    doing: [],
    review: [],
    done: [],
  };

  for (const task of tasks) {
    grouped[task.status].push(task);
  }

  return grouped;
};

export const taskPriorityLabel = (task: Task): string => {
  const priority = (task as Task & { priority?: string | null }).priority;
  const value = typeof priority === "string" ? priority.trim() : "";
  return value ? `Priority: ${value}` : "Priority: Unspecified";
};
