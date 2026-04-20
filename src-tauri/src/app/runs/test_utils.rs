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

pub(crate) fn should_skip_ci_missing_opencode_cli() -> bool {
    if std::env::var_os("CI").is_none() {
        return false;
    }

    let is_available = std::process::Command::new("opencode")
        .arg("--help")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if is_available {
        return false;
    }

    eprintln!("skipping OpenCode CLI-dependent test in CI because 'opencode' is unavailable");
    true
}
