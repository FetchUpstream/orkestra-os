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

import type { OpenCodeBusEvent, UiPart } from "../model/agentTypes";

type RootMessagesById = Record<
  string,
  { partOrder: string[]; partsById: Record<string, UiPart> }
>;

type TaskPartRoutingContext = {
  allTaskPartIds: string[];
  rootMessageIds: Set<string>;
  taskPartIdsByMessageId: Record<string, string[]>;
  explicitTaskPartIdsBySessionId: Record<string, string[]>;
};

type AssignmentCandidate = {
  taskPartId: string;
  source: SubagentTaskAssignmentSource;
  confidence: number;
  provisional: boolean;
};

export type SubagentTaskAssignmentSource =
  | "explicit-task-tool-session"
  | "parent-message"
  | "parent-session"
  | "single-task-fallback"
  | "active-task-fallback";

export type SubagentSessionAssignmentSnapshot = {
  sessionId: string;
  parentSessionId: string | null;
  parentMessageId: string | null;
  assignedTaskPartId: string | null;
  assignmentSource: SubagentTaskAssignmentSource | null;
  assignmentConfidence: number;
  assignmentProvisional: boolean;
};

export const SUBAGENT_TASK_ASSIGNMENT_CONFIDENCE = {
  explicitTaskToolSession: 400,
  parentMessage: 300,
  parentSession: 200,
  singleTaskFallback: 100,
  activeTaskFallback: 50,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const getEventRecord = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? value : {};
};

const getNestedRecord = (
  value: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> | null => {
  for (const key of keys) {
    const candidate = value[key];
    if (isRecord(candidate)) {
      return candidate;
    }
  }
  return null;
};

const getSessionIdentifier = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  const nested = getNestedRecord(value, "part", "info", "properties");
  const sessionId =
    (typeof value.sessionID === "string" ? value.sessionID : null) ||
    (typeof value.sessionId === "string" ? value.sessionId : null) ||
    (nested && typeof nested.sessionID === "string"
      ? nested.sessionID
      : null) ||
    (nested && typeof nested.sessionId === "string" ? nested.sessionId : null);

  return sessionId?.trim() || null;
};

const getParentIdentifier = (value: Record<string, unknown>): string | null => {
  const nested = getNestedRecord(value, "info", "part", "properties");
  const parentId =
    (typeof value.parentID === "string" ? value.parentID : null) ||
    (typeof value.parentId === "string" ? value.parentId : null) ||
    (nested && typeof nested.parentID === "string" ? nested.parentID : null) ||
    (nested && typeof nested.parentId === "string" ? nested.parentId : null);

  return parentId?.trim() || null;
};

const getExplicitParentSessionIdentifier = (
  value: Record<string, unknown>,
): string | null => {
  const nested = getNestedRecord(value, "info", "properties");
  const parentId =
    (typeof value.parentSessionID === "string"
      ? value.parentSessionID
      : null) ||
    (typeof value.parentSessionId === "string"
      ? value.parentSessionId
      : null) ||
    (nested && typeof nested.parentSessionID === "string"
      ? nested.parentSessionID
      : null) ||
    (nested && typeof nested.parentSessionId === "string"
      ? nested.parentSessionId
      : null);

  return parentId?.trim() || null;
};

const getPartIdentifier = (value: Record<string, unknown>): string | null => {
  return (
    (typeof value.id === "string" ? value.id.trim() : "") ||
    (typeof value.partID === "string" ? value.partID.trim() : "") ||
    (typeof value.partId === "string" ? value.partId.trim() : "") ||
    null
  );
};

const mergeSessionIds = (
  mapping: Record<string, string[]>,
  partId: string,
  sessionIds: readonly string[],
): void => {
  if (sessionIds.length === 0) {
    return;
  }

  const existing = new Set(mapping[partId] ?? []);
  for (const sessionId of sessionIds) {
    existing.add(sessionId);
  }
  mapping[partId] = Array.from(existing);
};

const collectSessionIdsFromValue = (
  value: unknown,
  sessionIds: Set<string>,
  seen: Set<unknown>,
): void => {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSessionIdsFromValue(item, sessionIds, seen);
    }
    return;
  }

  for (const [key, nestedValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (
      (key === "sessionID" || key === "sessionId") &&
      typeof nestedValue === "string"
    ) {
      const normalized = nestedValue.trim();
      if (normalized.length > 0) {
        sessionIds.add(normalized);
      }
      continue;
    }

    collectSessionIdsFromValue(nestedValue, sessionIds, seen);
  }
};

