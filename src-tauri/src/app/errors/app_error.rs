use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Clone, Debug)]
pub struct AppError {
    message: String,
}

impl AppError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn not_implemented(area: &str) -> Self {
        Self::new(format!("not implemented: {area}"))
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(message)
    }
}

impl From<sqlx::Error> for AppError {
    fn from(value: sqlx::Error) -> Self {
        Self::new(format!("database error: {value}"))
    }
}

impl Display for AppError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl Error for AppError {}
