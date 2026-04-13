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

describe("useBoardModel run settings defaults", () => {
  beforeEach(() => {
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
      expect(ref.current?.blockingStartTasks()).toEqual([
        {
          id: "task-2",
          displayKey: "PRJ-2",
          title: "Finalize schema",
          status: "doing",
        },
      ]);
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

  it("removes deleted run mini-cards from active task surfaces", async () => {
    listProjectTasksMock.mockResolvedValueOnce([
      {
        id: "task-1",
        title: "Task",
        status: "doing",
        projectId: "project-1",
      },
    ]);
    listTaskRunsMock.mockResolvedValueOnce([
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

    listProjectTasksMock.mockResolvedValueOnce([
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
