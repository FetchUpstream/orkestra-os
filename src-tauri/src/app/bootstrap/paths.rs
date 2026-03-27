use crate::app::errors::AppError;
use std::ffi::OsString;
use std::path::PathBuf;
use tauri::Manager;

const DB_FILENAME: &str = "orkestra.db";

#[derive(Clone, Debug)]
pub struct StartupPaths {
    pub app_data_dir: PathBuf,
    pub log_dir: PathBuf,
}

impl StartupPaths {
    pub fn db_path(&self) -> PathBuf {
        self.app_data_dir.join(DB_FILENAME)
    }
}

pub fn resolve_startup_paths<R: tauri::Runtime>(
    app: &tauri::App<R>,
) -> Result<StartupPaths, AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|err| {
        AppError::infrastructure_with_source(
            "bootstrap",
            "resolve_app_data_dir",
            "Failed to resolve app data directory",
            err,
        )
    })?;
    std::fs::create_dir_all(&app_data_dir).map_err(|err| {
        AppError::infrastructure_with_source(
            "bootstrap",
            "create_app_data_dir",
            format!(
                "Failed to create app data directory: {}",
                app_data_dir.display()
            ),
            err,
        )
    })?;

    let log_dir = resolve_log_dir(app)?;
    std::fs::create_dir_all(&log_dir).map_err(|err| {
        AppError::infrastructure_with_source(
            "bootstrap",
            "create_log_dir",
            format!("Failed to create log directory: {}", log_dir.display()),
            err,
        )
    })?;

    Ok(StartupPaths {
        app_data_dir,
        log_dir,
    })
}

pub fn resolve_log_dir<R: tauri::Runtime>(app: &tauri::App<R>) -> Result<PathBuf, AppError> {
    #[cfg(target_os = "linux")]
    {
        let identifier = app.config().identifier.trim();
        return linux_log_dir(
            identifier,
            std::env::var_os("XDG_STATE_HOME"),
            std::env::var_os("HOME"),
        );
    }

    #[cfg(not(target_os = "linux"))]
    {
        app.path().app_log_dir().map_err(|err| {
            AppError::infrastructure_with_source(
                "bootstrap",
                "resolve_log_dir",
                "Failed to resolve app log directory",
                err,
            )
        })
    }
}

#[cfg(target_os = "linux")]
fn linux_log_dir(
    identifier: &str,
    xdg_state_home: Option<OsString>,
    home: Option<OsString>,
) -> Result<PathBuf, AppError> {
    let base_dir = match into_non_empty_path(xdg_state_home) {
        Some(path) => path,
        None => {
            let home_dir = into_non_empty_path(home).ok_or_else(|| {
                AppError::infrastructure(
                    "bootstrap",
                    "resolve_log_dir",
                    "Unable to resolve Linux log directory: HOME is not set and XDG_STATE_HOME is empty",
                )
            })?;
            home_dir.join(".local").join("state")
        }
    };

    Ok(base_dir
        .join(normalize_app_identifier(identifier))
        .join("logs"))
}

#[cfg(target_os = "linux")]
fn into_non_empty_path(value: Option<OsString>) -> Option<PathBuf> {
    let value = value?;
    if value.is_empty() {
        return None;
    }
    Some(PathBuf::from(value))
}

fn normalize_app_identifier(identifier: &str) -> String {
    let normalized = identifier.trim();
    if normalized.is_empty() {
        return "orkestraos".to_string();
    }

    normalized
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_path_uses_expected_filename() {
        let startup_paths = StartupPaths {
            app_data_dir: PathBuf::from("/tmp/orkestra"),
            log_dir: PathBuf::from("/tmp/orkestra/logs"),
        };

        assert_eq!(
            startup_paths.db_path(),
            PathBuf::from("/tmp/orkestra/orkestra.db")
        );
    }

    #[test]
    fn normalize_app_identifier_replaces_unsupported_chars() {
        assert_eq!(normalize_app_identifier("my app/name"), "my-app-name");
    }

    #[cfg(target_os = "linux")]
    mod linux_tests {
        use super::*;

        #[test]
        fn linux_log_dir_prefers_xdg_state_home() {
            let path = linux_log_dir(
                "com.orkestra.app",
                Some("/tmp/xdg-state".into()),
                Some("/home/test".into()),
            )
            .expect("should resolve linux log dir");

            assert_eq!(path, PathBuf::from("/tmp/xdg-state/com.orkestra.app/logs"));
        }

        #[test]
        fn linux_log_dir_falls_back_to_home_state_dir() {
            let path = linux_log_dir("orkestra", None, Some("/home/test".into()))
                .expect("should resolve linux log dir");

            assert_eq!(path, PathBuf::from("/home/test/.local/state/orkestra/logs"));
        }
    }
}
