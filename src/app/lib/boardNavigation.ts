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
