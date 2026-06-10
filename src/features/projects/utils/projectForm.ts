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

const RESERVED_PROJECT_ENV_VAR_KEYS = new Set([
  "PATH",
  "SHELL",
  "HOME",
  "TERM",
  "COLORTERM",
  "LANG",
  "USER",
  "PWD",
  "OLDPWD",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
]);

export const isValidEnvVarKey = (value: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim());

export const isReservedProjectEnvVarKey = (value: string): boolean =>
  RESERVED_PROJECT_ENV_VAR_KEYS.has(value.trim().toUpperCase());

export const normalizeProjectEnvVars = (
  envVars: EnvVarInput[],
): EnvVarInput[] =>
  envVars
    .map((entry) => ({
      key: entry.key.trim(),
      value: entry.value,
    }))
    .filter((entry) => entry.key.length > 0 || entry.value.trim().length > 0);

type ProjectEnvVarValidationOptions = {
  allowedReservedEnvVars?: EnvVarInput[];
};

const legacyReservedEnvVarSignature = (entry: EnvVarInput): string =>
  JSON.stringify([entry.key.trim().toUpperCase(), entry.value]);

export const getProjectEnvVarError = (
  envVars: EnvVarInput[],
  options: ProjectEnvVarValidationOptions = {},
): string => {
  const allowedReservedEnvVars = new Set(
    normalizeProjectEnvVars(options.allowedReservedEnvVars ?? [])
      .filter((entry) => isReservedProjectEnvVarKey(entry.key))
      .map(legacyReservedEnvVarSignature),
  );

  for (const entry of normalizeProjectEnvVars(envVars)) {
    if (!entry.key) {
      return "Environment variable keys are required.";
    }
    if (!isValidEnvVarKey(entry.key)) {
      return "Environment variable keys must start with a letter or underscore and contain only letters, numbers, and underscores.";
    }
    if (
      isReservedProjectEnvVarKey(entry.key) &&
      !allowedReservedEnvVars.has(legacyReservedEnvVarSignature(entry))
    ) {
      return "PATH, SHELL, HOME, TERM, COLORTERM, LANG, USER, PWD, OLDPWD, TMPDIR, XDG_RUNTIME_DIR, XDG_CONFIG_HOME, XDG_DATA_HOME, and XDG_CACHE_HOME are managed by Orkestra and cannot be configured as project environment variables.";
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
