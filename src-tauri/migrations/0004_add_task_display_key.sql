ALTER TABLE tasks ADD COLUMN task_number INTEGER NOT NULL DEFAULT 0;

UPDATE tasks
SET task_number = (
  SELECT COUNT(*)
  FROM tasks t2
  WHERE t2.project_id = tasks.project_id
    AND (
      t2.created_at < tasks.created_at
      OR (t2.created_at = tasks.created_at AND t2.id <= tasks.id)
    )
)
WHERE task_number = 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_project_task_number
ON tasks (project_id, task_number);
