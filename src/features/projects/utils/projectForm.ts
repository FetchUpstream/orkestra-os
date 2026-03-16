import { createMemo } from "solid-js";
import { isValidProjectKey } from "../../../app/lib/projectKey";

export type RepoInput = {
  id?: string;
  path: string;
  name: string;
};

export const emptyRepo = (): RepoInput => ({ path: "", name: "" });

export const getCreateProjectErrorMessage = (error: unknown): string | null => {
  const message =
    typeof error === "string"
      ? error
      : error &&
          typeof error === "object" &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : null;

  if (!message) return null;
  if (message.toLowerCase().includes("database error")) return null;
  return message;
};

export const createProjectKeyError = (
  key: () => string,
  touched: () => Record<string, boolean>,
) =>
  createMemo(() => {
    const value = key().trim();
    if (!touched().key && !value) return "";
    if (!value) return "Project key is required";
    if (!isValidProjectKey(value)) return "Must be 2-4 letters or numbers";
    return "";
  });
