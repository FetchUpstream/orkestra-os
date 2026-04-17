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

import { render, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTaskDependenciesCacheForTests } from "../../../../app/lib/taskDependenciesCache";
import type { TaskDependencies } from "../../../../app/lib/tasks";
import { useBoardModel } from "../useBoardModel";

const {
  listProjectsMock,
  getProjectMock,
  getTaskMock,
  listProjectTasksMock,
  listTaskDependenciesMock,
  searchProjectTasksMock,
  setTaskStatusMock,
  createRunMock,
  listTaskRunsMock,
  listTaskRunSourceBranchesMock,
  startRunOpenCodeMock,
  getRunSelectionOptionsWithCacheMock,
  readRunSelectionOptionsCacheMock,
  subscribeToRunDeletedMock,
} = vi.hoisted(() => ({
  listProjectsMock: vi.fn(),
  getProjectMock: vi.fn(),
  getTaskMock: vi.fn(),
  listProjectTasksMock: vi.fn(),
  listTaskDependenciesMock: vi.fn(),
  searchProjectTasksMock: vi.fn(),
  setTaskStatusMock: vi.fn(),
  createRunMock: vi.fn(),
  listTaskRunsMock: vi.fn(),
  listTaskRunSourceBranchesMock: vi.fn(),
  startRunOpenCodeMock: vi.fn(),
  getRunSelectionOptionsWithCacheMock: vi.fn(),
  readRunSelectionOptionsCacheMock: vi.fn(),
  subscribeToRunDeletedMock: vi.fn(),
}));

let runDeletedListener:
  | ((event: { runId: string; timestamp: string }) => void)
  | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));

vi.mock("../../../../app/lib/projects", () => ({
  listProjects: listProjectsMock,
  getProject: getProjectMock,
}));

vi.mock("../../../../app/lib/tasks", () => ({
  getTask: getTaskMock,
  listProjectTasks: listProjectTasksMock,
  listTaskDependencies: listTaskDependenciesMock,
  searchProjectTasks: searchProjectTasksMock,
  setTaskStatus: setTaskStatusMock,
}));

vi.mock("../../../../app/lib/runs", () => ({
  createRun: createRunMock,
  listTaskRuns: listTaskRunsMock,
  listTaskRunSourceBranches: listTaskRunSourceBranchesMock,
  startRunOpenCode: startRunOpenCodeMock,
}));

vi.mock("../../../../app/lib/runSelectionOptionsCache", () => ({
  getRunSelectionOptionsWithCache: getRunSelectionOptionsWithCacheMock,
  readRunSelectionOptionsCache: readRunSelectionOptionsCacheMock,
}));

vi.mock("../../../../app/lib/runDeletedEvents", () => ({
  subscribeToRunDeleted: subscribeToRunDeletedMock,
}));

