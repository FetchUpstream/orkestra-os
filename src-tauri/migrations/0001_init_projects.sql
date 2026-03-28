CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  description TEXT NULL,
  default_repo_id TEXT NULL,
  default_run_provider TEXT NULL,
  default_run_model TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
