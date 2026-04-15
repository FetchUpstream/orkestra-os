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

import type { AgentStatus } from "./agentTypes";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const readSessionStatusType = (value: unknown): string | null => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized || null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const type =
    (typeof value.type === "string" ? value.type.trim().toLowerCase() : "") ||
    (typeof value.status === "string" ? value.status.trim().toLowerCase() : "");

  return type || null;
};

export const normalizeAgentSessionStatus = (
  value: unknown,
): AgentStatus | null => {
  const statusType = readSessionStatusType(value);

  switch (statusType) {
    case "busy":
    case "active":
      return "active";
    case "idle":
      return "idle";
    case "connecting":
      return "connecting";
    case "error":
      return "error";
    default:
      return null;
  }
};
