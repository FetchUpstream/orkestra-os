import { render, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, beforeEach, vi } from "vitest";
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

describe("useRunDetailModel auto initial prompt", () => {
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
    submitRunOpenCodePromptMock.mockResolvedValue({ status: "accepted" });
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
      title: "Ship release notes",
      description: "Draft changelog and verify links.",
      implementationGuide: "Use the release template.",
      status: "doing",
      projectId: "project-1",
    });
  });

  it("sends once when backend is ready", async () => {
    render(() => {
      useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(submitRunOpenCodePromptMock).toHaveBeenCalledTimes(1);
    });

    expect(submitRunOpenCodePromptMock).toHaveBeenCalledWith({
      runId: "run-1",
      prompt:
        "Ship release notes\n\nDraft changelog and verify links.\n\nImplementation guide:\nUse the release template.",
      clientRequestId: "initial-run-message:run-1",
    });
  });

  it("does not duplicate send after repeated ready/reconnect bootstrap", async () => {
    const modelRef: {
      current: {
        agent: {
          ensureAgentForRun: (runId: string) => Promise<void>;
          subscribeAgentEvents: (runId: string) => Promise<void>;
        };
      } | null;
    } = { current: null };
    render(() => {
      modelRef.current = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(submitRunOpenCodePromptMock).toHaveBeenCalledTimes(1);
    });

    await modelRef.current?.agent.ensureAgentForRun("run-1");
    await modelRef.current?.agent.subscribeAgentEvents("run-1");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submitRunOpenCodePromptMock).toHaveBeenCalledTimes(1);
  });

  it("resets and sends for a new run", async () => {
    const first = render(() => {
      useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(submitRunOpenCodePromptMock).toHaveBeenCalledTimes(1);
    });

    first.unmount();
    routeState.runId = "run-2";
    getRunMock.mockResolvedValueOnce({
      id: "run-2",
      taskId: "task-2",
      projectId: "project-1",
      status: "running",
      triggeredBy: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      finishedAt: null,
      summary: null,
      errorMessage: null,
      sourceBranch: "main",
      worktreeId: "wt-2",
      targetRepoId: "repo-1",
      displayKey: "RUN-2",
      initialPromptSentAt: null,
      initialPromptClientRequestId: null,
    });
    getTaskMock.mockResolvedValueOnce({
      id: "task-2",
      title: "Implement queue drain",
      description: "",
      implementationGuide: "",
      status: "doing",
      projectId: "project-1",
    });

    render(() => {
      useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(submitRunOpenCodePromptMock).toHaveBeenCalledTimes(2);
    });
    expect(submitRunOpenCodePromptMock).toHaveBeenLastCalledWith({
      runId: "run-2",
      prompt: "Implement queue drain",
      clientRequestId: "initial-run-message:run-2",
    });
  });

  it("composes fields and falls back when all are missing", async () => {
    getTaskMock.mockResolvedValueOnce({
      id: "task-1",
      title: "   ",
      description: "\n\nLine one\n\n\n\nLine two\n",
      implementationGuide: "\n\nStep A\n\n\n\nStep B\n",
      status: "doing",
      projectId: "project-1",
    });

    const first = render(() => {
      useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(submitRunOpenCodePromptMock).toHaveBeenCalledTimes(1);
    });
    expect(submitRunOpenCodePromptMock).toHaveBeenLastCalledWith({
      runId: "run-1",
      prompt: "Line one\n\nLine two\n\nImplementation guide:\nStep A\n\nStep B",
      clientRequestId: "initial-run-message:run-1",
    });

    first.unmount();
    routeState.runId = "run-2";
    getRunMock.mockResolvedValueOnce({
      id: "run-2",
      taskId: "task-2",
      projectId: "project-1",
      status: "running",
      triggeredBy: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      finishedAt: null,
      summary: null,
      errorMessage: null,
      sourceBranch: "main",
      worktreeId: "wt-2",
      targetRepoId: "repo-1",
      displayKey: "RUN-2",
      initialPromptSentAt: null,
      initialPromptClientRequestId: null,
    });
    getTaskMock.mockResolvedValueOnce({
      id: "task-2",
      title: "   ",
      description: "\n\n",
      implementationGuide: "\n",
      status: "doing",
      projectId: "project-1",
    });

    render(() => {
      useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(submitRunOpenCodePromptMock).toHaveBeenCalledTimes(2);
    });
    expect(submitRunOpenCodePromptMock).toHaveBeenLastCalledWith({
      runId: "run-2",
      prompt: "Please continue with the current task.",
      clientRequestId: "initial-run-message:run-2",
    });
  });

  it("does not auto-send when readiness is not ready", async () => {
    subscribeRunOpenCodeEventsMock.mockImplementationOnce(
      () => new Promise<() => void>(() => undefined),
    );
    bootstrapRunOpenCodeMock.mockResolvedValueOnce({
      state: "starting",
      bufferedEvents: [],
      messages: [],
      todos: [],
      streamConnected: false,
      readyPhase: "warming_backend",
    });

    render(() => {
      useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(getRunMock).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submitRunOpenCodePromptMock).not.toHaveBeenCalled();
  });

  it("does not auto-send when run status is not running", async () => {
    getRunMock.mockResolvedValueOnce({
      id: "run-1",
      taskId: "task-1",
      projectId: "project-1",
      status: "completed",
      triggeredBy: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      summary: null,
      errorMessage: null,
      sourceBranch: "main",
      worktreeId: "wt-1",
      targetRepoId: "repo-1",
      displayKey: "RUN-1",
      initialPromptSentAt: null,
      initialPromptClientRequestId: null,
    });

    render(() => {
      useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(getRunMock).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submitRunOpenCodePromptMock).not.toHaveBeenCalled();
  });

  it("does not mark failed auto-send as sent and retries when ready again", async () => {
    submitRunOpenCodePromptMock.mockResolvedValueOnce({
      status: "rejected",
      reason: "transient failure",
    });

    const modelRef: {
      current: {
        agent: {
          ensureAgentForRun: (runId: string) => Promise<void>;
          subscribeAgentEvents: (runId: string) => Promise<void>;
        };
      } | null;
    } = { current: null };

    render(() => {
      modelRef.current = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(submitRunOpenCodePromptMock).toHaveBeenCalledTimes(1);
    });

    submitRunOpenCodePromptMock.mockResolvedValueOnce({ status: "accepted" });
    await modelRef.current?.agent.ensureAgentForRun("run-1");
    await modelRef.current?.agent.subscribeAgentEvents("run-1");

    await waitFor(() => {
      expect(submitRunOpenCodePromptMock).toHaveBeenCalledTimes(2);
    });
  });

  it("does not auto-send on remount when run already has persisted sent flag", async () => {
    const first = render(() => {
      useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(submitRunOpenCodePromptMock).toHaveBeenCalledTimes(1);
    });

    first.unmount();
    getRunMock.mockResolvedValueOnce({
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
      initialPromptSentAt: "2026-01-01T00:00:10.000Z",
      initialPromptClientRequestId: "initial-run-message:run-1",
    });

    render(() => {
      useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(getRunMock).toHaveBeenCalledTimes(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submitRunOpenCodePromptMock).toHaveBeenCalledTimes(1);
  });
});
