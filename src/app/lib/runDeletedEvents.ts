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

export type RunDeletedEvent = {
  runId: string;
  timestamp: string;
};

type RunDeletedListener = (event: RunDeletedEvent) => void;

const runDeletedListeners = new Set<RunDeletedListener>();

export const emitRunDeleted = (event: RunDeletedEvent): void => {
  for (const listener of runDeletedListeners) {
    try {
      listener(event);
    } catch (error) {
      console.error("Failed to notify run deletion listener.", error);
    }
  }
};

export const subscribeToRunDeleted = (
  listener: RunDeletedListener,
): (() => void) => {
  runDeletedListeners.add(listener);
  return () => {
    runDeletedListeners.delete(listener);
  };
};
