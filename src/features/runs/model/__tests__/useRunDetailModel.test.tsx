import { render, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRunDetailModel } from "../useRunDetailModel";

const deferred = function <T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const {
  routeState,
  navigateMock,
  bootstrapRunOpenCodeMock,
  subscribeRunOpenCodeEventsMock,
  unsubscribeRunOpenCodeEventsMock,
  submitRunOpenCodePromptMock,
  getRunGitMergeStatusMock,
  rebaseRunWorktreeOntoSourceMock,
  mergeRunWorktreeIntoSourceMock,
  writeRunTerminalMock,
  getRunMock,
  getTaskMock,
} = vi.hoisted(() => ({
  routeState: { runId: "run-1" },
  navigateMock: vi.fn(),
  bootstrapRunOpenCodeMock: vi.fn(),
  subscribeRunOpenCodeEventsMock: vi.fn(),
  unsubscribeRunOpenCodeEventsMock: vi.fn(),
  submitRunOpenCodePromptMock: vi.fn(),
  getRunGitMergeStatusMock: vi.fn(),
  rebaseRunWorktreeOntoSourceMock: vi.fn(),
  mergeRunWorktreeIntoSourceMock: vi.fn(),
  writeRunTerminalMock: vi.fn(),
  getRunMock: vi.fn(),
  getTaskMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
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
  appendCappedHistory: (current: unknown[], next: unknown[] | unknown) => [
    ...current,
    ...(Array.isArray(next) ? next : [next]),
  ],
  getRun: getRunMock,
  getRunGitMergeStatus: getRunGitMergeStatusMock,
  getRunDiffFile: vi.fn(),
  killRunTerminal: vi.fn(async () => undefined),
  listRunDiffFiles: vi.fn(async () => []),
  mergeRunWorktreeIntoSource: mergeRunWorktreeIntoSourceMock,
  openRunTerminal: vi.fn(async () => ({
    sessionId: "terminal-1",
    generation: 1,
  })),
  rebaseRunWorktreeOntoSource: rebaseRunWorktreeOntoSourceMock,
  resizeRunTerminal: vi.fn(async () => undefined),
  setRunDiffWatch: vi.fn(async () => undefined),
  submitRunOpenCodePrompt: submitRunOpenCodePromptMock,
  subscribeRunOpenCodeEvents: subscribeRunOpenCodeEventsMock,
  unsubscribeRunOpenCodeEvents: unsubscribeRunOpenCodeEventsMock,
  writeRunTerminal: writeRunTerminalMock,
}));

vi.mock("../../../../app/lib/tasks", () => ({
  getTask: getTaskMock,
}));