const extractSessionIdsFromValue = (
  value: unknown,
  rootSessionId: string | null,
): string[] => {
  const sessionIds = new Set<string>();
  collectSessionIdsFromValue(value, sessionIds, new Set<unknown>());

  return Array.from(sessionIds).filter(
    (sessionId) => sessionId !== rootSessionId,
  );
};

const buildTaskPartRoutingContext = (
  rootMessagesById: RootMessagesById,
  taskPartSessionIdsByPartId: Record<string, string[]>,
): TaskPartRoutingContext => {
  const allTaskPartIds: string[] = [];
  const taskPartIdsByMessageId: Record<string, string[]> = {};
  const explicitTaskPartIdsBySessionId: Record<string, string[]> = {};

  for (const [messageId, message] of Object.entries(rootMessagesById)) {
    for (const partId of message.partOrder) {
      const part = message.partsById[partId];
      if (part?.kind !== "tool" || !isTaskToolName(part.toolName)) {
        continue;
      }

      allTaskPartIds.push(partId);
      taskPartIdsByMessageId[messageId] = [
        ...(taskPartIdsByMessageId[messageId] ?? []),
        partId,
      ];
    }
  }

  for (const [taskPartId, sessionIds] of Object.entries(
    taskPartSessionIdsByPartId,
  )) {
    for (const sessionId of sessionIds) {
      const existing = explicitTaskPartIdsBySessionId[sessionId] ?? [];
      if (!existing.includes(taskPartId)) {
        explicitTaskPartIdsBySessionId[sessionId] = [...existing, taskPartId];
      }
    }
  }

  return {
    allTaskPartIds,
    rootMessageIds: new Set(Object.keys(rootMessagesById)),
    taskPartIdsByMessageId,
    explicitTaskPartIdsBySessionId,
  };
};

const getUniqueTaskPartId = (
  taskPartIds: readonly string[] | undefined,
): string | null => {
  if (!taskPartIds || taskPartIds.length !== 1) {
    return null;
  }
  return taskPartIds[0] ?? null;
};

const buildExplicitAssignmentCandidate = (
  sessionId: string,
  context: TaskPartRoutingContext,
): AssignmentCandidate | null => {
  const taskPartId = getUniqueTaskPartId(
    context.explicitTaskPartIdsBySessionId[sessionId],
  );
  if (!taskPartId) {
    return null;
  }

  return {
    taskPartId,
    source: "explicit-task-tool-session",
    confidence: SUBAGENT_TASK_ASSIGNMENT_CONFIDENCE.explicitTaskToolSession,
    provisional: false,
  };
};

const buildParentMessageAssignmentCandidate = (
  parentMessageId: string | null,
  context: TaskPartRoutingContext,
): AssignmentCandidate | null => {
  if (!parentMessageId) {
    return null;
  }

  const taskPartId = getUniqueTaskPartId(
    context.taskPartIdsByMessageId[parentMessageId],
  );
  if (!taskPartId) {
    return null;
  }

  return {
    taskPartId,
    source: "parent-message",
    confidence: SUBAGENT_TASK_ASSIGNMENT_CONFIDENCE.parentMessage,
    provisional: false,
  };
};

const hasAmbiguousParentMessage = (
  parentMessageId: string | null,
  context: TaskPartRoutingContext,
): boolean => {
  if (!parentMessageId) {
    return false;
  }

  return (context.taskPartIdsByMessageId[parentMessageId]?.length ?? 0) > 1;
};

const buildParentSessionAssignmentCandidate = (
  parentSessionId: string | null,
  sessions: Map<string, SubagentSessionAssignmentSnapshot>,
): AssignmentCandidate | null => {
  if (!parentSessionId) {
    return null;
  }

  const parent = sessions.get(parentSessionId);
  if (!parent?.assignedTaskPartId) {
    return null;
  }

  return {
    taskPartId: parent.assignedTaskPartId,
    source: "parent-session",
    confidence: Math.min(
      parent.assignmentConfidence,
      SUBAGENT_TASK_ASSIGNMENT_CONFIDENCE.parentSession,
    ),
    provisional: parent.assignmentProvisional,
  };
};

