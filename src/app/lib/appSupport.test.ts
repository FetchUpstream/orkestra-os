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
import { compareAppVersions, normalizeAppVersion } from "./appVersion";
import { formatAppVersionForDisplay } from "./appSupport";

describe("normalizeAppVersion", () => {
  it.each([
    { input: undefined, expected: undefined },
    { input: "0.0.12+105", expected: "0.0.12+105" },
    { input: "v0.0.12+105", expected: "0.0.12+105" },
    { input: "0.0.2~RC.1", expected: "0.0.2-RC.1" },
  ])("normalizes $input", ({ input, expected }) => {
    expect(normalizeAppVersion(input)).toBe(expected);
  });
});

describe("formatAppVersionForDisplay", () => {
  it.each([
    { input: undefined, expected: "unknown" },
    { input: "v", expected: "unknown" },
    { input: "V", expected: "unknown" },
    { input: "0.0.12+105", expected: "v0.0.12+105" },
    { input: "v0.0.12+105", expected: "v0.0.12+105" },
    { input: "0.0.2~RC.1", expected: "v0.0.2-RC.1" },
  ])("returns $expected for $input", ({ input, expected }) => {
    expect(formatAppVersionForDisplay(input)).toBe(expected);
  });
});

describe("compareAppVersions", () => {
  it("treats Linux package prerelease syntax as semver-equivalent", () => {
    expect(compareAppVersions("0.0.2-RC.1", "0.0.2~RC.1")).toBe(0);
  });
});