describe("useRunDetailModel startup ownership", () => {
  beforeEach(() => {
    vi.useRealTimers();
    routeState.runId = "run-1";
    navigateMock.mockReset();
    bootstrapRunOpenCodeMock.mockReset();
    subscribeRunOpenCodeEventsMock.mockReset();
    unsubscribeRunOpenCodeEventsMock.mockReset();
    submitRunOpenCodePromptMock.mockReset();
    getRunGitMergeStatusMock.mockReset();
    rebaseRunWorktreeOntoSourceMock.mockReset();
    mergeRunWorktreeIntoSourceMock.mockReset();
    writeRunTerminalMock.mockReset();
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
    getRunGitMergeStatusMock.mockResolvedValue({
      state: "ready",
      sourceBranch: { name: "main", ahead: 0, behind: 0 },
      worktreeBranch: { name: "wt", ahead: 0, behind: 0 },
      isRebaseAllowed: true,
      isMergeAllowed: true,
      requiresRebase: false,
    });
    rebaseRunWorktreeOntoSourceMock.mockResolvedValue({ status: "accepted" });
    mergeRunWorktreeIntoSourceMock.mockResolvedValue({ status: "accepted" });
    writeRunTerminalMock.mockResolvedValue(undefined);
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

  it("sends conflict summary into chat once per fingerprint", async () => {
    rebaseRunWorktreeOntoSourceMock
      .mockResolvedValueOnce({
        status: "conflict",
        conflictSummary: "Resolve file conflicts in src/app.ts",
        conflictFingerprint: "fp-1",
      })
      .mockResolvedValueOnce({
        status: "conflict",
        conflictSummary: "Resolve file conflicts in src/app.ts",
        conflictFingerprint: "fp-1",
      });
    submitRunOpenCodePromptMock.mockResolvedValue({
      status: "accepted",
      queuedAt: "2026-01-01T00:00:00.000Z",
    });

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    await modelRef!.git.rebaseWorktreeOntoSource();
    await modelRef!.git.rebaseWorktreeOntoSource();

    expect(submitRunOpenCodePromptMock).toHaveBeenCalledTimes(1);
    expect(submitRunOpenCodePromptMock).toHaveBeenCalledWith({
      runId: "run-1",
      prompt: "Resolve file conflicts in src/app.ts",
      clientRequestId: undefined,
    });
  });

  it("surfaces backend validation message when rebase throws", async () => {
    rebaseRunWorktreeOntoSourceMock.mockRejectedValueOnce(
      new Error("Worktree has uncommitted changes; commit or stash first."),
    );

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    await modelRef!.git.rebaseWorktreeOntoSource();

    expect(modelRef!.git.actionError()).toBe(
      "Worktree has uncommitted changes; commit or stash first.",
    );
  });

  it("falls back to generic message when merge throw has no message", async () => {
    mergeRunWorktreeIntoSourceMock.mockRejectedValueOnce({});

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    await modelRef!.git.mergeWorktreeIntoSource();

    expect(modelRef!.git.actionError()).toBe(
      "Failed to merge worktree branch.",
    );
  });

  it("redirects to board only after confirmed completed run and done task", async () => {
    vi.useFakeTimers();
    getRunMock
      .mockResolvedValueOnce({
        id: "run-1",
        taskId: "task-1",
        projectId: "project-1",
        status: "running",
        triggeredBy: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "run-1",
        taskId: "task-1",
        projectId: "project-1",
        status: "completed",
        triggeredBy: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    getTaskMock
      .mockResolvedValueOnce({
        id: "task-1",
        title: "Task",
        description: "Description",
        implementationGuide: "Guide",
        status: "doing",
        projectId: "project-1",
      })
      .mockResolvedValueOnce({
        id: "task-1",
        title: "Task",
        description: "Description",
        implementationGuide: "Guide",
        status: "done",
        projectId: "project-1",
      });
    mergeRunWorktreeIntoSourceMock.mockResolvedValueOnce({ status: "merged" });

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    await modelRef!.git.mergeWorktreeIntoSource();

    expect(modelRef!.postMergeCompletionMessage()).toBe(
      "Merge completed. Returning to board...",
    );
    expect(navigateMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);

    expect(navigateMock).toHaveBeenCalledWith("/board?projectId=project-1", {
      replace: true,
    });
  });

  it("does not redirect when merge is conflict or failed", async () => {
    vi.useFakeTimers();
    mergeRunWorktreeIntoSourceMock.mockResolvedValueOnce({
      status: "conflict",
    });

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    await modelRef!.git.mergeWorktreeIntoSource();
    await vi.advanceTimersByTimeAsync(1500);
    expect(navigateMock).not.toHaveBeenCalled();

    mergeRunWorktreeIntoSourceMock.mockResolvedValueOnce({ status: "failed" });
    await modelRef!.git.mergeWorktreeIntoSource();
    await vi.advanceTimersByTimeAsync(1500);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("blocks terminal writes when run is completed", async () => {
    getRunMock.mockResolvedValueOnce({
      id: "run-1",
      taskId: "task-1",
      projectId: "project-1",
      status: "completed",
      triggeredBy: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    await modelRef!.terminal.writeTerminal("pwd");

    expect(writeRunTerminalMock).not.toHaveBeenCalled();
    expect(modelRef!.terminal.error()).toBe(
      "Run already completed. Terminal input is disabled.",
    );
  });

  it("keeps terminal input disabled until run status is loaded", async () => {
    const pendingRun = deferred<Awaited<ReturnType<typeof getRunMock>>>();
    getRunMock.mockReturnValueOnce(pendingRun.promise);

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    expect(modelRef!.terminal.isInputEnabled()).toBe(false);

    pendingRun.resolve({
      id: "run-1",
      taskId: "task-1",
      projectId: "project-1",
      status: "running",
      triggeredBy: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    await waitFor(() => {
      expect(modelRef!.terminal.isInputEnabled()).toBe(true);
    });
  });

  it("keeps terminal input disabled for completed runs in UI state", async () => {
    getRunMock.mockResolvedValueOnce({
      id: "run-1",
      taskId: "task-1",
      projectId: "project-1",
      status: "completed",
      triggeredBy: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
      expect(modelRef!.run()?.status).toBe("completed");
    });

    expect(modelRef!.terminal.isInputEnabled()).toBe(false);
  });

  it("forwards session.idle events to frontend event history", async () => {
    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
      expect(subscribeRunOpenCodeEventsMock).toHaveBeenCalledTimes(1);
    });

    const subscribeCall = subscribeRunOpenCodeEventsMock.mock.calls[0]?.[0] as
      | {
          onOutputChannel?: (event: {
            runId: string;
            ts: string | number | null;
            event: string;
            data: unknown;
          }) => void;
        }
      | undefined;
    expect(subscribeCall?.onOutputChannel).toBeTypeOf("function");

    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:00.000Z",
      event: "session.idle",
      data: { sessionID: "session-1" },
    });

    await waitFor(() => {
      const events = modelRef!.agent.events();
      expect(events).toHaveLength(1);
      expect(events[0]?.event).toBe("session.idle");
    });
  });
});
