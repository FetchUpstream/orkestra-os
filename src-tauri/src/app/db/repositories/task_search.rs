use crate::app::tasks::errors::TaskSearchRepositoryError;
use sqlx::{Row, SqlitePool};

#[derive(Clone, Debug)]
pub struct TaskSearchCandidate {
    pub task_id: String,
    pub display_key: String,
    pub title: String,
    pub description: String,
    pub fts_rank: f64,
}

#[derive(Clone, Debug)]
pub struct TaskSearchRepository {
    pool: SqlitePool,
}

impl TaskSearchRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn list_project_candidates(
        &self,
        project_id: &str,
        fts_query: &str,
        limit: i64,
    ) -> Result<Vec<TaskSearchCandidate>, TaskSearchRepositoryError> {
        let rows = sqlx::query(
            "SELECT
                d.task_id,
                d.display_key,
                d.title,
                d.description,
                bm25(task_search_fts) AS fts_rank
             FROM task_search_fts
             JOIN task_search_docs d ON d.doc_id = task_search_fts.rowid
             WHERE d.project_id = ?
               AND task_search_fts MATCH ?
             ORDER BY bm25(task_search_fts) ASC, d.doc_id ASC
             LIMIT ?",
        )
        .bind(project_id)
        .bind(fts_query)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|source| TaskSearchRepositoryError::db("list_project_candidates", source))?;

        Ok(rows
            .into_iter()
            .map(|row| TaskSearchCandidate {
                task_id: row.get("task_id"),
                display_key: row.get("display_key"),
                title: row.get("title"),
                description: row.get("description"),
                fts_rank: row.get("fts_rank"),
            })
            .collect())
    }
}
