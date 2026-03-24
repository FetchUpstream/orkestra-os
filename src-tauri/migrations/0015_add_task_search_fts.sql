CREATE TABLE IF NOT EXISTS task_search_docs (
  doc_id INTEGER PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  display_key TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_search_docs_project_id ON task_search_docs (project_id);
CREATE INDEX IF NOT EXISTS idx_task_search_docs_task_id ON task_search_docs (task_id);

CREATE VIRTUAL TABLE IF NOT EXISTS task_search_fts USING fts5(
  display_key,
  title,
  description,
  content='task_search_docs',
  content_rowid='doc_id',
  tokenize='unicode61',
  prefix='2 3 4'
);

CREATE TRIGGER IF NOT EXISTS task_search_docs_ai
AFTER INSERT ON task_search_docs
BEGIN
  INSERT INTO task_search_fts(rowid, display_key, title, description)
  VALUES (new.doc_id, new.display_key, new.title, new.description);
END;

CREATE TRIGGER IF NOT EXISTS task_search_docs_ad
AFTER DELETE ON task_search_docs
BEGIN
  INSERT INTO task_search_fts(task_search_fts, rowid, display_key, title, description)
  VALUES ('delete', old.doc_id, old.display_key, old.title, old.description);
END;

CREATE TRIGGER IF NOT EXISTS task_search_docs_au
AFTER UPDATE ON task_search_docs
BEGIN
  INSERT INTO task_search_fts(task_search_fts, rowid, display_key, title, description)
  VALUES ('delete', old.doc_id, old.display_key, old.title, old.description);
  INSERT INTO task_search_fts(rowid, display_key, title, description)
  VALUES (new.doc_id, new.display_key, new.title, new.description);
END;

CREATE TRIGGER IF NOT EXISTS tasks_search_ai
AFTER INSERT ON tasks
BEGIN
  INSERT INTO task_search_docs (
    task_id,
    project_id,
    display_key,
    repository_id,
    status,
    title,
    description
  )
  VALUES (
    new.id,
    new.project_id,
    COALESCE((SELECT key FROM projects WHERE id = new.project_id), 'PRJ') || '-' || CAST(new.task_number AS TEXT),
    new.repository_id,
    new.status,
    new.title,
    COALESCE(new.description, '')
  )
  ON CONFLICT(task_id) DO UPDATE SET
    project_id = excluded.project_id,
    display_key = excluded.display_key,
    repository_id = excluded.repository_id,
    status = excluded.status,
    title = excluded.title,
    description = excluded.description;
END;

CREATE TRIGGER IF NOT EXISTS tasks_search_au
AFTER UPDATE ON tasks
BEGIN
  INSERT INTO task_search_docs (
    task_id,
    project_id,
    display_key,
    repository_id,
    status,
    title,
    description
  )
  VALUES (
    new.id,
    new.project_id,
    COALESCE((SELECT key FROM projects WHERE id = new.project_id), 'PRJ') || '-' || CAST(new.task_number AS TEXT),
    new.repository_id,
    new.status,
    new.title,
    COALESCE(new.description, '')
  )
  ON CONFLICT(task_id) DO UPDATE SET
    project_id = excluded.project_id,
    display_key = excluded.display_key,
    repository_id = excluded.repository_id,
    status = excluded.status,
    title = excluded.title,
    description = excluded.description;
END;

CREATE TRIGGER IF NOT EXISTS tasks_search_ad
AFTER DELETE ON tasks
BEGIN
  DELETE FROM task_search_docs WHERE task_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS projects_search_key_au
AFTER UPDATE OF key ON projects
BEGIN
  UPDATE task_search_docs
  SET display_key = new.key || '-' || CAST((
    SELECT t.task_number
    FROM tasks t
    WHERE t.id = task_search_docs.task_id
  ) AS TEXT)
  WHERE project_id = new.id;
END;

INSERT INTO task_search_docs (
  task_id,
  project_id,
  display_key,
  repository_id,
  status,
  title,
  description
)
SELECT
  t.id,
  t.project_id,
  p.key || '-' || CAST(t.task_number AS TEXT),
  t.repository_id,
  t.status,
  t.title,
  COALESCE(t.description, '')
FROM tasks t
JOIN projects p ON p.id = t.project_id
ON CONFLICT(task_id) DO UPDATE SET
  project_id = excluded.project_id,
  display_key = excluded.display_key,
  repository_id = excluded.repository_id,
  status = excluded.status,
  title = excluded.title,
  description = excluded.description;

INSERT INTO task_search_fts(task_search_fts) VALUES('rebuild');
