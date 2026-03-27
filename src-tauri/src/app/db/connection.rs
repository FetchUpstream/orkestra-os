use crate::app::errors::AppError;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::path::Path;
use tracing::{error, info};

pub async fn connect(database_path: &Path) -> Result<SqlitePool, AppError> {
    let db_file = database_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("sqlite.db");
    info!(
        subsystem = "db.connection",
        operation = "connect",
        db_file = db_file,
        "Opening sqlite connection pool"
    );

    let options = SqliteConnectOptions::new()
        .filename(database_path)
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(|err| {
            error!(
                subsystem = "db.connection",
                operation = "connect",
                db_file = db_file,
                error = %err,
                "Failed to open sqlite connection pool"
            );
            AppError::from(err)
        })?;

    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .map_err(|err| {
            error!(
                subsystem = "db.connection",
                operation = "pragma_foreign_keys",
                db_file = db_file,
                error = %err,
                "Failed to enable sqlite foreign_keys pragma"
            );
            AppError::from(err)
        })?;

    info!(
        subsystem = "db.connection",
        operation = "connect",
        db_file = db_file,
        "Sqlite connection pool ready"
    );

    Ok(pool)
}
