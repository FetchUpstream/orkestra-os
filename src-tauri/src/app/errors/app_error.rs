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

use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UserSafeTelemetryClass {
    OpencodePermissionSessionMismatch,
    OpencodeProjectRepoConfigDrift,
    WorktreeConflictRetryExhausted,
    OpencodeRuntimeNotFound,
    MergeRebaseValidationFailure,
    OpencodeLifecycleRaceConflict,
}

impl UserSafeTelemetryClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OpencodePermissionSessionMismatch => "opencode_permission_session_mismatch",
            Self::OpencodeProjectRepoConfigDrift => "opencode_project_repo_config_drift",
            Self::WorktreeConflictRetryExhausted => "worktree_conflict_retry_exhausted",
            Self::OpencodeRuntimeNotFound => "opencode_runtime_not_found",
            Self::MergeRebaseValidationFailure => "merge_rebase_validation_failure",
            Self::OpencodeLifecycleRaceConflict => "opencode_lifecycle_race_conflict",
        }
    }

    pub fn subsystem(self) -> &'static str {
        match self {
            Self::OpencodePermissionSessionMismatch => "opencode.runtime",
            Self::OpencodeProjectRepoConfigDrift => "opencode.discovery",
            Self::WorktreeConflictRetryExhausted => "worktrees",
            Self::OpencodeRuntimeNotFound => "opencode.runtime",
            Self::MergeRebaseValidationFailure => "runs.merge",
            Self::OpencodeLifecycleRaceConflict => "opencode.runtime",
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Self::OpencodePermissionSessionMismatch => "permission_session_mismatch",
            Self::OpencodeProjectRepoConfigDrift => "project_repo_config_drift",
            Self::WorktreeConflictRetryExhausted => "worktree_conflict_retry_exhausted",
            Self::OpencodeRuntimeNotFound => "runtime_handle_not_found",
            Self::MergeRebaseValidationFailure => "merge_rebase_validation_failure",
            Self::OpencodeLifecycleRaceConflict => "lifecycle_race_conflict",
        }
    }
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    #[allow(dead_code)]
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

#[allow(dead_code)]
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

    pub fn user_safe_telemetry_class(&self) -> Option<UserSafeTelemetryClass> {
        match self {
            Self::Validation(message) => classify_user_safe_validation(message),
            Self::NotFound(message) => classify_user_safe_not_found(message),
            Self::Conflict(message) => classify_user_safe_conflict(message),
            _ => None,
        }
    }
}

fn classify_user_safe_validation(message: &str) -> Option<UserSafeTelemetryClass> {
    if message == "OpenCode session not initialized for run" {
        return Some(UserSafeTelemetryClass::OpencodePermissionSessionMismatch);
    }

    if message.starts_with("project default repository ")
        || message.starts_with("failed to canonicalize project git repository root")
        || message.starts_with("failed to load OpenCode config:")
        || message.starts_with("failed to list OpenCode providers:")
    {
        return Some(UserSafeTelemetryClass::OpencodeProjectRepoConfigDrift);
    }

    if message.contains("worktree creation retries exhausted due to repeated conflicts") {
        return Some(UserSafeTelemetryClass::WorktreeConflictRetryExhausted);
    }

    if message.starts_with("failed to start rebase:")
        || message.starts_with("rebase failed:")
        || message.starts_with("failed to inspect rebase index:")
        || message.starts_with("failed to commit rebase step:")
        || message.starts_with("failed to finish rebase:")
        || message.starts_with("failed to analyze merge:")
        || message.starts_with("cannot merge: source repository HEAD must be on source branch")
        || message.starts_with("failed to fast-forward source branch '")
        || message.starts_with("failed to resolve source branch reference:")
        || message.starts_with("failed to load worktree commit:")
        || message.starts_with("failed to open worktree repository:")
        || message.starts_with("failed to open source repository:")
        || message.starts_with("failed to inspect repository HEAD:")
        || message.starts_with("failed to execute git merge:")
        || message.starts_with("failed to inspect worktree status:")
        || message.starts_with("failed to inspect rebase conflicts:")
    {
        return Some(UserSafeTelemetryClass::MergeRebaseValidationFailure);
    }

    None
}

fn classify_user_safe_not_found(message: &str) -> Option<UserSafeTelemetryClass> {
    if message == "OpenCode run handle not found" {
        return Some(UserSafeTelemetryClass::OpencodeRuntimeNotFound);
    }

    None
}

fn classify_user_safe_conflict(message: &str) -> Option<UserSafeTelemetryClass> {
    if message == "OpenCode run runtime is shutting down and cannot accept new work"
        || message == "OpenCode service is shutting down and cannot accept new work"
        || message == "OpenCode run runtime shutdown is in progress"
        || message == "OpenCode run runtime is still in active use and cannot be shut down"
        || message == "OpenCode run runtime is no longer eligible for cleanup shutdown"
    {
        return Some(UserSafeTelemetryClass::OpencodeLifecycleRaceConflict);
    }

    None
}

impl From<sqlx::Error> for AppError {
    fn from(value: sqlx::Error) -> Self {
        Self::Database(value)
    }
}

#[cfg(test)]
mod tests {
    use super::{AppError, UserSafeTelemetryClass};

    #[test]
    fn classifies_opencode_permission_session_mismatch() {
        let err = AppError::validation("OpenCode session not initialized for run");
        assert_eq!(
            err.user_safe_telemetry_class(),
            Some(UserSafeTelemetryClass::OpencodePermissionSessionMismatch)
        );
    }

    #[test]
    fn classifies_project_repo_config_drift() {
        let err = AppError::validation(
            "project default repository path is invalid or stale: /tmp/repo (missing)",
        );
        assert_eq!(
            err.user_safe_telemetry_class(),
            Some(UserSafeTelemetryClass::OpencodeProjectRepoConfigDrift)
        );
    }

    #[test]
    fn classifies_worktree_conflict_retry_exhausted() {
        let err = AppError::validation(
            "failed to create worktree 'ABC/test': worktree creation retries exhausted due to repeated conflicts",
        );
        assert_eq!(
            err.user_safe_telemetry_class(),
            Some(UserSafeTelemetryClass::WorktreeConflictRetryExhausted)
        );
    }

    #[test]
    fn classifies_opencode_runtime_not_found() {
        let err = AppError::not_found("OpenCode run handle not found");
        assert_eq!(
            err.user_safe_telemetry_class(),
            Some(UserSafeTelemetryClass::OpencodeRuntimeNotFound)
        );
    }

    #[test]
    fn classifies_merge_rebase_validation_failure() {
        let err = AppError::validation("failed to start rebase: lock failure");
        assert_eq!(
            err.user_safe_telemetry_class(),
            Some(UserSafeTelemetryClass::MergeRebaseValidationFailure)
        );
    }

    #[test]
    fn classifies_opencode_lifecycle_race_conflict() {
        let err = AppError::conflict("OpenCode run runtime shutdown is in progress");
        assert_eq!(
            err.user_safe_telemetry_class(),
            Some(UserSafeTelemetryClass::OpencodeLifecycleRaceConflict)
        );
    }

    #[test]
    fn does_not_classify_routine_user_safe_validation() {
        let err = AppError::validation("run_id is required");
        assert_eq!(err.user_safe_telemetry_class(), None);
    }

    #[test]
    fn does_not_classify_routine_user_safe_conflict() {
        let err = AppError::conflict("project key already exists");
        assert_eq!(err.user_safe_telemetry_class(), None);
    }
}
