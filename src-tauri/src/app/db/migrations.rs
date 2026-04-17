// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

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
const MIGRATION_0021: &str = include_str!("../../../migrations/0021_allow_rejected_run_status.sql");
const MIGRATION_0022: &str = include_str!("../../../migrations/0022_add_run_identifiers.sql");

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

    let runs_table_sql: Option<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    let run_identifier_columns = sqlx::query("PRAGMA table_info(runs)")
        .fetch_all(pool)
        .await?;
    let mut has_run_number = run_identifier_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "run_number");
    let mut has_run_display_key = run_identifier_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "display_key");

    let needs_rejected_run_status_migration = runs_table_sql
        .as_deref()
        .is_some_and(|sql| !sql.contains("'rejected'"));

    if needs_rejected_run_status_migration {
        match (has_run_number, has_run_display_key) {
            (false, false) => {
                sqlx::query(MIGRATION_0021).execute(pool).await?;
            }
            (true, false) => {
                add_run_display_key_column(pool).await?;
                has_run_display_key = true;
                rebuild_legacy_runs_table_with_identifiers(pool).await?;
            }
            (false, true) => {
                add_run_number_column(pool).await?;
                has_run_number = true;
                rebuild_legacy_runs_table_with_identifiers(pool).await?;
            }
            (true, true) => {
                rebuild_runs_table_for_rejected_status(pool).await?;
            }
        }
    }

    sqlx::query(MIGRATION_0019).execute(pool).await?;

    match (has_run_number, has_run_display_key) {
        (false, false) => {
            sqlx::query(MIGRATION_0022).execute(pool).await?;
        }
        (true, false) => {
            add_run_display_key_column(pool).await?;
            backfill_missing_run_display_keys(pool).await?;
            ensure_run_identifier_indexes_and_trigger(pool).await?;
        }
        (false, true) => {
            add_run_number_column(pool).await?;
            backfill_missing_run_numbers(pool).await?;
            ensure_run_identifier_indexes_and_trigger(pool).await?;
        }
        (true, true) => {
            backfill_missing_run_identifiers(pool).await?;
            ensure_run_identifier_indexes_and_trigger(pool).await?;
        }
    }

    Ok(())
}

async fn add_run_number_column(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query("ALTER TABLE runs ADD COLUMN run_number INTEGER")
        .execute(pool)
        .await?;
    Ok(())
}

async fn add_run_display_key_column(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query("ALTER TABLE runs ADD COLUMN display_key TEXT")
        .execute(pool)
        .await?;
    Ok(())
}

