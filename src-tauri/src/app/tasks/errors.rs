use crate::app::errors::AppError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TaskRepositoryError {
    #[error("tasks repository operation '{operation}' failed: {source}")]
    Database {
        operation: &'static str,
        #[source]
        source: sqlx::Error,
    },
}

impl TaskRepositoryError {
    pub fn db(operation: &'static str, source: sqlx::Error) -> Self {
        Self::Database { operation, source }
    }

    pub fn into_sqlx(self) -> sqlx::Error {
        match self {
            Self::Database { source, .. } => source,
        }
    }
}

#[derive(Debug, Error)]
pub enum TaskSearchRepositoryError {
    #[error("task search repository operation '{operation}' failed: {source}")]
    Database {
        operation: &'static str,
        #[source]
        source: sqlx::Error,
    },
}

impl TaskSearchRepositoryError {
    pub fn db(operation: &'static str, source: sqlx::Error) -> Self {
        Self::Database { operation, source }
    }

    pub fn into_sqlx(self) -> sqlx::Error {
        match self {
            Self::Database { source, .. } => source,
        }
    }
}

#[derive(Debug, Error)]
pub enum TaskSearchError {
    #[error("project not found")]
    ProjectNotFound,
    #[error("task search matcher unavailable")]
    MatcherUnavailable,
    #[error("task lookup failed while searching")]
    TasksRepository {
        #[source]
        source: TaskRepositoryError,
    },
    #[error("candidate lookup failed while searching")]
    SearchRepository {
        #[source]
        source: TaskSearchRepositoryError,
    },
}

impl TaskSearchError {
    pub fn into_app_error(self) -> AppError {
        match self {
            Self::ProjectNotFound => AppError::not_found("project not found"),
            Self::MatcherUnavailable => AppError::validation("task search matcher unavailable"),
            Self::TasksRepository { source } => AppError::Database(source.into_sqlx()),
            Self::SearchRepository { source } => AppError::Database(source.into_sqlx()),
        }
    }
}

#[derive(Debug, Error)]
pub enum TaskServiceError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    NotFound(String),
    #[error("task repository operation failed")]
    Repository {
        #[source]
        source: TaskRepositoryError,
    },
    #[error("task search operation failed")]
    Search {
        #[source]
        source: TaskSearchError,
    },
    #[error("task run auto-start operation '{operation}' failed")]
    RunAutoStart {
        operation: &'static str,
        #[source]
        source: AppError,
    },
}

impl TaskServiceError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }

    pub fn into_app_error(self) -> AppError {
        match self {
            Self::Validation(message) => AppError::validation(message),
            Self::NotFound(message) => AppError::not_found(message),
            Self::Repository { source } => AppError::Database(source.into_sqlx()),
            Self::Search { source } => source.into_app_error(),
            Self::RunAutoStart { source, .. } => source,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_matcher_unavailable_maps_to_validation_error() {
        let mapped = TaskSearchError::MatcherUnavailable.into_app_error();
        match mapped {
            AppError::Validation(message) => assert_eq!(message, "task search matcher unavailable"),
            other => panic!("expected validation error, got {other:?}"),
        }
    }

    #[test]
    fn service_not_found_maps_to_not_found_error() {
        let mapped = TaskServiceError::not_found("task not found").into_app_error();
        match mapped {
            AppError::NotFound(message) => assert_eq!(message, "task not found"),
            other => panic!("expected not found error, got {other:?}"),
        }
    }
}