vi.mock("../../../../app/contexts/OpenCodeDependencyContext", () => ({
  useOpenCodeDependency: () => ({
    state: () => "available",
    reason: () => "",
    isModalVisible: () => false,
    refresh: vi.fn(async () => "available"),
    ensureAvailableForRequiredFlow: vi.fn(async () => true),
    showRequiredModal: vi.fn(),
  }),
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

describe("useBoardModel run settings defaults", () => {
  beforeEach(() => {
    resetTaskDependenciesCacheForTests();
    listProjectsMock.mockReset();
    getProjectMock.mockReset();
    getTaskMock.mockReset();
    listProjectTasksMock.mockReset();
    listTaskDependenciesMock.mockReset();
    searchProjectTasksMock.mockReset();
    setTaskStatusMock.mockReset();
    createRunMock.mockReset();
    listTaskRunsMock.mockReset();
    listTaskRunSourceBranchesMock.mockReset();
    startRunOpenCodeMock.mockReset();
    getRunSelectionOptionsWithCacheMock.mockReset();
    readRunSelectionOptionsCacheMock.mockReset();
    subscribeToRunDeletedMock.mockReset();
    runDeletedListener = null;
    subscribeToRunDeletedMock.mockImplementation(
      (onEvent: (event: { runId: string; timestamp: string }) => void) => {
        runDeletedListener = onEvent;
        return () => {
          if (runDeletedListener === onEvent) {
            runDeletedListener = null;
          }
        };
      },
    );

    listProjectsMock.mockResolvedValue([
      {
        id: "project-1",
        name: "Project",
        key: "PRJ",
      },
    ]);
    getProjectMock.mockResolvedValue({
      id: "project-1",
      name: "Project",
      key: "PRJ",
      defaultRunAgent: "agent-1",
      defaultRunProvider: "provider-1",
      defaultRunModel: "model-1",
      repositories: [],
    });
    listProjectTasksMock.mockResolvedValue([
      {
        id: "task-1",
        title: "Task",
        status: "todo",
        projectId: "project-1",
      },
    ]);
    getTaskMock.mockResolvedValue({
      id: "task-1",
      title: "Task",
      status: "todo",
      projectId: "project-1",
      isBlocked: false,
    });
    listTaskDependenciesMock.mockResolvedValue({ parents: [], children: [] });
    searchProjectTasksMock.mockResolvedValue([]);
    listTaskRunsMock.mockResolvedValue([]);
    listTaskRunSourceBranchesMock.mockResolvedValue([
      { name: "main", isCheckedOut: true },
      { name: "feature/source", isCheckedOut: false },
    ]);
    readRunSelectionOptionsCacheMock.mockReturnValue(null);
    getRunSelectionOptionsWithCacheMock.mockResolvedValue({
      agents: [{ id: "agent-1", label: "Agent 1" }],
      providers: [{ id: "provider-1", label: "Provider 1" }],
      models: [{ id: "model-1", label: "Model 1", providerId: "provider-1" }],
    });
  });

  it("preselects project defaults when opening board run settings", async () => {
    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.groupedTasks().todo.length).toBe(1);
    });

    ref.current?.onRequestMoveTaskToInProgress("task-1");

    await waitFor(() => {
      expect(ref.current?.isRunSettingsModalOpen()).toBe(true);
      expect(ref.current?.selectedRunAgentId()).toBe("agent-1");
      expect(ref.current?.selectedRunProviderId()).toBe("provider-1");
      expect(ref.current?.selectedRunModelId()).toBe("model-1");
      expect(ref.current?.selectedRunSourceBranch()).toBe("main");
    });
  });

  it("falls back when project default agent is unavailable", async () => {
    getProjectMock.mockResolvedValue({
      id: "project-1",
      name: "Project",
      key: "PRJ",
      defaultRunAgent: "agent-missing",
      defaultRunProvider: "provider-1",
      defaultRunModel: "model-1",
      repositories: [],
    });

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.groupedTasks().todo.length).toBe(1);
    });

    ref.current?.onRequestMoveTaskToInProgress("task-1");

    await waitFor(() => {
      expect(ref.current?.selectedRunAgentId()).toBe("");
      expect(ref.current?.selectedRunProviderId()).toBe("provider-1");
      expect(ref.current?.selectedRunModelId()).toBe("model-1");
    });
  });

  it("shows blocked task modal instead of run settings when blockers remain", async () => {
    getTaskMock.mockResolvedValue({
      id: "task-1",
      title: "Task",
      status: "todo",
      projectId: "project-1",
      isBlocked: true,
    });
    listTaskDependenciesMock.mockResolvedValue({
      parents: [
        {
          id: "task-2",
          displayKey: "PRJ-2",
          title: "Finalize schema",
          status: "doing",
        },
      ],
      children: [],
    });

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.groupedTasks().todo.length).toBe(1);
    });

    ref.current?.onRequestMoveTaskToInProgress("task-1");

    await waitFor(() => {
      expect(ref.current?.isBlockedTaskModalOpen()).toBe(true);
      expect(ref.current?.isRunSettingsModalOpen()).toBe(false);
      expect(ref.current?.blockingStartTasks()).toMatchObject([
        {
          id: "task-2",
          displayKey: "PRJ-2",
          title: "Finalize schema",
          status: "doing",
        },
      ]);
    });
  });

  it("builds board run mini-cards with sanitized identity labels", async () => {
    listProjectTasksMock.mockResolvedValue([
      {
        id: "task-1",
        title: "Task",
        status: "doing",
        projectId: "project-1",
      },
    ]);
    listTaskRunsMock.mockResolvedValue([
      {
        id: "run-1",
        taskId: "task-1",
        projectId: "project-1",
        runNumber: 42,
        displayKey: "RUN-42",
        status: "idle",
        runState: "waiting_for_input",
        triggeredBy: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
        agentId: "agent-1",
        modelId: "model-1",
      },
      {
        id: "run-2",
        taskId: "task-1",
        projectId: "project-1",
        runNumber: 43,
        displayKey: "550e8400-e29b-41d4-a716-446655440000",
        status: "queued",
        triggeredBy: "user",
        createdAt: "2026-01-01T00:01:00.000Z",
      },
      {
        id: "run-3",
        taskId: "task-1",
        projectId: "project-1",
        displayKey: "abcdefabcdefabcdefabcdef",
        status: "queued",
        triggeredBy: "user",
        createdAt: "2026-01-01T00:02:00.000Z",
      },
    ]);

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.taskRunMiniCards()["task-1"]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            runId: "run-1",
            identityLabel: "RUN-42",
            label: "Waiting for Input",
            status: "idle",
            statusLabel: "Idle",
            agentLabel: "Agent 1",
            modelLabel: "Model 1",
          }),
          expect.objectContaining({
            runId: "run-2",
            identityLabel: "Run #43",
            label: "Warming Up",
            status: "queued",
            statusLabel: "Queued",
            agentLabel: "Default agent",
            modelLabel: "Default model",
          }),
          expect.objectContaining({
            runId: "run-3",
            identityLabel: "Run",
            label: "Warming Up",
            status: "queued",
            statusLabel: "Queued",
            agentLabel: "Default agent",
            modelLabel: "Default model",
          }),
        ]),
      );
    });
  });

  it("keeps blocked tasks blocked when the fresh task still reports blocked", async () => {
    getTaskMock.mockResolvedValue({
      id: "task-1",
      title: "Task",
      status: "todo",
      projectId: "project-1",
      isBlocked: true,
    });
    listTaskDependenciesMock.mockResolvedValue({
      parents: [],
      children: [],
    });

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.groupedTasks().todo.length).toBe(1);
    });

    ref.current?.onRequestMoveTaskToInProgress("task-1");

    await waitFor(() => {
      expect(ref.current?.isBlockedTaskModalOpen()).toBe(true);
      expect(ref.current?.isRunSettingsModalOpen()).toBe(false);
      expect(ref.current?.blockingStartTasks()).toEqual([]);
    });
  });

  it("rechecks blockers before confirm and avoids moving blocked work", async () => {
    getTaskMock
      .mockResolvedValueOnce({
        id: "task-1",
        title: "Task",
        status: "todo",
        projectId: "project-1",
        isBlocked: false,
      })
      .mockResolvedValueOnce({
        id: "task-1",
        title: "Task",
        status: "todo",
        projectId: "project-1",
        isBlocked: true,
      });
    listTaskDependenciesMock
      .mockResolvedValueOnce({ parents: [], children: [] })
      .mockResolvedValueOnce({
        parents: [
          {
            id: "task-2",
            displayKey: "PRJ-2",
            title: "Finalize schema",
            status: "doing",
          },
        ],
        children: [],
      });

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.groupedTasks().todo.length).toBe(1);
    });

    ref.current?.onRequestMoveTaskToInProgress("task-1");

    await waitFor(() => {
      expect(ref.current?.isRunSettingsModalOpen()).toBe(true);
    });

    await ref.current?.onConfirmMoveTaskToInProgress();

    await waitFor(() => {
      expect(ref.current?.isBlockedTaskModalOpen()).toBe(true);
      expect(ref.current?.isRunSettingsModalOpen()).toBe(false);
    });

    expect(setTaskStatusMock).not.toHaveBeenCalled();
    expect(createRunMock).not.toHaveBeenCalled();
    expect(startRunOpenCodeMock).not.toHaveBeenCalled();
  });

  it("optimistically blocks dependent children when moving a done parent back to todo", async () => {
    const pendingStatusUpdate = deferred<{
      id: string;
      title: string;
      status: "todo";
      projectId: string;
      isBlocked: false;
    }>();
    listProjectTasksMock.mockResolvedValue([
      {
        id: "parent-1",
        title: "Parent task",
        status: "done",
        projectId: "project-1",
        isBlocked: false,
      },
      {
        id: "child-1",
        title: "Child task",
        status: "todo",
        projectId: "project-1",
        blockedByCount: 1,
        isBlocked: false,
      },
      {
        id: "task-3",
        title: "Unrelated task",
        status: "todo",
        projectId: "project-1",
        isBlocked: false,
      },
    ]);
    listTaskDependenciesMock.mockImplementation((taskId: string) => {
      if (taskId === "parent-1") {
        return Promise.resolve({
          taskId,
          parents: [],
          children: [
            {
              id: "child-1",
              displayKey: "PRJ-2",
              title: "Child task",
              status: "todo",
            },
          ],
        });
      }

      if (taskId === "child-1") {
        return Promise.resolve({
          taskId,
          parents: [
            {
              id: "parent-1",
              displayKey: "PRJ-1",
              title: "Parent task",
              status: "done",
            },
          ],
          children: [],
        });
      }

      return Promise.resolve({ taskId, parents: [], children: [] });
    });
    setTaskStatusMock.mockReturnValue(pendingStatusUpdate.promise);

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.groupedTasks().done.length).toBe(1);
      expect(ref.current?.groupedTasks().todo.length).toBe(2);
    });

    const movePromise = ref.current!.moveTaskToStatus("parent-1", "todo");

    await waitFor(() => {
      expect(ref.current?.groupedTasks().done).toEqual([]);
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "parent-1")
          ?.status,
      ).toBe("todo");
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(true);
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "task-3")
          ?.isBlocked,
      ).toBe(false);
    });

    pendingStatusUpdate.resolve({
      id: "parent-1",
      title: "Parent task",
      status: "todo",
      projectId: "project-1",
      isBlocked: false,
    });

    await expect(movePromise).resolves.toBe(true);

    await waitFor(() => {
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(true);
    });
  });

  it("optimistically clears blocked children when a single blocking parent moves to done", async () => {
    const pendingStatusUpdate = deferred<{
      id: string;
      title: string;
      status: "done";
      projectId: string;
      isBlocked: false;
    }>();
    listProjectTasksMock.mockResolvedValue([
      {
        id: "parent-1",
        title: "Parent task",
        status: "review",
        projectId: "project-1",
        isBlocked: false,
      },
      {
        id: "child-1",
        title: "Child task",
        status: "todo",
        projectId: "project-1",
        blockedByCount: 1,
        isBlocked: true,
      },
    ]);
    listTaskDependenciesMock.mockImplementation((taskId: string) => {
      if (taskId === "parent-1") {
        return Promise.resolve({
          taskId,
          parents: [],
          children: [
            {
              id: "child-1",
              displayKey: "PRJ-2",
              title: "Child task",
              status: "todo",
            },
          ],
        });
      }

      if (taskId === "child-1") {
        return Promise.resolve({
          taskId,
          parents: [
            {
              id: "parent-1",
              displayKey: "PRJ-1",
              title: "Parent task",
              status: "review",
            },
          ],
          children: [],
        });
      }

      return Promise.resolve({ taskId, parents: [], children: [] });
    });
    setTaskStatusMock.mockReturnValue(pendingStatusUpdate.promise);

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.groupedTasks().review.length).toBe(1);
      expect(ref.current?.groupedTasks().todo.length).toBe(1);
    });

    const movePromise = ref.current!.moveTaskToStatus("parent-1", "done");

    await waitFor(() => {
      expect(ref.current?.groupedTasks().done.length).toBe(1);
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(false);
    });

    pendingStatusUpdate.resolve({
      id: "parent-1",
      title: "Parent task",
      status: "done",
      projectId: "project-1",
      isBlocked: false,
    });

    await expect(movePromise).resolves.toBe(true);

    await waitFor(() => {
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(false);
    });
  });

  it("keeps multi-parent children blocked until every parent is done", async () => {
    const firstStatusUpdate = deferred<{
      id: string;
      title: string;
      status: "done";
      projectId: string;
      isBlocked: false;
    }>();
    const secondStatusUpdate = deferred<{
      id: string;
      title: string;
      status: "done";
      projectId: string;
      isBlocked: false;
    }>();
    listProjectTasksMock.mockResolvedValue([
      {
        id: "parent-1",
        title: "First parent",
        status: "review",
        projectId: "project-1",
        isBlocked: false,
      },
      {
        id: "parent-2",
        title: "Second parent",
        status: "review",
        projectId: "project-1",
        isBlocked: false,
      },
      {
        id: "child-1",
        title: "Child task",
        status: "todo",
        projectId: "project-1",
        blockedByCount: 2,
        isBlocked: true,
      },
    ]);
    listTaskDependenciesMock.mockImplementation((taskId: string) => {
      if (taskId === "parent-1" || taskId === "parent-2") {
        return Promise.resolve({
          taskId,
          parents: [],
          children: [
            {
              id: "child-1",
              displayKey: "PRJ-3",
              title: "Child task",
              status: "todo",
            },
          ],
        });
      }

      if (taskId === "child-1") {
        return Promise.resolve({
          taskId,
          parents: [
            {
              id: "parent-1",
              displayKey: "PRJ-1",
              title: "First parent",
              status: "review",
            },
            {
              id: "parent-2",
              displayKey: "PRJ-2",
              title: "Second parent",
              status: "review",
            },
          ],
          children: [],
        });
      }

      return Promise.resolve({ taskId, parents: [], children: [] });
    });
    setTaskStatusMock
      .mockReturnValueOnce(firstStatusUpdate.promise)
      .mockReturnValueOnce(secondStatusUpdate.promise);

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.groupedTasks().review.length).toBe(2);
      expect(ref.current?.groupedTasks().todo.length).toBe(1);
    });

    const firstMovePromise = ref.current!.moveTaskToStatus("parent-1", "done");

    await waitFor(() => {
      expect(ref.current?.groupedTasks().done.length).toBe(1);
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(true);
    });

    firstStatusUpdate.resolve({
      id: "parent-1",
      title: "First parent",
      status: "done",
      projectId: "project-1",
      isBlocked: false,
    });

    await expect(firstMovePromise).resolves.toBe(true);

    await waitFor(() => {
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(true);
    });

    const secondMovePromise = ref.current!.moveTaskToStatus("parent-2", "done");

    await waitFor(() => {
      expect(ref.current?.groupedTasks().done.length).toBe(2);
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(false);
    });

    secondStatusUpdate.resolve({
      id: "parent-2",
      title: "Second parent",
      status: "done",
      projectId: "project-1",
      isBlocked: false,
    });

    await expect(secondMovePromise).resolves.toBe(true);

    await waitFor(() => {
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(false);
    });
  });

  it("ignores stale overlapping parent propagations for the same child", async () => {
    const firstStatusUpdate = deferred<{
      id: string;
      title: string;
      status: "done";
      projectId: string;
      isBlocked: false;
    }>();
    const secondStatusUpdate = deferred<{
      id: string;
      title: string;
      status: "todo";
      projectId: string;
      isBlocked: false;
    }>();
    const firstChildDependencyRead = deferred<{
      taskId: string;
      parents: Array<{
        id: string;
        displayKey: string;
        title: string;
        status: "review" | "done";
      }>;
      children: [];
    }>();
    let childDependencyReadCount = 0;

    listProjectTasksMock.mockResolvedValue([
      {
        id: "parent-1",
        title: "First parent",
        status: "review",
        projectId: "project-1",
        isBlocked: false,
      },
      {
        id: "parent-2",
        title: "Second parent",
        status: "done",
        projectId: "project-1",
        isBlocked: false,
      },
      {
        id: "child-1",
        title: "Child task",
        status: "todo",
        projectId: "project-1",
        blockedByCount: 2,
        isBlocked: true,
      },
    ]);
    listTaskDependenciesMock.mockImplementation((taskId: string) => {
      if (taskId === "parent-1" || taskId === "parent-2") {
        return Promise.resolve({
          taskId,
          parents: [],
          children: [
            {
              id: "child-1",
              displayKey: "PRJ-3",
              title: "Child task",
              status: "todo",
            },
          ],
        });
      }

      if (taskId === "child-1") {
        childDependencyReadCount += 1;
        if (childDependencyReadCount === 1) {
          return firstChildDependencyRead.promise;
        }

        return Promise.resolve({
          taskId,
          parents: [
            {
              id: "parent-1",
              displayKey: "PRJ-1",
              title: "First parent",
              status: "review",
            },
            {
              id: "parent-2",
              displayKey: "PRJ-2",
              title: "Second parent",
              status: "done",
            },
          ],
          children: [],
        });
      }

      return Promise.resolve({ taskId, parents: [], children: [] });
    });
    setTaskStatusMock
      .mockReturnValueOnce(firstStatusUpdate.promise)
      .mockReturnValueOnce(secondStatusUpdate.promise);

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.groupedTasks().review.length).toBe(1);
      expect(ref.current?.groupedTasks().done.length).toBe(1);
      expect(ref.current?.groupedTasks().todo.length).toBe(1);
    });

    const firstMovePromise = ref.current!.moveTaskToStatus("parent-1", "done");

    await waitFor(() => {
      expect(ref.current?.groupedTasks().done.length).toBe(2);
    });

    const secondMovePromise = ref.current!.moveTaskToStatus("parent-2", "todo");

    await waitFor(() => {
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(true);
    });

    firstChildDependencyRead.resolve({
      taskId: "child-1",
      parents: [
        {
          id: "parent-1",
          displayKey: "PRJ-1",
          title: "First parent",
          status: "review",
        },
        {
          id: "parent-2",
          displayKey: "PRJ-2",
          title: "Second parent",
          status: "done",
        },
      ],
      children: [],
    });

    await waitFor(() => {
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(true);
    });

    firstStatusUpdate.resolve({
      id: "parent-1",
      title: "First parent",
      status: "done",
      projectId: "project-1",
      isBlocked: false,
    });
    secondStatusUpdate.resolve({
      id: "parent-2",
      title: "Second parent",
      status: "todo",
      projectId: "project-1",
      isBlocked: false,
    });

    await expect(firstMovePromise).resolves.toBe(true);
    await expect(secondMovePromise).resolves.toBe(true);

    await waitFor(() => {
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(true);
    });
  });

  it("keeps unrelated dependent propagations independent", async () => {
    const firstStatusUpdate = deferred<{
      id: string;
      title: string;
      status: "todo";
      projectId: string;
      isBlocked: false;
    }>();
    const secondStatusUpdate = deferred<{
      id: string;
      title: string;
      status: "done";
      projectId: string;
      isBlocked: false;
    }>();
    const firstChildDependencyRead = deferred<TaskDependencies>();

    listProjectTasksMock.mockResolvedValue([
      {
        id: "parent-1",
        title: "First parent",
        status: "done",
        projectId: "project-1",
        isBlocked: false,
      },
      {
        id: "parent-2",
        title: "Second parent",
        status: "review",
        projectId: "project-1",
        isBlocked: false,
      },
      {
        id: "child-1",
        title: "First child",
        status: "todo",
        projectId: "project-1",
        blockedByCount: 1,
        isBlocked: false,
      },
      {
        id: "child-2",
        title: "Second child",
        status: "todo",
        projectId: "project-1",
        blockedByCount: 1,
        isBlocked: true,
      },
    ]);
    listTaskDependenciesMock.mockImplementation((taskId: string) => {
      if (taskId === "parent-1") {
        return Promise.resolve({
          taskId,
          parents: [],
          children: [
            {
              id: "child-1",
              displayKey: "PRJ-3",
              title: "First child",
              status: "todo",
            },
          ],
        });
      }

      if (taskId === "parent-2") {
        return Promise.resolve({
          taskId,
          parents: [],
          children: [
            {
              id: "child-2",
              displayKey: "PRJ-4",
              title: "Second child",
              status: "todo",
            },
          ],
        });
      }

      if (taskId === "child-1") {
        return firstChildDependencyRead.promise;
      }

      if (taskId === "child-2") {
        return Promise.resolve({
          taskId,
          parents: [
            {
              id: "parent-2",
              displayKey: "PRJ-2",
              title: "Second parent",
              status: "review",
            },
          ],
          children: [],
        });
      }

      return Promise.resolve({ taskId, parents: [], children: [] });
    });
    setTaskStatusMock
      .mockReturnValueOnce(firstStatusUpdate.promise)
      .mockReturnValueOnce(secondStatusUpdate.promise);

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.groupedTasks().done.length).toBe(1);
      expect(ref.current?.groupedTasks().review.length).toBe(1);
      expect(ref.current?.groupedTasks().todo.length).toBe(2);
    });

    const firstMovePromise = ref.current!.moveTaskToStatus("parent-1", "todo");

    await waitFor(() => {
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "parent-1")
          ?.status,
      ).toBe("todo");
    });

    const secondMovePromise = ref.current!.moveTaskToStatus("parent-2", "done");

    await waitFor(() => {
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-2")
          ?.isBlocked,
      ).toBe(false);
    });

    firstChildDependencyRead.resolve({
      taskId: "child-1",
      parents: [
        {
          id: "parent-1",
          displayKey: "PRJ-1",
          title: "First parent",
          status: "done",
        },
      ],
      children: [],
    });

    await waitFor(() => {
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(true);
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-2")
          ?.isBlocked,
      ).toBe(false);
    });

    firstStatusUpdate.resolve({
      id: "parent-1",
      title: "First parent",
      status: "todo",
      projectId: "project-1",
      isBlocked: false,
    });
    secondStatusUpdate.resolve({
      id: "parent-2",
      title: "Second parent",
      status: "done",
      projectId: "project-1",
      isBlocked: false,
    });

    await expect(firstMovePromise).resolves.toBe(true);
    await expect(secondMovePromise).resolves.toBe(true);

    await waitFor(() => {
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(true);
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-2")
          ?.isBlocked,
      ).toBe(false);
    });
  });

  it("does not repopulate cleared dependency cache from stale in-flight reads", async () => {
    const firstParentUpdate = deferred<{
      id: string;
      title: string;
      status: "todo";
      projectId: string;
      isBlocked: false;
    }>();
    const secondParentUpdate = deferred<{
      id: string;
      title: string;
      status: "todo";
      projectId: string;
      isBlocked: false;
    }>();
    const firstChildDependencyRead = deferred<TaskDependencies>();
    let childDependencyReadCount = 0;

    listProjectsMock.mockResolvedValue([
      { id: "project-1", name: "Alpha", key: "ALP" },
      { id: "project-2", name: "Beta", key: "BET" },
    ]);
    getProjectMock.mockImplementation(async (projectId: string) => ({
      id: projectId,
      name: projectId === "project-2" ? "Beta" : "Alpha",
      key: projectId === "project-2" ? "BET" : "ALP",
      repositories: [],
    }));
    listProjectTasksMock.mockImplementation(async (projectId: string) => {
      if (projectId === "project-2") {
        return [
          {
            id: "task-2",
            title: "Project two task",
            status: "todo",
            projectId,
            isBlocked: false,
          },
        ];
      }

      return [
        {
          id: "parent-1",
          title: "First parent",
          status: "done",
          projectId,
          isBlocked: false,
        },
        {
          id: "parent-2",
          title: "Second parent",
          status: "done",
          projectId,
          isBlocked: false,
        },
        {
          id: "child-1",
          title: "Child task",
          status: "todo",
          projectId,
          blockedByCount: 2,
          isBlocked: false,
        },
      ];
    });
    listTaskDependenciesMock.mockImplementation((taskId: string) => {
      if (taskId === "parent-1" || taskId === "parent-2") {
        return Promise.resolve({
          taskId,
          parents: [],
          children: [
            {
              id: "child-1",
              displayKey: "PRJ-3",
              title: "Child task",
              status: "todo",
            },
          ],
        });
      }

      if (taskId === "child-1") {
        childDependencyReadCount += 1;
        if (childDependencyReadCount === 1) {
          return firstChildDependencyRead.promise;
        }

        return Promise.resolve({
          taskId,
          parents: [
            {
              id: "parent-1",
              displayKey: "PRJ-1",
              title: "First parent",
              status: "done",
            },
            {
              id: "parent-2",
              displayKey: "PRJ-2",
              title: "Second parent",
              status: "done",
            },
          ],
          children: [],
        });
      }

      return Promise.resolve({ taskId, parents: [], children: [] });
    });
    setTaskStatusMock
      .mockReturnValueOnce(firstParentUpdate.promise)
      .mockReturnValueOnce(secondParentUpdate.promise);

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.groupedTasks().done.length).toBe(2);
      expect(ref.current?.groupedTasks().todo.length).toBe(1);
    });

    void ref.current!.moveTaskToStatus("parent-1", "todo");

    await waitFor(() => {
      expect(childDependencyReadCount).toBe(1);
    });

    await ref.current!.onProjectChange("project-2");
    await waitFor(() => {
      expect(ref.current?.selectedProjectId()).toBe("project-2");
      expect(ref.current?.groupedTasks().todo.length).toBe(1);
      expect(ref.current?.groupedTasks().done.length).toBe(0);
    });

    firstChildDependencyRead.resolve({
      taskId: "child-1",
      parents: [
        {
          id: "parent-1",
          displayKey: "PRJ-1",
          title: "First parent",
          status: "done",
        },
        {
          id: "parent-2",
          displayKey: "PRJ-2",
          title: "Second parent",
          status: "done",
        },
      ],
      children: [],
    });

    await ref.current!.onProjectChange("project-1");
    await waitFor(() => {
      expect(ref.current?.selectedProjectId()).toBe("project-1");
      expect(ref.current?.groupedTasks().done.length).toBe(2);
    });

    void ref.current!.moveTaskToStatus("parent-2", "todo");

    await waitFor(() => {
      expect(childDependencyReadCount).toBe(2);
    });
  });

  it("rolls back dependent blocked state when the parent move fails", async () => {
    const pendingStatusUpdate = deferred<never>();
    listProjectTasksMock.mockResolvedValue([
      {
        id: "parent-1",
        title: "Parent task",
        status: "done",
        projectId: "project-1",
        isBlocked: false,
      },
      {
        id: "child-1",
        title: "Child task",
        status: "todo",
        projectId: "project-1",
        blockedByCount: 1,
        isBlocked: false,
      },
    ]);
    listTaskDependenciesMock.mockImplementation((taskId: string) => {
      if (taskId === "parent-1") {
        return Promise.resolve({
          taskId,
          parents: [],
          children: [
            {
              id: "child-1",
              displayKey: "PRJ-2",
              title: "Child task",
              status: "todo",
            },
          ],
        });
      }

      if (taskId === "child-1") {
        return Promise.resolve({
          taskId,
          parents: [
            {
              id: "parent-1",
              displayKey: "PRJ-1",
              title: "Parent task",
              status: "done",
            },
          ],
          children: [],
        });
      }

      return Promise.resolve({ taskId, parents: [], children: [] });
    });
    setTaskStatusMock.mockReturnValue(pendingStatusUpdate.promise);

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.groupedTasks().done.length).toBe(1);
      expect(ref.current?.groupedTasks().todo.length).toBe(1);
    });

    const movePromise = ref.current!.moveTaskToStatus("parent-1", "todo");

    await waitFor(() => {
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(true);
    });

    pendingStatusUpdate.reject(new Error("save failed"));

    await expect(movePromise).resolves.toBe(false);

    await waitFor(() => {
      expect(ref.current?.groupedTasks().done.length).toBe(1);
      expect(
        ref.current?.groupedTasks().todo.find((task) => task.id === "child-1")
          ?.isBlocked,
      ).toBe(false);
      expect(ref.current?.error()).toBe(
        "Failed to update task status. Please try again.",
      );
    });
  });

  it("removes deleted run mini-cards from active task surfaces", async () => {
    listProjectTasksMock.mockResolvedValue([
      {
        id: "task-1",
        title: "Task",
        status: "doing",
        projectId: "project-1",
      },
    ]);
    listTaskRunsMock.mockResolvedValue([
      {
        id: "run-1",
        taskId: "task-1",
        projectId: "project-1",
        status: "in_progress",
        runState: "busy_coding",
        triggeredBy: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.taskRunMiniCards()["task-1"]?.[0]?.runId).toBe(
        "run-1",
      );
    });

    runDeletedListener?.({
      runId: "run-1",
      timestamp: "2026-01-01T00:00:03.000Z",
    });

    await waitFor(() => {
      expect(ref.current?.taskRunMiniCards()["task-1"]).toBeUndefined();
    });
  });

  it("keeps deleted runs filtered during board task refresh", async () => {
    const activeRun = {
      id: "run-1",
      taskId: "task-1",
      projectId: "project-1",
      status: "in_progress",
      runState: "busy_coding",
      triggeredBy: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    listProjectTasksMock.mockResolvedValue([
      {
        id: "task-1",
        title: "Task",
        status: "doing",
        projectId: "project-1",
      },
    ]);
    listTaskRunsMock.mockResolvedValue([activeRun]);

    const ref: { current: ReturnType<typeof useBoardModel> | null } = {
      current: null,
    };
    render(() => {
      ref.current = useBoardModel();
      return <div />;
    });

    await waitFor(() => {
      expect(ref.current?.taskRunMiniCards()["task-1"]?.[0]?.runId).toBe(
        "run-1",
      );
    });

    runDeletedListener?.({
      runId: "run-1",
      timestamp: "2026-01-01T00:00:03.000Z",
    });

    await waitFor(() => {
      expect(ref.current?.taskRunMiniCards()["task-1"]).toBeUndefined();
    });

    await ref.current?.refreshSelectedProjectTasks();

    await waitFor(() => {
      expect(ref.current?.taskRunMiniCards()["task-1"]).toBeUndefined();
    });
  });
});
