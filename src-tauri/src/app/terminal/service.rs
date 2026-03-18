use crate::app::errors::AppError;
use crate::app::runs::dto::RunDto;
use crate::app::runs::service::RunsService;
use crate::app::worktrees::pathing::resolve_worktree_path;
use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

#[derive(Clone)]
pub struct TerminalService {
    runs_service: RunsService,
    worktrees_root: PathBuf,
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

impl std::fmt::Debug for TerminalService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TerminalService")
            .field("worktrees_root", &self.worktrees_root)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRunTerminalResponse {
    pub session_id: String,
    pub generation: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "event")]
pub enum TerminalFrame {
    Data { chunk_base64: String },
    Exit { code: Option<i32>, signal: Option<i32> },
    Error { message: String },
    Closed,
}

struct TerminalSession {
    generation: u64,
    owner_label: String,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    killer: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

impl TerminalService {
    pub fn new(runs_service: RunsService, app_data_dir: PathBuf) -> Self {
        Self {
            runs_service,
            worktrees_root: app_data_dir.join("worktrees"),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn open_run_terminal(
        &self,
        owner_label: &str,
        run_id: &str,
        route_instance_id: &str,
        cols: u16,
        rows: u16,
        on_output: Channel<TerminalFrame>,
    ) -> Result<OpenRunTerminalResponse, AppError> {
        let owner_label = owner_label.trim();
        let route_instance_id = route_instance_id.trim();
        if owner_label.is_empty() {
            return Err(AppError::validation("owner label is required"));
        }
        if route_instance_id.is_empty() {
            return Err(AppError::validation("route_instance_id is required"));
        }

        let size = Self::validate_size(cols, rows)?;
        let run = self.runs_service.get_run(run_id).await?;
        let cwd = self.resolve_worktree_path(&run)?;
        let shell = Self::resolve_shell();

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(size)
            .map_err(|err| AppError::validation(format!("failed to open pty: {err}")))?;

        let mut cmd = CommandBuilder::new(shell);
        cmd.cwd(cwd);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|err| AppError::validation(format!("failed to spawn terminal process: {err}")))?;
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|err| AppError::validation(format!("failed to create terminal reader: {err}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|err| AppError::validation(format!("failed to create terminal writer: {err}")))?;

        let session_id = uuid::Uuid::new_v4().to_string();
        let generation = 1_u64;
        let child_arc = Arc::new(Mutex::new(child));

        let session = TerminalSession {
            generation,
            owner_label: owner_label.to_string(),
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
            killer: child_arc.clone(),
        };

        self.sessions
            .lock()
            .map_err(|_| AppError::validation("failed to lock terminal session registry"))?
            .insert(session_id.clone(), session);

        self.spawn_terminal_reader(session_id.clone(), generation, reader, child_arc, on_output);

        Ok(OpenRunTerminalResponse {
            session_id,
            generation,
        })
    }

    pub fn write_run_terminal(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
        data: &str,
    ) -> Result<(), AppError> {
        let writer = self.with_session(owner_label, session_id, generation, |session| {
            session.writer.clone()
        })?;
        let mut writer = writer
            .lock()
            .map_err(|_| AppError::validation("failed to lock terminal writer"))?;
        writer
            .write_all(data.as_bytes())
            .map_err(|err| AppError::validation(format!("failed to write to terminal: {err}")))?;
        writer
            .flush()
            .map_err(|err| AppError::validation(format!("failed to flush terminal write: {err}")))
    }

    pub fn resize_run_terminal(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
        cols: u16,
        rows: u16,
    ) -> Result<(), AppError> {
        let size = Self::validate_size(cols, rows)?;
        let master = self.with_session(owner_label, session_id, generation, |session| {
            session.master.clone()
        })?;
        let master = master
            .lock()
            .map_err(|_| AppError::validation("failed to lock terminal pty"))?;
        master
            .resize(size)
            .map_err(|err| AppError::validation(format!("failed to resize terminal: {err}")))
    }

    pub fn kill_run_terminal(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), AppError> {
        let session = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| AppError::validation("failed to lock terminal session registry"))?;
            let Some(session) = sessions.get(session_id) else {
                return Ok(());
            };
            self.validate_owner_generation(owner_label, session_id, generation, session)?;
            sessions
                .remove(session_id)
                .ok_or_else(|| AppError::not_found("terminal session not found"))?
        };

        let mut killer = session
            .killer
            .lock()
            .map_err(|_| AppError::validation("failed to lock terminal process handle"))?;
        let _ = killer.kill();
        Ok(())
    }

    fn with_session<T>(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
        selector: impl FnOnce(&TerminalSession) -> T,
    ) -> Result<T, AppError> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::validation("failed to lock terminal session registry"))?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::not_found("terminal session not found"))?;
        self.validate_owner_generation(owner_label, session_id, generation, session)?;
        Ok(selector(session))
    }

    fn validate_owner_generation(
        &self,
        owner_label: &str,
        session_id: &str,
        generation: u64,
        session: &TerminalSession,
    ) -> Result<(), AppError> {
        if session.generation != generation {
            return Err(AppError::validation(format!(
                "terminal session generation mismatch for '{session_id}'"
            )));
        }
        if session.owner_label != owner_label {
            return Err(AppError::validation(format!(
                "terminal session owner mismatch for '{session_id}'"
            )));
        }
        Ok(())
    }

    fn resolve_worktree_path(&self, run: &RunDto) -> Result<PathBuf, AppError> {
        let worktree_id = run
            .worktree_id
            .as_deref()
            .ok_or_else(|| AppError::not_found("run worktree not found"))?
            .trim();
        resolve_worktree_path(&self.worktrees_root, worktree_id)
    }

    fn validate_size(cols: u16, rows: u16) -> Result<PtySize, AppError> {
        if cols == 0 || rows == 0 {
            return Err(AppError::validation("terminal size must be >= 1"));
        }
        Ok(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
    }

    fn resolve_shell() -> String {
        #[cfg(windows)]
        {
            for candidate in ["pwsh.exe", "powershell.exe", "cmd.exe"] {
                if Self::is_executable_on_path(candidate) {
                    return candidate.to_string();
                }
            }
            "cmd.exe".to_string()
        }

        #[cfg(not(windows))]
        {
            if let Ok(shell) = std::env::var("SHELL") {
                let trimmed = shell.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
            if std::path::Path::new("/bin/bash").exists() {
                return "/bin/bash".to_string();
            }
            "/bin/sh".to_string()
        }
    }

    #[cfg(windows)]
    fn is_executable_on_path(candidate: &str) -> bool {
        if candidate.contains(std::path::MAIN_SEPARATOR) {
            return std::path::Path::new(candidate).exists();
        }
        std::env::var_os("PATH")
            .map(|paths| {
                std::env::split_paths(&paths)
                    .map(|path| path.join(candidate))
                    .any(|full_path| full_path.exists())
            })
            .unwrap_or(false)
    }

    fn spawn_terminal_reader(
        &self,
        session_id: String,
        generation: u64,
        mut reader: Box<dyn Read + Send>,
        child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
        on_output: Channel<TerminalFrame>,
    ) {
        let sessions = self.sessions.clone();
        std::thread::spawn(move || {
            let mut buf = [0_u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk_base64 = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        if on_output.send(TerminalFrame::Data { chunk_base64 }).is_err() {
                            break;
                        }
                    }
                    Err(err) => {
                        let _ = on_output.send(TerminalFrame::Error {
                            message: format!("terminal read failed: {err}"),
                        });
                        break;
                    }
                }
            }

            let (code, signal) = match child.lock() {
                Ok(mut child) => match child.wait() {
                    Ok(status) => {
                        let code = i32::try_from(status.exit_code()).ok();
                        let signal = status.signal().and_then(|value| value.parse::<i32>().ok());
                        (code, signal)
                    }
                    Err(err) => {
                        let _ = on_output.send(TerminalFrame::Error {
                            message: format!("terminal wait failed: {err}"),
                        });
                        (None, None)
                    }
                },
                Err(_) => {
                    let _ = on_output.send(TerminalFrame::Error {
                        message: "failed to lock terminal process handle".to_string(),
                    });
                    (None, None)
                }
            };

            let _ = on_output.send(TerminalFrame::Exit { code, signal });
            let _ = on_output.send(TerminalFrame::Closed);

            if let Ok(mut sessions) = sessions.lock() {
                if let Some(session) = sessions.get(&session_id) {
                    if session.generation == generation {
                        sessions.remove(&session_id);
                    }
                }
            }
        });
    }
}
