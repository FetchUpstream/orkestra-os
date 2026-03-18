import { render, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRunDetailModel } from "../useRunDetailModel";

const {
  routeState,
  bootstrapRunOpenCodeMock,
  subscribeRunOpenCodeEventsMock,
  unsubscribeRunOpenCodeEventsMock,
  submitRunOpenCodePromptMock,
  getRunMock,
  getTaskMock,
} = vi.hoisted(() => ({
  routeState: { runId: "run-1" },
  bootstrapRunOpenCodeMock: vi.fn(),
  subscribeRunOpenCodeEventsMock: vi.fn(),
  unsubscribeRunOpenCodeEventsMock: vi.fn(),
  submitRunOpenCodePromptMock: vi.fn(),
  getRunMock: vi.fn(),
  getTaskMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useParams: () => ({
    get runId() {
      return routeState.runId;
    },
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));

vi.mock("../../../../app/lib/runs", () => ({
  bootstrapRunOpenCode: bootstrapRunOpenCodeMock,
  appendCappedHistory: (current: unknown[], next: unknown[]) => [
    ...current,
    ...next,
  ],
  getRun: getRunMock,
  getRunDiffFile: vi.fn(),
  killRunTerminal: vi.fn(async () => undefined),
  listRunDiffFiles: vi.fn(async () => []),
  openRunTerminal: vi.fn(async () => ({
    sessionId: "terminal-1",
    generation: 1,
  })),
  resizeRunTerminal: vi.fn(async () => undefined),
  setRunDiffWatch: vi.fn(async () => undefined),
  submitRunOpenCodePrompt: submitRunOpenCodePromptMock,
  subscribeRunOpenCodeEvents: subscribeRunOpenCodeEventsMock,
  unsubscribeRunOpenCodeEvents: unsubscribeRunOpenCodeEventsMock,
  writeRunTerminal: vi.fn(async () => undefined),
}));

vi.mock("../../../../app/lib/tasks", () => ({
  getTask: getTaskMock,
}));

describe("useRunDetailModel startup ownership", () => {
  beforeEach(() => {
    routeState.runId = "run-1";
    bootstrapRunOpenCodeMock.mockReset();
    subscribeRunOpenCodeEventsMock.mockReset();
    unsubscribeRunOpenCodeEventsMock.mockReset();
    submitRunOpenCodePromptMock.mockReset();
    getRunMock.mockReset();
    getTaskMock.mockReset();

    bootstrapRunOpenCodeMock.mockResolvedValue({
      state: "running",
      bufferedEvents: [],
      messages: [],
      todos: [],
      streamConnected: true,
    });
    subscribeRunOpenCodeEventsMock.mockResolvedValue(() => undefined);
    unsubscribeRunOpenCodeEventsMock.mockResolvedValue(undefined);
    getRunMock.mockResolvedValue({
      id: "run-1",
      taskId: "task-1",
      projectId: "project-1",
      status: "running",
      triggeredBy: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      finishedAt: null,
      summary: null,
      errorMessage: null,
      sourceBranch: "main",
      worktreeId: "wt-1",
      targetRepoId: "repo-1",
      displayKey: "RUN-1",
      initialPromptSentAt: null,
      initialPromptClientRequestId: null,
    });
    getTaskMock.mockResolvedValue({
      id: "task-1",
      title: "Task",
      description: "Description",
      implementationGuide: "Guide",
      status: "doing",
      projectId: "project-1",
    });
  });

  it("boots and subscribes for observation without auto-seeding", async () => {
    render(() => {
      useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(bootstrapRunOpenCodeMock).toHaveBeenCalledWith("run-1");
      expect(subscribeRunOpenCodeEventsMock).toHaveBeenCalledTimes(1);
    });

    expect(submitRunOpenCodePromptMock).not.toHaveBeenCalled();
  });
});
