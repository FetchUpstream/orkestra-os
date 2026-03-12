CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_project_id_id
ON tasks (project_id, id);

CREATE TABLE IF NOT EXISTS task_dependencies (
  project_id TEXT NOT NULL,
  parent_task_id TEXT NOT NULL,
  child_task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (parent_task_id, child_task_id),
  CHECK (parent_task_id <> child_task_id),
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, parent_task_id) REFERENCES tasks (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, child_task_id) REFERENCES tasks (project_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_project_parent
ON task_dependencies (project_id, parent_task_id);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_project_child
ON task_dependencies (project_id, child_task_id);
