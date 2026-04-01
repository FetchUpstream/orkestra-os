DROP INDEX IF EXISTS idx_runs_single_active_per_task;
DROP INDEX IF EXISTS idx_runs_status;
DROP INDEX IF EXISTS idx_runs_project_id_created_at;
DROP INDEX IF EXISTS idx_runs_task_id_created_at;

CREATE TABLE runs__new (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  target_repo_id TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'in_progress', 'idle', 'complete', 'failed', 'cancelled')),
  triggered_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT NULL,
  finished_at TEXT NULL,
  summary TEXT NULL,
  error_message TEXT NULL,
  worktree_id TEXT NULL,
  agent_id TEXT NULL,
  source_branch TEXT NULL,
  opencode_session_id TEXT NULL,
  initial_prompt_sent_at TEXT NULL,
  initial_prompt_client_request_id TEXT NULL,
  initial_prompt_claimed_at TEXT NULL,
  initial_prompt_claim_request_id TEXT NULL,
  setup_state TEXT NOT NULL DEFAULT 'pending',
  setup_started_at TEXT NULL,
  setup_finished_at TEXT NULL,
  setup_error_message TEXT NULL,
  cleanup_state TEXT NOT NULL DEFAULT 'pending',
  cleanup_started_at TEXT NULL,
  cleanup_finished_at TEXT NULL,
  cleanup_error_message TEXT NULL,
  provider_id TEXT NULL,
  model_id TEXT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  FOREIGN KEY (target_repo_id) REFERENCES project_repositories (id) ON DELETE SET NULL
);

INSERT INTO runs__new (
  id,
  task_id,
  project_id,
  target_repo_id,
  status,
  triggered_by,
  created_at,
  started_at,
  finished_at,
  summary,
  error_message,
  worktree_id,
  agent_id,
  source_branch,
  opencode_session_id,
  initial_prompt_sent_at,
  initial_prompt_client_request_id,
  initial_prompt_claimed_at,
  initial_prompt_claim_request_id,
  setup_state,
  setup_started_at,
  setup_finished_at,
  setup_error_message,
  cleanup_state,
  cleanup_started_at,
  cleanup_finished_at,
  cleanup_error_message,
  provider_id,
  model_id
)
SELECT
  id,
  task_id,
  project_id,
  target_repo_id,
  CASE
    WHEN status IN ('queued', 'preparing', 'running', 'in_progress', 'idle') THEN 'idle'
    WHEN status IN ('completed', 'complete') THEN 'complete'
    ELSE status
  END,
  triggered_by,
  created_at,
  started_at,
  finished_at,
  summary,
  error_message,
  worktree_id,
  agent_id,
  source_branch,
  opencode_session_id,
  initial_prompt_sent_at,
  initial_prompt_client_request_id,
  initial_prompt_claimed_at,
  initial_prompt_claim_request_id,
  setup_state,
  setup_started_at,
  setup_finished_at,
  setup_error_message,
  cleanup_state,
  cleanup_started_at,
  cleanup_finished_at,
  cleanup_error_message,
  provider_id,
  model_id
FROM runs;

DROP TABLE runs;

ALTER TABLE runs__new RENAME TO runs;

CREATE INDEX IF NOT EXISTS idx_runs_task_id_created_at ON runs (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_project_id_created_at ON runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status);
