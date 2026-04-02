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
  listProjectTasksMock,
  searchProjectTasksMock,
  listTaskRunsMock,
  getRunSelectionOptionsWithCacheMock,
  readRunSelectionOptionsCacheMock,
} = vi.hoisted(() => ({
  listProjectsMock: vi.fn(),
  getProjectMock: vi.fn(),
  listProjectTasksMock: vi.fn(),
  searchProjectTasksMock: vi.fn(),
  listTaskRunsMock: vi.fn(),
  getRunSelectionOptionsWithCacheMock: vi.fn(),
  readRunSelectionOptionsCacheMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));

vi.mock("../../../../app/lib/projects", () => ({
  listProjects: listProjectsMock,
  getProject: getProjectMock,
}));

vi.mock("../../../../app/lib/tasks", () => ({
  listProjectTasks: listProjectTasksMock,
  searchProjectTasks: searchProjectTasksMock,
  setTaskStatus: vi.fn(),
}));

vi.mock("../../../../app/lib/runs", () => ({
  createRun: vi.fn(),
  listTaskRuns: listTaskRunsMock,
  startRunOpenCode: vi.fn(),
}));

vi.mock("../../../../app/lib/runSelectionOptionsCache", () => ({
  getRunSelectionOptionsWithCache: getRunSelectionOptionsWithCacheMock,
  readRunSelectionOptionsCache: readRunSelectionOptionsCacheMock,
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
    listProjectTasksMock.mockReset();
    searchProjectTasksMock.mockReset();
    listTaskRunsMock.mockReset();
    getRunSelectionOptionsWithCacheMock.mockReset();
    readRunSelectionOptionsCacheMock.mockReset();

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
    searchProjectTasksMock.mockResolvedValue([]);
    listTaskRunsMock.mockResolvedValue([]);
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
});
