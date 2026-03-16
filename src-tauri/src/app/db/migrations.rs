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

    Ok(())
}
