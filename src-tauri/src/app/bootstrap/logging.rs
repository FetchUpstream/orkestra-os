use std::path::Path;
use std::sync::{Once, OnceLock};

use tracing::warn;
use tracing_appender::non_blocking::NonBlocking;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::fmt;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{EnvFilter, Registry};

static LOGGING_INIT: Once = Once::new();
static LOG_GUARDS: OnceLock<Vec<WorkerGuard>> = OnceLock::new();

const LOG_FILENAME: &str = "backend.log";

pub fn init(log_dir: &Path) {
    LOGGING_INIT.call_once(|| {
        let mut guards: Vec<WorkerGuard> = Vec::new();

        let subscriber_result = match build_file_writer(&log_dir, &mut guards) {
            Ok(non_blocking) => {
                let file_layer = fmt::layer()
                    .json()
                    .with_ansi(false)
                    .with_target(true)
                    .with_current_span(true)
                    .with_span_list(true)
                    .with_writer(non_blocking);

                let subscriber = Registry::default()
                    .with(resolve_env_filter())
                    .with(
                        fmt::layer()
                            .with_target(true)
                            .with_ansi(cfg!(debug_assertions)),
                    )
                    .with(file_layer);

                tracing::subscriber::set_global_default(subscriber)
            }
            Err(err) => {
                eprintln!("failed to initialize file logging: {err}");

                let subscriber = Registry::default().with(resolve_env_filter()).with(
                    fmt::layer()
                        .with_target(true)
                        .with_ansi(cfg!(debug_assertions)),
                );

                tracing::subscriber::set_global_default(subscriber)
            }
        };

        if let Err(err) = subscriber_result {
            eprintln!("failed to install global tracing subscriber: {err}");
            return;
        }

        if !guards.is_empty() {
            let _ = LOG_GUARDS.set(guards);
            tracing::info!(log_dir = %log_dir.display(), "backend file logging initialized");
        } else {
            warn!("backend file logging unavailable, running with console logging only");
        }
    });
}

fn build_file_writer(log_dir: &Path, guards: &mut Vec<WorkerGuard>) -> anyhow::Result<NonBlocking> {
    std::fs::create_dir_all(log_dir)?;

    let file_appender = tracing_appender::rolling::daily(log_dir, LOG_FILENAME);
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    guards.push(guard);

    Ok(non_blocking)
}

fn resolve_env_filter() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_log_directive()))
}

fn default_log_directive() -> &'static str {
    if cfg!(debug_assertions) {
        "debug,sqlx=warn,tao=info,wry=info"
    } else {
        "info,sqlx=warn,tao=warn,wry=warn"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_directive_is_never_empty() {
        assert!(!default_log_directive().trim().is_empty());
    }
}
