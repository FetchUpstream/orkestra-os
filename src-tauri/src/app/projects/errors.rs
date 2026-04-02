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
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProjectsRepositoryError {
    #[error("database error while {operation}")]
    Database {
        operation: &'static str,
        #[source]
        source: sqlx::Error,
    },
    #[error("{0}")]
    Validation(&'static str),
}

impl ProjectsRepositoryError {
    pub fn db(operation: &'static str, source: sqlx::Error) -> Self {
        Self::Database { operation, source }
    }

    pub fn validation(message: &'static str) -> Self {
        Self::Validation(message)
    }
}

#[derive(Debug, Error)]
pub enum ProjectFileSearchError {
    #[error("project file search failed")]
    TaskJoin {
        #[source]
        source: tokio::task::JoinError,
    },
    #[error("project file matcher unavailable")]
    MatcherUnavailable,
    #[error("repository path does not exist for '{repository_name}'")]
    RepositoryPathMissing { repository_name: String },
    #[error("repository path is not a directory for '{repository_name}'")]
    RepositoryPathNotDirectory { repository_name: String },
}

#[derive(Debug, Error)]
pub enum ProjectsServiceError {
    #[error("{0}")]
    Validation(&'static str),
    #[error("{0}")]
    NotFound(&'static str),
    #[error("failed to query project data")]
    QueryProjectData {
        #[source]
        source: ProjectsRepositoryError,
    },
    #[error("failed to persist project data")]
    PersistProjectData {
        #[source]
        source: ProjectsRepositoryError,
    },
    #[error("failed to clone project")]
    CloneProject {
        #[source]
        source: ProjectsRepositoryError,
    },
    #[error("failed to delete project")]
    DeleteProject {
        #[source]
        source: ProjectsRepositoryError,
    },
    #[error("failed to search project files")]
    SearchProjectFiles {
        #[source]
        source: ProjectFileSearchError,
    },
    #[error("failed to remove project artifacts")]
    RemoveProjectArtifacts {
        #[source]
        source: AppError,
    },
}

impl From<ProjectsServiceError> for AppError {
    fn from(value: ProjectsServiceError) -> Self {
        match value {
            ProjectsServiceError::Validation(message) => AppError::validation(message),
            ProjectsServiceError::NotFound(message) => AppError::not_found(message),
            ProjectsServiceError::SearchProjectFiles { source } => match source {
                ProjectFileSearchError::RepositoryPathMissing { .. }
                | ProjectFileSearchError::RepositoryPathNotDirectory { .. }
                | ProjectFileSearchError::MatcherUnavailable
                | ProjectFileSearchError::TaskJoin { .. } => {
                    AppError::validation(source.to_string())
                }
            },
            ProjectsServiceError::QueryProjectData { source }
            | ProjectsServiceError::PersistProjectData { source }
            | ProjectsServiceError::CloneProject { source }
            | ProjectsServiceError::DeleteProject { source } => match source {
                ProjectsRepositoryError::Validation(message) => AppError::validation(message),
                ProjectsRepositoryError::Database { source, .. } => AppError::from(source),
            },
            ProjectsServiceError::RemoveProjectArtifacts { source } => source,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ProjectFileSearchError, ProjectsRepositoryError, ProjectsServiceError};
    use crate::app::errors::AppError;
    use std::error::Error;

    #[test]
    fn repository_database_error_maps_to_database_app_error_with_source() {
        let err = ProjectsServiceError::QueryProjectData {
            source: ProjectsRepositoryError::db(
                "listing projects",
                sqlx::Error::Protocol("synthetic protocol error".into()),
            ),
        };

        let app_error = AppError::from(err);
        assert!(matches!(app_error, AppError::Database(_)));
        assert!(app_error.source().is_some());
    }

    #[test]
    fn file_search_path_errors_remain_validation_messages() {
        let err = ProjectsServiceError::SearchProjectFiles {
            source: ProjectFileSearchError::RepositoryPathMissing {
                repository_name: "main".to_string(),
            },
        };

        let app_error = AppError::from(err);
        assert_eq!(
            app_error.to_string(),
            "repository path does not exist for 'main'"
        );
    }
}
