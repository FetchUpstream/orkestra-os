import { Channel, invoke } from "@tauri-apps/api/core";

export const RUN_STATUSES = [
  "queued",
  "preparing",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export type Run = {
  id: string;
  taskId: string;
  projectId: string;
  runNumber?: number | null;
  displayKey?: string | null;
  targetRepoId?: string | null;
  status: RunStatus;
  triggeredBy: string;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  summary?: string | null;
  errorMessage?: string | null;
  worktreeId?: string | null;
  agentId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  sourceBranch?: string | null;
  initialPromptSentAt?: string | null;
  initialPromptClientRequestId?: string | null;
  setupState?: string | null;
  setupStartedAt?: string | null;
  setupFinishedAt?: string | null;
  setupErrorMessage?: string | null;
  cleanupState?: string | null;
  cleanupStartedAt?: string | null;
  cleanupFinishedAt?: string | null;
  cleanupErrorMessage?: string | null;
};

export type RunDiffFile = {
  path: string;
  additions: number;
  deletions: number;
  status: string;
};

export type RunDiffFilePayload = {
  path: string;
  additions: number;
  deletions: number;
  original: string;
  modified: string;
  language: string;
  status: string;
  isBinary: boolean;
  truncated: boolean;
};

export type RunTerminalDataFrame = {
  type: "data";
  chunkBase64: string;
};

export type RunTerminalExitFrame = {
  type: "exit";
  code: number | null;
  signal: number | string | null;
};

export type RunTerminalErrorFrame = {
  type: "error";
  message: string;
};

export type RunTerminalClosedFrame = {
  type: "closed";
};

export type RunTerminalFrame =
  | RunTerminalDataFrame
  | RunTerminalExitFrame
  | RunTerminalErrorFrame
  | RunTerminalClosedFrame;

export type RunOpenCodeAgentState =
  | "idle"
  | "accepted"
  | "starting"
  | "running"
  | "unsupported"
  | "error";

export type RunOpenCodeChatMode = "interactive" | "read_only" | "unavailable";

export type RunOpenCodeEvent = {
  runId: string;
  ts: string | number | null;
  event: string;
  data: unknown;
};

export type EnsureRunOpenCodeResult = {
  state?: RunOpenCodeAgentState;
  supported?: boolean;
  error?: string | null;
};

export type SubscribeRunOpenCodeEventsParams = {
  runId: string;
  subscriberId?: string;
  onOutput?: (event: RunOpenCodeEvent) => void;
  onOutputChannel?: (event: RunOpenCodeEvent) => void;
};

export type SubmitRunOpenCodePromptParams = {
  runId: string;
  prompt: string;
  clientRequestId?: string;
  agent?: string;
  agentId?: string;
  providerId?: string;
  modelId?: string;
};

export type RunSelectionOption = {
  id: string;
  label: string;
};

export type RunModelOption = RunSelectionOption & {
  providerId?: string;
};

export type RunSelectionOptions = {
  agents: RunSelectionOption[];
  providers: RunSelectionOption[];
  models: RunModelOption[];
};

export type SubmitRunOpenCodePromptResult = {
  status: "accepted" | "unsupported";
  reason?: string;
  queuedAt: string;
  clientRequestId?: string;
};

export type ReplyRunOpenCodePermissionParams = {
  runId: string;
  sessionId: string;
  requestId: string;
  decision: "allow" | "deny";
  remember?: boolean;
};

export type ReplyRunOpenCodePermissionResult = {
  status: "accepted" | "unsupported";
  reason?: string;
  repliedAt: string;
};

export type StartRunOpenCodeResult = {
  state: RunOpenCodeAgentState;
  reason?: string;
  queuedAt: string;
  clientRequestId: string;
  readyPhase?: string;
};

export type RunOpenCodeSessionMessagesResult = {
  messages: unknown[];
  raw: unknown;
};

export type RunOpenCodeSessionTodosResult = {
  todos: unknown[];
  raw: unknown;
};

export type BootstrapRunOpenCodeResult = {
  state: RunOpenCodeAgentState;
  chatMode: RunOpenCodeChatMode;
  reason?: string;
  bufferedEvents: RunOpenCodeEvent[];
  messages: unknown[];
  todos: unknown[];
  sessionId?: string;
  streamConnected: boolean;
  readyPhase?: string;
};

export type RunGitBranchSync = {
  name: string;
  ahead: number;
  behind: number;
};

export type RunGitMergeState =
  | "clean"
  | "needs_rebase"
  | "rebase_in_progress"
  | "mergeable"
  | "conflicted"
  | "merged"
  | "completing"
  | "ready"
  | "rebase_required"
  | "rebasing"
  | "rebase_conflict"
  | "rebase_failed"
  | "rebase_succeeded"
  | "merge_ready"
  | "merging"
  | "merge_conflict"
  | "merge_failed"
  | "merged"
  | "completing"
  | "completed"
  | "unsupported"
  | "unknown";

export type RunGitMergeStatus = {
  state: RunGitMergeState;
  rawState?: string;
  sourceBranch: RunGitBranchSync;
  worktreeBranch: RunGitBranchSync;
  isWorktreeClean?: boolean;
  isRebaseAllowed: boolean;
  isMergeAllowed: boolean;
  requiresRebase: boolean;
  rebaseDisabledReason?: string;
  mergeDisabledReason?: string;
  conflictSummary?: string;
  conflictFingerprint?: string;
};

export type RunGitRebaseResult = {
  status: "accepted" | "conflict" | "failed";
  message?: string;
  conflictSummary?: string;
  conflictFingerprint?: string;
};

export type RunGitMergeResult = {
  status: "accepted" | "conflict" | "failed" | "merged" | "completing";
  message?: string;
  conflictSummary?: string;
  conflictFingerprint?: string;
};

export const RUN_OPENCODE_EVENT_HISTORY_LIMIT = 500;

export const appendCappedHistory = <T>(
  current: T[],
  items: T | T[],
  maxSize = RUN_OPENCODE_EVENT_HISTORY_LIMIT,
): T[] => {
  const incoming = Array.isArray(items) ? items : [items];
  if (incoming.length === 0) {
    return current;
  }

  const cappedMaxSize = Math.max(1, Math.floor(maxSize));
  if (incoming.length >= cappedMaxSize) {
    return incoming.slice(incoming.length - cappedMaxSize);
  }

  const overflow = current.length + incoming.length - cappedMaxSize;
  if (overflow <= 0) {
    return [...current, ...incoming];
  }

  return [...current.slice(overflow), ...incoming];
};

export type OpenRunTerminalParams = {
  runId: string;
  routeInstanceId: string;
  cols: number;
  rows: number;
  onOutput: (frame: RunTerminalFrame) => void;
};

export type OpenRunTerminalResult = {
  sessionId: string;
  generation: number;
};

export type WriteRunTerminalParams = {
  sessionId: string;
  generation: number;
  data: string;
};

export type ResizeRunTerminalParams = {
  sessionId: string;
  generation: number;
  cols: number;
  rows: number;
};

export type KillRunTerminalParams = {
  sessionId: string;
  generation: number;
};

type RunDiffFileResponse = {
  path: string;
  additions: number;
  deletions: number;
  status: string;
};

type RunDiffFilePayloadResponse = {
  path: string;
  additions: number;
  deletions: number;
  original: string;
  modified: string;
  language: string;
  status: string;
  is_binary?: boolean;
  isBinary?: boolean;
  truncated: boolean;
};

type OpenRunTerminalResponse = {
  session_id?: string;
  sessionId?: string;
  generation: number;
};

type RunTerminalFrameResponse = {
  type?: string;
  event?: string;
  chunk_base64?: string;
  chunkBase64?: string;
  code?: number | null;
  signal?: number | string | null;
  message?: string;
};

type RunOpenCodeEventResponse = {
  run_id?: string;
  runId?: string;
  timestamp?: string | number | null;
  ts?: string | number | null;
  eventName?: string;
  event?: string;
  payload?: unknown;
  data?: unknown;
};

type SubmitRunOpenCodePromptResponse = {
  state?: string;
  status?: string;
  reason?: string | null;
  queued_at?: string;
  queuedAt?: string;
  client_request_id?: string | null;
  clientRequestId?: string | null;
};

type ReplyRunOpenCodePermissionResponse = {
  state?: string;
  status?: string;
  reason?: string | null;
  replied_at?: string;
  repliedAt?: string;
};

type RunOpenCodeSnapshotResponse = {
  messages?: unknown;
  todos?: unknown;
  items?: unknown;
  data?: unknown;
};

type BootstrapRunOpenCodeResponse = {
  state?: RunOpenCodeAgentState | string;
  chat_mode?: RunOpenCodeChatMode | string | null;
  chatMode?: RunOpenCodeChatMode | string | null;
  reason?: string | null;
  buffered_events?: unknown;
  bufferedEvents?: unknown;
  messages?: unknown;
  todos?: unknown;
  session_id?: string | null;
  sessionId?: string | null;
  stream_connected?: boolean;
  streamConnected?: boolean;
  ready_phase?: string | null;
  readyPhase?: string | null;
  bootstrap?: unknown;
  result?: unknown;
  data?: unknown;
  payload?: unknown;
};

type StartRunOpenCodeResponse = {
  state?: RunOpenCodeAgentState | string;
  reason?: string | null;
  queued_at?: string;
  queuedAt?: string;
  client_request_id?: string;
  clientRequestId?: string;
  ready_phase?: string | null;
  readyPhase?: string | null;
};

type RunResponse = {
  id: string;
  task_id?: string;
  taskId?: string;
  run_number?: number | null;
  runNumber?: number | null;
  display_key?: string | null;
  displayKey?: string | null;
  project_id?: string;
  projectId?: string;
  target_repo_id?: string | null;
  targetRepoId?: string | null;
  status: string;
  triggered_by?: string;
  triggeredBy?: string;
  created_at?: string;
  createdAt?: string;
  started_at?: string | null;
  startedAt?: string | null;
  finished_at?: string | null;
  finishedAt?: string | null;
  summary?: string | null;
  error_message?: string | null;
  errorMessage?: string | null;
  worktree_id?: string | null;
  worktreeId?: string | null;
  agent_id?: string | null;
  agentId?: string | null;
  provider_id?: string | null;
  providerId?: string | null;
  model_id?: string | null;
  modelId?: string | null;
  source_branch?: string | null;
  sourceBranch?: string | null;
  initial_prompt_sent_at?: string | null;
  initialPromptSentAt?: string | null;
  initial_prompt_client_request_id?: string | null;
  initialPromptClientRequestId?: string | null;
  setup_state?: string | null;
  setupState?: string | null;
  setup_started_at?: string | null;
  setupStartedAt?: string | null;
  setup_finished_at?: string | null;
  setupFinishedAt?: string | null;
  setup_error_message?: string | null;
  setupErrorMessage?: string | null;
  cleanup_state?: string | null;
  cleanupState?: string | null;
  cleanup_started_at?: string | null;
  cleanupStartedAt?: string | null;
  cleanup_finished_at?: string | null;
  cleanupFinishedAt?: string | null;
  cleanup_error_message?: string | null;
  cleanupErrorMessage?: string | null;
};

type RunSelectionItemResponse = {
  id?: string;
  agent_id?: string;
  agentId?: string;
  model_id?: string;
  modelId?: string;
  model_name?: string;
  modelName?: string;
  value?: string;
  key?: string;
  name?: string;
  label?: string;
  display_name?: string;
  displayName?: string;
  provider_id?: string;
  providerId?: string;
};

type RunSelectionOptionsResponse = {
  agents?: unknown;
  providers?: unknown;
  models?: unknown;
  data?: unknown;
  payload?: unknown;
  result?: unknown;
};

type RunGitBranchSyncResponse = {
  name?: string;
  branch?: string;
  ahead?: number;
  behind?: number;
};

type RunGitMergeStatusResponse = {
  state?: string;
  source_branch?: unknown;
  sourceBranch?: unknown;
  worktree_branch?: unknown;
  worktreeBranch?: unknown;
  source_ahead?: number;
  sourceAhead?: number;
  source_behind?: number;
  sourceBehind?: number;
  worktree_ahead?: number;
  worktreeAhead?: number;
  worktree_behind?: number;
  worktreeBehind?: number;
  ahead_count?: number;
  aheadCount?: number;
  behind_count?: number;
  behindCount?: number;
  is_worktree_clean?: boolean;
  isWorktreeClean?: boolean;
  source?: RunGitBranchSyncResponse;
  worktree?: RunGitBranchSyncResponse;
  branches?: {
    source?: RunGitBranchSyncResponse;
    worktree?: RunGitBranchSyncResponse;
  };
  can_rebase?: boolean;
  canRebase?: boolean;
  can_merge?: boolean;
  canMerge?: boolean;
  requires_rebase?: boolean;
  requiresRebase?: boolean;
  rebase_disabled_reason?: string | null;
  rebaseDisabledReason?: string | null;
  merge_disabled_reason?: string | null;
  mergeDisabledReason?: string | null;
  disable_reason?: string | null;
  disableReason?: string | null;
  conflict_summary?: string | null;
  conflictSummary?: string | null;
  conflict_fingerprint?: string | null;
  conflictFingerprint?: string | null;
  status?: unknown;
  data?: unknown;
  payload?: unknown;
  result?: unknown;
};

type RunGitActionResponse = {
  status?: string;
  state?: string;
  disable_reason?: string | null;
  disableReason?: string | null;
  conflict?: {
    chat_prompt?: string | null;
    chatPrompt?: string | null;
  };
  error?: string | null;
  message?: string | null;
  reason?: string | null;
  conflict_summary?: string | null;
  conflictSummary?: string | null;
  conflict_fingerprint?: string | null;
  conflictFingerprint?: string | null;
};

type RunGitActionEnvelopeResponse = RunGitActionResponse & {
  status?: unknown;
  data?: unknown;
  payload?: unknown;
  result?: unknown;
};

const runStatusSet = new Set<string>(RUN_STATUSES);

const toRunStatus = (status: string): RunStatus => {
  if (runStatusSet.has(status)) return status as RunStatus;
  return "queued";
};

const pick = <T>(snake: T | undefined, camel: T | undefined): T | undefined =>
  snake !== undefined ? snake : camel;

const toRun = (run: RunResponse): Run => ({
  id: run.id,
  taskId: pick(run.task_id, run.taskId) ?? "",
  projectId: pick(run.project_id, run.projectId) ?? "",
  runNumber: pick(run.run_number, run.runNumber),
  displayKey: pick(run.display_key, run.displayKey),
  targetRepoId: pick(run.target_repo_id, run.targetRepoId),
  status: toRunStatus(run.status),
  triggeredBy: pick(run.triggered_by, run.triggeredBy) ?? "",
  createdAt: pick(run.created_at, run.createdAt) ?? "",
  startedAt: pick(run.started_at, run.startedAt),
  finishedAt: pick(run.finished_at, run.finishedAt),
  summary: run.summary,
  errorMessage: pick(run.error_message, run.errorMessage),
  worktreeId: pick(run.worktree_id, run.worktreeId),
  agentId: pick(run.agent_id, run.agentId),
  providerId: pick(run.provider_id, run.providerId),
  modelId: pick(run.model_id, run.modelId),
  sourceBranch: pick(run.source_branch, run.sourceBranch),
  initialPromptSentAt: pick(
    run.initial_prompt_sent_at,
    run.initialPromptSentAt,
  ),
  initialPromptClientRequestId: pick(
    run.initial_prompt_client_request_id,
    run.initialPromptClientRequestId,
  ),
  setupState: pick(run.setup_state, run.setupState),
  setupStartedAt: pick(run.setup_started_at, run.setupStartedAt),
  setupFinishedAt: pick(run.setup_finished_at, run.setupFinishedAt),
  setupErrorMessage: pick(run.setup_error_message, run.setupErrorMessage),
  cleanupState: pick(run.cleanup_state, run.cleanupState),
  cleanupStartedAt: pick(run.cleanup_started_at, run.cleanupStartedAt),
  cleanupFinishedAt: pick(run.cleanup_finished_at, run.cleanupFinishedAt),
  cleanupErrorMessage: pick(run.cleanup_error_message, run.cleanupErrorMessage),
});

const toRunDiffFile = (file: RunDiffFileResponse): RunDiffFile => ({
  path: file.path,
  additions: file.additions,
  deletions: file.deletions,
  status: file.status,
});

const toRunDiffFilePayload = (
  payload: RunDiffFilePayloadResponse,
): RunDiffFilePayload => ({
  path: payload.path,
  additions: payload.additions,
  deletions: payload.deletions,
  original: payload.original,
  modified: payload.modified,
  language: payload.language,
  status: payload.status,
  isBinary: pick(payload.is_binary, payload.isBinary) ?? false,
  truncated: payload.truncated,
});

const toRunTerminalFrame = (
  frame: RunTerminalFrameResponse,
): RunTerminalFrame | null => {
  const frameType = frame.event ?? frame.type;

  if (frameType === "data") {
    const chunkBase64 = pick(frame.chunk_base64, frame.chunkBase64);
    if (typeof chunkBase64 === "string") {
      return { type: "data", chunkBase64 };
    }
    return null;
  }

  if (frameType === "exit") {
    return {
      type: "exit",
      code: frame.code ?? null,
      signal: frame.signal ?? null,
    };
  }

  if (frameType === "error") {
    return {
      type: "error",
      message: frame.message ?? "Terminal stream error.",
    };
  }

  if (frameType === "closed") {
    return { type: "closed" };
  }

  return null;
};

const toRunOpenCodeEvent = (
  event: RunOpenCodeEventResponse,
  fallbackRunId: string,
): RunOpenCodeEvent => ({
  runId: pick(event.run_id, event.runId) ?? fallbackRunId,
  ts: pick(event.timestamp, event.ts) ?? null,
  event: pick(event.eventName, event.event) ?? "unknown",
  data: pick(event.payload, event.data) ?? null,
});

const toUnknownArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as RunOpenCodeSnapshotResponse;
  if (Array.isArray(record.items)) {
    return record.items;
  }
  if (Array.isArray(record.data)) {
    return record.data;
  }

  return [];
};

