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
    expect(formatGitStateLabel("clean")).toBe("Clean");
    expect(formatGitStateLabel("needs_rebase")).toBe("Needs rebase");
    expect(formatGitStateLabel("rebase_in_progress")).toBe(
      "Rebase in progress",
    );
    expect(formatGitStateLabel("mergeable")).toBe("Mergeable");
    expect(formatGitStateLabel("conflicted")).toBe("Conflicted");
  });

  it("keeps fallback text for unknown states", () => {
    expect(formatGitStateLabel("unknown")).toBe("Unrecognized");
    expect(formatGitStateLabel("unknown", "brand_new_state")).toBe(
      "Unrecognized (brand_new_state)",
    );
  });
});
