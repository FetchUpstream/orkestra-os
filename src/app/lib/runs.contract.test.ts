import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRun,
  getRun,
  listTaskRuns,
  type Run,
  type RunStatus,
} from "./runs";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("runs contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes create_run with taskId argument", async () => {
    invokeMock.mockResolvedValue({
      id: "run-1",
      task_id: "task-1",
      project_id: "project-1",
      status: "queued" satisfies RunStatus,
      triggered_by: "user",
      created_at: "2026-01-01T00:00:00.000Z",
    });

    await createRun("task-1");

    expect(invokeMock).toHaveBeenCalledWith("create_run", {
      taskId: "task-1",
    });
  });

  it("normalizes list_task_runs response for snake_case and camelCase variants", async () => {
    invokeMock.mockResolvedValue([
      {
        id: "run-snake",
        task_id: "task-1",
        project_id: "project-1",
        target_repo_id: "repo-1",
        status: "running" satisfies RunStatus,
        triggered_by: "user",
        created_at: "2026-01-01T00:00:00.000Z",
        started_at: "2026-01-01T00:00:10.000Z",
        finished_at: null,
        summary: null,
        error_message: null,
        worktree_id: null,
        agent_id: null,
      },
      {
        id: "run-camel",
        taskId: "task-1",
        projectId: "project-1",
        targetRepoId: "repo-1",
        status: "completed" satisfies RunStatus,
        triggeredBy: "system",
        createdAt: "2026-01-02T00:00:00.000Z",
        startedAt: "2026-01-02T00:00:10.000Z",
        finishedAt: "2026-01-02T00:05:00.000Z",
        summary: "Done",
        errorMessage: null,
        worktreeId: "wt-1",
        agentId: "agent-1",
      },
    ]);

    const runs = await listTaskRuns("task-1");

    expect(invokeMock).toHaveBeenCalledWith("list_task_runs", {
      taskId: "task-1",
    });
    expect(runs).toEqual([
      {
        id: "run-snake",
        taskId: "task-1",
        projectId: "project-1",
        targetRepoId: "repo-1",
        status: "running",
        triggeredBy: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:10.000Z",
        finishedAt: null,
        summary: null,
        errorMessage: null,
        worktreeId: null,
        agentId: null,
      },
      {
        id: "run-camel",
        taskId: "task-1",
        projectId: "project-1",
        targetRepoId: "repo-1",
        status: "completed",
        triggeredBy: "system",
        createdAt: "2026-01-02T00:00:00.000Z",
        startedAt: "2026-01-02T00:00:10.000Z",
        finishedAt: "2026-01-02T00:05:00.000Z",
        summary: "Done",
        errorMessage: null,
        worktreeId: "wt-1",
        agentId: "agent-1",
      },
    ] satisfies Run[]);
  });

  it("normalizes get_run and coerces unknown statuses", async () => {
    invokeMock.mockResolvedValue({
      id: "run-404",
      task_id: "task-1",
      project_id: "project-1",
      status: "unknown",
      triggered_by: "user",
      created_at: "2026-01-01T00:00:00.000Z",
      error_message: "oops",
    });

    const run = await getRun("run-404");

    expect(invokeMock).toHaveBeenCalledWith("get_run", { runId: "run-404" });
    expect(run.status).toBe("queued");
    expect(run.errorMessage).toBe("oops");
  });
});
