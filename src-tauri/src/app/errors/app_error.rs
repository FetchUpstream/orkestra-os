use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("database error: {0}")]
    Database(#[source] sqlx::Error),
    #[error("{0}")]
    Infrastructure(#[from] InfrastructureError),
}

#[derive(Debug, Error)]
#[error("{message}")]
pub struct InfrastructureError {
    pub subsystem: &'static str,
    pub code: &'static str,
    pub message: String,
    #[source]
    pub source: Option<Box<dyn std::error::Error + Send + Sync>>,
}

impl AppError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict(message.into())
    }

    pub fn infrastructure(
        subsystem: &'static str,
        code: &'static str,
        message: impl Into<String>,
    ) -> Self {
        Self::Infrastructure(InfrastructureError {
            subsystem,
            code,
            message: message.into(),
            source: None,
        })
    }

    pub fn infrastructure_with_source<E>(
        subsystem: &'static str,
        code: &'static str,
        message: impl Into<String>,
        source: E,
    ) -> Self
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        Self::Infrastructure(InfrastructureError {
            subsystem,
            code,
            message: message.into(),
            source: Some(Box::new(source)),
        })
    }

    pub fn category(&self) -> &'static str {
        match self {
            Self::Validation(_) => "validation",
            Self::NotFound(_) => "not_found",
            Self::Conflict(_) => "conflict",
            Self::Database(_) => "database",
            Self::Infrastructure(_) => "infrastructure",
        }
    }

    pub fn subsystem(&self) -> Option<&'static str> {
        match self {
            Self::Database(_) => Some("database"),
            Self::Infrastructure(err) => Some(err.subsystem),
            _ => None,
        }
    }

    pub fn code(&self) -> Option<&'static str> {
        match self {
            Self::Database(err) => Some(match err {
                sqlx::Error::RowNotFound => "row_not_found",
                sqlx::Error::PoolTimedOut => "pool_timed_out",
                sqlx::Error::PoolClosed => "pool_closed",
                _ => "sqlx_error",
            }),
            Self::Infrastructure(err) => Some(err.code),
            _ => None,
        }
    }

    pub fn is_user_safe(&self) -> bool {
        matches!(
            self,
            Self::Validation(_) | Self::NotFound(_) | Self::Conflict(_)
        )
    }
}

impl From<sqlx::Error> for AppError {
    fn from(value: sqlx::Error) -> Self {
        Self::Database(value)
    }
}
