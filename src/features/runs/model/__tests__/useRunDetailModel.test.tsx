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
  getRunSelectionOptionsWithCacheMock,
  readRunSelectionOptionsCacheMock,
  replyRunOpenCodePermissionMock,
  getRunGitMergeStatusMock,
  rebaseRunWorktreeOntoSourceMock,
  mergeRunWorktreeIntoSourceMock,
  listRunDiffFilesMock,
  getRunDiffFileMock,
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
  getRunSelectionOptionsWithCacheMock: vi.fn(),
  readRunSelectionOptionsCacheMock: vi.fn(),
  replyRunOpenCodePermissionMock: vi.fn(),
  getRunGitMergeStatusMock: vi.fn(),
  rebaseRunWorktreeOntoSourceMock: vi.fn(),
  mergeRunWorktreeIntoSourceMock: vi.fn(),
  listRunDiffFilesMock: vi.fn(),
  getRunDiffFileMock: vi.fn(),
  writeRunTerminalMock: vi.fn(),
  getRunMock: vi.fn(),
  getTaskMock: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ search: "" }),
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
  getRunDiffFile: getRunDiffFileMock,
  killRunTerminal: vi.fn(async () => undefined),
  listRunDiffFiles: listRunDiffFilesMock,
  mergeRunWorktreeIntoSource: mergeRunWorktreeIntoSourceMock,
  openRunTerminal: vi.fn(async () => ({
    sessionId: "terminal-1",
    generation: 1,
  })),
  rebaseRunWorktreeOntoSource: rebaseRunWorktreeOntoSourceMock,
  resizeRunTerminal: vi.fn(async () => undefined),
  setRunDiffWatch: vi.fn(async () => undefined),
  submitRunOpenCodePrompt: submitRunOpenCodePromptMock,
  replyRunOpenCodePermission: replyRunOpenCodePermissionMock,
  subscribeRunOpenCodeEvents: subscribeRunOpenCodeEventsMock,
  unsubscribeRunOpenCodeEvents: unsubscribeRunOpenCodeEventsMock,
  writeRunTerminal: writeRunTerminalMock,
}));

