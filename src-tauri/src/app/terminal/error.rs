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
use crate::app::worktrees::error::WorktreePathError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TerminalServiceError {
    #[error("owner label is required")]
    OwnerLabelRequired,
    #[error("route_instance_id is required")]
    RouteInstanceIdRequired,
    #[error("terminal size must be >= 1")]
    InvalidTerminalSize,
    #[error("failed to open pty")]
    OpenPty {
        #[source]
        source: anyhow::Error,
    },
    #[error("failed to spawn terminal process with shell '{shell}' in '{cwd}'")]
    SpawnProcess {
        shell: String,
        cwd: String,
        #[source]
        source: anyhow::Error,
    },
    #[error("failed to create terminal reader")]
    CreateReader {
        #[source]
        source: anyhow::Error,
    },
    #[error("failed to create terminal writer")]
    CreateWriter {
        #[source]
        source: anyhow::Error,
    },
    #[error("failed to lock terminal session registry")]
    LockSessionRegistry,
    #[error("failed to lock terminal writer")]
    LockWriter,
    #[error("failed to write to terminal")]
    WriteTerminal {
        #[source]
        source: std::io::Error,
    },
    #[error("failed to flush terminal write")]
    FlushTerminal {
        #[source]
        source: std::io::Error,
    },
    #[error("failed to lock terminal pty")]
    LockPty,
    #[error("failed to resize terminal")]
    ResizeTerminal {
        #[source]
        source: anyhow::Error,
    },
    #[error("terminal session not found")]
    SessionNotFound,
    #[error("terminal session generation mismatch for '{session_id}'")]
    SessionGenerationMismatch { session_id: String },
    #[error("terminal session owner mismatch for '{session_id}'")]
    SessionOwnerMismatch { session_id: String },
    #[error("failed to lock terminal process handle")]
    LockProcessHandle,
    #[error("run worktree not found")]
    RunWorktreeMissing,
    #[error("failed to load run '{run_id}'")]
    ResolveRun {
        run_id: String,
        #[source]
        source: AppError,
    },
    #[error(transparent)]
    WorktreePath(#[from] WorktreePathError),
}

impl TerminalServiceError {
    pub fn to_app_error(&self) -> AppError {
        match self {
            Self::SessionNotFound | Self::RunWorktreeMissing => {
                AppError::not_found(self.to_string())
            }
            Self::WorktreePath(path_error) => path_error.to_app_error(),
            _ => AppError::validation(self.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::TerminalServiceError;
    use crate::app::errors::AppError;

    #[test]
    fn session_not_found_maps_to_not_found() {
        let app_error = TerminalServiceError::SessionNotFound.to_app_error();
        assert!(matches!(app_error, AppError::NotFound(_)));
    }

    #[test]
    fn validation_variant_maps_to_validation() {
        let app_error = TerminalServiceError::InvalidTerminalSize.to_app_error();
        assert!(matches!(app_error, AppError::Validation(_)));
    }
}
