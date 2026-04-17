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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDependencies } from "./tasks";
import {
  getTaskDependenciesWithCache,
  readTaskDependenciesCache,
  resetTaskDependenciesCacheForTests,
} from "./taskDependenciesCache";

const { listTaskDependenciesMock } = vi.hoisted(() => ({
  listTaskDependenciesMock: vi.fn(),
}));

vi.mock("./tasks", () => ({
  listTaskDependencies: listTaskDependenciesMock,
}));

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("taskDependenciesCache", () => {
  beforeEach(() => {
    resetTaskDependenciesCacheForTests();
    listTaskDependenciesMock.mockReset();
  });

  it("loads once and serves cached values", async () => {
    listTaskDependenciesMock.mockResolvedValue({
      taskId: "task-1",
      parents: [
        {
          id: "task-0",
          displayKey: "PRJ-0",
          title: "Parent task",
          status: "done",
        },
      ],
      children: [],
    } satisfies TaskDependencies);

    const first = await getTaskDependenciesWithCache("task-1");
    const second = await getTaskDependenciesWithCache("task-1");

    expect(first).toEqual({
      taskId: "task-1",
      parents: [
        {
          id: "task-0",
          displayKey: "PRJ-0",
          title: "Parent task",
          status: "done",
        },
      ],
      children: [],
    });
    expect(second).toEqual(first);
    expect(readTaskDependenciesCache("task-1")).toEqual(first);
    expect(listTaskDependenciesMock).toHaveBeenCalledTimes(1);
    expect(listTaskDependenciesMock).toHaveBeenCalledWith("task-1");
  });

  it("does not repopulate cache from stale in-flight reads after refresh", async () => {
    const firstRead = deferred<TaskDependencies>();
    listTaskDependenciesMock
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValueOnce({
        taskId: "task-1",
        parents: [
          {
            id: "task-2",
            displayKey: "PRJ-2",
            title: "Fresh parent",
            status: "review",
          },
        ],
        children: [],
      } satisfies TaskDependencies);

    const firstRequest = getTaskDependenciesWithCache("task-1");
    const refreshed = await getTaskDependenciesWithCache("task-1", {
      refresh: true,
    });

    expect(refreshed).toEqual({
      taskId: "task-1",
      parents: [
        {
          id: "task-2",
          displayKey: "PRJ-2",
          title: "Fresh parent",
          status: "review",
        },
      ],
      children: [],
    });

    firstRead.resolve({
      taskId: "task-1",
      parents: [
        {
          id: "task-9",
          displayKey: "PRJ-9",
          title: "Stale parent",
          status: "done",
        },
      ],
      children: [],
    });

    await expect(firstRequest).resolves.toEqual({
      taskId: "task-1",
      parents: [
        {
          id: "task-9",
          displayKey: "PRJ-9",
          title: "Stale parent",
          status: "done",
        },
      ],
      children: [],
    });
    expect(readTaskDependenciesCache("task-1")).toEqual(refreshed);
    expect(listTaskDependenciesMock).toHaveBeenCalledTimes(2);
  });
});
