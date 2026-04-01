import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapRunOpenCode,
  createRun,
  getRun,
  getRunSelectionOptions,
  getRunGitMergeStatus,
  getRunOpenCodeSessionMessages,
  getRunOpenCodeSessionTodos,
  listActiveRuns,
  listTaskRuns,
  mergeRunWorktreeIntoSource,
  rebaseRunWorktreeOntoSource,
  submitRunOpenCodePrompt,
  type BootstrapRunOpenCodeResult,
  type Run,
  type RunGitMergeStatus,
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
      request: {
        taskId: "task-1",
        agentId: undefined,
        providerId: undefined,
        modelId: undefined,
      },
    });
  });

  it("passes run defaults into create_run request", async () => {
    invokeMock.mockResolvedValue({
      id: "run-2",
      task_id: "task-2",
      project_id: "project-1",
      status: "queued" satisfies RunStatus,
      triggered_by: "user",
      created_at: "2026-01-01T00:00:00.000Z",
    });

    await createRun("task-2", {
      agentId: "agent-1",
      providerId: "provider-1",
      modelId: "model-1",
    });

    expect(invokeMock).toHaveBeenCalledWith("create_run", {
      request: {
        taskId: "task-2",
        agentId: "agent-1",
        providerId: "provider-1",
        modelId: "model-1",
      },
    });
  });

  it("normalizes run selection options payload", async () => {
    invokeMock.mockResolvedValueOnce({
      agents: [{ agentId: "agent-1", display_name: "Planner" }],
      providers: [
        {
          id: "provider-1",
          name: "OpenAI",
          models: [{ modelId: "model-1", label: "GPT-5" }],
        },
      ],
    });

    const options = await getRunSelectionOptions("project-1");

    expect(invokeMock).toHaveBeenCalledWith(
      "get_project_opencode_selection_catalog",
      { projectId: "project-1" },
    );

    expect(options).toEqual({
      agents: [{ id: "agent-1", label: "Planner" }],
      providers: [{ id: "provider-1", label: "OpenAI" }],
      models: [{ id: "model-1", label: "GPT-5", providerId: "provider-1" }],
    });
  });

  it("normalizes model labels across backend name shapes", async () => {
    invokeMock.mockResolvedValueOnce({
      agents: [],
      providers: [
        {
          id: "provider-1",
          name: "OpenAI",
          models: [
            { modelId: "model-a", model_name: "GPT-4.1" },
            { modelId: "model-b", modelName: "GPT-4o" },
            { modelId: "model-c", name: "o3" },
            { modelId: "model-d" },
          ],
        },
      ],
    });

    const options = await getRunSelectionOptions("project-1");

    expect(options.models).toEqual([
      { id: "model-a", label: "GPT-4.1", providerId: "provider-1" },
      { id: "model-b", label: "GPT-4o", providerId: "provider-1" },
      { id: "model-c", label: "o3", providerId: "provider-1" },
      { id: "model-d", label: "Model", providerId: "provider-1" },
    ]);
  });

  it("passes optional message overrides to submit_run_opencode_prompt", async () => {
    invokeMock.mockResolvedValue({
      status: "accepted",
      queued_at: "2026-01-01T00:00:00.000Z",
    });

    await submitRunOpenCodePrompt({
      runId: "run-1",
      prompt: "hello",
      agentId: "agent-1",
      providerId: "provider-1",
      modelId: "model-1",
    });

    expect(invokeMock).toHaveBeenCalledWith("submit_run_opencode_prompt", {
      request: {
        runId: "run-1",
        prompt: "hello",
        clientRequestId: undefined,
        agent: undefined,
        agentId: "agent-1",
        providerId: "provider-1",
        modelId: "model-1",
      },
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
        source_branch: "main",
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
        sourceBranch: "develop",
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
        sourceBranch: "main",
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
        sourceBranch: "develop",
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

  it("invokes list_active_runs and normalizes response", async () => {
    invokeMock.mockResolvedValue([
      {
        id: "run-active",
        task_id: "task-1",
        project_id: "project-1",
        status: "running" satisfies RunStatus,
        triggered_by: "user",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const runs = await listActiveRuns();

    expect(invokeMock).toHaveBeenCalledWith("list_active_runs");
    expect(runs).toEqual([
      {
        id: "run-active",
        taskId: "task-1",
        projectId: "project-1",
        targetRepoId: undefined,
        status: "running",
        triggeredBy: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: undefined,
        finishedAt: undefined,
        summary: undefined,
        errorMessage: undefined,
        worktreeId: undefined,
        agentId: undefined,
        providerId: undefined,
        modelId: undefined,
        sourceBranch: undefined,
      },
    ] satisfies Run[]);
  });

  it("invokes bootstrap_run_opencode with runId argument", async () => {
    invokeMock.mockResolvedValue({
      state: "running",
      bufferedEvents: [],
      messages: [],
      todos: [],
      streamConnected: true,
    });

    await bootstrapRunOpenCode("run-1");

    expect(invokeMock).toHaveBeenCalledWith("bootstrap_run_opencode", {
      runId: "run-1",
    });
  });

  it("invokes child session history commands with optional sessionId", async () => {
    invokeMock.mockResolvedValue([]);

    await getRunOpenCodeSessionMessages({ runId: "run-1", sessionId: "ses-2" });
    await getRunOpenCodeSessionTodos({ runId: "run-1", sessionId: "ses-2" });

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "get_run_opencode_session_messages",
      { runId: "run-1", sessionId: "ses-2" },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "get_run_opencode_session_todos",
      { runId: "run-1", sessionId: "ses-2" },
    );
  });

  it("normalizes bootstrap snake_case wrapped payload", async () => {
    invokeMock.mockResolvedValue({
      result: {
        state: "starting",
        reason: "warming",
        buffered_events: [
          {
            run_id: "run-server",
            timestamp: "2026-01-01T00:00:00.000Z",
            event: "stdout",
            payload: { line: "hello" },
          },
        ],
        messages: { items: [{ payload: { role: "assistant" } }] },
        todos: { data: [{ payload: { text: "Do thing" } }] },
        session_id: "session-1",
        stream_connected: true,
        ready_phase: "hydrated",
      },
    });

    const result = await bootstrapRunOpenCode("run-1");

    expect(result).toEqual({
      state: "starting",
      chatMode: "interactive",
      reason: "warming",
      bufferedEvents: [
        {
          runId: "run-server",
          ts: "2026-01-01T00:00:00.000Z",
          event: "stdout",
          data: { line: "hello" },
        },
      ],
      messages: [{ role: "assistant" }],
      todos: [{ text: "Do thing" }],
      sessionId: "session-1",
      streamConnected: true,
      readyPhase: "hydrated",
    } satisfies BootstrapRunOpenCodeResult);
  });

  it("normalizes bootstrap camelCase payload and fallback defaults", async () => {
    invokeMock.mockResolvedValue({
      state: "invalid",
      bufferedEvents: [
        {
          ts: 123,
          eventName: "status",
          data: { ok: true },
        },
      ],
      messages: [{ payload: { id: "msg-1" } }],
      todos: [{ payload: { id: "todo-1" } }],
      streamConnected: false,
    });

    const result = await bootstrapRunOpenCode("run-fallback");

    expect(result).toEqual({
      state: "idle",
      chatMode: "interactive",
      reason: undefined,
      bufferedEvents: [
        {
          runId: "run-fallback",
          ts: 123,
          event: "status",
          data: { ok: true },
        },
      ],
      messages: [{ id: "msg-1" }],
      todos: [{ id: "todo-1" }],
      sessionId: undefined,
      streamConnected: false,
      readyPhase: undefined,
    } satisfies BootstrapRunOpenCodeResult);
  });

  it("invokes get_run_git_merge_status with runId argument", async () => {
    invokeMock.mockResolvedValue({
      state: "ready",
      sourceBranch: "main",
      worktreeBranch: "feature/run-1",
      sourceAhead: 0,
      sourceBehind: 1,
      worktreeAhead: 2,
      worktreeBehind: 0,
      canRebase: true,
      canMerge: false,
      requiresRebase: true,
      mergeDisabledReason: "Rebase required",
    });

    const status = await getRunGitMergeStatus("run-1");

    expect(invokeMock).toHaveBeenCalledWith("get_run_git_merge_status", {
      runId: "run-1",
    });
    expect(status).toEqual({
      state: "ready",
      repositoryState: undefined,
      isRebaseInProgress: false,
      sourceBranch: {
        name: "main",
        ahead: 0,
        behind: 1,
      },
      worktreeBranch: {
        name: "feature/run-1",
        ahead: 2,
        behind: 0,
      },
      isRebaseAllowed: true,
      isMergeAllowed: false,
      requiresRebase: true,
      rebaseDisabledReason: undefined,
      mergeDisabledReason: "Rebase required",
      conflictSummary: undefined,
      conflictFingerprint: undefined,
    } satisfies RunGitMergeStatus);
  });

  it("normalizes snake_case branch payload for git merge status", async () => {
    invokeMock.mockResolvedValue({
      status: {
        state: "merge_conflict",
        branches: {
          source: { branch: "main", ahead: 1, behind: 0 },
          worktree: { name: "feature/abc", ahead: 3, behind: 2 },
        },
        can_rebase: false,
        can_merge: false,
        requires_rebase: false,
        rebase_disabled_reason: "Already rebased",
        merge_disabled_reason: "Resolve conflicts",
        conflict_summary: "Conflicts detected",
        conflict_fingerprint: "fp-1",
      },
    });

    const status = await getRunGitMergeStatus("run-1");

    expect(status).toEqual({
      state: "merge_conflict",
      repositoryState: undefined,
      isRebaseInProgress: false,
      sourceBranch: {
        name: "main",
        ahead: 1,
        behind: 0,
      },
      worktreeBranch: {
        name: "feature/abc",
        ahead: 3,
        behind: 2,
      },
      isRebaseAllowed: false,
      isMergeAllowed: false,
      requiresRebase: false,
      rebaseDisabledReason: "Already rebased",
      mergeDisabledReason: "Resolve conflicts",
      conflictSummary: "Conflicts detected",
      conflictFingerprint: "fp-1",
    } satisfies RunGitMergeStatus);
  });

  it("supports backend merge-state vocabulary and disable_reason fallback", async () => {
    invokeMock.mockResolvedValue({
      status: {
        state: "needs_rebase",
        source_branch: "main",
        worktree_branch: "feature/abc",
        source_ahead: 0,
        source_behind: 1,
        worktree_ahead: 1,
        worktree_behind: 1,
        can_rebase: false,
        can_merge: false,
        disable_reason: "worktree must be clean",
      },
    });

    const status = await getRunGitMergeStatus("run-1");

    expect(status.state).toBe("needs_rebase");
    expect(status.rawState).toBeUndefined();
    expect(status.rebaseDisabledReason).toBe("worktree must be clean");
    expect(status.mergeDisabledReason).toBe("worktree must be clean");
    expect(status.isRebaseAllowed).toBe(false);
    expect(status.isMergeAllowed).toBe(false);
    expect(status.isRebaseInProgress).toBe(false);
  });

  it("maps git2 ahead_count/behind_count into branch divergence and dirty flag", async () => {
    invokeMock.mockResolvedValue({
      status: {
        state: "mergeable",
        source_branch: "main",
        worktree_branch: "feature/abc",
        ahead_count: 1,
        behind_count: 0,
        is_worktree_clean: false,
        can_rebase: false,
        can_merge: false,
        disable_reason: "clean the worktree",
      },
    });

    const status = await getRunGitMergeStatus("run-1");

    expect(status.sourceBranch).toEqual({
      name: "main",
      ahead: 0,
      behind: 1,
    });
    expect(status.worktreeBranch).toEqual({
      name: "feature/abc",
      ahead: 1,
      behind: 0,
    });
    expect(status.isWorktreeClean).toBe(false);
  });

  it("normalizes merge-state variants from backend", async () => {
    invokeMock.mockResolvedValueOnce({
      status: {
        state: "rebase-in-progress",
        repository_state: "rebase_merge",
        is_rebase_in_progress: true,
      },
    });
    invokeMock.mockResolvedValueOnce({
      status: {
        state: "mergeReady",
      },
    });

    const hyphen = await getRunGitMergeStatus("run-1");
    const camel = await getRunGitMergeStatus("run-1");

    expect(hyphen.state).toBe("rebase_in_progress");
    expect(hyphen.rawState).toBeUndefined();
    expect(hyphen.repositoryState).toBe("rebase_merge");
    expect(hyphen.isRebaseInProgress).toBe(true);
    expect(camel.state).toBe("merge_ready");
    expect(camel.rawState).toBeUndefined();
    expect(camel.isRebaseInProgress).toBe(false);
  });

  it("falls back to merge state when rebasing flag is absent", async () => {
    invokeMock.mockResolvedValue({
      status: {
        state: "rebase_in_progress",
      },
    });

    const status = await getRunGitMergeStatus("run-1");

    expect(status.isRebaseInProgress).toBe(true);
  });

  it("preserves raw unknown merge-state for UI fallback", async () => {
    invokeMock.mockResolvedValue({
      status: {
        state: "new-backend-state",
      },
    });

    const status = await getRunGitMergeStatus("run-1");

    expect(status.state).toBe("unknown");
    expect(status.rawState).toBe("new-backend-state");
  });

  it("fails closed for mergeability booleans from malformed payload", async () => {
    invokeMock.mockResolvedValue({
      status: {
        state: "ready",
        source_branch: "main",
        worktree_branch: "feature/abc",
        can_rebase: "true",
        can_merge: 1,
        requires_rebase: { value: true },
        rebase_disabled_reason: { reason: "bad" },
        merge_disabled_reason: 42,
      },
    });

    const status = await getRunGitMergeStatus("run-1");

    expect(status.isRebaseAllowed).toBe(false);
    expect(status.isMergeAllowed).toBe(false);
    expect(status.requiresRebase).toBe(false);
    expect(status.rebaseDisabledReason).toBeUndefined();
    expect(status.mergeDisabledReason).toBeUndefined();
  });

  it("keeps actions disabled when allowed flags are false even if reasons are malformed", async () => {
    invokeMock.mockResolvedValue({
      status: {
        state: "ready",
        source_branch: "main",
        worktree_branch: "feature/abc",
        can_rebase: false,
        can_merge: false,
        requires_rebase: false,
        rebase_disabled_reason: { text: "not a string" },
        merge_disabled_reason: ["not", "a", "string"],
      },
    });

    const status = await getRunGitMergeStatus("run-1");

    expect(status.isRebaseAllowed).toBe(false);
    expect(status.isMergeAllowed).toBe(false);
    expect(status.rebaseDisabledReason).toBeUndefined();
    expect(status.mergeDisabledReason).toBeUndefined();
  });

  it("does not throw on malformed branch-name payload fields", async () => {
    invokeMock.mockResolvedValue({
      status: {
        state: "ready",
        source_branch: 123,
        worktree_branch: { invalid: true },
        source: { name: ["bad"], ahead: 1, behind: 0 },
        worktree: { branch: false, ahead: 0, behind: 2 },
      },
    });

    await expect(getRunGitMergeStatus("run-1")).resolves.toEqual(
      expect.objectContaining({
        sourceBranch: {
          name: "unknown",
          ahead: 1,
          behind: 0,
        },
        worktreeBranch: {
          name: "unknown",
          ahead: 0,
          behind: 2,
        },
      }),
    );
  });

  it("parses backend action envelope state even when status is nested object", async () => {
    invokeMock.mockResolvedValueOnce({
      state: "accepted",
      status: { state: "accepted" },
      message: 42,
      conflict_summary: ["nope"],
      conflict_fingerprint: { id: "fp" },
    });
    invokeMock.mockResolvedValueOnce({
      state: null,
      reason: { text: "bad" },
      conflictSummary: 123,
      conflictFingerprint: false,
    });

    const rebase = await rebaseRunWorktreeOntoSource("run-1");
    const merge = await mergeRunWorktreeIntoSource("run-1");

    expect(rebase).toEqual({
      status: "accepted",
      message: undefined,
      conflictSummary: undefined,
      conflictFingerprint: undefined,
    });
    expect(merge).toEqual({
      status: "failed",
      message: undefined,
      conflictSummary: undefined,
      conflictFingerprint: undefined,
    });
  });

  it("maps nested backend rebase conflict payload without false failed state", async () => {
    invokeMock.mockResolvedValue({
      state: "conflict",
      status: {
        state: "rebase_conflict",
      },
      conflict: {
        chat_prompt: "Resolve conflicts in file A and B",
      },
    });

    const rebase = await rebaseRunWorktreeOntoSource("run-1");

    expect(rebase).toEqual({
      status: "conflict",
      message: undefined,
      conflictSummary: "Resolve conflicts in file A and B",
      conflictFingerprint: undefined,
    });
  });

  it("treats conflicted action state as conflict with nested status payload", async () => {
    invokeMock.mockResolvedValue({
      state: "conflicted",
      status: {
        state: "merge_conflict",
      },
      conflict: {
        chat_prompt: "Resolve merge conflicts",
      },
    });

    const merge = await mergeRunWorktreeIntoSource("run-1");

    expect(merge).toEqual({
      status: "conflict",
      message: undefined,
      conflictSummary: "Resolve merge conflicts",
      conflictFingerprint: undefined,
    });
  });

  it("keeps top-level action state canonical over nested status.state", async () => {
    invokeMock.mockResolvedValue({
      state: "accepted",
      status: {
        state: "conflicted",
      },
      conflict_summary: "nested should not win",
    });

    const rebase = await rebaseRunWorktreeOntoSource("run-1");

    expect(rebase).toEqual({
      status: "accepted",
      message: undefined,
      conflictSummary: "nested should not win",
      conflictFingerprint: undefined,
    });
  });

  it("does not map valid conflicted action state to failed", async () => {
    invokeMock.mockResolvedValue({
      state: "conflicted",
      message: "Conflict detected",
    });

    const rebase = await rebaseRunWorktreeOntoSource("run-1");

    expect(rebase.status).toBe("conflict");
    expect(rebase.message).toBe("Conflict detected");
  });

  it("preserves backend disable_reason for blocked rebase envelopes", async () => {
    invokeMock.mockResolvedValue({
      state: "blocked",
      status: {
        state: "noop",
        disable_reason: "Worktree must be clean before rebasing.",
      },
    });

    const rebase = await rebaseRunWorktreeOntoSource("run-1");

    expect(rebase).toEqual({
      status: "failed",
      message: "Worktree must be clean before rebasing.",
      conflictSummary: undefined,
      conflictFingerprint: undefined,
    });
  });

  it("maps accepted and conflict action states from nested status envelope", async () => {
    invokeMock.mockResolvedValueOnce({
      status: {
        state: "rebase-in-progress",
        message: "Rebase started",
      },
    });
    invokeMock.mockResolvedValueOnce({
      status: {
        state: "rebase_conflict",
        message: "Rebase hit conflicts",
      },
    });

    const accepted = await rebaseRunWorktreeOntoSource("run-1");
    const conflict = await rebaseRunWorktreeOntoSource("run-1");

    expect(accepted).toEqual({
      status: "accepted",
      message: "Rebase started",
      conflictSummary: undefined,
      conflictFingerprint: undefined,
    });
    expect(conflict).toEqual({
      status: "conflict",
      message: "Rebase hit conflicts",
      conflictSummary: undefined,
      conflictFingerprint: undefined,
    });
  });

  it("keeps unknown action state fallback safe and informative", async () => {
    invokeMock.mockResolvedValue({
      status: {
        state: "new_unhandled_state",
      },
    });

    const merge = await mergeRunWorktreeIntoSource("run-1");

    expect(merge.status).toBe("failed");
    expect(merge.message).toBe(
      "Rebase/merge backend state: new_unhandled_state.",
    );
  });

  it("invokes canonical rebase and merge git commands", async () => {
    invokeMock.mockResolvedValueOnce({
      status: "conflict",
      conflict_summary: "x",
    });
    invokeMock.mockResolvedValueOnce({ status: "merged" });

    const rebase = await rebaseRunWorktreeOntoSource("run-1");
    const merge = await mergeRunWorktreeIntoSource("run-1");

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "rebase_run_worktree_branch",
      {
        runId: "run-1",
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "merge_run_into_source_branch",
      {
        runId: "run-1",
      },
    );
    expect(rebase.status).toBe("conflict");
    expect(rebase.conflictSummary).toBe("x");
    expect(merge.status).toBe("merged");
  });
});
