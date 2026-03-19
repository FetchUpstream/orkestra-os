ALTER TABLE project_repositories ADD COLUMN setup_script TEXT;
ALTER TABLE project_repositories ADD COLUMN cleanup_script TEXT;

ALTER TABLE runs ADD COLUMN setup_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE runs ADD COLUMN setup_started_at TEXT;
ALTER TABLE runs ADD COLUMN setup_finished_at TEXT;
ALTER TABLE runs ADD COLUMN setup_error_message TEXT;

ALTER TABLE runs ADD COLUMN cleanup_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE runs ADD COLUMN cleanup_started_at TEXT;
ALTER TABLE runs ADD COLUMN cleanup_finished_at TEXT;
ALTER TABLE runs ADD COLUMN cleanup_error_message TEXT;