vi.mock("../../../../app/lib/runSelectionOptionsCache", () => ({
  getRunSelectionOptionsWithCache: getRunSelectionOptionsWithCacheMock,
  readRunSelectionOptionsCache: readRunSelectionOptionsCacheMock,
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
    getRunSelectionOptionsWithCacheMock.mockReset();
    readRunSelectionOptionsCacheMock.mockReset();
    replyRunOpenCodePermissionMock.mockReset();
    getRunGitMergeStatusMock.mockReset();
    rebaseRunWorktreeOntoSourceMock.mockReset();
    mergeRunWorktreeIntoSourceMock.mockReset();
    listRunDiffFilesMock.mockReset();
    getRunDiffFileMock.mockReset();
    writeRunTerminalMock.mockReset();
    getRunMock.mockReset();
    getTaskMock.mockReset();

    bootstrapRunOpenCodeMock.mockResolvedValue({
      state: "running",
      chatMode: "interactive",
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
    replyRunOpenCodePermissionMock.mockResolvedValue({
      status: "accepted",
      repliedAt: "2026-01-01T00:00:00.000Z",
    });
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
    readRunSelectionOptionsCacheMock.mockReturnValue(null);
    getRunSelectionOptionsWithCacheMock.mockResolvedValue({
      agents: [],
      providers: [],
      models: [],
    });
    listRunDiffFilesMock.mockResolvedValue([]);
    getRunDiffFileMock.mockResolvedValue({
      path: "src/main.ts",
      additions: 1,
      deletions: 1,
      original: "before\nline two",
      modified: "after\nline two",
      language: "typescript",
      status: "modified",
      isBinary: false,
      truncated: false,
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

  it("hydrates read-only history without subscribing to live events", async () => {
    bootstrapRunOpenCodeMock.mockResolvedValueOnce({
      state: "running",
      chatMode: "read_only",
      bufferedEvents: [
        {
          runId: "run-1",
          ts: "2026-01-01T00:00:00.000Z",
          event: "message.updated",
          data: {
            type: "message.updated",
            properties: {
              info: {
                id: "msg-1",
                role: "assistant",
                sessionID: "session-1",
              },
            },
          },
        },
      ],
      messages: [
        {
          payload: {
            info: {
              id: "msg-1",
              role: "assistant",
              sessionID: "session-1",
            },
          },
        },
      ],
      todos: [],
      streamConnected: false,
    });

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
      expect(modelRef!.agent.chatMode()).toBe("read_only");
      expect(subscribeRunOpenCodeEventsMock).not.toHaveBeenCalled();
      expect(modelRef!.agent.events().length).toBe(1);
    });
  });

  it("uses startup-cached run options when available", async () => {
    readRunSelectionOptionsCacheMock.mockReturnValueOnce({
      agents: [{ id: "agent-cached", label: "Cached Agent" }],
      providers: [{ id: "provider-cached", label: "Cached Provider" }],
      models: [
        {
          id: "model-cached",
          label: "Cached Model",
          providerId: "provider-cached",
        },
      ],
    });

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
      expect(modelRef!.agent.runProviderOptions()).toEqual([
        { id: "provider-cached", label: "Cached Provider" },
      ]);
    });

    expect(getRunSelectionOptionsWithCacheMock).not.toHaveBeenCalled();
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
      agentId: undefined,
      providerId: undefined,
      modelId: undefined,
    });
  });

  it("submits prompt with message-level selection overrides", async () => {
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

    const accepted = await modelRef!.agent.submitPrompt("Ship it", {
      agentId: "agent-1",
      providerId: "provider-1",
      modelId: "model-1",
    });

    expect(accepted).toBe(true);
    expect(submitRunOpenCodePromptMock).toHaveBeenCalledWith({
      runId: "run-1",
      prompt: "Ship it",
      clientRequestId: undefined,
      agentId: "agent-1",
      providerId: "provider-1",
      modelId: "model-1",
    });
  });

  it("does not inject implicit agent when no prompt override is provided", async () => {
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

    const accepted = await modelRef!.agent.submitPrompt("Ship it");

    expect(accepted).toBe(true);
    expect(submitRunOpenCodePromptMock).toHaveBeenCalledWith({
      runId: "run-1",
      prompt: "Ship it",
      clientRequestId: undefined,
      agentId: undefined,
      providerId: undefined,
      modelId: undefined,
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

  it("treats mergeable rebase backend state as non-error guidance", async () => {
    rebaseRunWorktreeOntoSourceMock.mockResolvedValueOnce({
      status: "failed",
      message: "Rebase/merge backend state: mergeable.",
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

    expect(modelRef!.git.actionError()).toBe("");
    expect(modelRef!.git.lastActionMessage()).toBe(
      "Rebase/merge backend state: mergeable.",
    );
  });

  it("keeps real failed rebase messages as action errors", async () => {
    rebaseRunWorktreeOntoSourceMock.mockResolvedValueOnce({
      status: "failed",
      message:
        "Rebase failed after merged checks completed with unresolved conflicts.",
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

    expect(modelRef!.git.actionError()).toBe(
      "Rebase failed after merged checks completed with unresolved conflicts.",
    );
    expect(modelRef!.git.lastActionMessage()).toBe("");
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

  it("keeps failed merge errors in actionError only", async () => {
    mergeRunWorktreeIntoSourceMock.mockResolvedValueOnce({
      status: "failed",
      message: "Merge failed due to non-fast-forward update.",
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

    expect(modelRef!.git.lastActionMessage()).toBe("");
    expect(modelRef!.git.actionError()).toBe(
      "Merge failed due to non-fast-forward update.",
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

    const baselineGetRunCalls = getRunMock.mock.calls.length;

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

    await waitFor(
      () => {
        const refreshCalls = getRunMock.mock.calls.length - baselineGetRunCalls;
        expect(refreshCalls).toBeGreaterThanOrEqual(3);
        expect(refreshCalls).toBeLessThanOrEqual(3);
      },
      { timeout: 3000 },
    );
  });

  it("suppresses idle refresh when same-batch session is mismatched", async () => {
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

    const baselineGetRunCalls = getRunMock.mock.calls.length;

    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:00.000Z",
      event: "permission.asked",
      data: {
        requestID: "perm-1",
        sessionID: "session-1",
        kind: "write",
      },
    });
    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:01.000Z",
      event: "session.idle",
      data: { sessionID: "session-other" },
    });

    await waitFor(() => {
      expect(modelRef!.agent.store().sessionId).toBe("session-1");
    });

    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(getRunMock.mock.calls.length).toBe(baselineGetRunCalls);
  });

  it("ignores session.idle refresh for mismatched session id", async () => {
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

    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:00.000Z",
      event: "permission.asked",
      data: {
        requestID: "perm-1",
        sessionID: "session-1",
        kind: "write",
      },
    });

    await waitFor(() => {
      expect(modelRef!.agent.store().sessionId).toBe("session-1");
    });

    const baselineGetRunCalls = getRunMock.mock.calls.length;

    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:01.000Z",
      event: "session.idle",
      data: { sessionID: "session-other" },
    });

    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(getRunMock.mock.calls.length).toBe(baselineGetRunCalls);
  });

  it("keeps newest refresh result when refreshes complete out of order", async () => {
    const staleRun = deferred<Awaited<ReturnType<typeof getRunMock>>>();
    const newestRun = deferred<Awaited<ReturnType<typeof getRunMock>>>();

    getRunMock
      .mockReturnValueOnce(staleRun.promise)
      .mockReturnValueOnce(newestRun.promise)
      .mockResolvedValue({
        id: "run-1",
        taskId: "task-1",
        projectId: "project-1",
        status: "running",
        triggeredBy: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    getTaskMock
      .mockResolvedValueOnce({
        id: "task-2",
        title: "Newest Task",
        description: "Description",
        implementationGuide: "Guide",
        status: "doing",
        projectId: "project-1",
      })
      .mockResolvedValueOnce({
        id: "task-1",
        title: "Stale Task",
        description: "Description",
        implementationGuide: "Guide",
        status: "doing",
        projectId: "project-1",
      });

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

    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:01.000Z",
      event: "session.idle",
      data: { sessionID: "session-1" },
    });

    await waitFor(() => {
      expect(getRunMock).toHaveBeenCalledTimes(2);
    });

    newestRun.resolve({
      id: "run-1",
      taskId: "task-2",
      projectId: "project-1",
      status: "completed",
      triggeredBy: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    await waitFor(() => {
      expect(modelRef!.run()?.status).toBe("completed");
      expect(modelRef!.task()?.id).toBe("task-2");
    });

    staleRun.resolve({
      id: "run-1",
      taskId: "task-1",
      projectId: "project-1",
      status: "running",
      triggeredBy: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    await waitFor(() => {
      expect(modelRef!.run()?.status).toBe("completed");
      expect(modelRef!.task()?.id).toBe("task-2");
    });
  });

  it("replies to pending permission using run and session context", async () => {
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

    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:00.000Z",
      event: "permission.asked",
      data: {
        requestID: "perm-1",
        sessionID: "session-1",
        kind: "write",
      },
    });

    await waitFor(() => {
      const pending = modelRef!.agent.store().pendingPermissionsById;
      expect(pending["perm-1"]).toBeTruthy();
      expect(modelRef!.agent.store().sessionId).toBe("session-1");
    });

    const accepted = await modelRef!.agent.replyPermission("perm-1", "allow");

    expect(accepted).toBe(true);
    expect(replyRunOpenCodePermissionMock).toHaveBeenCalledWith({
      runId: "run-1",
      sessionId: "session-1",
      requestId: "perm-1",
      decision: "allow",
      remember: false,
    });
  });

  it("stores and updates draft review comments in app state", async () => {
    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    const created = modelRef!.review.upsertDraftComment({
      filePath: "src/demo.ts",
      side: "modified",
      line: 3,
      body: "Need to handle null cases.",
    });

    expect(created).toBeTruthy();
    expect(modelRef!.review.getDraftCommentsForFile("src/demo.ts")).toEqual([
      expect.objectContaining({
        id: created?.id,
        line: 3,
        body: "Need to handle null cases.",
        side: "modified",
      }),
    ]);

    modelRef!.review.upsertDraftComment({
      id: created!.id,
      filePath: "src/demo.ts",
      side: "modified",
      line: 3,
      body: "Need to handle null + undefined cases.",
    });

    expect(modelRef!.review.getDraftCommentsForFile("src/demo.ts")).toEqual([
      expect.objectContaining({
        id: created!.id,
        body: "Need to handle null + undefined cases.",
      }),
    ]);
  });

  it("removes draft review comments by id", async () => {
    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    const created = modelRef!.review.upsertDraftComment({
      filePath: "src/demo.ts",
      side: "modified",
      line: 2,
      body: "Consider extracting a helper.",
    });
    expect(modelRef!.review.draftComments()).toHaveLength(1);

    modelRef!.review.removeDraftComment(created!.id);

    expect(modelRef!.review.draftComments()).toHaveLength(0);
  });
});