const unwrapSnapshotPayload = (item: unknown): unknown => {
  if (item && typeof item === "object" && "payload" in item) {
    return (item as { payload: unknown }).payload;
  }
  return item;
};

const unwrapSnapshotItems = (items: unknown[]): unknown[] => {
  return items.map(unwrapSnapshotPayload);
};

const toRunOpenCodeAgentState = (state: unknown): RunOpenCodeAgentState => {
  if (
    state === "idle" ||
    state === "accepted" ||
    state === "starting" ||
    state === "running" ||
    state === "unsupported" ||
    state === "error"
  ) {
    return state;
  }
  return "idle";
};

const toRunOpenCodeChatMode = (
  value: unknown,
  fallbackState: RunOpenCodeAgentState,
): RunOpenCodeChatMode => {
  if (
    value === "interactive" ||
    value === "read_only" ||
    value === "unavailable"
  ) {
    return value;
  }

  if (fallbackState === "unsupported") {
    return "unavailable";
  }

  return "interactive";
};

const unwrapBootstrapRunOpenCodePayload = (
  response: unknown,
): BootstrapRunOpenCodeResponse => {
  if (!response || typeof response !== "object") {
    return {};
  }

  const record = response as BootstrapRunOpenCodeResponse;
  const wrapped = pick(
    record.bootstrap,
    pick(record.result, pick(record.data, record.payload)),
  );

  if (wrapped && typeof wrapped === "object") {
    return wrapped as BootstrapRunOpenCodeResponse;
  }

  return record;
};

