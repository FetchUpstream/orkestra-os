CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'review', 'done')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id) REFERENCES project_repositories (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_repository_id ON tasks (repository_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
