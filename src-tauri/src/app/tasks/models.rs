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

#[derive(Clone, Debug)]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub repository_id: String,
    pub task_number: i64,
    pub display_key: String,
    pub title: String,
    pub description: Option<String>,
    pub implementation_guide: Option<String>,
    pub status: String,
    pub blocked_by_count: i64,
    pub is_blocked: bool,
    pub target_repository_name: Option<String>,
    pub target_repository_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct NewTask {
    pub id: String,
    pub project_id: String,
    pub repository_id: String,
    pub title: String,
    pub description: Option<String>,
    pub implementation_guide: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct UpdateTaskDetails {
    pub title: String,
    pub description: Option<String>,
    pub implementation_guide: Option<Option<String>>,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct UpdateTaskStatus {
    pub status: String,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct MoveTaskRepository {
    pub repository_id: String,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct TaskDependencyTask {
    pub id: String,
    pub display_key: String,
    pub title: String,
    pub status: String,
    pub target_repository_name: Option<String>,
    pub target_repository_path: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct TaskDependencies {
    pub parents: Vec<TaskDependencyTask>,
    pub children: Vec<TaskDependencyTask>,
}

#[derive(Clone, Debug)]
pub struct TaskDependencyEdge {
    pub parent_task_id: String,
    pub child_task_id: String,
    pub created_at: String,
}