const toSafeCount = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  return 0;
};

const toOptionalTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

const toSelectionLabel = (
  value: RunSelectionItemResponse,
  fallbackLabel: string,
): string => {
  const label = toOptionalTrimmedString(
    value.display_name ?? value.displayName ?? value.label ?? value.name,
  );
  if (label) {
    return label;
  }
  return fallbackLabel;
};

const toModelSelectionLabel = (value: RunSelectionItemResponse): string => {
  const label = toOptionalTrimmedString(
    value.display_name ??
      value.displayName ??
      value.label ??
      value.name ??
      value.model_name ??
      value.modelName,
  );
  if (label) {
    return label;
  }
  return "Model";
};

const toSelectionId = (value: RunSelectionItemResponse): string => {
  return (
    toOptionalTrimmedString(
      value.id ??
        value.agent_id ??
        value.agentId ??
        value.model_id ??
        value.modelId ??
        value.value ??
        value.key,
    ) ?? ""
  );
};

const toSelectionList = (
  response: unknown,
  key: "agents" | "providers" | "models",
): unknown[] => {
  if (Array.isArray(response)) {
    return response;
  }
  if (!response || typeof response !== "object") {
    return [];
  }

  const direct = (response as Record<string, unknown>)[key];
  if (Array.isArray(direct)) {
    return direct;
  }

  const payload = unwrapRunSelectionOptionsPayload(response);
  const nested = payload[key];
  return Array.isArray(nested) ? nested : [];
};

