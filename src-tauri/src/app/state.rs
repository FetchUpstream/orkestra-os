use crate::app::db::repositories::projects::ProjectsRepository;
use crate::app::projects::service::ProjectsService;
use sqlx::SqlitePool;

#[derive(Clone, Debug, Default)]
pub struct AppState {
    pub db_pool: Option<SqlitePool>,
    pub projects_service: Option<ProjectsService>,
    pub is_ready: bool,
}

impl AppState {
    pub fn new_with_pool(db_pool: SqlitePool) -> Self {
        let repository = ProjectsRepository::new(db_pool.clone());
        let projects_service = ProjectsService::new(repository);
        Self {
            db_pool: Some(db_pool),
            projects_service: Some(projects_service),
            is_ready: true,
        }
    }

    pub fn new_placeholder() -> Self {
        Self::default()
    }
}
