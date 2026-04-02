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
import {
  createTask,
  listTaskDependencies,
  listProjectTasks,
  setTaskStatus,
  updateTask,
  type CreateTaskInput,
  type Task,
  type TaskStatus,
} from "./tasks";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("tasks contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("sends repository_id in create_task payload", async () => {
    invokeMock.mockResolvedValue({
      id: "task-123",
      title: "New task",
      status: "todo" satisfies TaskStatus,
      project_id: "project-1",
      repository_id: "repo-1",
      implementation_guide: "Follow checklist",
    });

    const input: CreateTaskInput = {
      projectId: "project-1",
      title: "New task",
      status: "todo",
      targetRepositoryId: "repo-1",
      implementationGuide: "Follow checklist",
    };

    await createTask(input);

    expect(invokeMock).toHaveBeenCalledWith("create_task", {
      input: {
        project_id: "project-1",
        title: "New task",
        description: undefined,
        implementation_guide: "Follow checklist",
        status: "todo",
        repository_id: "repo-1",
      },
    });
  });

  it("normalizes list_project_tasks response for snake_case and camelCase variants", async () => {
    invokeMock.mockResolvedValue([
      {
        id: "task-snake",
        title: "Snake",
        description: "Snake description",
        implementation_guide: "Use migrations first",
        status: "doing" satisfies TaskStatus,
        blocked_by_count: 2,
        is_blocked: true,
        task_number: 12,
        display_key: "ORK-12",
        project_id: "project-1",
        target_repository_id: "repo-1",
        target_repository_name: "Main",
        target_repository_path: "/repo/main",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "task-camel",
        title: "Camel",
        description: "Camel description",
        implementationGuide: "Keep API stable",
        status: "review" satisfies TaskStatus,
        blockedByCount: 1,
        isBlocked: false,
        taskNumber: 13,
        displayKey: "ORK-13",
        projectId: "project-1",
        targetRepositoryId: "repo-2",
        targetRepositoryName: "Tools",
        targetRepositoryPath: "/repo/tools",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);

    const tasks = await listProjectTasks("project-1");

    expect(invokeMock).toHaveBeenCalledWith("list_project_tasks", {
      projectId: "project-1",
    });
    expect(tasks).toEqual([
      {
        id: "task-snake",
        title: "Snake",
        description: "Snake description",
        implementationGuide: "Use migrations first",
        status: "doing",
        blockedByCount: 2,
        isBlocked: true,
        taskNumber: 12,
        displayKey: "ORK-12",
        projectId: "project-1",
        targetRepositoryId: "repo-1",
        targetRepositoryName: "Main",
        targetRepositoryPath: "/repo/main",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "task-camel",
        title: "Camel",
        description: "Camel description",
        implementationGuide: "Keep API stable",
        status: "review",
        blockedByCount: 1,
        isBlocked: false,
        taskNumber: 13,
        displayKey: "ORK-13",
        projectId: "project-1",
        targetRepositoryId: "repo-2",
        targetRepositoryName: "Tools",
        targetRepositoryPath: "/repo/tools",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ] satisfies Task[]);
  });

  it("normalizes list_task_dependencies response for snake_case and camelCase variants", async () => {
    invokeMock.mockResolvedValue({
      task_id: "task-123",
      parents: [
        {
          id: "task-parent-1",
          display_key: "ORK-1",
          title: "Parent task",
          status: "done" satisfies TaskStatus,
          target_repository_name: "Main",
          target_repository_path: "/repo/main",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      children: [
        {
          id: "task-child-1",
          displayKey: "ORK-2",
          title: "Child task",
          status: "todo" satisfies TaskStatus,
          targetRepositoryName: "Tools",
          targetRepositoryPath: "/repo/tools",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });

    const dependencies = await listTaskDependencies("task-123");

    expect(invokeMock).toHaveBeenCalledWith("list_task_dependencies", {
      taskId: "task-123",
    });
    expect(dependencies).toEqual({
      taskId: "task-123",
      parents: [
        {
          id: "task-parent-1",
          displayKey: "ORK-1",
          title: "Parent task",
          status: "done",
          targetRepositoryName: "Main",
          targetRepositoryPath: "/repo/main",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      children: [
        {
          id: "task-child-1",
          displayKey: "ORK-2",
          title: "Child task",
          status: "todo",
          targetRepositoryName: "Tools",
          targetRepositoryPath: "/repo/tools",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
  });

  it("falls back to requested task id when list_task_dependencies omits task id", async () => {
    invokeMock.mockResolvedValue({
      parents: [],
      children: [],
    });

    const dependencies = await listTaskDependencies("task-fallback");

    expect(invokeMock).toHaveBeenCalledWith("list_task_dependencies", {
      taskId: "task-fallback",
    });
    expect(dependencies).toEqual({
      taskId: "task-fallback",
      parents: [],
      children: [],
    });
  });

  it("sends status update payload in set_task_status command", async () => {
    invokeMock.mockResolvedValue({
      id: "task-123",
      title: "Task",
      status: "doing" satisfies TaskStatus,
    });

    await setTaskStatus("task-123", { status: "doing" });

    expect(invokeMock).toHaveBeenCalledWith("set_task_status", {
      id: "task-123",
      input: { status: "doing", source_action: undefined },
    });
  });

  it("sends board source_action in set_task_status command", async () => {
    invokeMock.mockResolvedValue({
      id: "task-123",
      title: "Task",
      status: "doing" satisfies TaskStatus,
    });

    await setTaskStatus("task-123", {
      status: "doing",
      sourceAction: "board_manual_move",
    });

    expect(invokeMock).toHaveBeenCalledWith("set_task_status", {
      id: "task-123",
      input: { status: "doing", source_action: "board_manual_move" },
    });
  });

  it("sends implementation guide in update_task payload", async () => {
    invokeMock.mockResolvedValue({
      id: "task-123",
      title: "Task",
      description: "Task description",
      implementation_guide: "Follow the rollout checklist",
      status: "todo" satisfies TaskStatus,
    });

    await updateTask("task-123", {
      title: "Task",
      description: "Task description",
      implementationGuide: "Follow the rollout checklist",
    });

    expect(invokeMock).toHaveBeenCalledWith("update_task", {
      id: "task-123",
      input: {
        title: "Task",
        description: "Task description",
        implementation_guide: "Follow the rollout checklist",
      },
    });
  });
});
