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
const MIGRATION_0012: &str =
    include_str!("../../../migrations/0012_add_runs_active_task_unique_index.sql");

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

    let has_single_active_run_index = sqlx::query(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_runs_single_active_per_task' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?
    .is_some();

    if !has_single_active_run_index {
        sqlx::query(MIGRATION_0012).execute(pool).await?;
    }

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
    }

    #[tokio::test]
    async fn run_migrations_adds_active_run_unique_index() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        run_migrations(&pool).await.unwrap();

        let index_exists: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_runs_single_active_per_task' LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();
        assert_eq!(index_exists, Some(1));
    }

    #[tokio::test]
    async fn run_migrations_dedupes_existing_active_runs_before_unique_index() {
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
            ('run-new', 'task-1', 'proj-1', NULL, 'running', 'system', '2026-01-02T00:00:00Z', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();

        run_migrations(&pool).await.unwrap();

        let active_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM runs WHERE task_id = 'task-1' AND status IN ('queued', 'preparing', 'running')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(active_count, 1);

        let kept_active_id: String = sqlx::query_scalar(
            "SELECT id FROM runs WHERE task_id = 'task-1' AND status IN ('queued', 'preparing', 'running')",
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
        assert_eq!(index_exists, Some(1));
    }
}