const buildSingleTaskFallbackCandidate = (
  context: TaskPartRoutingContext,
): AssignmentCandidate | null => {
  const taskPartId = getUniqueTaskPartId(context.allTaskPartIds);
  if (!taskPartId) {
    return null;
  }

  return {
    taskPartId,
    source: "single-task-fallback",
    confidence: SUBAGENT_TASK_ASSIGNMENT_CONFIDENCE.singleTaskFallback,
    provisional: true,
  };
};

const buildActiveTaskFallbackCandidate = (
  activeTaskPartId: string | null,
): AssignmentCandidate | null => {
  if (!activeTaskPartId) {
    return null;
  }

  return {
    taskPartId: activeTaskPartId,
    source: "active-task-fallback",
    confidence: SUBAGENT_TASK_ASSIGNMENT_CONFIDENCE.activeTaskFallback,
    provisional: true,
  };
};

const applyAssignmentCandidate = (
  session: SubagentSessionAssignmentSnapshot,
  candidate: AssignmentCandidate | null,
): boolean => {
  if (!candidate) {
    return false;
  }

  if (!session.assignedTaskPartId) {
    session.assignedTaskPartId = candidate.taskPartId;
    session.assignmentSource = candidate.source;
    session.assignmentConfidence = candidate.confidence;
    session.assignmentProvisional = candidate.provisional;
    return true;
  }

  if (candidate.confidence > session.assignmentConfidence) {
    session.assignedTaskPartId = candidate.taskPartId;
    session.assignmentSource = candidate.source;
    session.assignmentConfidence = candidate.confidence;
    session.assignmentProvisional = candidate.provisional;
    return true;
  }

  if (candidate.confidence < session.assignmentConfidence) {
    return false;
  }

  if (session.assignedTaskPartId !== candidate.taskPartId) {
    return false;
  }

  if (session.assignmentProvisional && !candidate.provisional) {
    session.assignmentSource = candidate.source;
    session.assignmentProvisional = false;
    return true;
  }

  return false;
};

const clearUnsafeFallbackAssignment = (
  session: SubagentSessionAssignmentSnapshot,
  context: TaskPartRoutingContext,
): boolean => {
  if (
    session.assignmentSource !== "active-task-fallback" ||
    !hasAmbiguousParentMessage(session.parentMessageId, context)
  ) {
    return false;
  }

  session.assignedTaskPartId = null;
  session.assignmentSource = null;
  session.assignmentConfidence = 0;
  session.assignmentProvisional = true;
  return true;
};

const getRootTaskPartIdFromEvent = (
  event: OpenCodeBusEvent,
  rootSessionId: string | null,
): string | null => {
  const properties = getEventRecord(event.properties);
  const sessionId = getSessionIdentifier(properties);
  if (!sessionId || !rootSessionId || sessionId !== rootSessionId) {
    return null;
  }

  const part = getNestedRecord(properties, "part");
  if (
    !part ||
    typeof part.type !== "string" ||
    part.type !== "tool" ||
    !isTaskToolName(part.tool)
  ) {
    return null;
  }

  return getPartIdentifier(part);
};

const readParentLinks = (
  eventType: string,
  properties: Record<string, unknown>,
  context: TaskPartRoutingContext,
): { parentMessageId: string | null; parentSessionId: string | null } => {
  const genericParentId = getParentIdentifier(properties);
  let parentMessageId: string | null = null;
  let parentSessionId = getExplicitParentSessionIdentifier(properties);

  if (genericParentId) {
    if (eventType === "message.updated") {
      parentMessageId = genericParentId;
    } else if (eventType === "session.updated") {
      if (context.rootMessageIds.has(genericParentId)) {
        parentMessageId = genericParentId;
      } else if (!parentSessionId) {
        parentSessionId = genericParentId;
      }
    }
  }

  return { parentMessageId, parentSessionId };
};

export const isTaskToolName = (value: unknown): boolean => {
  return typeof value === "string" && value.trim().toLowerCase() === "task";
};

export const extractTaskSubagentSessionIds = (
  part: UiPart,
  rootSessionId: string | null,
): string[] => {
  if (part.kind !== "tool" || !isTaskToolName(part.toolName)) {
    return [];
  }

  return extractSessionIdsFromValue(part.raw, rootSessionId);
};

