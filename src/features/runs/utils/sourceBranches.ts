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

import type { RunSourceBranchOption } from "../../../app/lib/runs";

export const getDefaultRunSourceBranch = (
  branches: RunSourceBranchOption[],
): string => {
  return (
    branches.find((branch) => branch.isCheckedOut)?.name ??
    branches[0]?.name ??
    ""
  );
};

export const isRunSourceBranchAvailable = (
  branchName: string,
  branches: RunSourceBranchOption[],
): boolean => {
  const normalizedBranchName = branchName.trim();
  if (!normalizedBranchName) {
    return false;
  }

  return branches.some((branch) => branch.name === normalizedBranchName);
};

export const validateNewRunSourceBranchName = (
  branchName: string,
  branches: RunSourceBranchOption[],
): string => {
  const normalizedBranchName = branchName.trim();
  if (!normalizedBranchName) {
    return "Enter a branch name.";
  }

  if (isRunSourceBranchAvailable(normalizedBranchName, branches)) {
    return "A local branch with this name already exists. Select it from the list instead.";
  }

  if (
    normalizedBranchName.startsWith("/") ||
    normalizedBranchName.endsWith("/") ||
    normalizedBranchName.endsWith(".") ||
    normalizedBranchName.includes("..") ||
    normalizedBranchName.includes("//") ||
    normalizedBranchName.includes("@{") ||
    /\s/.test(normalizedBranchName) ||
    ["~", "^", ":", "?", "*", "[", "]", "\\"].some((character) =>
      normalizedBranchName.includes(character),
    ) ||
    /(^|\/)\.(\.?)(\/|$)/.test(normalizedBranchName) ||
    /(^|\/)lock($|\/)/.test(normalizedBranchName)
  ) {
    return "Branch name is not valid.";
  }

  return "";
};
