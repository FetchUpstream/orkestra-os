// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

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
