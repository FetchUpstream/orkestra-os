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
import {
  getDefaultRunSourceBranch,
  validateNewRunSourceBranchName,
} from "../sourceBranches";

const branches = [
  { name: "main", isCheckedOut: true },
  { name: "feature/existing", isCheckedOut: false },
];

describe("source branch helpers", () => {
  it("keeps the checked-out branch as the default source branch", () => {
    expect(getDefaultRunSourceBranch(branches)).toBe("main");
  });

  it("allows common new branch names with slashes, hyphens, underscores, and dots", () => {
    expect(
      validateNewRunSourceBranchName(
        "feature/run-prepend_instructions.v1",
        branches,
      ),
    ).toBe("");
  });

  it("requires a new branch name", () => {
    expect(validateNewRunSourceBranchName("   ", branches)).toBe(
      "Enter a branch name.",
    );
  });

  it("rejects duplicate local branch names", () => {
    expect(validateNewRunSourceBranchName("feature/existing", branches)).toBe(
      "A local branch with this name already exists. Select it from the list instead.",
    );
  });

  it("rejects obviously invalid branch names", () => {
    expect(validateNewRunSourceBranchName("feature/..", branches)).toBe(
      "Branch name is not valid.",
    );
  });

  it("rejects branch names that Git rejects as branch shorthands", () => {
    expect(validateNewRunSourceBranchName("HEAD", branches)).toBe(
      "Branch name is not valid.",
    );
    expect(validateNewRunSourceBranchName("-feature", branches)).toBe(
      "Branch name is not valid.",
    );
  });
});
