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
const MIGRATION_0008: &str = include_str!("../../../migrations/0008_add_runs_opencode_session_id.sql");
const MIGRATION_0009: &str = include_str!("../../../migrations/0009_add_tasks_implementation_guide.sql");
const MIGRATION_0010: &str = include_str!("../../../migrations/0010_add_runs_initial_prompt_tracking.sql");
const MIGRATION_0011: &str = include_str!("../../../migrations/0011_add_runs_initial_prompt_claim_tracking.sql");

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

    let run_columns = sqlx::query("PRAGMA table_info(runs)").fetch_all(pool).await?;
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
}
