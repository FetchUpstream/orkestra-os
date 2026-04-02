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
pub enum WorktreePathError {
    #[error("project_key is required")]
    ProjectKeyRequired,
    #[error("project_key length must be 2 to 4")]
    ProjectKeyLength,
    #[error("project_key must be uppercase alphanumeric")]
    ProjectKeyFormat,
    #[error("worktree branch segment is required")]
    BranchSegmentRequired,
    #[error("worktree branch segment must match [a-z0-9-]")]
    BranchSegmentFormat,
    #[error("run worktree not found")]
    WorktreeNotFound,
    #[error("worktree id must use exactly two normal path segments")]
    InvalidWorktreeIdPathShape,
    #[error("worktree id must be '<PROJECT_KEY>/<branch-segment>'")]
    InvalidWorktreeId,
    #[error("failed to resolve worktrees root path '{path}'")]
    CanonicalizeWorktreesRoot {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to resolve worktree path '{path}'")]
    CanonicalizeWorktreePath {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("resolved worktree path is outside worktrees root")]
    WorktreePathOutsideRoot,
}

impl WorktreePathError {
    pub fn to_app_error(&self) -> AppError {
        match self {
            Self::WorktreeNotFound => AppError::not_found(self.to_string()),
            _ => AppError::validation(self.to_string()),
        }
    }
}

#[derive(Debug, Error)]
pub enum WorktreesServiceError {
    #[error(transparent)]
    Pathing(#[from] WorktreePathError),
    #[error("repo_path is required")]
    RepoPathRequired,
    #[error("worktree_id is required")]
    WorktreeIdRequired,
    #[error("repository must not be bare")]
    BareRepository,
    #[error("failed to open repository '{repo_path}'")]
    OpenRepository {
        repo_path: String,
        #[source]
        source: git2::Error,
    },
    #[error("failed to resolve HEAD reference")]
    ResolveHeadRef {
        #[source]
        source: git2::Error,
    },
    #[error("failed to resolve HEAD commit")]
    ResolveHeadCommit {
        #[source]
        source: git2::Error,
    },
    #[error("invalid worktree path")]
    InvalidWorktreePath,
    #[error("failed to create worktree parent directory '{path}'")]
    CreateWorktreeParentDir {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[allow(dead_code)]
    #[error("failed to create branch '{branch_name}'")]
    CreateBranch {
        branch_name: String,
        #[source]
        source: git2::Error,
    },
    #[allow(dead_code)]
    #[error("failed to lookup branch '{branch_name}'")]
    LookupBranch {
        branch_name: String,
        #[source]
        source: git2::Error,
    },
    #[allow(dead_code)]
    #[error("invalid worktree id")]
    InvalidWorktreeId,
    #[allow(dead_code)]
    #[error("failed to prepare worktree metadata directory '{path}'")]
    PrepareWorktreeMetadataDir {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to create worktree '{worktree_id}'")]
    CreateWorktree {
        worktree_id: String,
        #[source]
        source: git2::Error,
    },
    #[error("worktree '{worktree_id}' not found")]
    WorktreeNotFound {
        worktree_id: String,
        #[source]
        source: git2::Error,
    },
    #[error("failed to prune worktree '{worktree_id}'")]
    PruneWorktree {
        worktree_id: String,
        #[source]
        source: git2::Error,
    },
    #[error("failed to remove worktree directory '{path}'")]
    RemoveWorktreeDirectory {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to remove project worktree root '{path}'")]
    RemoveProjectWorktreeRoot {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

impl WorktreesServiceError {
    pub fn to_app_error(&self) -> AppError {
        match self {
            Self::WorktreeNotFound { .. } => {
                AppError::not_found(format!("{self}: {}", root_source(self)))
            }
            Self::Pathing(pathing) => pathing.to_app_error(),
            _ => AppError::validation(format!("{self}: {}", root_source(self))),
        }
    }
}

fn root_source(err: &dyn std::error::Error) -> String {
    let mut current = err.source();
    let mut last = None;
    while let Some(source) = current {
        last = Some(source.to_string());
        current = source.source();
    }
    last.unwrap_or_else(|| "no additional context".to_string())
}

#[cfg(test)]
mod tests {
    use super::{WorktreePathError, WorktreesServiceError};
    use crate::app::errors::AppError;

    #[test]
    fn path_worktree_not_found_maps_to_not_found() {
        let app_error = WorktreePathError::WorktreeNotFound.to_app_error();
        assert!(matches!(app_error, AppError::NotFound(_)));
    }

    #[test]
    fn service_not_found_maps_to_not_found() {
        let source = git2::Error::from_str("missing");
        let app_error = WorktreesServiceError::WorktreeNotFound {
            worktree_id: "ALP/fix-login".to_string(),
            source,
        }
        .to_app_error();
        assert!(matches!(app_error, AppError::NotFound(_)));
    }
}
