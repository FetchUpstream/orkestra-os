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

import { compareVersions } from "compare-versions";

const LINUX_PACKAGE_PRERELEASE_PATTERN =
  /^(?<core>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))~(?<prerelease>[0-9A-Za-z.-]+)(?<build>\+[0-9A-Za-z.-]+)?$/;

const normalize = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const normalizeAppVersion = (value?: string | null) => {
  const normalized = normalize(value);
  if (!normalized) {
    return undefined;
  }

  const stripped = normalized.replace(/^v/i, "");
  const linuxPackageMatch = stripped.match(LINUX_PACKAGE_PRERELEASE_PATTERN);
  if (!linuxPackageMatch?.groups) {
    return stripped;
  }

  const { core, prerelease, build } = linuxPackageMatch.groups;
  return `${core}-${prerelease}${build ?? ""}`;
};

export const formatAppVersionForDisplay = (value?: string | null) => {
  const normalized = normalizeAppVersion(value);
  if (!normalized) {
    return "unknown";
  }

  return `v${normalized}`;
};

export const compareAppVersions = (left: string, right: string) => {
  const normalizedLeft = normalizeAppVersion(left) ?? normalize(left) ?? "";
  const normalizedRight = normalizeAppVersion(right) ?? normalize(right) ?? "";
  return compareVersions(normalizedLeft, normalizedRight);
};
