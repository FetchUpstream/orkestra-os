use super::AppError;

pub fn capture_handled_error(error: &AppError) {
    sentry::with_scope(
        |scope| {
            scope.set_tag("handled", "true");
            scope.set_tag("error.category", error.category());

            if let Some(subsystem) = error.subsystem() {
                scope.set_tag("error.subsystem", subsystem);
            }

            if let Some(code) = error.code() {
                scope.set_tag("error.code", code);
            }
        },
        || {
            sentry::capture_error(error);
        },
    );
}