const toSelectionOptions = (
  source: unknown,
  fallbackLabel: string,
): RunSelectionOption[] => {
  if (!Array.isArray(source)) {
    return [];
  }
  return source
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const value = item as RunSelectionItemResponse;
      const id = toSelectionId(value);
      if (!id) {
        return null;
      }
      return {
        id,
        label: toSelectionLabel(value, fallbackLabel),
      };
    })
    .filter((item): item is RunSelectionOption => item !== null);
};

const toModelSelectionOptions = (source: unknown): RunModelOption[] => {
  if (!Array.isArray(source)) {
    return [];
  }
  return source
    .map((item): RunModelOption | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const value = item as RunSelectionItemResponse;
      const id = toSelectionId(value);
      if (!id) {
        return null;
      }
      const providerId = toOptionalTrimmedString(
        value.provider_id ?? value.providerId,
      );
      return {
        id,
        label: toModelSelectionLabel(value),
        ...(providerId ? { providerId } : {}),
      };
    })
    .filter((item): item is RunModelOption => item !== null);
};

const unwrapRunSelectionOptionsPayload = (
  response: unknown,
): RunSelectionOptionsResponse => {
  if (!response || typeof response !== "object") {
    return {};
  }

  const record = response as RunSelectionOptionsResponse;
  const wrapped = pick(record.data, pick(record.payload, record.result));
  if (wrapped && typeof wrapped === "object") {
    return wrapped as RunSelectionOptionsResponse;
  }
  return record;
};

