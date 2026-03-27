use crate::app::errors::AppError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RunsRepositoryError {
    #[error("database operation failed while {operation}")]
    Database {
        operation: &'static str,
        #[source]
        source: sqlx::Error,
    },
    #[error("run not found after create: {run_id}")]
    RunMissingAfterCreate { run_id: String },
}

impl RunsRepositoryError {
    pub fn database(operation: &'static str, source: sqlx::Error) -> Self {
        Self::Database { operation, source }
    }
}

impl From<RunsRepositoryError> for AppError {
    fn from(value: RunsRepositoryError) -> Self {
        match value {
            RunsRepositoryError::Database { source, .. } => AppError::Database(source),
            RunsRepositoryError::RunMissingAfterCreate { .. } => {
                AppError::not_found(value.to_string())
            }
        }
    }
}

#[derive(Debug, Error)]
pub enum RunsDiffError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    NotFound(String),
    #[error("repository operation failed while {operation}")]
    Git {
        operation: &'static str,
        #[source]
        source: git2::Error,
    },
    #[error("i/o operation failed while {operation}")]
    Io {
        operation: &'static str,
        #[source]
        source: std::io::Error,
    },
}

impl RunsDiffError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }
}

impl From<RunsDiffError> for AppError {
    fn from(value: RunsDiffError) -> Self {
        match value {
            RunsDiffError::Validation(message) => AppError::validation(message),
            RunsDiffError::NotFound(message) => AppError::not_found(message),
            other => AppError::validation(other.to_string()),
        }
    }
}

#[derive(Debug, Error)]
pub enum RunsMergeError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    NotFound(String),
    #[error("repository operation failed while {operation}")]
    Git {
        operation: &'static str,
        #[source]
        source: git2::Error,
    },
    #[error("process execution failed while {operation}")]
    Process {
        operation: &'static str,
        #[source]
        source: std::io::Error,
    },
}

impl RunsMergeError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }
}

impl From<RunsMergeError> for AppError {
    fn from(value: RunsMergeError) -> Self {
        match value {
            RunsMergeError::Validation(message) => AppError::validation(message),
            RunsMergeError::NotFound(message) => AppError::not_found(message),
            other => AppError::validation(other.to_string()),
        }
    }
}
