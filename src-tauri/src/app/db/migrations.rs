use crate::app::errors::AppError;
use sqlx::Row;
use sqlx::SqlitePool;

const MIGRATION_0001: &str = include_str!("../../../migrations/0001_init_projects.sql");
const MIGRATION_0002: &str = include_str!("../../../migrations/0002_init_core_tables.sql");
const MIGRATION_0003: &str = include_str!("../../../migrations/0003_init_tasks.sql");
const MIGRATION_0004: &str = include_str!("../../../migrations/0004_add_task_display_key.sql");
const MIGRATION_0005: &str = include_str!("../../../migrations/0005_task_dependencies.sql");
const MIGRATION_0006: &str = include_str!("../../../migrations/0006_init_runs.sql");
const MIGRATION_0007: &str = include_str!("../../../migrations/0007_add_run_source_branch.sql");
const MIGRATION_0008: &str =
    include_str!("../../../migrations/0008_add_runs_opencode_session_id.sql");
const MIGRATION_0009: &str =
    include_str!("../../../migrations/0009_add_tasks_implementation_guide.sql");
const MIGRATION_0010: &str =
    include_str!("../../../migrations/0010_add_runs_initial_prompt_tracking.sql");
const MIGRATION_0011: &str =
    include_str!("../../../migrations/0011_add_runs_initial_prompt_claim_tracking.sql");
const MIGRATION_0015: &str = include_str!("../../../migrations/0015_add_task_search_fts.sql");
const MIGRATION_0017: &str =
    include_str!("../../../migrations/0017_update_run_status_lifecycle.sql");
const MIGRATION_0018: &str = include_str!("../../../migrations/0018_add_runs_run_state.sql");
const MIGRATION_0019: &str =
    include_str!("../../../migrations/0019_drop_runs_single_active_index.sql");
