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

export type WorkflowSyncStateCategory =
  | "up_to_date"
  | "rebase_required"
  | "rebase_in_progress"
  | "ready_to_merge"
  | "conflicted"
  | "merged"
  | "finalizing_merge"
  | "unknown";

export const classifyWorkflowSyncState = (
  state: string,
): WorkflowSyncStateCategory => {
  switch (state) {
    case "clean":
      return "up_to_date";
    case "needs_rebase":
    case "rebase_required":
      return "rebase_required";
    case "rebase_in_progress":
    case "rebasing":
      return "rebase_in_progress";
    case "mergeable":
    case "merge_ready":
    case "rebase_succeeded":
      return "ready_to_merge";
    case "conflicted":
    case "merge_conflict":
    case "rebase_conflict":
      return "conflicted";
    case "merged":
    case "complete":
    case "completed":
      return "merged";
    case "completing":
    case "merging":
      return "finalizing_merge";
    default:
      return "unknown";
  }
};

export const formatWorkflowSyncCategoryLabel = (
  category: WorkflowSyncStateCategory,
): string => {
  switch (category) {
    case "up_to_date":
      return "Up to Date";
    case "rebase_required":
      return "Rebase Required";
    case "rebase_in_progress":
      return "Rebase In Progress";
    case "ready_to_merge":
      return "Ready to Merge";
    case "conflicted":
      return "Conflicts Detected";
    case "merged":
      return "Merged";
    case "finalizing_merge":
      return "Finalizing Merge";
    default:
      return "Status Unknown";
  }
};

export const formatWorkflowSyncStatusLabel = (
  state: string,
  _rawState?: string,
): string => {
  return formatWorkflowSyncCategoryLabel(classifyWorkflowSyncState(state));
};

export const formatGitStateLabel = formatWorkflowSyncStatusLabel;
