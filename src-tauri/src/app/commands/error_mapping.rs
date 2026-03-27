use crate::app::errors::AppError;
use tracing::warn;

pub fn map_app_error(error: AppError) -> String {
    let mapped_message = mapped_message_for_error(&error);
    log_mapped_error(&error, &mapped_message);
    maybe_capture_handled_error(&error);

    mapped_message
}

fn mapped_message_for_error(error: &AppError) -> String {
    match error {
        AppError::Validation(message) => message.clone(),
        AppError::NotFound(message) => message.clone(),
        AppError::Conflict(message) => message.clone(),
        AppError::Database(_) => "Unable to complete this request right now.".to_string(),
        AppError::Infrastructure(_) => "Something went wrong. Please try again.".to_string(),
    }
}

fn log_mapped_error(error: &AppError, mapped_message: &str) {
    let (error_kind, message_for_log) = match error {
        AppError::Validation(message) => ("validation", Some(message.as_str())),
        AppError::NotFound(message) => ("not_found", Some(message.as_str())),
        AppError::Conflict(message) => ("conflict", Some(message.as_str())),
        AppError::Database(_) => ("database", None),
        AppError::Infrastructure(_) => ("infrastructure", None),
    };

    warn!(
        subsystem = "commands.error_mapping",
        operation = "map_app_error",
        error_kind = error_kind,
        user_safe = error.is_user_safe(),
        sentry_capture = !error.is_user_safe(),
        safe_message = message_for_log.unwrap_or("<redacted>"),
        mapped_message = mapped_message,
        "Mapped top-level app error"
    );
}

fn maybe_capture_handled_error(error: &AppError) {
    if !error.is_user_safe() {
        crate::app::errors::sentry::capture_handled_error(error);
    }
}

pub fn map_result<T>(result: Result<T, AppError>) -> Result<T, String> {
    result.map_err(map_app_error)
}

#[cfg(test)]
mod tests {
    use super::{map_app_error, map_result};
    use crate::app::errors::AppError;

    #[test]
    fn maps_validation_to_exact_message() {
        let error = AppError::Validation("invalid payload".to_string());

        let mapped = map_app_error(error);

        assert_eq!(mapped, "invalid payload");
    }

    #[test]
    fn maps_not_found_to_exact_message() {
        let error = AppError::NotFound("project not found".to_string());

        let mapped = map_app_error(error);

        assert_eq!(mapped, "project not found");
    }

    #[test]
    fn maps_database_to_internal_message_without_leaking_details() {
        let sql_detail = "syntax error near SELECT * FROM secret_table";
        let error = AppError::Database(sqlx::Error::Protocol(sql_detail.into()));

        let mapped = map_app_error(error);

        assert_eq!(mapped, "Unable to complete this request right now.");
        assert!(!mapped.contains("secret_table"));
        assert!(!mapped.contains("syntax error"));
    }

    #[test]
    fn maps_conflict_to_exact_message() {
        let error = AppError::Conflict("project key already exists".to_string());

        let mapped = map_app_error(error);

        assert_eq!(mapped, "project key already exists");
    }

    #[test]
    fn maps_infrastructure_to_generic_message_without_leaking_details() {
        let error = AppError::infrastructure(
            "filesystem",
            "permission_denied",
            "failed to write /home/louis/private/project/.env",
        );

        let mapped = map_app_error(error);

        assert_eq!(mapped, "Something went wrong. Please try again.");
        assert!(!mapped.contains("/home/louis/private/project/.env"));
    }

    #[test]
    fn map_result_keeps_ok_unchanged() {
        let result: Result<i32, AppError> = Ok(42);

        let mapped = map_result(result);

        assert_eq!(mapped, Ok(42));
    }

    #[test]
    fn map_result_maps_err_to_string() {
        let result: Result<(), AppError> = Err(AppError::Validation("missing name".to_string()));

        let mapped = map_result(result);

        assert_eq!(mapped, Err("missing name".to_string()));
    }
}
