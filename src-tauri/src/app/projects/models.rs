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

use crate::app::projects::env::ProjectEnvVar;

#[derive(Clone, Debug)]
pub struct Project {
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

#[derive(Clone, Debug)]
pub struct ProjectRepository {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub repo_path: String,
    pub is_default: bool,
    pub setup_script: Option<String>,
    pub cleanup_script: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug)]
pub struct ProjectDetails {
    pub project: Project,
    pub repositories: Vec<ProjectRepository>,
}

#[derive(Clone, Debug)]
pub struct NewProjectRepository {
    pub name: String,
    pub repo_path: String,
    pub is_default: bool,
    pub setup_script: Option<String>,
    pub cleanup_script: Option<String>,
}

#[derive(Clone, Debug)]
pub struct UpsertProjectRepository {
    pub id: Option<String>,
    pub name: String,
    pub repo_path: String,
    pub is_default: bool,
    pub setup_script: Option<String>,
    pub cleanup_script: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewProject {
    pub id: String,
    pub name: String,
    pub key: String,
    pub description: Option<String>,
    pub default_repo_id: Option<String>,
    pub default_run_agent: Option<String>,
    pub default_run_provider: Option<String>,
    pub default_run_model: Option<String>,
    pub env_vars: Option<Vec<ProjectEnvVar>>,
    pub created_at: String,
    pub updated_at: String,
    pub repositories: Vec<NewProjectRepository>,
}
