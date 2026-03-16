use crate::app::errors::AppError;
use crate::app::runs::dto::{EnsureRunOpenCodeResponse, RawAgentEvent, RunDto};
use crate::app::runs::service::RunsService;
use chrono::Utc;
use opencode::{
    OpencodeClient, OpencodeClientConfig, OpencodeServer, OpencodeServerOptions, RequestOptions,
    create_opencode_client, create_opencode_server,
};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tokio::sync::RwLock;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;

const MAX_BUFFERED_EVENTS: usize = 500;

#[derive(Clone)]
pub struct RunsOpenCodeService {
    runs_service: RunsService,
    worktrees_root: PathBuf,
    handles: Arc<RwLock<HashMap<String, Arc<RunOpenCodeHandle>>>>,
}

impl std::fmt::Debug for RunsOpenCodeService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunsOpenCodeService")
            .field("worktrees_root", &self.worktrees_root)
            .finish_non_exhaustive()
    }
}

struct RunOpenCodeHandle {
    _server: Arc<tokio::sync::Mutex<OpencodeServer>>,
    _client: OpencodeClient,
    subscribers: Arc<Mutex<HashMap<String, Channel<RawAgentEvent>>>>,
    event_tx: tokio::sync::broadcast::Sender<RawAgentEvent>,
    buffered_events: Arc<Mutex<VecDeque<RawAgentEvent>>>,
}

impl RunsOpenCodeService {
    pub fn new(runs_service: RunsService, app_data_dir: PathBuf) -> Self {
        Self {
            runs_service,
            worktrees_root: app_data_dir.join("worktrees"),
            handles: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn ensure_run_opencode(&self, run_id: &str) -> Result<EnsureRunOpenCodeResponse, AppError> {
        let run = self.runs_service.get_run(run_id).await?;
        if matches!(run.status.as_str(), "completed" | "failed" | "cancelled") {
            return Ok(EnsureRunOpenCodeResponse {
                state: "unsupported".to_string(),
                reason: Some(format!("run status '{}' is not supported", run.status)),
            });
        }

        if !matches!(run.status.as_str(), "queued" | "preparing" | "running") {
            return Ok(EnsureRunOpenCodeResponse {
                state: "unsupported".to_string(),
                reason: Some(format!("run status '{}' is not supported", run.status)),
            });
        }

        if self.handles.read().await.contains_key(&run.id) {
            return Ok(EnsureRunOpenCodeResponse {
                state: "running".to_string(),
                reason: None,
            });
        }

        let worktree_path = self.resolve_worktree_path(&run)?;
        let mut options = OpencodeServerOptions {
            cwd: Some(worktree_path.clone()),
            ..Default::default()
        };
        options.config = Some(serde_json::json!({}));

        let server = create_opencode_server(Some(options))
            .await
            .map_err(|err| AppError::validation(format!("failed to start OpenCode server: {err}")))?;
        let client = create_opencode_client(Some(OpencodeClientConfig {
            base_url: server.url.clone(),
            directory: Some(worktree_path.to_string_lossy().to_string()),
            ..Default::default()
        }))
        .map_err(|err| AppError::validation(format!("failed to create OpenCode client: {err}")))?;

        client
            .global()
            .health(RequestOptions::default())
            .await
            .map_err(|err| AppError::validation(format!("OpenCode health check failed: {err}")))?;

        let (event_tx, _rx) = tokio::sync::broadcast::channel(64);
        let subscribers = Arc::new(Mutex::new(HashMap::new()));
        let buffered_events = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_BUFFERED_EVENTS)));
        let handle = Arc::new(RunOpenCodeHandle {
            _server: Arc::new(tokio::sync::Mutex::new(server)),
            _client: client.clone(),
            subscribers: subscribers.clone(),
            event_tx: event_tx.clone(),
            buffered_events: buffered_events.clone(),
        });

        self.handles
            .write()
            .await
            .insert(run.id.clone(), handle.clone());

        self.spawn_event_stream(run.id.clone(), client, event_tx, buffered_events);

        if run.status == "queued" {
            let _ = self.runs_service.transition_queued_to_running(&run.id).await?;
        }

