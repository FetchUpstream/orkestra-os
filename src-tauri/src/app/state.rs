use crate::app::db::repositories::projects::ProjectsRepository;
use crate::app::db::repositories::runs::RunsRepository;
use crate::app::db::repositories::tasks::TasksRepository;
use crate::app::projects::service::ProjectsService;
use crate::app::runs::service::RunsService;
use crate::app::tasks::service::TasksService;
use sqlx::SqlitePool;

#[derive(Clone, Debug)]
pub struct AppState {
    pub db_pool: SqlitePool,
    pub projects_service: ProjectsService,
    pub runs_service: RunsService,
    pub tasks_service: TasksService,
}

impl AppState {
    pub fn new(db_pool: SqlitePool) -> Self {
        let repository = ProjectsRepository::new(db_pool.clone());
        let runs_repository = RunsRepository::new(db_pool.clone());
        let tasks_repository = TasksRepository::new(db_pool.clone());
        let projects_service = ProjectsService::new(repository);
        let runs_service = RunsService::new(runs_repository);
        let tasks_service = TasksService::new(tasks_repository);
        Self {
            db_pool,
            projects_service,
            runs_service,
            tasks_service,
        }
    }
}
