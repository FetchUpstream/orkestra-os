use crate::app::db::repositories::tasks::TasksRepository;
use crate::app::errors::AppError;
use crate::app::tasks::dto::{CreateTaskRequest, TaskDto};
use crate::app::tasks::models::NewTask;
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

        Ok(TaskDto {
            id: created.id,
            project_id: created.project_id,
            repository_id: created.repository_id,
            title: created.title,
            description: created.description,
            status: created.status,
            created_at: created.created_at,
            updated_at: created.updated_at,
        })
    }

    pub async fn list_project_tasks(&self, project_id: &str) -> Result<Vec<TaskDto>, AppError> {
        if !self.repository.project_exists(project_id).await? {
            return Err(AppError::not_found("project not found"));
        }

        let tasks = self.repository.list_project_tasks(project_id).await?;
        Ok(tasks
            .into_iter()
            .map(|task| TaskDto {
                id: task.id,
                project_id: task.project_id,
                repository_id: task.repository_id,
                title: task.title,
                description: task.description,
                status: task.status,
                created_at: task.created_at,
                updated_at: task.updated_at,
            })
            .collect())
    }

    pub async fn get_task(&self, id: &str) -> Result<TaskDto, AppError> {
        let task = self
            .repository
            .get_task(id)
            .await?
            .ok_or_else(|| AppError::not_found("task not found"))?;

        Ok(TaskDto {
            id: task.id,
            project_id: task.project_id,
            repository_id: task.repository_id,
            title: task.title,
            description: task.description,
            status: task.status,
            created_at: task.created_at,
            updated_at: task.updated_at,
        })
    }

    fn validate_status(status: &str) -> Result<(), AppError> {
        if ["todo", "doing", "review", "done"].contains(&status) {
            Ok(())
        } else {
            Err(AppError::validation("invalid task status"))
        }
    }
}
