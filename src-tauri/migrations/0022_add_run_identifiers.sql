ALTER TABLE runs ADD COLUMN run_number INTEGER;
ALTER TABLE runs ADD COLUMN display_key TEXT;

WITH ordered_runs AS (
  SELECT
    r.id AS run_id,
    ROW_NUMBER() OVER (
      PARTITION BY r.task_id
      ORDER BY r.created_at ASC, r.id ASC
    ) AS next_run_number,
    (
      SELECT p.key || '-' || t.task_number
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = r.task_id
    ) AS task_display_key
  FROM runs r
)
UPDATE runs
SET
  run_number = (
    SELECT next_run_number
    FROM ordered_runs
    WHERE ordered_runs.run_id = runs.id
  ),
  display_key = (
    SELECT CASE
      WHEN task_display_key IS NOT NULL AND task_display_key != ''
        THEN task_display_key || '-R' || next_run_number
      ELSE 'R' || next_run_number
    END
    FROM ordered_runs
    WHERE ordered_runs.run_id = runs.id
  )
WHERE run_number IS NULL OR display_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_task_id_run_number
  ON runs (task_id, run_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_display_key
  ON runs (display_key);

CREATE TRIGGER IF NOT EXISTS runs_assign_identifiers_after_insert
AFTER INSERT ON runs
FOR EACH ROW
WHEN NEW.run_number IS NULL OR NEW.display_key IS NULL
BEGIN
  UPDATE runs
  SET
    run_number = COALESCE(
      NEW.run_number,
      (
        SELECT COALESCE(MAX(existing.run_number), 0) + 1
        FROM runs existing
        WHERE existing.task_id = NEW.task_id
          AND existing.id != NEW.id
      )
    ),
    display_key = COALESCE(
      NEW.display_key,
      (
        WITH next_identifier AS (
          SELECT COALESCE(
            NEW.run_number,
            (
              SELECT COALESCE(MAX(existing.run_number), 0) + 1
              FROM runs existing
              WHERE existing.task_id = NEW.task_id
                AND existing.id != NEW.id
            )
          ) AS run_number,
          (
            SELECT p.key || '-' || t.task_number
            FROM tasks t
            JOIN projects p ON p.id = t.project_id
            WHERE t.id = NEW.task_id
          ) AS task_display_key
        )
        SELECT CASE
          WHEN task_display_key IS NOT NULL AND task_display_key != ''
            THEN task_display_key || '-R' || run_number
          ELSE 'R' || run_number
        END
        FROM next_identifier
      )
    )
  WHERE id = NEW.id;
END;
