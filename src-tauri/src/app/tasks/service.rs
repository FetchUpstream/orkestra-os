use crate::app::db::repositories::tasks::TasksRepository;
use crate::app::errors::AppError;
use crate::app::tasks::dto::{
    AddTaskDependencyRequest, CreateTaskRequest, DeleteTaskResponse, MoveTaskRequest,
    RemoveTaskDependencyRequest, RemoveTaskDependencyResponse, SetTaskStatusRequest,
    TaskDependenciesDto, TaskDependencyEdgeDto, TaskDependencyTaskDto, TaskDto, UpdateTaskRequest,
};
use crate::app::tasks::models::{
    MoveTaskRepository, NewTask, Task, TaskDependencyTask, UpdateTaskDetails, UpdateTaskStatus,
};
use chrono::Utc;

#[derive(Clone, Debug)]
pub struct TasksService {
    repository: TasksRepository,
}

impl TasksService {
    pub fn new(repository: TasksRepository) -> Self {
        Self { repository }
    }

    pub async fn create_task(&self, mut input: CreateTaskRequest) -> Result<TaskDto, AppError> {
        input.project_id = input.project_id.trim().to_string();
        input.repository_id = input.repository_id.trim().to_string();
        input.title = input.title.trim().to_string();
        input.status = input.status.trim().to_string();
        input.description = input.description.map(|value| value.trim().to_string());

        if input.title.is_empty() {
            return Err(AppError::validation("task title is required"));
        }

        Self::validate_status(&input.status)?;

        if !self.repository.project_exists(&input.project_id).await? {
            return Err(AppError::not_found("project not found"));
        }

        if !self
            .repository
            .repository_belongs_to_project(&input.repository_id, &input.project_id)
            .await?
        {
            return Err(AppError::validation(
                "repository must belong to the specified project",
            ));
        }

        let now = Utc::now().to_rfc3339();
        let created = self
            .repository
            .create_task(NewTask {
                id: uuid::Uuid::new_v4().to_string(),
                project_id: input.project_id,
                repository_id: input.repository_id,
                title: input.title,
                description: input.description,
                status: input.status,
                created_at: now.clone(),
                updated_at: now,
            })
            .await?;

        Ok(Self::to_dto(created))
    }

    pub async fn list_project_tasks(&self, project_id: &str) -> Result<Vec<TaskDto>, AppError> {
        if !self.repository.project_exists(project_id).await? {
            return Err(AppError::not_found("project not found"));
        }

        let tasks = self.repository.list_project_tasks(project_id).await?;
        Ok(tasks.into_iter().map(Self::to_dto).collect())
    }

