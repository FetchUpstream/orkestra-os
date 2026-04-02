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

import { getRunSelectionOptions, type RunSelectionOptions } from "./runs";

const cachedRunSelectionOptionsByProject = new Map<
  string,
  RunSelectionOptions
>();
const inflightRunSelectionOptionsByProject = new Map<
  string,
  Promise<RunSelectionOptions>
>();

const cloneSelectionOptions = (
  options: RunSelectionOptions,
): RunSelectionOptions => ({
  agents: [...options.agents],
  providers: [...options.providers],
  models: [...options.models],
});

const loadRunSelectionOptions = async (
  projectId: string,
): Promise<RunSelectionOptions> => {
  const next = await getRunSelectionOptions(projectId);
  cachedRunSelectionOptionsByProject.set(
    projectId,
    cloneSelectionOptions(next),
  );
  return cloneSelectionOptions(next);
};

export const readRunSelectionOptionsCache = (
  projectId: string,
): RunSelectionOptions | null => {
  const cached = cachedRunSelectionOptionsByProject.get(projectId);
  if (!cached) {
    return null;
  }
  return cloneSelectionOptions(cached);
};

export const getRunSelectionOptionsWithCache = async (
  projectId: string,
  options?: { refresh?: boolean },
): Promise<RunSelectionOptions> => {
  if (options?.refresh) {
    cachedRunSelectionOptionsByProject.delete(projectId);
  }

  const cached = cachedRunSelectionOptionsByProject.get(projectId);
  if (cached) {
    return cloneSelectionOptions(cached);
  }

  const inflight = inflightRunSelectionOptionsByProject.get(projectId);
  if (inflight) {
    return inflight;
  }

  const nextInflight = loadRunSelectionOptions(projectId).finally(() => {
    inflightRunSelectionOptionsByProject.delete(projectId);
  });
  inflightRunSelectionOptionsByProject.set(projectId, nextInflight);

  return nextInflight;
};

export const primeRunSelectionOptionsCache = (projectId: string): void => {
  void getRunSelectionOptionsWithCache(projectId).catch(() => {
    // Startup cache warmup failures are handled by local feature fallbacks.
  });
};

export const invalidateRunSelectionOptionsCache = (
  projectId?: string,
): void => {
  if (!projectId) {
    cachedRunSelectionOptionsByProject.clear();
    inflightRunSelectionOptionsByProject.clear();
    return;
  }

  cachedRunSelectionOptionsByProject.delete(projectId);
  inflightRunSelectionOptionsByProject.delete(projectId);
};

export const resetRunSelectionOptionsCacheForTests = (): void => {
  invalidateRunSelectionOptionsCache();
};
