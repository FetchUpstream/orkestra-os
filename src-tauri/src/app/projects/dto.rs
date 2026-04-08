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

use crate::app::projects::env::ProjectEnvVar;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectDto {
    pub id: String,
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub default_repo_id: Option<String>,
    pub default_run_agent: Option<String>,
    pub default_run_provider: Option<String>,
    pub default_run_model: Option<String>,
    pub env_vars: Option<Vec<ProjectEnvVar>>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub description: Option<String>,
    pub key: String,
    pub default_run_agent: Option<String>,
    pub default_run_provider: String,
    pub default_run_model: String,
    pub env_vars: Option<Vec<ProjectEnvVar>>,
    pub repositories: Vec<CreateProjectRepositoryRequest>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpdateProjectRequest {
    pub name: String,
    pub description: Option<String>,
    pub key: String,
    pub default_run_agent: Option<String>,
    pub default_run_provider: String,
    pub default_run_model: String,
    pub env_vars: Option<Vec<ProjectEnvVar>>,
    pub repositories: Vec<CreateProjectRepositoryRequest>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CloneProjectRequest {
    pub name: String,
    pub key: String,
    pub repository_destination: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateProjectRepositoryRequest {
    pub id: Option<String>,
    pub name: String,
    pub repo_path: String,
    pub is_default: bool,
    pub setup_script: Option<String>,
    pub cleanup_script: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectRepositoryDto {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub repo_path: String,
    pub is_default: bool,
    pub setup_script: Option<String>,
    pub cleanup_script: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectDetailsDto {
    pub project: ProjectDto,
    pub repositories: Vec<ProjectRepositoryDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SearchProjectFilesRequest {
    pub project_id: String,
    pub repository_id: String,
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SearchLocalDirectoriesRequest {
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LocalDirectorySearchResultDto {
    pub path: String,
    pub directory_name: String,
    pub parent_path: String,
}
