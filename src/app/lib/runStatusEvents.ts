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
import type { RunStatus } from "./runs";

export type RunStatusChangedEvent = {
  runId: string;
  taskId: string;
  projectId: string;
  previousStatus: RunStatus;
  newStatus: RunStatus;
  transitionSource: string;
  timestamp: string;
};

type RawRunStatusChangedEvent = {
  run_id?: string;
  runId?: string;
  task_id?: string;
  taskId?: string;
  project_id?: string;
  projectId?: string;
  previous_status?: RunStatus;
  previousStatus?: RunStatus;
  new_status?: RunStatus;
  newStatus?: RunStatus;
  transition_source?: string;
  transitionSource?: string;
  timestamp?: string;
};

const RUN_STATUS_CHANGED_EVENT = "run-status-changed";

const normalizeRunStatusChangedEvent = (
  payload: RawRunStatusChangedEvent,
): RunStatusChangedEvent | null => {
  const runId = payload.run_id ?? payload.runId ?? "";
  const taskId = payload.task_id ?? payload.taskId ?? "";
  const projectId = payload.project_id ?? payload.projectId ?? "";
  const previousStatus = payload.previous_status ?? payload.previousStatus;
  const newStatus = payload.new_status ?? payload.newStatus;
  const transitionSource =
    payload.transition_source ?? payload.transitionSource ?? "";
  const timestamp = payload.timestamp ?? "";

  if (
    !runId ||
    !taskId ||
    !projectId ||
    !previousStatus ||
    !newStatus ||
    !timestamp
  ) {
    return null;
  }

  return {
    runId,
    taskId,
    projectId,
    previousStatus,
    newStatus,
    transitionSource,
    timestamp,
  };
};

export const subscribeToRunStatusChanged = async (
  onEvent: (event: RunStatusChangedEvent) => void,
): Promise<() => void> =>
  listen<RawRunStatusChangedEvent>(RUN_STATUS_CHANGED_EVENT, (event) => {
    const normalized = normalizeRunStatusChangedEvent(event.payload);
    if (normalized) {
      onEvent(normalized);
    }
  });