const toRunSelectionOptions = (response: unknown): RunSelectionOptions => {
  const payload = unwrapRunSelectionOptionsPayload(response);
  return {
    agents: toSelectionOptions(payload.agents, "Agent"),
    providers: toSelectionOptions(payload.providers, "Provider"),
    models: toModelSelectionOptions(payload.models),
  };
};

const toRunGitMergeState = (state: unknown): RunGitMergeState => {
  const normalizedState = toOptionalTrimmedString(state)
    ?.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
  if (!normalizedState) {
    return "unknown";
  }

  switch (normalizedState) {
    case "ready":
    case "clean":
    case "needs_rebase":
    case "rebase_in_progress":
    case "mergeable":
    case "conflicted":
    case "rebase_required":
    case "rebasing":
    case "rebase_conflict":
    case "rebase_failed":
    case "rebase_succeeded":
    case "merge_ready":
    case "merging":
    case "merge_conflict":
    case "merge_failed":
    case "merged":
    case "completing":
    case "completed":
    case "unsupported":
      return normalizedState as RunGitMergeState;
    default:
      return "unknown";
  }
};

const toRunGitBranchSync = (
  fallbackName: unknown,
  branch: RunGitBranchSyncResponse | undefined,
  fallbackAhead: unknown,
  fallbackBehind: unknown,
): RunGitBranchSync => {
  const name =
    toOptionalTrimmedString(branch?.name) ||
    toOptionalTrimmedString(branch?.branch) ||
    toOptionalTrimmedString(fallbackName) ||
    "unknown";

  return {
    name,
    ahead: toSafeCount(branch?.ahead ?? fallbackAhead),
    behind: toSafeCount(branch?.behind ?? fallbackBehind),
  };
};

const unwrapRunGitMergeStatusPayload = (
  response: unknown,
): RunGitMergeStatusResponse => {
  if (!response || typeof response !== "object") {
    return {};
  }

  const record = response as RunGitMergeStatusResponse;
  const wrapped = pick(
    record.status,
    pick(record.data, pick(record.payload, record.result)),
  );

  if (wrapped && typeof wrapped === "object") {
    return wrapped as RunGitMergeStatusResponse;
  }

  return record;
};

const toRunGitMergeStatus = (response: unknown): RunGitMergeStatus => {
  const payload = unwrapRunGitMergeStatusPayload(response);
  const rawState = toOptionalTrimmedString(payload.state);
  const state = toRunGitMergeState(payload.state);
  const source = pick(payload.source, payload.branches?.source);
  const worktree = pick(payload.worktree, payload.branches?.worktree);
  const worktreeAheadCount = pick(payload.ahead_count, payload.aheadCount);
  const worktreeBehindCount = pick(payload.behind_count, payload.behindCount);

  const sourceBranch = toRunGitBranchSync(
    pick(payload.source_branch, payload.sourceBranch) ?? "source",
    source,
    pick(payload.source_ahead, payload.sourceAhead) ?? worktreeBehindCount,
    pick(payload.source_behind, payload.sourceBehind) ?? worktreeAheadCount,
  );

  const worktreeBranch = toRunGitBranchSync(
    pick(payload.worktree_branch, payload.worktreeBranch) ?? "worktree",
    worktree,
    pick(payload.worktree_ahead, payload.worktreeAhead) ?? worktreeAheadCount,
    pick(payload.worktree_behind, payload.worktreeBehind) ??
      worktreeBehindCount,
  );

  return {
    state,
    rawState: state === "unknown" ? rawState : undefined,
    sourceBranch,
    worktreeBranch,
    isWorktreeClean:
      pick(payload.is_worktree_clean, payload.isWorktreeClean) === true
        ? true
        : pick(payload.is_worktree_clean, payload.isWorktreeClean) === false
          ? false
          : undefined,
    isRebaseAllowed: pick(payload.can_rebase, payload.canRebase) === true,
    isMergeAllowed: pick(payload.can_merge, payload.canMerge) === true,
    requiresRebase:
      pick(payload.requires_rebase, payload.requiresRebase) === true,
    rebaseDisabledReason: toOptionalTrimmedString(
      pick(
        pick(payload.rebase_disabled_reason, payload.rebaseDisabledReason),
        pick(payload.disable_reason, payload.disableReason),
      ),
    ),
    mergeDisabledReason: toOptionalTrimmedString(
      pick(
        pick(payload.merge_disabled_reason, payload.mergeDisabledReason),
        pick(payload.disable_reason, payload.disableReason),
      ),
    ),
    conflictSummary: toOptionalTrimmedString(
      pick(payload.conflict_summary, payload.conflictSummary),
    ),
    conflictFingerprint: toOptionalTrimmedString(
      pick(payload.conflict_fingerprint, payload.conflictFingerprint),
    ),
  };
};

