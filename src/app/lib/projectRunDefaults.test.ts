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
import { resolveProjectRunDefaults } from "./projectRunDefaults";

const providers = [
  { id: "provider-1", label: "Provider 1" },
  { id: "provider-2", label: "Provider 2" },
];

const models = [
  { id: "model-1", label: "Model 1", providerId: "provider-1" },
  { id: "model-2", label: "Model 2", providerId: "provider-2" },
];

describe("resolveProjectRunDefaults", () => {
  it("returns valid values unchanged when provider and model match", () => {
    const resolved = resolveProjectRunDefaults({
      persisted: { providerId: "provider-1", modelId: "model-1" },
      providers,
      models,
    });

    expect(resolved).toMatchObject({
      providerId: "provider-1",
      modelId: "model-1",
      validAsIs: true,
      repaired: false,
      requiresUserAction: false,
      reason: "valid",
    });
  });

  it("falls back to first provider/model when persisted values are missing", () => {
    const resolved = resolveProjectRunDefaults({
      persisted: { providerId: "", modelId: "" },
      providers,
      models,
    });

    expect(resolved.providerId).toBe("provider-1");
    expect(resolved.modelId).toBe("model-1");
    expect(resolved.validAsIs).toBe(false);
    expect(resolved.repaired).toBe(true);
    expect(resolved.requiresUserAction).toBe(false);
  });

  it("repairs stale provider and model to safe available defaults", () => {
    const resolved = resolveProjectRunDefaults({
      persisted: { providerId: "provider-stale", modelId: "model-stale" },
      providers,
      models,
    });

    expect(resolved).toMatchObject({
      providerId: "provider-1",
      modelId: "model-1",
      validAsIs: false,
      repaired: true,
      requiresUserAction: false,
    });
    expect(["provider_invalid", "model_invalid"]).toContain(resolved.reason);
  });

  it("infers provider from model when provider is missing", () => {
    const resolved = resolveProjectRunDefaults({
      persisted: { providerId: "", modelId: "model-2" },
      providers,
      models,
    });

    expect(resolved.providerId).toBe("provider-2");
    expect(resolved.modelId).toBe("model-2");
    expect(resolved.requiresUserAction).toBe(false);
  });

  it("requires user action when no providers are available", () => {
    const resolved = resolveProjectRunDefaults({
      persisted: { providerId: "provider-1", modelId: "model-1" },
      providers: [],
      models,
    });

    expect(resolved).toMatchObject({
      providerId: "",
      modelId: "",
      requiresUserAction: true,
      reason: "no_providers",
    });
  });

  it("requires user action when selected provider has no models", () => {
    const resolved = resolveProjectRunDefaults({
      persisted: { providerId: "provider-2", modelId: "" },
      providers,
      models: [{ id: "model-1", label: "Model 1", providerId: "provider-1" }],
    });

    expect(resolved.providerId).toBe("provider-2");
    expect(resolved.modelId).toBe("");
    expect(resolved.requiresUserAction).toBe(true);
    expect(resolved.reason).toBe("no_models_for_provider");
  });
});
