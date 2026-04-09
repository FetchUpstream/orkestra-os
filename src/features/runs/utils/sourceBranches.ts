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
