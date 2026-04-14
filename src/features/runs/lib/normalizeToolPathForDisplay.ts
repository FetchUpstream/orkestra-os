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

export type ToolPathDisplayContext = {
  worktreeId?: string | null;
  targetRepositoryPath?: string | null;
};

const normalizeSlashes = (value: string): string => value.replace(/\\+/g, "/");
const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FILESYSTEM_PATH_PREFIX = String.raw`(?:[A-Za-z]:[\\/]|/(?!/)|\\\\)`;

const trimTrailingSlashes = (value: string): string =>
  value.replace(/\/+$/, "") || "/";

const toDisplayRelativePath = (value: string): string => {
  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue === ".") {
    return "./";
  }

  return trimmedValue.startsWith("./") ? trimmedValue : `./${trimmedValue}`;
};

const isAbsolutePath = (value: string): boolean => {
  return (
    value.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
};

const toRepoRelativePath = (
  pathValue: string,
  targetRepositoryPath?: string | null,
): string | null => {
  const normalizedRepoRoot = targetRepositoryPath?.trim();
  if (!normalizedRepoRoot) {
    return null;
  }

  const absolutePath = trimTrailingSlashes(normalizeSlashes(pathValue));
  const repoRoot = trimTrailingSlashes(normalizeSlashes(normalizedRepoRoot));
  if (absolutePath === repoRoot) {
    return ".";
  }

  const prefix = `${repoRoot}/`;
  if (!absolutePath.startsWith(prefix)) {
    return null;
  }

  return absolutePath.slice(prefix.length);
};

const toWorktreeRelativePath = (
  pathValue: string,
  worktreeId?: string | null,
): string | null => {
  const normalizedWorktreeId = worktreeId?.trim();
  if (!normalizedWorktreeId) {
    return null;
  }

  const worktreeIdSegments = normalizeSlashes(normalizedWorktreeId)
    .split("/")
    .filter(Boolean);
  if (worktreeIdSegments.length === 0) {
    return null;
  }

  const segments = normalizeSlashes(pathValue).split("/").filter(Boolean);
  const matchingIndexes: number[] = [];
  for (
    let index = 0;
    index <= segments.length - worktreeIdSegments.length;
    index += 1
  ) {
    const matches = worktreeIdSegments.every(
      (segment, offset) => segments[index + offset] === segment,
    );
    if (matches) {
      matchingIndexes.push(index);
    }
  }

  if (matchingIndexes.length !== 1) {
    return null;
  }

  const segmentIndex = matchingIndexes[0];
  if (segmentIndex <= 0 || segments[segmentIndex - 1] !== "worktrees") {
    return null;
  }

  const trailingIndex = segmentIndex + worktreeIdSegments.length;
  if (trailingIndex >= segments.length) {
    return ".";
  }

  return segments.slice(trailingIndex).join("/");
};

const replaceWorktreeAbsolutePathsInText = (
  rawText: string,
  worktreeId?: string | null,
): string => {
  const normalizedWorktreeId = worktreeId?.trim();
  if (!normalizedWorktreeId) {
    return rawText;
  }

  const normalizedWorktreePath = normalizeSlashes(normalizedWorktreeId)
    .split("/")
    .filter(Boolean)
    .join("/");
  if (!normalizedWorktreePath) {
    return rawText;
  }

  const markerRegex =
    escapeRegExp(`/worktrees/${normalizedWorktreePath}`).replace(
      /\//g,
      String.raw`[\\/]`,
    ) + String.raw`(?=$|[\\/])`;
  const pattern = new RegExp(
    String.raw`(^|[\s([{"'])(${FILESYSTEM_PATH_PREFIX}[^\s<>"')]*${markerRegex}(?:[\\/]([^\s<>"')]*))?)`,
    "g",
  );

  return rawText.replace(
    pattern,
    (_match, leadingBoundary: string, _fullPath: string, relativePath = "") => {
      return `${leadingBoundary}${toDisplayRelativePath(normalizeSlashes(relativePath))}`;
    },
  );
};

export const normalizeToolPathForDisplay = (
  rawPath: string,
  context: ToolPathDisplayContext,
): string => {
  const trimmedPath = rawPath.trim();
  if (!trimmedPath || !isAbsolutePath(trimmedPath)) {
    return trimmedPath;
  }

  const repoRelativePath = toRepoRelativePath(
    trimmedPath,
    context.targetRepositoryPath,
  );
  if (repoRelativePath) {
    return toDisplayRelativePath(repoRelativePath);
  }

  const worktreeRelativePath = toWorktreeRelativePath(
    trimmedPath,
    context.worktreeId,
  );
  if (worktreeRelativePath) {
    return toDisplayRelativePath(worktreeRelativePath);
  }

  return trimmedPath;
};

export const normalizeToolOutputTextForDisplay = (
  rawText: string,
  context: ToolPathDisplayContext,
): string => {
  if (!rawText.trim()) {
    return rawText;
  }

  const withNormalizedPathTags = rawText.replace(
    /<path>([^<]+)<\/path>/g,
    (_match, rawPath: string) => {
      const displayPath = normalizeToolPathForDisplay(rawPath, context);
      return `<path>${displayPath}</path>`;
    },
  );

  return replaceWorktreeAbsolutePathsInText(
    withNormalizedPathTags,
    context.worktreeId,
  );
};
