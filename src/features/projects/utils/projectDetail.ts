// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import type { Project } from "../../../app/lib/projects";
import type { Task, TaskStatus } from "../../../app/lib/tasks";

export type DependencyBadgeState = "blocked" | "ready" | "none";

export const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "review", "done"];

export const formatTaskStatus = (status: TaskStatus): string => {
  if (status === "todo") return "To do";
  if (status === "doing") return "In progress";
  if (status === "review") return "In review";
  return "Done";
};

export const getCreateTaskErrorMessage = (error: unknown): string | null => {
  const message =
    typeof error === "string"
      ? error
      : error &&
          typeof error === "object" &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : null;
  if (!message) return null;
  if (message.toLowerCase().includes("database error")) return null;
  return message;
};

export const formatUpdatedAt = (value?: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

export const isTaskBlocked = (task: Task): boolean => task.isBlocked === true;

export const dependencyBadgeState = (task: Task): DependencyBadgeState => {
  if (isTaskBlocked(task)) return "blocked";
  if (task.status !== "todo") return "none";
  if ((task.blockedByCount ?? 0) > 0) return "ready";
  return "none";
};

export const taskDisplayKey = (
  task: Task,
  project: Project | null,
): string | null => {
  if (task.displayKey?.trim()) return task.displayKey;
  if (task.taskNumber && project?.key)
    return `${project.key}-${task.taskNumber}`;
  return null;
};
