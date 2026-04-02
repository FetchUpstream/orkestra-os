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

import { createSignal } from "solid-js";

const [pendingCommitRunIds, setPendingCommitRunIds] = createSignal<
  Record<string, boolean>
>({});

export const isRunCommitPending = (runId: string): boolean => {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId) return false;
  return pendingCommitRunIds()[normalizedRunId] === true;
};

export const setRunCommitPending = (
  runId: string,
  isPending: boolean,
): void => {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId) return;

  setPendingCommitRunIds((current) => {
    if (isPending) {
      if (current[normalizedRunId]) return current;
      return {
        ...current,
        [normalizedRunId]: true,
      };
    }

    if (!current[normalizedRunId]) return current;
    const next = { ...current };
    delete next[normalizedRunId];
    return next;
  });
};
