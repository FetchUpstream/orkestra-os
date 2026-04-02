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

export const formatGitStateLabel = (
  state: string,
  rawState?: string,
): string => {
  switch (state) {
    case "clean":
      return "Clean";
    case "needs_rebase":
      return "Needs rebase";
    case "rebase_in_progress":
      return "Rebase in progress";
    case "mergeable":
      return "Mergeable";
    case "conflicted":
      return "Conflicted";
    case "ready":
      return "Ready";
    case "rebase_required":
      return "Rebase required";
    case "rebasing":
      return "Rebasing";
    case "rebase_conflict":
      return "Rebase conflict";
    case "rebase_failed":
      return "Rebase failed";
    case "rebase_succeeded":
      return "Rebase succeeded";
    case "merge_ready":
      return "Merge ready";
    case "merging":
      return "Merging";
    case "merge_conflict":
      return "Merge conflict";
    case "merge_failed":
      return "Merge failed";
    case "merged":
      return "Merged";
    case "completing":
      return "Completing run";
    case "complete":
    case "completed":
      return "Completed";
    case "unsupported":
      return "Unsupported";
    default:
      return rawState ? `Unrecognized (${rawState})` : "Unrecognized";
  }
};