const toRunGitActionResult = (
  response: unknown,
): {
  status: string;
  message?: string;
  conflictSummary?: string;
  conflictFingerprint?: string;
} => {
  if (!response || typeof response !== "object") {
    return { status: "failed", message: "Unexpected empty backend response." };
  }

  const record = response as RunGitActionEnvelopeResponse;
  const topLevelState = toOptionalTrimmedString(record.state);
  const wrapped =
    (record.status && typeof record.status === "object"
      ? record.status
      : undefined) ??
    (record.data && typeof record.data === "object"
      ? record.data
      : undefined) ??
    (record.payload && typeof record.payload === "object"
      ? record.payload
      : undefined) ??
    (record.result && typeof record.result === "object"
      ? record.result
      : undefined);
  const payload =
    wrapped && typeof wrapped === "object"
      ? ({ ...record, ...(wrapped as object) } as RunGitActionResponse)
      : (record as RunGitActionResponse);

  const nestedStatusState =
    record.status && typeof record.status === "object"
      ? (toOptionalTrimmedString(
          (record.status as { state?: unknown; status?: unknown }).state,
        ) ??
        toOptionalTrimmedString(
          (record.status as { state?: unknown; status?: unknown }).status,
        ))
      : undefined;

  const rawStatus =
    topLevelState ??
    nestedStatusState ??
    toOptionalTrimmedString(payload.state) ??
    toOptionalTrimmedString(payload.status);

  const normalizedStatus = rawStatus
    ?.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();

  const conflictMessage = toOptionalTrimmedString(
    pick(payload.conflict?.chat_prompt, payload.conflict?.chatPrompt),
  );

  const message = toOptionalTrimmedString(
    payload.message ??
      pick(payload.disable_reason, payload.disableReason) ??
      payload.reason ??
      payload.error,
  );

  const knownActionStates = new Set([
    "accepted",
    "ok",
    "rebasing",
    "rebase_in_progress",
    "rebase_succeeded",
    "conflict",
    "rebase_conflict",
    "conflicted",
    "merged",
    "completed",
    "completing",
    "merging",
    "merge_ready",
    "merge_conflict",
    "failed",
    "noop",
    "blocked",
  ]);

  return {
    status: normalizedStatus ?? "failed",
    message:
      message ??
      (normalizedStatus && !knownActionStates.has(normalizedStatus)
        ? `Rebase/merge backend state: ${normalizedStatus}.`
        : undefined),
    conflictSummary: toOptionalTrimmedString(
      pick(payload.conflict_summary, payload.conflictSummary) ??
        conflictMessage,
    ),
    conflictFingerprint: toOptionalTrimmedString(
      pick(payload.conflict_fingerprint, payload.conflictFingerprint),
    ),
  };
};

const toBootstrapRunOpenCodeResult = (
  runId: string,
  response: unknown,
): BootstrapRunOpenCodeResult => {
  const record = unwrapBootstrapRunOpenCodePayload(response);
  const rawBufferedEvents = pick(record.buffered_events, record.bufferedEvents);
  const state = toRunOpenCodeAgentState(record.state);

  return {
    state,
    chatMode: toRunOpenCodeChatMode(
      pick(record.chat_mode, record.chatMode),
      state,
    ),
    reason: record.reason ?? undefined,
    bufferedEvents: toUnknownArray(rawBufferedEvents).map((event) =>
      toRunOpenCodeEvent(event as RunOpenCodeEventResponse, runId),
    ),
    messages: unwrapSnapshotItems(toUnknownArray(record.messages)),
    todos: unwrapSnapshotItems(toUnknownArray(record.todos)),
    sessionId: pick(record.session_id, record.sessionId) ?? undefined,
    streamConnected:
      pick(record.stream_connected, record.streamConnected) ?? false,
    readyPhase: pick(record.ready_phase, record.readyPhase) ?? undefined,
  };
};

export const createRun = async (
  taskId: string,
  defaults?: {
    agentId?: string;
    providerId?: string;
    modelId?: string;
  },
): Promise<Run> => {
  const response = await invoke<RunResponse>("create_run", {
    request: {
      taskId,
      agentId: defaults?.agentId,
      providerId: defaults?.providerId,
      modelId: defaults?.modelId,
    },
  });
  return toRun(response);
};

export const getRunSelectionOptions = async (
  projectId: string,
): Promise<RunSelectionOptions> => {
  const selectionCatalog = await invoke<unknown>(
    "get_project_opencode_selection_catalog",
    {
      projectId,
    },
  );

  const agentsPayload = toSelectionList(selectionCatalog, "agents");
  const providersPayload = toSelectionList(selectionCatalog, "providers");

  const providers = toSelectionOptions(providersPayload, "Provider");
  const models = toModelSelectionOptions(
    Array.isArray(providersPayload)
      ? providersPayload.flatMap((provider) => {
          if (!provider || typeof provider !== "object") return [];
          const providerRecord = provider as {
            id?: string;
            models?: unknown[];
          };
          if (!Array.isArray(providerRecord.models)) return [];
          return providerRecord.models.map((model) => ({
            ...(model && typeof model === "object" ? model : {}),
            providerId: providerRecord.id,
          }));
        })
      : [],
  );

  return toRunSelectionOptions({
    agents: agentsPayload,
    providers,
    models,
  });
};

export const listTaskRuns = async (taskId: string): Promise<Run[]> => {
  const response = await invoke<RunResponse[]>("list_task_runs", { taskId });
  return response.map(toRun);
};

