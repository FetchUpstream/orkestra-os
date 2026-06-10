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
  getProjectEnvVarError,
  isReservedProjectEnvVarKey,
  normalizeProjectEnvVars,
} from "./projectForm";

describe("projectForm environment variables", () => {
  it("normalizes normal project environment variables", () => {
    expect(
      normalizeProjectEnvVars([
        { key: "  API_TOKEN  ", value: "secret" },
        { key: "", value: "" },
      ]),
    ).toEqual([{ key: "API_TOKEN", value: "secret" }]);
  });

  it("rejects invalid keys", () => {
    expect(getProjectEnvVarError([{ key: "1INVALID", value: "value" }])).toBe(
      "Environment variable keys must start with a letter or underscore and contain only letters, numbers, and underscores.",
    );
  });

  it("rejects reserved runtime keys before save", () => {
    expect(isReservedProjectEnvVarKey("PATH")).toBe(true);
    expect(isReservedProjectEnvVarKey("path")).toBe(true);
    expect(isReservedProjectEnvVarKey("PaTh")).toBe(true);
    expect(getProjectEnvVarError([{ key: "PATH", value: "" }])).toContain(
      "managed by Orkestra",
    );
    expect(getProjectEnvVarError([{ key: "path", value: "" }])).toContain(
      "managed by Orkestra",
    );
    expect(getProjectEnvVarError([{ key: "PaTh", value: "" }])).toContain(
      "managed by Orkestra",
    );
  });

  it("allows unchanged legacy reserved runtime keys while editing", () => {
    expect(
      getProjectEnvVarError([{ key: "path", value: "/legacy/bin" }], {
        allowedReservedEnvVars: [{ key: "PATH", value: "/legacy/bin" }],
      }),
    ).toBe("");
    expect(
      getProjectEnvVarError([{ key: "PATH", value: "/changed/bin" }], {
        allowedReservedEnvVars: [{ key: "PATH", value: "/legacy/bin" }],
      }),
    ).toContain("managed by Orkestra");
  });

  it("allows normal empty values", () => {
    expect(getProjectEnvVarError([{ key: "EMPTY_OK", value: "" }])).toBe("");
  });
});
