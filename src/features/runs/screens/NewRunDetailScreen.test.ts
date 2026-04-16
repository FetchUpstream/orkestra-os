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

import { describe, expect, it } from "vitest";
import { formatGitStateLabel } from "./gitStateLabels";

describe("formatGitStateLabel", () => {
  it("maps known backend git states to user-facing labels", () => {
    expect(formatGitStateLabel("clean")).toBe("Up to Date");
    expect(formatGitStateLabel("needs_rebase")).toBe("Rebase Required");
    expect(formatGitStateLabel("rebase_in_progress")).toBe(
      "Rebase In Progress",
    );
    expect(formatGitStateLabel("mergeable")).toBe("Ready to Merge");
    expect(formatGitStateLabel("conflicted")).toBe("Conflicts Detected");
    expect(formatGitStateLabel("merged")).toBe("Merged");
    expect(formatGitStateLabel("completing")).toBe("Finalizing Merge");
    expect(formatGitStateLabel("ready")).toBe("Status Unknown");
  });

  it("falls back to status unknown for unsupported states", () => {
    expect(formatGitStateLabel("unknown")).toBe("Status Unknown");
    expect(formatGitStateLabel("unknown", "brand_new_state")).toBe(
      "Status Unknown",
    );
  });
});