export const getRun = async (runId: string): Promise<Run> => {
  const response = await invoke<RunResponse>("get_run", { runId });
  return toRun(response);
};

export const deleteRun = async (runId: string): Promise<void> => {
  await invoke("delete_run", { runId });
};

export const listRunDiffFiles = async (
  runId: string,
): Promise<RunDiffFile[]> => {
  const response = await invoke<RunDiffFileResponse[]>("list_run_diff_files", {
    runId,
  });
  return response.map(toRunDiffFile);
};

export const getRunDiffFile = async (
  runId: string,
  path: string,
): Promise<RunDiffFilePayload> => {
  const response = await invoke<RunDiffFilePayloadResponse>(
    "get_run_diff_file",
    {
      runId,
      path,
    },
  );
  return toRunDiffFilePayload(response);
};

export const setRunDiffWatch = async (
  runId: string,
  enabled: boolean,
): Promise<void> => {
  await invoke("set_run_diff_watch", { runId, enabled });
};

export const openRunTerminal = async ({
  runId,
  routeInstanceId,
  cols,
  rows,
  onOutput,
}: OpenRunTerminalParams): Promise<OpenRunTerminalResult> => {
  const outputChannel = new Channel<RunTerminalFrameResponse>();
  outputChannel.onmessage = (frame) => {
    const parsedFrame = toRunTerminalFrame(frame);
    if (!parsedFrame) return;
    onOutput(parsedFrame);
  };

  const response = await invoke<OpenRunTerminalResponse>("open_run_terminal", {
    runId,
    routeInstanceId,
    cols,
    rows,
    onOutput: outputChannel,
  });

  const sessionId = pick(response.session_id, response.sessionId);
  if (!sessionId) {
    throw new Error("Terminal session ID missing from backend response.");
  }

  return {
    sessionId,
    generation: response.generation,
  };
};

export const writeRunTerminal = async ({
  sessionId,
  generation,
  data,
}: WriteRunTerminalParams): Promise<void> => {
  await invoke("write_run_terminal", {
    sessionId,
    generation,
    data,
  });
};

export const resizeRunTerminal = async ({
  sessionId,
  generation,
  cols,
  rows,
}: ResizeRunTerminalParams): Promise<void> => {
  await invoke("resize_run_terminal", {
    sessionId,
    generation,
    cols,
    rows,
  });
};

export const killRunTerminal = async ({
  sessionId,
  generation,
}: KillRunTerminalParams): Promise<void> => {
  await invoke("kill_run_terminal", {
    sessionId,
    generation,
  });
};

export const ensureRunOpenCode = async (
  runId: string,
): Promise<EnsureRunOpenCodeResult> => {
  return invoke<EnsureRunOpenCodeResult>("ensure_run_opencode", {
    runId,
  });
};

export const bootstrapRunOpenCode = async (
  runId: string,
): Promise<BootstrapRunOpenCodeResult> => {
  const response = await invoke<unknown>("bootstrap_run_opencode", {
    runId,
  });
  return toBootstrapRunOpenCodeResult(runId, response);
};

export const getBufferedRunOpenCodeEvents = async (
  runId: string,
): Promise<RunOpenCodeEvent[]> => {
  const response = await invoke<RunOpenCodeEventResponse[]>(
    "get_buffered_run_opencode_events",
    { runId },
  );
  return response.map((event) => toRunOpenCodeEvent(event, runId));
};

export const getRunOpenCodeSessionMessages = async (
  runId: string,
): Promise<RunOpenCodeSessionMessagesResult> => {
  const response = await invoke<unknown>("get_run_opencode_session_messages", {
    runId,
  });

  if (Array.isArray(response)) {
    return {
      messages: unwrapSnapshotItems(response),
      raw: response,
    };
  }

  const record =
    response && typeof response === "object"
      ? (response as RunOpenCodeSnapshotResponse)
      : null;

  if (record && Array.isArray(record.messages)) {
    return {
      messages: unwrapSnapshotItems(record.messages),
      raw: response,
    };
  }

  return {
    messages: unwrapSnapshotItems(toUnknownArray(response)),
    raw: response,
  };
};

export const getRunOpenCodeSessionTodos = async (
  runId: string,
): Promise<RunOpenCodeSessionTodosResult> => {
  const response = await invoke<unknown>("get_run_opencode_session_todos", {
    runId,
  });

  if (Array.isArray(response)) {
    return {
      todos: unwrapSnapshotItems(response),
      raw: response,
    };
  }

  const record =
    response && typeof response === "object"
      ? (response as RunOpenCodeSnapshotResponse)
      : null;

  if (record && Array.isArray(record.todos)) {
    return {
      todos: unwrapSnapshotItems(record.todos),
      raw: response,
    };
  }

  return {
    todos: unwrapSnapshotItems(toUnknownArray(response)),
    raw: response,
  };
};

export const subscribeRunOpenCodeEvents = async ({
  runId,
  subscriberId,
  onOutput,
  onOutputChannel,
}: SubscribeRunOpenCodeEventsParams): Promise<() => void> => {
  const handler = onOutput ?? onOutputChannel;
  if (!handler) {
    throw new Error("subscribeRunOpenCodeEvents requires an output handler.");
  }

  const outputChannel = new Channel<RunOpenCodeEventResponse>();
  outputChannel.onmessage = (event) => {
    handler(toRunOpenCodeEvent(event, runId));
  };

  await invoke("subscribe_run_opencode_events", {
    runId,
    subscriberId,
    onOutput: outputChannel,
  });

  return () => {
    outputChannel.onmessage = () => {};
  };
};