        Ok(EnsureRunOpenCodeResponse {
            state: "running".to_string(),
            reason: None,
        })
    }

    pub async fn subscribe_run_opencode_events(
        &self,
        subscriber_id: &str,
        run_id: &str,
        on_output: Channel<RawAgentEvent>,
    ) -> Result<(), AppError> {
        let ensured = self.ensure_run_opencode(run_id).await?;
        if ensured.state == "unsupported" {
            return Err(AppError::validation(
                ensured
                    .reason
                    .unwrap_or_else(|| "run status is not supported".to_string()),
            ));
        }

        let handle = self
            .handles
            .read()
            .await
            .get(run_id)
            .cloned()
            .ok_or_else(|| AppError::not_found("OpenCode run handle not found"))?;

        {
            let mut subscribers = handle
                .subscribers
                .lock()
                .map_err(|_| AppError::validation("failed to lock OpenCode subscribers"))?;
            subscribers.insert(subscriber_id.to_string(), on_output);
        }

        let subscriber_id_owned = subscriber_id.to_string();
        let subscribers = handle.subscribers.clone();
        let mut stream = BroadcastStream::new(handle.event_tx.subscribe());
        tauri::async_runtime::spawn(async move {
            while let Some(frame) = stream.next().await {
                let Ok(event) = frame else {
                    continue;
                };

                let send_result = {
                    let subscribers_guard = subscribers.lock();
                    if let Ok(subscribers_guard) = subscribers_guard {
                        subscribers_guard
                            .get(&subscriber_id_owned)
                            .cloned()
                            .map(|channel| channel.send(event.clone()))
                    } else {
                        None
                    }
                };

                if matches!(send_result, Some(Err(_))) {
                    if let Ok(mut subscribers_guard) = subscribers.lock() {
                        subscribers_guard.remove(&subscriber_id_owned);
                    }
                    break;
                }
            }
        });

        Ok(())
    }

    pub async fn get_buffered_run_opencode_events(
        &self,
        run_id: &str,
    ) -> Result<Vec<RawAgentEvent>, AppError> {
        let handle = self
            .handles
            .read()
            .await
            .get(run_id)
            .cloned()
            .ok_or_else(|| AppError::not_found("OpenCode run handle not found"))?;

        let buffered = handle
            .buffered_events
            .lock()
            .map_err(|_| AppError::validation("failed to lock OpenCode buffered events"))?;
        Ok(buffered.iter().cloned().collect())
    }

    fn spawn_event_stream(
        &self,
        run_id: String,
        client: OpencodeClient,
        event_tx: tokio::sync::broadcast::Sender<RawAgentEvent>,
        buffered_events: Arc<Mutex<VecDeque<RawAgentEvent>>>,
    ) {
        let handles = self.handles.clone();
        tauri::async_runtime::spawn(async move {
            let mut stream = match client.event().subscribe(RequestOptions::default()).await {
                Ok(stream) => stream,
                Err(_) => {
                    let mut handles_guard = handles.write().await;
                    handles_guard.remove(&run_id);
                    return;
                }
            };

            while let Some(frame) = stream.next().await {
                let sse = match frame {
                    Ok(event) => event,
                    Err(_) => break,
                };

                let event_name = sse.event.unwrap_or_else(|| "message".to_string());
                let payload = sse.data;
                let agent_event = RawAgentEvent {
                    timestamp: Utc::now().to_rfc3339(),
                    event_name,
                    payload,
                };

                if let Ok(mut buffered) = buffered_events.lock() {
                    if buffered.len() >= MAX_BUFFERED_EVENTS {
                        buffered.pop_front();
                    }
                    buffered.push_back(agent_event.clone());
                }

                let _ = event_tx.send(agent_event);
            }

            let mut handles_guard = handles.write().await;
            handles_guard.remove(&run_id);
        });
    }

    fn resolve_worktree_path(&self, run: &RunDto) -> Result<PathBuf, AppError> {
        let worktree_id = run
            .worktree_id
            .as_deref()
            .ok_or_else(|| AppError::not_found("run worktree not found"))?
            .trim();
        if worktree_id.is_empty() {
            return Err(AppError::not_found("run worktree not found"));
        }

        if run.project_id.trim().is_empty() {
            return Err(AppError::validation("run project_id is required"));
        }

        let worktree_path = self.worktrees_root.join(&run.project_id).join(worktree_id);
        if !worktree_path.exists() {
            return Err(AppError::not_found("run worktree path not found"));
        }

        Ok(worktree_path)
    }
}
