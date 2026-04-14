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

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateWorktreeRequest {
    pub project_key: String,
    pub repo_path: String,
    pub branch_title: String,
    pub unique_suffix_seed: Option<String>,
    pub source_branch: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateWorktreeResponse {
    pub worktree_id: String,
    pub branch_name: String,
    pub source_branch: Option<String>,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RemoveWorktreeRequest {
    pub repo_path: String,
    pub worktree_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LocalBranchDto {
    pub name: String,
    pub is_checked_out: bool,
}