export const unsubscribeRunOpenCodeEvents = async (
  runId: string,
  subscriberId?: string,
): Promise<void> => {
  if (!subscriberId) {
    return;
  }

  await invoke("unsubscribe_run_opencode_events", {
    runId,
    subscriberId,
  });
};

export const submitRunOpenCodePrompt = async ({
  runId,
  prompt,
  clientRequestId,
  agent,
  agentId,
  providerId,
  modelId,
}: SubmitRunOpenCodePromptParams): Promise<SubmitRunOpenCodePromptResult> => {
  const response = await invoke<SubmitRunOpenCodePromptResponse>(
    "submit_run_opencode_prompt",
    {
      request: {
        runId,
        prompt,
        clientRequestId,
        agent,
        agentId,
        providerId,
        modelId,
      },
    },
  );

  const submitState = response.state ?? response.status;

  return {
    status: submitState === "unsupported" ? "unsupported" : "accepted",
    reason: response.reason ?? undefined,
    queuedAt: pick(response.queued_at, response.queuedAt) ?? "",
    clientRequestId:
      pick(response.client_request_id, response.clientRequestId) ?? undefined,
  };
};

export const replyRunOpenCodePermission = async ({
  runId,
  sessionId,
  requestId,
  decision,
  remember = false,
}: ReplyRunOpenCodePermissionParams): Promise<ReplyRunOpenCodePermissionResult> => {
  const response = await invoke<ReplyRunOpenCodePermissionResponse>(
    "reply_run_opencode_permission",
    {
      request: {
        runId,
        sessionId,
        requestId,
        decision,
        remember,
      },
    },
  );

  const state = response.state ?? response.status;
  return {
    status: state === "unsupported" ? "unsupported" : "accepted",
    reason: response.reason ?? undefined,
    repliedAt: pick(response.replied_at, response.repliedAt) ?? "",
  };
};

export const startRunOpenCode = async (
  runId: string,
): Promise<StartRunOpenCodeResult> => {
  const response = await invoke<StartRunOpenCodeResponse>(
    "start_run_opencode",
    {
      runId,
    },
  );

  return {
    state: toRunOpenCodeAgentState(response.state),
    reason: response.reason ?? undefined,
    queuedAt: pick(response.queued_at, response.queuedAt) ?? "",
    clientRequestId:
      pick(response.client_request_id, response.clientRequestId) ?? "",
    readyPhase: pick(response.ready_phase, response.readyPhase) ?? undefined,
  };
};

export const getRunGitMergeStatus = async (
  runId: string,
): Promise<RunGitMergeStatus> => {
  const response = await invoke<unknown>("get_run_git_merge_status", {
    runId,
  });
  return toRunGitMergeStatus(response);
};

export const rebaseRunWorktreeOntoSource = async (
  runId: string,
): Promise<RunGitRebaseResult> => {
  const response = await invoke<unknown>("rebase_run_worktree_branch", {
    runId,
  });
  const result = toRunGitActionResult(response);

  if (
    result.status === "accepted" ||
    result.status === "ok" ||
    result.status === "rebasing" ||
    result.status === "rebase_in_progress" ||
    result.status === "rebase_succeeded"
  ) {
    return {
      status: "accepted",
      message: result.message,
      conflictSummary: result.conflictSummary,
      conflictFingerprint: result.conflictFingerprint,
    };
  }
  if (result.status === "conflict" || result.status === "rebase_conflict") {
    return {
      status: "conflict",
      message: result.message,
      conflictSummary: result.conflictSummary,
      conflictFingerprint: result.conflictFingerprint,
    };
  }
  if (result.status === "conflicted") {
    return {
      status: "conflict",
      message: result.message,
      conflictSummary: result.conflictSummary,
      conflictFingerprint: result.conflictFingerprint,
    };
  }
  return {
    status: "failed",
    message: result.message,
    conflictSummary: result.conflictSummary,
    conflictFingerprint: result.conflictFingerprint,
  };
};

export const mergeRunWorktreeIntoSource = async (
  runId: string,
): Promise<RunGitMergeResult> => {
  const response = await invoke<unknown>("merge_run_into_source_branch", {
    runId,
  });
  const result = toRunGitActionResult(response);

  if (result.status === "merged" || result.status === "completed") {
    return {
      status: "merged",
      message: result.message,
      conflictSummary: result.conflictSummary,
      conflictFingerprint: result.conflictFingerprint,
    };
  }
  if (result.status === "completing" || result.status === "merging") {
    return {
      status: "completing",
      message: result.message,
      conflictSummary: result.conflictSummary,
      conflictFingerprint: result.conflictFingerprint,
    };
  }
  if (
    result.status === "accepted" ||
    result.status === "ok" ||
    result.status === "merge_ready"
  ) {
    return {
      status: "accepted",
      message: result.message,
      conflictSummary: result.conflictSummary,
      conflictFingerprint: result.conflictFingerprint,
    };
  }
  if (result.status === "conflict" || result.status === "merge_conflict") {
    return {
      status: "conflict",
      message: result.message,
      conflictSummary: result.conflictSummary,
      conflictFingerprint: result.conflictFingerprint,
    };
  }
  if (result.status === "conflicted") {
    return {
      status: "conflict",
      message: result.message,
      conflictSummary: result.conflictSummary,
      conflictFingerprint: result.conflictFingerprint,
    };
  }
  return {
    status: "failed",
    message: result.message,
    conflictSummary: result.conflictSummary,
    conflictFingerprint: result.conflictFingerprint,
  };
};