export const buildTaskPartSessionIdsByPartId = (
  rootMessagesById: RootMessagesById,
  rawEvents: readonly OpenCodeBusEvent[],
  rootSessionId: string | null,
): Record<string, string[]> => {
  const mapping: Record<string, string[]> = {};

  for (const message of Object.values(rootMessagesById)) {
    for (const partId of message.partOrder) {
      const part = message.partsById[partId];
      if (!part) {
        continue;
      }

      mergeSessionIds(
        mapping,
        part.id,
        extractTaskSubagentSessionIds(part, rootSessionId),
      );
    }
  }

  for (const event of rawEvents) {
    const properties = getEventRecord(event.properties);
    const taskPartId = getRootTaskPartIdFromEvent(event, rootSessionId);
    if (!taskPartId) {
      continue;
    }

    const rawPart = getNestedRecord(properties, "part");
    mergeSessionIds(
      mapping,
      taskPartId,
      extractSessionIdsFromValue(rawPart, rootSessionId),
    );
  }

  return mapping;
};

export const buildSubagentSessionAssignments = (
  rawEvents: readonly OpenCodeBusEvent[],
  rootSessionId: string | null,
  rootMessagesById: RootMessagesById,
  taskPartSessionIdsByPartId: Record<string, string[]>,
): Record<string, SubagentSessionAssignmentSnapshot> => {
  const context = buildTaskPartRoutingContext(
    rootMessagesById,
    taskPartSessionIdsByPartId,
  );
  const sessions = new Map<string, SubagentSessionAssignmentSnapshot>();
  let activeTaskPartId: string | null = null;

  const ensureSession = (
    sessionId: string,
  ): SubagentSessionAssignmentSnapshot => {
    const existing = sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: SubagentSessionAssignmentSnapshot = {
      sessionId,
      parentSessionId: null,
      parentMessageId: null,
      assignedTaskPartId: null,
      assignmentSource: null,
      assignmentConfidence: 0,
      assignmentProvisional: true,
    };

    applyAssignmentCandidate(
      created,
      buildExplicitAssignmentCandidate(sessionId, context),
    );
    sessions.set(sessionId, created);
    return created;
  };

  for (const event of rawEvents) {
    const nextActiveTaskPartId = getRootTaskPartIdFromEvent(
      event,
      rootSessionId,
    );
    if (nextActiveTaskPartId) {
      activeTaskPartId = nextActiveTaskPartId;
    }

    const properties = getEventRecord(event.properties);
    const sessionId = getSessionIdentifier(properties);
    if (!sessionId) {
      continue;
    }

    if (rootSessionId && sessionId === rootSessionId) {
      continue;
    }

    const session = ensureSession(sessionId);
    const { parentMessageId, parentSessionId } = readParentLinks(
      event.type,
      properties,
      context,
    );

    if (parentMessageId && !session.parentMessageId) {
      session.parentMessageId = parentMessageId;
    }
    if (
      parentSessionId &&
      parentSessionId !== session.sessionId &&
      !session.parentSessionId
    ) {
      session.parentSessionId = parentSessionId;
    }

    applyAssignmentCandidate(
      session,
      buildParentMessageAssignmentCandidate(session.parentMessageId, context),
    );
    clearUnsafeFallbackAssignment(session, context);
    applyAssignmentCandidate(
      session,
      buildParentSessionAssignmentCandidate(session.parentSessionId, sessions),
    );
    if (!hasAmbiguousParentMessage(session.parentMessageId, context)) {
      applyAssignmentCandidate(
        session,
        buildActiveTaskFallbackCandidate(activeTaskPartId),
      );
    }
  }

  for (const sessionIds of Object.values(taskPartSessionIdsByPartId)) {
    for (const sessionId of sessionIds) {
      ensureSession(sessionId);
    }
  }

  for (const session of sessions.values()) {
    applyAssignmentCandidate(
      session,
      buildExplicitAssignmentCandidate(session.sessionId, context),
    );
    applyAssignmentCandidate(
      session,
      buildParentMessageAssignmentCandidate(session.parentMessageId, context),
    );
    clearUnsafeFallbackAssignment(session, context);
  }

  for (let index = 0; index < sessions.size; index += 1) {
    let changed = false;

    for (const session of sessions.values()) {
      changed =
        applyAssignmentCandidate(
          session,
          buildParentSessionAssignmentCandidate(
            session.parentSessionId,
            sessions,
          ),
        ) || changed;
    }

    if (!changed) {
      break;
    }
  }

  const singleTaskFallback = buildSingleTaskFallbackCandidate(context);
  for (const session of sessions.values()) {
    applyAssignmentCandidate(session, singleTaskFallback);
  }

  return Object.fromEntries(
    Array.from(sessions.values()).map((session) => [
      session.sessionId,
      session,
    ]),
  );
};
