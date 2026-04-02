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

import { listen } from "@tauri-apps/api/event";
import type { RunState } from "./runs";

export type RunStateChangedEvent = {
  runId: string;
  taskId: string;
  projectId: string;
  previousRunState?: RunState | null;
  newRunState?: RunState | null;
  transitionSource: string;
  timestamp: string;
};

type RawRunStateChangedEvent = {
  run_id?: string;
  runId?: string;
  task_id?: string;
  taskId?: string;
  project_id?: string;
  projectId?: string;
  previous_run_state?: RunState | null;
  previousRunState?: RunState | null;
  new_run_state?: RunState | null;
  newRunState?: RunState | null;
  transition_source?: string;
  transitionSource?: string;
  timestamp?: string;
};

const RUN_STATE_CHANGED_EVENT = "run-state-changed";

const normalizeRunStateChangedEvent = (
  payload: RawRunStateChangedEvent,
): RunStateChangedEvent | null => {
  const runId = payload.run_id ?? payload.runId ?? "";
  const taskId = payload.task_id ?? payload.taskId ?? "";
  const projectId = payload.project_id ?? payload.projectId ?? "";
  const transitionSource =
    payload.transition_source ?? payload.transitionSource ?? "";
  const timestamp = payload.timestamp ?? "";

  if (!runId || !taskId || !projectId || !timestamp) {
    return null;
  }

  return {
    runId,
    taskId,
    projectId,
    previousRunState:
      payload.previous_run_state ?? payload.previousRunState ?? null,
    newRunState: payload.new_run_state ?? payload.newRunState ?? null,
    transitionSource,
    timestamp,
  };
};

export const subscribeToRunStateChanged = async (
  onEvent: (event: RunStateChangedEvent) => void,
): Promise<() => void> =>
  listen<RawRunStateChangedEvent>(RUN_STATE_CHANGED_EVENT, (event) => {
    const normalized = normalizeRunStateChangedEvent(event.payload);
    if (normalized) {
      onEvent(normalized);
    }
  });
