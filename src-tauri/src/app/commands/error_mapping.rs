use crate::app::errors::AppError;

pub fn map_app_error(error: AppError) -> String {
    match error {
        AppError::Validation(message) => message,
        AppError::NotFound(message) => message,
        AppError::NotImplemented(_) => "feature not implemented".to_string(),
        AppError::Database(_) => "internal database error".to_string(),
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
    fn maps_not_implemented_to_generic_message() {
        let error = AppError::NotImplemented("not implemented: exports".to_string());

        let mapped = map_app_error(error);

        assert_eq!(mapped, "feature not implemented");
    }

    #[test]
    fn maps_database_to_internal_message_without_leaking_details() {
        let sql_detail = "syntax error near SELECT * FROM secret_table";
        let error = AppError::Database(sqlx::Error::Protocol(sql_detail.into()));

        let mapped = map_app_error(error);

        assert_eq!(mapped, "internal database error");
        assert!(!mapped.contains("secret_table"));
        assert!(!mapped.contains("syntax error"));
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
