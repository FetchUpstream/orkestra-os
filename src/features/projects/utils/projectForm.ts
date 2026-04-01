import { createMemo } from "solid-js";
import { isValidProjectKey } from "../../../app/lib/projectKey";

export type RepoInput = {
  id?: string;
  path: string;
  name: string;
  setupScript: string;
  cleanupScript: string;
};

export type EnvVarInput = {
  key: string;
  value: string;
};

export const emptyRepo = (): RepoInput => ({
  path: "",
  name: "",
  setupScript: "",
  cleanupScript: "",
});

export const emptyEnvVar = (): EnvVarInput => ({
  key: "",
  value: "",
});

export const isValidEnvVarKey = (value: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim());

export const normalizeProjectEnvVars = (
  envVars: EnvVarInput[],
): EnvVarInput[] =>
  envVars
    .map((entry) => ({
      key: entry.key.trim(),
      value: entry.value,
    }))
    .filter((entry) => entry.key.length > 0 || entry.value.trim().length > 0);

export const getProjectEnvVarError = (envVars: EnvVarInput[]): string => {
  for (const entry of normalizeProjectEnvVars(envVars)) {
    if (!entry.key) {
      return "Environment variable keys are required.";
    }
    if (!isValidEnvVarKey(entry.key)) {
      return "Environment variable keys must start with a letter or underscore and contain only letters, numbers, and underscores.";
    }
  }

  return "";
};

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