async fn rebuild_legacy_runs_table_with_identifiers(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(
        "DROP INDEX IF EXISTS idx_runs_status;
         DROP INDEX IF EXISTS idx_runs_project_id_created_at;
         DROP INDEX IF EXISTS idx_runs_task_id_created_at;

         CREATE TABLE runs__new (
           id TEXT PRIMARY KEY,
           task_id TEXT NOT NULL,
           project_id TEXT NOT NULL,
           run_number INTEGER,
           display_key TEXT,
           target_repo_id TEXT NULL,
           status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'in_progress', 'idle', 'complete', 'failed', 'cancelled', 'rejected')),
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
           model_id TEXT NULL,
           run_state TEXT NULL,
           FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
           FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
           FOREIGN KEY (target_repo_id) REFERENCES project_repositories (id) ON DELETE SET NULL
         );

         INSERT INTO runs__new (
           id, task_id, project_id, run_number, display_key, target_repo_id, status, triggered_by, created_at,
           started_at, finished_at, summary, error_message, worktree_id, agent_id,
           source_branch, opencode_session_id, initial_prompt_sent_at,
           initial_prompt_client_request_id, initial_prompt_claimed_at,
           initial_prompt_claim_request_id, setup_state, setup_started_at,
           setup_finished_at, setup_error_message, cleanup_state, cleanup_started_at,
           cleanup_finished_at, cleanup_error_message, provider_id, model_id, run_state
         )
         SELECT
           id, task_id, project_id, run_number, display_key, target_repo_id,
           CASE
             WHEN status = 'running' THEN 'in_progress'
             WHEN status = 'completed' THEN 'complete'
             WHEN status IN ('queued', 'preparing') THEN 'idle'
             ELSE status
           END,
           triggered_by, created_at, started_at, finished_at, summary, error_message, worktree_id, agent_id,
           source_branch, opencode_session_id, initial_prompt_sent_at,
           initial_prompt_client_request_id, initial_prompt_claimed_at,
           initial_prompt_claim_request_id, setup_state, setup_started_at,
           setup_finished_at, setup_error_message, cleanup_state, cleanup_started_at,
           cleanup_finished_at, cleanup_error_message, provider_id, model_id, run_state
         FROM runs;

         DROP TABLE runs;
         ALTER TABLE runs__new RENAME TO runs;

         CREATE INDEX IF NOT EXISTS idx_runs_task_id_created_at ON runs (task_id, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_runs_project_id_created_at ON runs (project_id, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status);",
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn rebuild_runs_table_for_rejected_status(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(
        "DROP INDEX IF EXISTS idx_runs_status;
         DROP INDEX IF EXISTS idx_runs_project_id_created_at;
         DROP INDEX IF EXISTS idx_runs_task_id_created_at;

         CREATE TABLE runs__new (
           id TEXT PRIMARY KEY,
           task_id TEXT NOT NULL,
           project_id TEXT NOT NULL,
           run_number INTEGER,
           display_key TEXT,
           target_repo_id TEXT NULL,
           status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'in_progress', 'idle', 'complete', 'failed', 'cancelled', 'rejected')),
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
           model_id TEXT NULL,
           run_state TEXT NULL,
           FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
           FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
           FOREIGN KEY (target_repo_id) REFERENCES project_repositories (id) ON DELETE SET NULL
         );

         INSERT INTO runs__new (
           id, task_id, project_id, run_number, display_key, target_repo_id, status, triggered_by, created_at,
           started_at, finished_at, summary, error_message, worktree_id, agent_id,
           source_branch, opencode_session_id, initial_prompt_sent_at,
           initial_prompt_client_request_id, initial_prompt_claimed_at,
           initial_prompt_claim_request_id, setup_state, setup_started_at,
           setup_finished_at, setup_error_message, cleanup_state, cleanup_started_at,
           cleanup_finished_at, cleanup_error_message, provider_id, model_id, run_state
         )
         SELECT
           id, task_id, project_id, run_number, display_key, target_repo_id, status, triggered_by, created_at,
           started_at, finished_at, summary, error_message, worktree_id, agent_id,
           source_branch, opencode_session_id, initial_prompt_sent_at,
           initial_prompt_client_request_id, initial_prompt_claimed_at,
           initial_prompt_claim_request_id, setup_state, setup_started_at,
           setup_finished_at, setup_error_message, cleanup_state, cleanup_started_at,
           cleanup_finished_at, cleanup_error_message, provider_id, model_id, run_state
         FROM runs;

         DROP TABLE runs;
         ALTER TABLE runs__new RENAME TO runs;

         CREATE INDEX IF NOT EXISTS idx_runs_task_id_created_at ON runs (task_id, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_runs_project_id_created_at ON runs (project_id, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status);",
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn backfill_missing_run_numbers(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(
        "WITH ordered_runs AS (
            SELECT
              r.id AS run_id,
              ROW_NUMBER() OVER (
                PARTITION BY r.task_id
                ORDER BY r.created_at ASC, r.id ASC
              ) AS next_run_number
            FROM runs r
            WHERE r.run_number IS NULL
          )
          UPDATE runs
          SET run_number = (
            SELECT next_run_number
            FROM ordered_runs
            WHERE ordered_runs.run_id = runs.id
          )
          WHERE run_number IS NULL",
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn backfill_missing_run_display_keys(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(
        "WITH run_display_keys AS (
            SELECT
              r.id AS run_id,
              CASE
                WHEN p.key IS NOT NULL AND p.key != ''
                  THEN p.key || '-' || t.task_number || '-R' || r.run_number
                ELSE 'T' || r.task_id || '-R' || r.run_number
              END AS next_display_key
            FROM runs r
            LEFT JOIN tasks t ON t.id = r.task_id
            LEFT JOIN projects p ON p.id = t.project_id
            WHERE r.display_key IS NULL
          )
          UPDATE runs
          SET display_key = (
            SELECT next_display_key
            FROM run_display_keys
            WHERE run_display_keys.run_id = runs.id
          )
          WHERE display_key IS NULL",
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn backfill_missing_run_identifiers(pool: &SqlitePool) -> Result<(), AppError> {
    let missing_identifier_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM runs WHERE run_number IS NULL OR display_key IS NULL",
    )
    .fetch_one(pool)
    .await?;
    if missing_identifier_count == 0 {
        return Ok(());
    }

    sqlx::query(
        "WITH existing_run_numbers AS (
            SELECT task_id, COALESCE(MAX(run_number), 0) AS max_run_number
            FROM runs
            WHERE run_number IS NOT NULL
            GROUP BY task_id
          ),
          ordered_runs AS (
            SELECT
              r.id AS run_id,
              r.task_id AS task_id,
              COALESCE(
                r.run_number,
                COALESCE(existing_run_numbers.max_run_number, 0) + ROW_NUMBER() OVER (
                  PARTITION BY r.task_id, CASE WHEN r.run_number IS NULL THEN 1 ELSE 0 END
                  ORDER BY r.created_at ASC, r.id ASC
                )
              ) AS next_run_number,
              (
                SELECT p.key || '-' || t.task_number
                FROM tasks t
                JOIN projects p ON p.id = t.project_id
                WHERE t.id = r.task_id
              ) AS task_display_key
            FROM runs r
            LEFT JOIN existing_run_numbers ON existing_run_numbers.task_id = r.task_id
            WHERE r.run_number IS NULL OR r.display_key IS NULL
          )
          UPDATE runs
          SET
            run_number = COALESCE(runs.run_number, (
              SELECT next_run_number
              FROM ordered_runs
              WHERE ordered_runs.run_id = runs.id
            )),
            display_key = COALESCE(runs.display_key, (
              SELECT CASE
                WHEN task_display_key IS NOT NULL AND task_display_key != ''
                  THEN task_display_key || '-R' || COALESCE(runs.run_number, next_run_number)
                ELSE 'T' || task_id || '-R' || COALESCE(runs.run_number, next_run_number)
              END
              FROM ordered_runs
              WHERE ordered_runs.run_id = runs.id
            ))
          WHERE run_number IS NULL OR display_key IS NULL",
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn ensure_run_identifier_indexes_and_trigger(pool: &SqlitePool) -> Result<(), AppError> {
    let has_task_run_number_index = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_runs_task_id_run_number'",
    )
    .fetch_one(pool)
    .await?
        > 0;
    if !has_task_run_number_index {
        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_task_id_run_number ON runs (task_id, run_number)",
        )
        .execute(pool)
        .await?;
    }

    let has_display_key_index = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_runs_display_key'",
    )
    .fetch_one(pool)
    .await?
        > 0;
    if !has_display_key_index {
        sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_display_key ON runs (display_key)")
            .execute(pool)
            .await?;
    }

    let has_identifier_trigger = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'runs_assign_identifiers_after_insert'",
    )
    .fetch_one(pool)
    .await?
        > 0;
    if !has_identifier_trigger {
        sqlx::query(
            "CREATE TRIGGER IF NOT EXISTS runs_assign_identifiers_after_insert
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
                      ELSE 'T' || NEW.task_id || '-R' || run_number
                    END
                    FROM next_identifier
                  )
                )
              WHERE id = NEW.id;
            END",
        )
        .execute(pool)
        .await?;
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
    async fn run_migrations_preserves_existing_active_runs_after_dropping_unique_index() {
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

        let active_ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM runs WHERE task_id = 'task-1' AND status IN ('queued', 'preparing', 'in_progress', 'idle') ORDER BY created_at ASC",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(active_ids, vec!["run-old".to_string(), "run-new".to_string()]);

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

    #[tokio::test]
    async fn run_migrations_backfills_persisted_run_identifiers() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query(MIGRATION_0001).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0002).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0003).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0004).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0006).execute(&pool).await.unwrap();

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
             VALUES ('task-1', 'proj-1', 'repo-1', 12, 'Run Details', 'Task details', 'todo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, target_repo_id, status, triggered_by, created_at)
             VALUES
             ('run-1', 'task-1', 'proj-1', 'repo-1', 'queued', 'user', '2026-01-01T00:00:00Z'),
             ('run-2', 'task-1', 'proj-1', 'repo-1', 'complete', 'user', '2026-01-02T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        run_migrations(&pool).await.unwrap();

        let rows: Vec<(i64, String)> = sqlx::query_as(
            "SELECT run_number, display_key FROM runs WHERE task_id = 'task-1' ORDER BY run_number ASC",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(
            rows,
            vec![(1, "ORK-12-R1".to_string()), (2, "ORK-12-R2".to_string())]
        );
    }

    #[tokio::test]
    async fn run_migrations_preserve_existing_run_identifiers_while_backfilling_missing_fields() {
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
             VALUES ('task-1', 'proj-1', 'repo-1', 12, 'Run Details', 'Task details', 'todo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                run_number INTEGER,
                display_key TEXT,
                target_repo_id TEXT NULL,
                status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'in_progress', 'idle', 'complete', 'failed', 'cancelled', 'rejected')),
                run_state TEXT NULL,
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
                provider_id TEXT NULL,
                model_id TEXT NULL,
                setup_state TEXT NOT NULL DEFAULT 'pending',
                setup_started_at TEXT NULL,
                setup_finished_at TEXT NULL,
                setup_error_message TEXT NULL,
                cleanup_state TEXT NOT NULL DEFAULT 'pending',
                cleanup_started_at TEXT NULL,
                cleanup_finished_at TEXT NULL,
                cleanup_error_message TEXT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, run_number, display_key, target_repo_id, status, triggered_by, created_at)
             VALUES
             ('run-1', 'task-1', 'proj-1', 7, NULL, 'repo-1', 'queued', 'user', '2026-01-01T00:00:00Z'),
             ('run-2', 'task-1', 'proj-1', NULL, 'CUSTOM-RUN-KEY', 'repo-1', 'complete', 'user', '2026-01-02T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        run_migrations(&pool).await.unwrap();

        let rows: Vec<(String, Option<i64>, Option<String>)> =
            sqlx::query_as("SELECT id, run_number, display_key FROM runs ORDER BY created_at ASC")
                .fetch_all(&pool)
                .await
                .unwrap();

        assert_eq!(
            rows,
            vec![
                ("run-1".to_string(), Some(7), Some("ORK-12-R7".to_string())),
                (
                    "run-2".to_string(),
                    Some(8),
                    Some("CUSTOM-RUN-KEY".to_string())
                ),
            ]
        );
    }

    #[tokio::test]
    async fn run_migrations_adds_missing_display_key_without_rebuilding_partial_identifier_schema()
    {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query(MIGRATION_0001).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0002).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0003).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0004).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                run_number INTEGER,
                target_repo_id TEXT NULL,
                status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'in_progress', 'idle', 'complete', 'failed', 'cancelled')),
                run_state TEXT NULL,
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
                provider_id TEXT NULL,
                model_id TEXT NULL,
                setup_state TEXT NOT NULL DEFAULT 'pending',
                setup_started_at TEXT NULL,
                setup_finished_at TEXT NULL,
                setup_error_message TEXT NULL,
                cleanup_state TEXT NOT NULL DEFAULT 'pending',
                cleanup_started_at TEXT NULL,
                cleanup_finished_at TEXT NULL,
                cleanup_error_message TEXT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

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
             VALUES ('task-1', 'proj-1', 'repo-1', 1, 'Task', NULL, 'todo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, run_number, target_repo_id, status, triggered_by, created_at)
             VALUES ('run-1', 'task-1', 'proj-1', 4, 'repo-1', 'queued', 'user', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        run_migrations(&pool).await.unwrap();

        let schema: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs' LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(schema.contains("'rejected'"));
        assert!(schema.contains("run_number INTEGER"));
        assert!(schema.contains("display_key TEXT"));

        let identifiers: (i64, String) =
            sqlx::query_as("SELECT run_number, display_key FROM runs WHERE id = 'run-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(identifiers, (4, "ORK-1-R4".to_string()));
    }

    #[tokio::test]
    async fn run_migrations_adds_missing_run_number_without_rebuilding_partial_identifier_schema() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query(MIGRATION_0001).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0002).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0003).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0004).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                display_key TEXT,
                target_repo_id TEXT NULL,
                status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'in_progress', 'idle', 'complete', 'failed', 'cancelled')),
                run_state TEXT NULL,
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
                provider_id TEXT NULL,
                model_id TEXT NULL,
                setup_state TEXT NOT NULL DEFAULT 'pending',
                setup_started_at TEXT NULL,
                setup_finished_at TEXT NULL,
                setup_error_message TEXT NULL,
                cleanup_state TEXT NOT NULL DEFAULT 'pending',
                cleanup_started_at TEXT NULL,
                cleanup_finished_at TEXT NULL,
                cleanup_error_message TEXT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

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
             VALUES ('task-1', 'proj-1', 'repo-1', 1, 'Task', NULL, 'todo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, display_key, target_repo_id, status, triggered_by, created_at)
             VALUES ('run-1', 'task-1', 'proj-1', 'CUSTOM-RUN-KEY', 'repo-1', 'queued', 'user', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        run_migrations(&pool).await.unwrap();

        let schema: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs' LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(schema.contains("'rejected'"));
        assert!(schema.contains("run_number INTEGER"));
        assert!(schema.contains("display_key TEXT"));

        let identifiers: (i64, String) =
            sqlx::query_as("SELECT run_number, display_key FROM runs WHERE id = 'run-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(identifiers, (1, "CUSTOM-RUN-KEY".to_string()));
    }

    #[tokio::test]
    async fn run_migrations_rebuilds_rejected_status_check_without_dropping_existing_identifiers() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query(MIGRATION_0001).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0002).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0003).execute(&pool).await.unwrap();
        sqlx::query(MIGRATION_0004).execute(&pool).await.unwrap();

        sqlx::query(
            "CREATE TABLE runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                run_number INTEGER,
                display_key TEXT,
                target_repo_id TEXT NULL,
                status TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'in_progress', 'idle', 'complete', 'failed', 'cancelled')),
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
                provider_id TEXT NULL,
                model_id TEXT NULL,
                run_state TEXT NULL,
                setup_state TEXT NOT NULL DEFAULT 'pending',
                setup_started_at TEXT NULL,
                setup_finished_at TEXT NULL,
                setup_error_message TEXT NULL,
                cleanup_state TEXT NOT NULL DEFAULT 'pending',
                cleanup_started_at TEXT NULL,
                cleanup_finished_at TEXT NULL,
                cleanup_error_message TEXT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

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
             VALUES ('task-1', 'proj-1', 'repo-1', 1, 'Task', NULL, 'todo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO runs (id, task_id, project_id, run_number, display_key, target_repo_id, status, triggered_by, created_at)
             VALUES ('run-1', 'task-1', 'proj-1', 4, 'ORK-1-R4', 'repo-1', 'queued', 'user', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        run_migrations(&pool).await.unwrap();

        let schema: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs' LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(schema.contains("'rejected'"));

        let identifiers: (i64, String) =
            sqlx::query_as("SELECT run_number, display_key FROM runs WHERE id = 'run-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(identifiers, (4, "ORK-1-R4".to_string()));
    }
}
