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
  getBufferedRunOpenCodeEventsMock,
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
  getProjectMock,
} = vi.hoisted(() => ({
  routeState: { runId: "run-1" },
  navigateMock: vi.fn(),
  bootstrapRunOpenCodeMock: vi.fn(),
  getBufferedRunOpenCodeEventsMock: vi.fn(),
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
  getProjectMock: vi.fn(),
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
  getBufferedRunOpenCodeEvents: getBufferedRunOpenCodeEventsMock,
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

vi.mock("../../../../app/lib/projects", () => ({
  getProject: getProjectMock,
}));

describe("useRunDetailModel startup ownership", () => {
  beforeEach(() => {
    vi.useRealTimers();
    routeState.runId = "run-1";
    navigateMock.mockReset();
    bootstrapRunOpenCodeMock.mockReset();
    getBufferedRunOpenCodeEventsMock.mockReset();
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
    getProjectMock.mockReset();

    bootstrapRunOpenCodeMock.mockResolvedValue({
      state: "running",
      chatMode: "interactive",
      bufferedEvents: [],
      messages: [],
      todos: [],
      streamConnected: true,
    });
    getBufferedRunOpenCodeEventsMock.mockResolvedValue([]);
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
    getProjectMock.mockResolvedValue({
      id: "project-1",
      name: "Project",
      key: "PROJ",
      defaultRunAgent: "agent-1",
      defaultRunProvider: "provider-1",
      defaultRunModel: "model-1",
      repositories: [],
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

  it("hydrates read-only history without subscribing to live event updates", async () => {
    bootstrapRunOpenCodeMock.mockResolvedValueOnce({
      state: "ready",
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
      readyPhase: "completed_history",
    });

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
      expect(modelRef!.agent.chatMode()).toBe("read_only");
      expect(modelRef!.agent.events().length).toBe(1);
    });

    expect(subscribeRunOpenCodeEventsMock).not.toHaveBeenCalled();
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

  it("loads project defaults for composer fallback selection", async () => {
    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
      expect(modelRef!.agent.projectDefaultRunAgentId()).toBe("agent-1");
      expect(modelRef!.agent.projectDefaultRunProviderId()).toBe("provider-1");
      expect(modelRef!.agent.projectDefaultRunModelId()).toBe("model-1");
    });
  });

  it("loads run options from run project while task context is still loading", async () => {
    const taskLoad = deferred<{
      id: string;
      title: string;
      description: string;
      implementationGuide: string;
      status: string;
      projectId: string;
    }>();
    getTaskMock.mockReturnValueOnce(taskLoad.promise);

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
      expect(getRunSelectionOptionsWithCacheMock).toHaveBeenCalledWith(
        "project-1",
      );
      expect(modelRef!.agent.runSelectionOptionsError()).toBe("");
    });

    taskLoad.resolve({
      id: "task-1",
      title: "Task",
      description: "Description",
      implementationGuide: "Guide",
      status: "doing",
      projectId: "project-1",
    });
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

  it("sets submitting state immediately while prompt submission is pending", async () => {
    const pendingSubmit = deferred<{
      status: "accepted";
      queuedAt: string;
    }>();
    submitRunOpenCodePromptMock.mockReturnValueOnce(pendingSubmit.promise);

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    const submitPromise = modelRef!.agent.submitPrompt("Ship it");

    await waitFor(() => {
      expect(modelRef!.agent.isSubmittingPrompt()).toBe(true);
    });

    pendingSubmit.resolve({
      status: "accepted",
      queuedAt: "2026-01-01T00:00:00.000Z",
    });
    await expect(submitPromise).resolves.toBe(true);

    await waitFor(() => {
      expect(modelRef!.agent.isSubmittingPrompt()).toBe(false);
      expect(modelRef!.agent.submitError()).toBe("");
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

  it("resubscribes after stream.resync_needed event", async () => {
    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
      expect(subscribeRunOpenCodeEventsMock).toHaveBeenCalledTimes(1);
    });

    const firstSubscribeCall = subscribeRunOpenCodeEventsMock.mock
      .calls[0]?.[0] as
      | {
          onOutputChannel?: (event: {
            runId: string;
            ts: string | number | null;
            event: string;
            data: unknown;
          }) => void;
        }
      | undefined;

    firstSubscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:00.000Z",
      event: "stream.resync_needed",
      data: { reason: "missed_events" },
    });

    await waitFor(
      () => {
        expect(subscribeRunOpenCodeEventsMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );

    expect(unsubscribeRunOpenCodeEventsMock).toHaveBeenCalledWith(
      "run-1",
      expect.stringContaining("run-detail:run-1:"),
    );
  });

  it("tracks OpenCode connection status across disconnect and reconnect events", async () => {
    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
      expect(subscribeRunOpenCodeEventsMock).toHaveBeenCalledTimes(1);
      expect(modelRef!.agent.connectionStatus()).toBe("warming");
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
      event: "message",
      data: { type: "server.disconnected", reason: "socket_closed" },
    });

    await waitFor(() => {
      expect(modelRef!.agent.connectionStatus()).toBe("disconnected");
    });

    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:01.000Z",
      event: "message",
      data: { type: "server.connected", reason: "socket_recovered" },
    });

    await waitFor(() => {
      expect(modelRef!.agent.connectionStatus()).toBe("connected");
    });
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

    const accepted = await modelRef!.agent.replyPermission("perm-1", "once");

    expect(accepted).toBe(true);
    expect(replyRunOpenCodePermissionMock).toHaveBeenCalledWith({
      runId: "run-1",
      sessionId: "session-1",
      requestId: "perm-1",
      decision: "once",
      remember: false,
    });
    expect(
      modelRef!.agent.store().pendingPermissionsById["perm-1"],
    ).toBeUndefined();
    expect(modelRef!.agent.permissionState().resolvedRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requestId: "perm-1", status: "replied" }),
      ]),
    );
    const latestAllowEvent = modelRef!.agent.events();
    expect(latestAllowEvent[latestAllowEvent.length - 1]?.event).toBe(
      "permission.replied",
    );
  });

  it("records local rejected permission event after deny is accepted", async () => {
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
        requestID: "perm-2",
        sessionID: "session-1",
        kind: "bash",
      },
    });

    await waitFor(() => {
      expect(
        modelRef!.agent.store().pendingPermissionsById["perm-2"],
      ).toBeTruthy();
    });

    const accepted = await modelRef!.agent.replyPermission("perm-2", "deny");

    expect(accepted).toBe(true);
    expect(
      modelRef!.agent.store().pendingPermissionsById["perm-2"],
    ).toBeUndefined();
    const latestDenyEvent = modelRef!.agent.events();
    expect(latestDenyEvent[latestDenyEvent.length - 1]?.event).toBe(
      "permission.rejected",
    );
  });

  it("auto-dismisses stale permission requests before backend reply", async () => {
    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
      expect(subscribeRunOpenCodeEventsMock).toHaveBeenCalledTimes(1);
    });

    const accepted = await modelRef!.agent.replyPermission(
      "missing-perm",
      "always",
    );

    expect(accepted).toBe(false);
    expect(replyRunOpenCodePermissionMock).not.toHaveBeenCalled();
    expect(modelRef!.agent.permissionReplyError()).toBe("");
    expect(
      modelRef!.agent.store().pendingPermissionsById["missing-perm"],
    ).toBeUndefined();
  });

  it("auto-dismisses stale permission requests on backend stale response", async () => {
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
        requestID: "perm-stale-1",
        sessionID: "session-1",
        kind: "write",
      },
    });

    await waitFor(() => {
      expect(
        modelRef!.agent.store().pendingPermissionsById["perm-stale-1"],
      ).toBeTruthy();
    });

    replyRunOpenCodePermissionMock.mockRejectedValueOnce(
      new Error("permission request is stale"),
    );

    const accepted = await modelRef!.agent.replyPermission(
      "perm-stale-1",
      "deny",
    );

    expect(accepted).toBe(false);
    expect(modelRef!.agent.permissionReplyError()).toBe("");
    expect(
      modelRef!.agent.store().pendingPermissionsById["perm-stale-1"],
    ).toBeUndefined();
    expect(modelRef!.agent.permissionState().failedRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: "perm-stale-1",
          failureMessage: "Permission request expired before response.",
        }),
      ]),
    );
    expect(
      modelRef!.agent.store().failedPermissionsById["perm-stale-1"],
    ).toMatchObject({
      requestId: "perm-stale-1",
      failureMessage: "Permission request expired before response.",
    });
  });

  it("serializes multiple pending permissions into active and queued state", async () => {
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
    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:01.000Z",
      event: "permission.asked",
      data: {
        requestID: "perm-2",
        sessionID: "session-1",
        kind: "bash",
      },
    });

    await waitFor(() => {
      expect(modelRef!.agent.permissionState().activeRequest).toMatchObject({
        requestId: "perm-1",
      });
      expect(modelRef!.agent.permissionState().queuedRequests).toEqual([
        expect.objectContaining({ requestId: "perm-2" }),
      ]);
    });
  });

  it("rejects out-of-order permission replies while another request is active", async () => {
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
    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:01.000Z",
      event: "permission.asked",
      data: {
        requestID: "perm-2",
        sessionID: "session-1",
        kind: "bash",
      },
    });

    await waitFor(() => {
      expect(modelRef!.agent.permissionState().queuedRequests).toHaveLength(1);
    });

    const accepted = await modelRef!.agent.replyPermission("perm-2", "once");

    expect(accepted).toBe(false);
    expect(replyRunOpenCodePermissionMock).not.toHaveBeenCalled();
    expect(modelRef!.agent.permissionReplyError()).toBe(
      "Finish the current permission request first.",
    );
  });

  it("replies to subagent permission using the canonical root session", async () => {
    bootstrapRunOpenCodeMock.mockResolvedValueOnce({
      state: "running",
      chatMode: "interactive",
      bufferedEvents: [],
      messages: [],
      todos: [],
      streamConnected: true,
      sessionId: "session-root",
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
      ts: "2026-01-01T00:00:00.000Z",
      event: "session.updated",
      data: {
        info: {
          sessionID: "session-sub-1",
          parentID: "session-root",
          title: "Docs lookup",
          agent: "explorer",
          model: "provider/k2p5",
        },
      },
    });
    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:01.000Z",
      event: "permission.asked",
      data: {
        requestID: "perm-sub-1",
        sessionID: "session-sub-1",
        kind: "write",
      },
    });

    await waitFor(() => {
      expect(
        modelRef!.agent.store().pendingPermissionsById["perm-sub-1"],
      ).toBeTruthy();
    });

    expect(modelRef!.agent.permissionState().activeRequest).toMatchObject({
      requestId: "perm-sub-1",
      sessionId: "session-sub-1",
      sourceKind: "subagent",
      sourceLabel: "Docs lookup - k2p5",
    });

    const accepted = await modelRef!.agent.replyPermission(
      "perm-sub-1",
      "once",
    );

    expect(accepted).toBe(true);
    expect(replyRunOpenCodePermissionMock).toHaveBeenCalledWith({
      runId: "run-1",
      sessionId: "session-root",
      requestId: "perm-sub-1",
      decision: "once",
      remember: false,
    });
  });

  it("keeps main-agent permissions classified as main when message parents are present", async () => {
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
      event: "message.updated",
      data: {
        info: {
          id: "msg-1",
          sessionID: "session-1",
          parentID: "msg-root",
          role: "assistant",
        },
      },
    });
    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:01.000Z",
      event: "permission.asked",
      data: {
        requestID: "perm-main-1",
        sessionID: "session-1",
        kind: "bash",
      },
    });

    await waitFor(() => {
      expect(modelRef!.agent.permissionState().activeRequest).toMatchObject({
        requestId: "perm-main-1",
        sourceKind: "main",
        sourceLabel: "Main agent",
      });
    });
  });

  it("sanitizes unsafe subagent titles in permission source labels", async () => {
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
      event: "session.updated",
      data: {
        info: {
          sessionID: "session-sub-2",
          parentID: "session-root",
          title: "abcdef012345abcdef012345",
        },
      },
    });
    subscribeCall?.onOutputChannel?.({
      runId: "run-1",
      ts: "2026-01-01T00:00:01.000Z",
      event: "permission.asked",
      data: {
        requestID: "perm-sub-2",
        sessionID: "session-sub-2",
        kind: "write",
      },
    });

    await waitFor(() => {
      expect(modelRef!.agent.permissionState().activeRequest).toMatchObject({
        requestId: "perm-sub-2",
        sourceKind: "subagent",
        sourceLabel: "Subagent",
      });
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

  it("builds a deterministic multi-file review submission plan", async () => {
    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    modelRef!.review.upsertDraftComment({
      filePath: "src/zeta.ts",
      side: "modified",
      line: 8,
      body: "Zeta change request.",
    });
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    modelRef!.review.upsertDraftComment({
      filePath: "src/alpha.ts",
      side: "modified",
      line: 5,
      body: "Please update naming.\nPreserve readability.",
    });
    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    modelRef!.review.upsertDraftComment({
      filePath: "src/alpha.ts",
      side: "modified",
      line: 2,
      body: "Guard the undefined case.",
    });
    vi.useRealTimers();

    const plan = modelRef!.review.getDraftReviewSubmissionPlan();

    expect(plan.isSubmittable).toBe(true);
    expect(plan.eligibleCount).toBe(3);
    expect(plan.ineligibleCount).toBe(0);
    expect(plan.fileCount).toBe(2);
    expect(plan.message).toContain("# Review: Requested changes");
    expect(plan.message).toContain("Summary: 3 comments across 2 files.");
    expect(plan.message).toContain("File: `src/alpha.ts`");
    expect(plan.message).toContain("File: `src/zeta.ts`");
    expect(plan.message).not.toContain("## src/");
    expect(plan.message).toContain("- Side: modified · Line: 2");
    expect(plan.message).toContain("- Side: modified · Line: 5");
    expect(plan.message).toContain("  > Please update naming.");
    expect(plan.message).toContain("  > Preserve readability.");
    expect(plan.message).not.toContain("[internal-id]");

    const alphaSectionStart = plan.message.indexOf("File: `src/alpha.ts`");
    const zetaSectionStart = plan.message.indexOf("File: `src/zeta.ts`");
    const alphaLineTwo = plan.message.indexOf("- Side: modified · Line: 2");
    const alphaLineFive = plan.message.indexOf("- Side: modified · Line: 5");
    expect(alphaSectionStart).toBeGreaterThan(-1);
    expect(zetaSectionStart).toBeGreaterThan(alphaSectionStart);
    expect(alphaLineFive).toBeGreaterThan(alphaLineTwo);
  });

  it("blocks review submission when any draft comment is ineligible", async () => {
    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    modelRef!.review.upsertDraftComment({
      filePath: "src/demo.ts",
      side: "modified",
      line: 3,
      body: "Valid comment.",
    });
    const ineligible = modelRef!.review.upsertDraftComment({
      filePath: "src/demo.ts",
      side: "original",
      line: 2,
      body: "Ineligible because side is original.",
    });

    const blockedPlan = modelRef!.review.getDraftReviewSubmissionPlan();
    expect(blockedPlan.isSubmittable).toBe(false);
    expect(blockedPlan.eligibleCount).toBe(1);
    expect(blockedPlan.ineligibleCount).toBe(1);
    expect(blockedPlan.blockedReason).toContain(
      "Resolve or remove 1 draft comment",
    );

    modelRef!.review.removeDraftComments([ineligible!.id]);

    const unblockedPlan = modelRef!.review.getDraftReviewSubmissionPlan();
    expect(unblockedPlan.isSubmittable).toBe(true);
    expect(unblockedPlan.eligibleCount).toBe(1);
    expect(unblockedPlan.ineligibleCount).toBe(0);
  });

  it("marks draft anchors for revalidation when diff metadata changes", async () => {
    listRunDiffFilesMock
      .mockResolvedValueOnce([
        {
          path: "src/demo.ts",
          additions: 1,
          deletions: 0,
          status: "modified",
        },
      ])
      .mockResolvedValueOnce([
        {
          path: "src/demo.ts",
          additions: 2,
          deletions: 0,
          status: "modified",
        },
      ]);

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    await modelRef!.refreshDiffFiles();
    const created = modelRef!.review.upsertDraftComment({
      filePath: "src/demo.ts",
      side: "modified",
      line: 1,
      body: "Do not lose this note.",
      anchorLineSnippet: "const after = 2;",
    });

    await modelRef!.refreshDiffFiles();

    const updated = modelRef!.review
      .draftComments()
      .find((comment) => comment.id === created?.id);
    expect(updated).toMatchObject({
      body: "Do not lose this note.",
      anchorTrust: "needs_validation",
      anchorTrustReason: "diff_changed",
    });
  });

  it("marks removed-file draft anchors as untrusted and keeps them visible", async () => {
    listRunDiffFilesMock
      .mockResolvedValueOnce([
        {
          path: "src/demo.ts",
          additions: 1,
          deletions: 0,
          status: "modified",
        },
      ])
      .mockResolvedValueOnce([]);

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    await modelRef!.refreshDiffFiles();
    const created = modelRef!.review.upsertDraftComment({
      filePath: "src/demo.ts",
      side: "modified",
      line: 1,
      body: "Preserve me.",
    });

    await modelRef!.refreshDiffFiles();

    const removed = modelRef!.review
      .draftComments()
      .find((comment) => comment.id === created?.id);
    expect(removed).toMatchObject({
      body: "Preserve me.",
      anchorTrust: "untrusted",
      anchorTrustReason: "file_removed",
    });
    expect(
      modelRef!.review
        .getDraftCommentsNeedingAttention()
        .some((comment) => comment.id === created?.id),
    ).toBe(true);
  });

  it("validates draft anchors against current commentable diff context", async () => {
    listRunDiffFilesMock
      .mockResolvedValueOnce([
        {
          path: "src/demo.ts",
          additions: 1,
          deletions: 0,
          status: "modified",
        },
      ])
      .mockResolvedValueOnce([
        {
          path: "src/demo.ts",
          additions: 2,
          deletions: 0,
          status: "modified",
        },
      ]);

    let modelRef: ReturnType<typeof useRunDetailModel> | undefined;
    render(() => {
      modelRef = useRunDetailModel();
      return <div />;
    });

    await waitFor(() => {
      expect(modelRef).toBeDefined();
    });

    await modelRef!.refreshDiffFiles();
    const created = modelRef!.review.upsertDraftComment({
      filePath: "src/demo.ts",
      side: "modified",
      line: 2,
      body: "Please keep this behavior.",
      anchorLineSnippet: "const after = 2;",
    });

    await modelRef!.refreshDiffFiles();

    modelRef!.review.validateDraftAnchorsForFile({
      filePath: "src/demo.ts",
      side: "modified",
      modifiedLineCount: 2,
      commentableModifiedLines: new Set([2]),
      modifiedLineTextByLine: new Map([
        [1, "const before = 1;"],
        [2, "const after = 2;"],
      ]),
    });

    let validated = modelRef!.review
      .draftComments()
      .find((comment) => comment.id === created?.id);
    expect(validated).toMatchObject({
      anchorTrust: "trusted",
      anchorTrustReason: undefined,
    });

    modelRef!.review.validateDraftAnchorsForFile({
      filePath: "src/demo.ts",
      side: "modified",
      modifiedLineCount: 2,
      commentableModifiedLines: new Set([2]),
      modifiedLineTextByLine: new Map([
        [1, "const before = 1;"],
        [2, "const after changed = 3;"],
      ]),
    });

    validated = modelRef!.review
      .draftComments()
      .find((comment) => comment.id === created?.id);
    expect(validated).toMatchObject({
      anchorTrust: "untrusted",
      anchorTrustReason: "snippet_mismatch",
    });
  });
});
