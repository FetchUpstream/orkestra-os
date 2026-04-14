CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  target_repo_id TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'in_progress', 'idle', 'complete', 'failed', 'cancelled', 'rejected')),
  triggered_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT NULL,
  finished_at TEXT NULL,
  summary TEXT NULL,
  error_message TEXT NULL,
  worktree_id TEXT NULL,
  agent_id TEXT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  FOREIGN KEY (target_repo_id) REFERENCES project_repositories (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_task_id_created_at ON runs (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_project_id_created_at ON runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status);
