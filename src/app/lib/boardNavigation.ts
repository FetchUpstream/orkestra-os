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

export const BOARD_ROUTE_PATH = "/board";
export const BOARD_SELECTED_PROJECT_STORAGE_KEY = "board.selectedProjectId";

export const getBoardProjectIdFromSearch = (search: string): string =>
  new URLSearchParams(search).get("projectId")?.trim() || "";

export const buildBoardHref = (projectId?: string | null): string => {
  const normalizedProjectId = projectId?.trim() || "";
  return normalizedProjectId
    ? `${BOARD_ROUTE_PATH}?projectId=${encodeURIComponent(normalizedProjectId)}`
    : BOARD_ROUTE_PATH;
};

export const resolveProjectBoardHref = (
  ...projectIds: Array<string | null | undefined>
): string => {
  for (const projectId of projectIds) {
    const normalizedProjectId = projectId?.trim();
    if (normalizedProjectId) return buildBoardHref(normalizedProjectId);
  }
  return buildBoardHref();
};

export const readRememberedBoardProjectId = (): string => {
  if (typeof window === "undefined") return "";
  try {
    return (
      window.localStorage.getItem(BOARD_SELECTED_PROJECT_STORAGE_KEY) ?? ""
    );
  } catch {
    return "";
  }
};
