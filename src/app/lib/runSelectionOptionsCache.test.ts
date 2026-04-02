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

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRunSelectionOptionsWithCache,
  primeRunSelectionOptionsCache,
  readRunSelectionOptionsCache,
  resetRunSelectionOptionsCacheForTests,
} from "./runSelectionOptionsCache";

const { getRunSelectionOptionsMock } = vi.hoisted(() => ({
  getRunSelectionOptionsMock: vi.fn(),
}));

vi.mock("./runs", () => ({
  getRunSelectionOptions: getRunSelectionOptionsMock,
}));

describe("runSelectionOptionsCache", () => {
  beforeEach(() => {
    resetRunSelectionOptionsCacheForTests();
    getRunSelectionOptionsMock.mockReset();
  });

  it("loads once and serves cached values", async () => {
    getRunSelectionOptionsMock.mockResolvedValue({
      agents: [{ id: "agent-1", label: "Agent" }],
      providers: [{ id: "provider-1", label: "Provider" }],
      models: [{ id: "model-1", label: "Model", providerId: "provider-1" }],
    });

    const first = await getRunSelectionOptionsWithCache("project-1");
    const second = await getRunSelectionOptionsWithCache("project-1");

    expect(first.providers).toEqual([{ id: "provider-1", label: "Provider" }]);
    expect(second.providers).toEqual([{ id: "provider-1", label: "Provider" }]);
    expect(getRunSelectionOptionsMock).toHaveBeenCalledTimes(1);
    expect(getRunSelectionOptionsMock).toHaveBeenCalledWith("project-1");
  });

  it("supports startup warmup and cache read", async () => {
    getRunSelectionOptionsMock.mockResolvedValue({
      agents: [],
      providers: [{ id: "provider-1", label: "Provider" }],
      models: [],
    });

    primeRunSelectionOptionsCache("project-1");
    await Promise.resolve();
    await Promise.resolve();

    expect(readRunSelectionOptionsCache("project-1")).toEqual({
      agents: [],
      providers: [{ id: "provider-1", label: "Provider" }],
      models: [],
    });
  });
});
