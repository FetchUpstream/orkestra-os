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

import {
  listTaskDependencies,
  type TaskDependencies,
  type TaskDependencyTask,
} from "./tasks";

const cachedTaskDependenciesByTaskId = new Map<string, TaskDependencies>();
const inflightTaskDependenciesByTaskId = new Map<
  string,
  Promise<TaskDependencies>
>();

const cloneTaskDependencyTask = (
  dependencyTask: TaskDependencyTask,
): TaskDependencyTask => ({
  ...dependencyTask,
});

const cloneTaskDependencies = (
  dependencies: TaskDependencies,
): TaskDependencies => ({
  taskId: dependencies.taskId,
  parents: dependencies.parents.map(cloneTaskDependencyTask),
  children: dependencies.children.map(cloneTaskDependencyTask),
});

const normalizeTaskDependencies = (
  taskId: string,
  dependencies: TaskDependencies,
): TaskDependencies => ({
  taskId: dependencies.taskId || taskId,
  parents: dependencies.parents.map(cloneTaskDependencyTask),
  children: dependencies.children.map(cloneTaskDependencyTask),
});

const emptyTaskDependencies = (taskId: string): TaskDependencies => ({
  taskId,
  parents: [],
  children: [],
});

export const readTaskDependenciesCache = (
  taskId: string,
): TaskDependencies | null => {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    return emptyTaskDependencies("");
  }

  const cached = cachedTaskDependenciesByTaskId.get(normalizedTaskId);
  if (!cached) {
    return null;
  }

  return cloneTaskDependencies(cached);
};

export const getTaskDependenciesWithCache = async (
  taskId: string,
  options?: { refresh?: boolean },
): Promise<TaskDependencies> => {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    return emptyTaskDependencies("");
  }

  if (options?.refresh) {
    cachedTaskDependenciesByTaskId.delete(normalizedTaskId);
    inflightTaskDependenciesByTaskId.delete(normalizedTaskId);
  }

  const cached = cachedTaskDependenciesByTaskId.get(normalizedTaskId);
  if (cached) {
    return cloneTaskDependencies(cached);
  }

  const inflight = inflightTaskDependenciesByTaskId.get(normalizedTaskId);
  if (inflight) {
    return inflight;
  }

  const nextInflight = listTaskDependencies(normalizedTaskId)
    .then((dependencies) => {
      const normalizedDependencies = normalizeTaskDependencies(
        normalizedTaskId,
        dependencies,
      );
      if (inflightTaskDependenciesByTaskId.get(normalizedTaskId) === nextInflight) {
        cachedTaskDependenciesByTaskId.set(
          normalizedTaskId,
          normalizedDependencies,
        );
        inflightTaskDependenciesByTaskId.delete(normalizedTaskId);
      }
      return cloneTaskDependencies(normalizedDependencies);
    })
    .catch((error) => {
      if (inflightTaskDependenciesByTaskId.get(normalizedTaskId) === nextInflight) {
        inflightTaskDependenciesByTaskId.delete(normalizedTaskId);
      }
      throw error;
    });

  inflightTaskDependenciesByTaskId.set(normalizedTaskId, nextInflight);
  return nextInflight;
};

export const invalidateTaskDependenciesCache = (taskId?: string): void => {
  const normalizedTaskId = taskId?.trim() || "";
  if (!normalizedTaskId) {
    cachedTaskDependenciesByTaskId.clear();
    inflightTaskDependenciesByTaskId.clear();
    return;
  }

  cachedTaskDependenciesByTaskId.delete(normalizedTaskId);
  inflightTaskDependenciesByTaskId.delete(normalizedTaskId);
};

export const resetTaskDependenciesCacheForTests = (): void => {
  invalidateTaskDependenciesCache();
};