    pub async fn get_task(&self, id: &str) -> Result<TaskDto, AppError> {
        let task = self
            .repository
            .get_task(id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        Ok(Self::to_dto(task))
    }

    pub async fn update_task(
        &self,
        id: &str,
        mut input: UpdateTaskRequest,
    ) -> Result<TaskDto, AppError> {
        input.title = input.title.trim().to_string();
        input.description = input.description.map(|value| value.trim().to_string());

        if input.title.is_empty() {
            return Err(AppError::validation("task title is required"));
        }

        let updated = self
            .repository
            .update_task_details(
                id,
                UpdateTaskDetails {
                    title: input.title,
                    description: input.description,
                    updated_at: Utc::now().to_rfc3339(),
                },
            )
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        Ok(Self::to_dto(updated))
    }

    pub async fn set_task_status(
        &self,
        id: &str,
        mut input: SetTaskStatusRequest,
    ) -> Result<TaskDto, AppError> {
        input.status = input.status.trim().to_string();
        Self::validate_status(&input.status)?;

        let existing_task = self
            .repository
            .get_task(id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        if !Self::can_transition_status(&existing_task.status, &input.status) {
            return Err(AppError::validation("invalid task status transition"));
        }

        let updated = self
            .repository
            .update_task_status(
                id,
                UpdateTaskStatus {
                    status: input.status,
                    updated_at: Utc::now().to_rfc3339(),
                },
            )
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        Ok(Self::to_dto(updated))
    }

    pub async fn move_task(
        &self,
        id: &str,
        mut input: MoveTaskRequest,
    ) -> Result<TaskDto, AppError> {
        input.repository_id = input.repository_id.trim().to_string();

        let existing_task = self
            .repository
            .get_task(id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        if !self
            .repository
            .repository_belongs_to_project(&input.repository_id, &existing_task.project_id)
            .await?
        {
            return Err(AppError::validation(
                "repository must belong to the specified project",
            ));
        }

        let updated = self
            .repository
            .move_task_repository(
                id,
                MoveTaskRepository {
                    repository_id: input.repository_id,
                    updated_at: Utc::now().to_rfc3339(),
                },
            )
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        Ok(Self::to_dto(updated))
    }

    pub async fn delete_task(&self, id: &str) -> Result<DeleteTaskResponse, AppError> {
        let deleted = self.repository.delete_task(id).await?;
        if !deleted {
            return Err(AppError::not_found("task not found"));
        }

        Ok(DeleteTaskResponse { id: id.to_string() })
    }

    pub async fn list_task_dependencies(
        &self,
        task_id: &str,
    ) -> Result<TaskDependenciesDto, AppError> {
        let task_id = task_id.trim().to_string();

        self.repository
            .get_task(&task_id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        let dependencies = self
            .repository
            .list_task_dependencies(&task_id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        Ok(TaskDependenciesDto {
            task_id,
            parents: dependencies
                .parents
                .into_iter()
                .map(Self::to_dependency_task_dto)
                .collect(),
            children: dependencies
                .children
                .into_iter()
                .map(Self::to_dependency_task_dto)
                .collect(),
        })
    }

    pub async fn add_task_dependency(
        &self,
        mut input: AddTaskDependencyRequest,
    ) -> Result<TaskDependencyEdgeDto, AppError> {
        input.parent_task_id = input.parent_task_id.trim().to_string();
        input.child_task_id = input.child_task_id.trim().to_string();

        if input.parent_task_id == input.child_task_id {
            return Err(AppError::validation("task cannot depend on itself"));
        }

        let parent_task = self
            .repository
            .get_task(&input.parent_task_id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;
        let child_task = self
            .repository
            .get_task(&input.child_task_id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        if parent_task.project_id != child_task.project_id {
            return Err(AppError::validation(
                "dependency tasks must belong to the same project",
            ));
        }

        if self
            .repository
            .dependency_exists(&input.parent_task_id, &input.child_task_id)
            .await?
        {
            return Err(AppError::validation("dependency already exists"));
        }

        if self
            .repository
            .dependency_would_create_cycle(&input.parent_task_id, &input.child_task_id)
            .await?
        {
            return Err(AppError::validation("dependency would create a cycle"));
        }

        let created_at = Utc::now().to_rfc3339();
        let edge = self
            .repository
            .add_task_dependency(
                &parent_task.project_id,
                &input.parent_task_id,
                &input.child_task_id,
                &created_at,
            )
            .await?;

        Ok(TaskDependencyEdgeDto {
            parent_task_id: edge.parent_task_id,
            child_task_id: edge.child_task_id,
            created_at: edge.created_at,
        })
    }

    pub async fn remove_task_dependency(
        &self,
        mut input: RemoveTaskDependencyRequest,
    ) -> Result<RemoveTaskDependencyResponse, AppError> {
        input.parent_task_id = input.parent_task_id.trim().to_string();
        input.child_task_id = input.child_task_id.trim().to_string();

        if input.parent_task_id == input.child_task_id {
            return Err(AppError::validation("task cannot depend on itself"));
        }

        let parent_task = self
            .repository
            .get_task(&input.parent_task_id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;
        let child_task = self
            .repository
            .get_task(&input.child_task_id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        if parent_task.project_id != child_task.project_id {
            return Err(AppError::validation(
                "dependency tasks must belong to the same project",
            ));
        }

        let removed = self
            .repository
            .remove_task_dependency(&input.parent_task_id, &input.child_task_id)
            .await?;

        Ok(RemoveTaskDependencyResponse {
            parent_task_id: input.parent_task_id,
            child_task_id: input.child_task_id,
            removed,
        })
    }

    fn to_dto(task: Task) -> TaskDto {
        TaskDto {
            id: task.id,
            project_id: task.project_id,
            repository_id: task.repository_id,
            task_number: task.task_number,
            display_key: task.display_key,
            title: task.title,
            description: task.description,
            status: task.status,
            blocked_by_count: task.blocked_by_count,
            is_blocked: task.is_blocked,
            target_repository_name: task.target_repository_name,
            target_repository_path: task.target_repository_path,
            created_at: task.created_at,
            updated_at: task.updated_at,
        }
    }

    fn to_dependency_task_dto(task: TaskDependencyTask) -> TaskDependencyTaskDto {
        TaskDependencyTaskDto {
            id: task.id,
            display_key: task.display_key,
            title: task.title,
            status: task.status,
            target_repository_name: task.target_repository_name,
            target_repository_path: task.target_repository_path,
            updated_at: task.updated_at,
        }
    }

    fn validate_status(status: &str) -> Result<(), AppError> {
        if ["todo", "doing", "review", "done"].contains(&status) {
            Ok(())
        } else {
            Err(AppError::validation("invalid task status"))
        }
    }

    fn next_status(status: &str) -> Option<&'static str> {
        match status {
            "todo" => Some("doing"),
            "doing" => Some("review"),
            "review" => Some("done"),
            "done" => Some("todo"),
            _ => None,
        }
    }

    fn can_transition_status(from: &str, to: &str) -> bool {
        if from == "review" {
            return ["todo", "doing", "done"].contains(&to);
        }

        if from == "doing" {
            return ["review", "todo"].contains(&to);
        }

        Self::next_status(from) == Some(to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::db::migrations::run_migrations;
    use sqlx::SqlitePool;

    async fn setup_service() -> (TasksService, SqlitePool) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        let repository = TasksRepository::new(pool.clone());
        (TasksService::new(repository), pool)
    }

    async fn seed_task(pool: &SqlitePool, task_status: &str) {
        let project_id = "project-1";
        let repository_id = "repo-1";

        sqlx::query(
            "INSERT INTO projects (id, name, key, description, default_repo_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(project_id)
        .bind("Alpha")
        .bind("ALP")
        .bind(Option::<String>::None)
        .bind(repository_id)
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO project_repositories (id, project_id, name, repo_path, is_default, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(repository_id)
        .bind(project_id)
        .bind("Main")
        .bind("/repo/main")
        .bind(1)
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO tasks (id, project_id, repository_id, task_number, title, description, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("task-1")
        .bind(project_id)
        .bind(repository_id)
        .bind(1)
        .bind("Task")
        .bind(Option::<String>::None)
        .bind(task_status)
        .bind("2024-01-01T00:00:00Z")
        .bind("2024-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    #[test]
    fn transition_matrix_allows_review_backflow_and_preserves_other_rules() {
        assert!(TasksService::can_transition_status("todo", "doing"));
        assert!(TasksService::can_transition_status("doing", "review"));
        assert!(TasksService::can_transition_status("doing", "todo"));
        assert!(TasksService::can_transition_status("review", "done"));
        assert!(TasksService::can_transition_status("review", "doing"));
        assert!(TasksService::can_transition_status("review", "todo"));
        assert!(TasksService::can_transition_status("done", "todo"));

        assert!(!TasksService::can_transition_status("todo", "review"));
        assert!(!TasksService::can_transition_status("todo", "done"));
        assert!(!TasksService::can_transition_status("todo", "todo"));
        assert!(!TasksService::can_transition_status("doing", "done"));
        assert!(!TasksService::can_transition_status("invalid", "todo"));
    }

    #[tokio::test]
    async fn set_task_status_allows_review_to_doing() {
        let (service, pool) = setup_service().await;
        seed_task(&pool, "review").await;

        let result = service
            .set_task_status(
                "task-1",
                SetTaskStatusRequest {
                    status: "doing".to_string(),
                },
            )
            .await
            .unwrap();

        assert_eq!(result.status, "doing");

        let task = service.get_task("task-1").await.unwrap();
        assert_eq!(task.status, "doing");
    }

    #[tokio::test]
    async fn set_task_status_allows_review_to_todo() {
        let (service, pool) = setup_service().await;
        seed_task(&pool, "review").await;

        let result = service
            .set_task_status(
                "task-1",
                SetTaskStatusRequest {
                    status: "todo".to_string(),
                },
            )
            .await
            .unwrap();

        assert_eq!(result.status, "todo");

        let task = service.get_task("task-1").await.unwrap();
        assert_eq!(task.status, "todo");
    }

    #[tokio::test]
    async fn set_task_status_allows_doing_to_todo() {
        let (service, pool) = setup_service().await;
        seed_task(&pool, "doing").await;

        let result = service
            .set_task_status(
                "task-1",
                SetTaskStatusRequest {
                    status: "todo".to_string(),
                },
            )
            .await
            .unwrap();

        assert_eq!(result.status, "todo");

        let task = service.get_task("task-1").await.unwrap();
        assert_eq!(task.status, "todo");
    }

    #[tokio::test]
    async fn set_task_status_rejects_invalid_transition_and_keeps_state() {
        let (service, pool) = setup_service().await;
        seed_task(&pool, "todo").await;

        let result = service
            .set_task_status(
                "task-1",
                SetTaskStatusRequest {
                    status: "review".to_string(),
                },
            )
            .await;

        match result {
            Err(AppError::Validation(message)) => {
                assert_eq!(message, "invalid task status transition")
            }
            _ => panic!("expected validation error for invalid transition"),
        }

        let task = service.get_task("task-1").await.unwrap();
        assert_eq!(task.status, "todo");
    }
}