const MIGRATION_0020: &str = include_str!("../../../migrations/0020_add_project_env_vars.sql");

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(MIGRATION_0001).execute(pool).await?;
    sqlx::query(MIGRATION_0002).execute(pool).await?;
    sqlx::query(MIGRATION_0003).execute(pool).await?;

    let has_task_number = sqlx::query("PRAGMA table_info(tasks)")
        .fetch_all(pool)
        .await?
        .iter()
        .any(|row| row.get::<String, _>("name") == "task_number");

    if !has_task_number {
        sqlx::query(MIGRATION_0004).execute(pool).await?;
    }

    let has_task_dependencies = sqlx::query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_dependencies' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?
    .is_some();

    if !has_task_dependencies {
        sqlx::query(MIGRATION_0005).execute(pool).await?;
    }

    let has_runs =
        sqlx::query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs' LIMIT 1")
            .fetch_optional(pool)
            .await?
            .is_some();

    if !has_runs {
        sqlx::query(MIGRATION_0006).execute(pool).await?;
    }

    let has_run_source_branch = sqlx::query("PRAGMA table_info(runs)")
        .fetch_all(pool)
        .await?
        .iter()
        .any(|row| row.get::<String, _>("name") == "source_branch");

    if !has_run_source_branch {
        sqlx::query(MIGRATION_0007).execute(pool).await?;
    }

    let has_opencode_session_id = sqlx::query("PRAGMA table_info(runs)")
        .fetch_all(pool)
        .await?
        .iter()
        .any(|row| row.get::<String, _>("name") == "opencode_session_id");

    if !has_opencode_session_id {
        sqlx::query(MIGRATION_0008).execute(pool).await?;
    }

    let has_implementation_guide = sqlx::query("PRAGMA table_info(tasks)")
        .fetch_all(pool)
        .await?
        .iter()
        .any(|row| row.get::<String, _>("name") == "implementation_guide");

    if !has_implementation_guide {
        sqlx::query(MIGRATION_0009).execute(pool).await?;
    }

    let run_columns = sqlx::query("PRAGMA table_info(runs)")
        .fetch_all(pool)
        .await?;
    let has_initial_prompt_sent_at = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "initial_prompt_sent_at");
    let has_initial_prompt_client_request_id = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "initial_prompt_client_request_id");
    let has_initial_prompt_claimed_at = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "initial_prompt_claimed_at");
    let has_initial_prompt_claim_request_id = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "initial_prompt_claim_request_id");

    if !has_initial_prompt_sent_at && !has_initial_prompt_client_request_id {
        sqlx::query(MIGRATION_0010).execute(pool).await?;
    } else {
        if !has_initial_prompt_sent_at {
            sqlx::query("ALTER TABLE runs ADD COLUMN initial_prompt_sent_at TEXT")
                .execute(pool)
                .await?;
        }
        if !has_initial_prompt_client_request_id {
            sqlx::query("ALTER TABLE runs ADD COLUMN initial_prompt_client_request_id TEXT")
                .execute(pool)
                .await?;
        }
    }

    if !has_initial_prompt_claimed_at && !has_initial_prompt_claim_request_id {
        sqlx::query(MIGRATION_0011).execute(pool).await?;
    } else {
        if !has_initial_prompt_claimed_at {
            sqlx::query("ALTER TABLE runs ADD COLUMN initial_prompt_claimed_at TEXT")
                .execute(pool)
                .await?;
        }
        if !has_initial_prompt_claim_request_id {
            sqlx::query("ALTER TABLE runs ADD COLUMN initial_prompt_claim_request_id TEXT")
                .execute(pool)
                .await?;
        }
    }

    let repository_columns = sqlx::query("PRAGMA table_info(project_repositories)")
        .fetch_all(pool)
        .await?;
    let has_setup_script = repository_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "setup_script");
    let has_cleanup_script = repository_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "cleanup_script");

    if !has_setup_script {
        sqlx::query("ALTER TABLE project_repositories ADD COLUMN setup_script TEXT")
            .execute(pool)
            .await?;
    }
    if !has_cleanup_script {
        sqlx::query("ALTER TABLE project_repositories ADD COLUMN cleanup_script TEXT")
            .execute(pool)
            .await?;
    }

    let project_columns = sqlx::query("PRAGMA table_info(projects)")
        .fetch_all(pool)
        .await?;
    let has_default_run_agent = project_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "default_run_agent");
    let has_default_run_provider = project_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "default_run_provider");
    let has_default_run_model = project_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "default_run_model");
    let has_env_vars_json = project_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "env_vars_json");

    if !has_default_run_agent {
        sqlx::query("ALTER TABLE projects ADD COLUMN default_run_agent TEXT")
            .execute(pool)
            .await?;
    }
    if !has_default_run_provider {
        sqlx::query("ALTER TABLE projects ADD COLUMN default_run_provider TEXT")
            .execute(pool)
            .await?;
    }
    if !has_default_run_model {
        sqlx::query("ALTER TABLE projects ADD COLUMN default_run_model TEXT")
            .execute(pool)
            .await?;
    }
    if !has_env_vars_json {
        sqlx::query(MIGRATION_0020).execute(pool).await?;
    }

    let run_columns = sqlx::query("PRAGMA table_info(runs)")
        .fetch_all(pool)
        .await?;
    let has_setup_state = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "setup_state");
    let has_setup_started_at = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "setup_started_at");
    let has_setup_finished_at = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "setup_finished_at");
    let has_setup_error_message = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "setup_error_message");
    let has_cleanup_state = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "cleanup_state");
    let has_cleanup_started_at = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "cleanup_started_at");
    let has_cleanup_finished_at = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "cleanup_finished_at");
    let has_cleanup_error_message = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "cleanup_error_message");
    let has_provider_id = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "provider_id");
    let has_model_id = run_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "model_id");

    if !has_setup_state {
        sqlx::query("ALTER TABLE runs ADD COLUMN setup_state TEXT NOT NULL DEFAULT 'pending'")
            .execute(pool)
            .await?;
    }
    if !has_setup_started_at {
        sqlx::query("ALTER TABLE runs ADD COLUMN setup_started_at TEXT")
            .execute(pool)
            .await?;
    }
    if !has_setup_finished_at {
        sqlx::query("ALTER TABLE runs ADD COLUMN setup_finished_at TEXT")
            .execute(pool)
            .await?;
    }
    if !has_setup_error_message {
        sqlx::query("ALTER TABLE runs ADD COLUMN setup_error_message TEXT")
            .execute(pool)
            .await?;
    }
    if !has_cleanup_state {
        sqlx::query("ALTER TABLE runs ADD COLUMN cleanup_state TEXT NOT NULL DEFAULT 'pending'")
            .execute(pool)
            .await?;
    }
    if !has_cleanup_started_at {
        sqlx::query("ALTER TABLE runs ADD COLUMN cleanup_started_at TEXT")
            .execute(pool)
            .await?;
    }
    if !has_cleanup_finished_at {
        sqlx::query("ALTER TABLE runs ADD COLUMN cleanup_finished_at TEXT")
            .execute(pool)
            .await?;
    }
    if !has_cleanup_error_message {
        sqlx::query("ALTER TABLE runs ADD COLUMN cleanup_error_message TEXT")
            .execute(pool)
            .await?;
    }
    if !has_provider_id {
        sqlx::query("ALTER TABLE runs ADD COLUMN provider_id TEXT")
            .execute(pool)
            .await?;
    }
    if !has_model_id {
        sqlx::query("ALTER TABLE runs ADD COLUMN model_id TEXT")
            .execute(pool)
            .await?;
    }

    let has_task_search_docs = sqlx::query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_search_docs' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?
    .is_some();

    if !has_task_search_docs {
        sqlx::query(MIGRATION_0015).execute(pool).await?;
    }

    let runs_table_sql: Option<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    let needs_run_status_lifecycle_migration = runs_table_sql.as_deref().is_some_and(|sql| {
        sql.contains("'running'") || sql.contains("'completed'") || !sql.contains("'idle'")
    });

    if needs_run_status_lifecycle_migration {
        sqlx::query(MIGRATION_0017).execute(pool).await?;
    }

    let has_run_state = sqlx::query("PRAGMA table_info(runs)")
        .fetch_all(pool)
        .await?
        .iter()
        .any(|row| row.get::<String, _>("name") == "run_state");

    if !has_run_state {
        sqlx::query(MIGRATION_0018).execute(pool).await?;
    }

    sqlx::query(MIGRATION_0019).execute(pool).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn run_migrations_adds_missing_initial_prompt_column_in_partial_state() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query(MIGRATION_0001).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0002).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0003).execute(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                target_repo_id TEXT NULL,
                status TEXT NOT NULL,
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
                initial_prompt_sent_at TEXT
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        run_migrations(&pool).await.unwrap();

        let run_columns = sqlx::query("PRAGMA table_info(runs)")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(run_columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "initial_prompt_sent_at"));
        assert!(run_columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "initial_prompt_client_request_id"));
        assert!(run_columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "initial_prompt_claimed_at"));
        assert!(run_columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "initial_prompt_claim_request_id"));
        assert!(run_columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "provider_id"));
        assert!(run_columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "model_id"));
        assert!(run_columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "run_state"));
    }

    #[tokio::test]
    async fn run_migrations_adds_run_state_column_to_existing_runs_table() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query(MIGRATION_0001).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0002).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0003).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0006).execute(&pool).await.unwrap();

        run_migrations(&pool).await.unwrap();

        let run_columns = sqlx::query("PRAGMA table_info(runs)")
            .fetch_all(&pool)
            .await
            .unwrap();

        assert!(run_columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "run_state"));
    }

    #[tokio::test]
    async fn run_migrations_drops_active_run_unique_index() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        run_migrations(&pool).await.unwrap();

        let index_exists: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_runs_single_active_per_task' LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        assert_eq!(index_exists, None);
    }

    #[tokio::test]
    async fn run_migrations_dedupes_existing_active_runs() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query(MIGRATION_0001).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0002).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0003).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0004).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0005).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0006).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0007).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0008).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0010).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0011).execute(&pool).await.unwrap();

        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, created_at, updated_at)
             VALUES ('proj-1', 'Project 1', 'ORK', NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, created_at)
             VALUES ('repo-1', 'proj-1', 'Repo 1', '/tmp/repo-1', 1, '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, title, description, implementation_guide, status, created_at, updated_at, task_number)
             VALUES ('task-1', 'proj-1', 'repo-1', 'Task 1', NULL, NULL, 'doing', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO runs (
                id, task_id, project_id, target_repo_id, status, triggered_by, created_at,
                started_at, finished_at, summary, error_message, worktree_id, agent_id,
                source_branch, opencode_session_id, initial_prompt_sent_at,
                initial_prompt_client_request_id, initial_prompt_claimed_at,
                initial_prompt_claim_request_id
            ) VALUES
            ('run-old', 'task-1', 'proj-1', NULL, 'queued', 'system', '2026-01-01T00:00:00Z', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
            ('run-new', 'task-1', 'proj-1', NULL, 'in_progress', 'system', '2026-01-02T00:00:00Z', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();

        run_migrations(&pool).await.unwrap();

        let active_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM runs WHERE task_id = 'task-1' AND status IN ('queued', 'preparing', 'in_progress', 'idle')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(active_count, 1);

        let kept_active_id: String = sqlx::query_scalar(
            "SELECT id FROM runs WHERE task_id = 'task-1' AND status IN ('queued', 'preparing', 'in_progress', 'idle')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(kept_active_id, "run-new");

        let cancelled_status: String =
            sqlx::query_scalar("SELECT status FROM runs WHERE id = 'run-old'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(cancelled_status, "cancelled");

        let index_exists: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_runs_single_active_per_task' LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        assert_eq!(index_exists, None);
    }

    #[tokio::test]
    async fn run_migrations_rebuilds_legacy_run_status_check_and_moves_existing_runs_to_idle() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query(MIGRATION_0001).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0002).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0003).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0004).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0005).execute(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                target_repo_id TEXT NULL,
                status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'running', 'completed', 'failed', 'cancelled')),
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
                model_id TEXT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE UNIQUE INDEX idx_runs_single_active_per_task ON runs(task_id)
             WHERE status IN ('queued', 'preparing', 'running', 'completed')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, created_at, updated_at)
             VALUES ('proj-1', 'Project 1', 'ORK', NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, created_at)
             VALUES ('repo-1', 'proj-1', 'Repo 1', '/tmp/repo-1', 1, '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, title, description, implementation_guide, status, created_at, updated_at, task_number)
             VALUES ('task-1', 'proj-1', 'repo-1', 'Task 1', NULL, NULL, 'doing', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, title, description, implementation_guide, status, created_at, updated_at, task_number)
             VALUES ('task-2', 'proj-1', 'repo-1', 'Task 2', NULL, NULL, 'done', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 2)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at, setup_state, cleanup_state)
             VALUES
             ('run-queued', 'task-1', 'proj-1', NULL, 'queued', 'system', '2026-01-01T00:00:00Z', 'pending', 'pending'),
             ('run-completed', 'task-2', 'proj-1', NULL, 'completed', 'system', '2026-01-02T00:00:00Z', 'pending', 'pending')",
        )
        .execute(&pool)
        .await
        .unwrap();

        run_migrations(&pool).await.unwrap();

        let run_queued_status: String =
            sqlx::query_scalar("SELECT status FROM runs WHERE id = 'run-queued'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_queued_status, "idle");

        let run_completed_status: String =
            sqlx::query_scalar("SELECT status FROM runs WHERE id = 'run-completed'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run_completed_status, "complete");

        let runs_table_sql: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs' LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(runs_table_sql.contains("'in_progress'"));
        assert!(runs_table_sql.contains("'idle'"));
        assert!(runs_table_sql.contains("'complete'"));

        let active_run_index_sql: Option<String> = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_runs_single_active_per_task' LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        assert!(active_run_index_sql.is_none());
    }

    #[tokio::test]
    async fn run_migrations_backfills_task_search_docs_for_existing_rows() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query(MIGRATION_0001).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0002).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0003).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0004).execute(&pool).await.unwrap();

        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, created_at, updated_at)
             VALUES ('proj-1', 'Project 1', 'ORK', NULL, 'repo-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, created_at)
             VALUES ('repo-1', 'proj-1', 'Repo 1', '/tmp/repo-1', 1, '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, status, created_at, updated_at)
             VALUES ('task-1', 'proj-1', 'repo-1', 1, 'Run Details', 'Task details', 'todo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        run_migrations(&pool).await.unwrap();

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_search_docs WHERE task_id = 'task-1' AND display_key = 'ORK-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);

        let fts_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_search_fts WHERE task_search_fts MATCH 'details'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(fts_count, 1);
    }
}
