import { invoke } from "@tauri-apps/api/core";

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
  sourceBranch?: string | null;
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
  source_branch?: string | null;
  sourceBranch?: string | null;
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
  sourceBranch: pick(run.source_branch, run.sourceBranch),
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

export const createRun = async (taskId: string): Promise<Run> => {
  const response = await invoke<RunResponse>("create_run", { taskId });
  return toRun(response);
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
