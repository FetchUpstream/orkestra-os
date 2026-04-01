WITH ranked_active_runs AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY task_id
      ORDER BY created_at DESC, id DESC
    ) AS active_rank
  FROM runs
  WHERE status IN ('queued', 'preparing', 'running', 'in_progress', 'idle')
)
UPDATE runs
SET
  status = 'cancelled',
  error_message = COALESCE(
    error_message,
    'Auto-cancelled during migration 0012: duplicate active run for task.'
  )
WHERE id IN (
  SELECT id
  FROM ranked_active_runs
  WHERE active_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_single_active_per_task
ON runs(task_id)
WHERE status IN ('queued', 'preparing', 'running', 'in_progress', 'idle');
