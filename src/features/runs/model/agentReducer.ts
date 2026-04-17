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

import {
  type AgentRole,
  type AgentStore,
  type OpenCodeBusEvent,
  type UiDiffSummary,
  type UiMessage,
  type UiPart,
  type UiPermissionRequest,
  type UiQuestionRequest,
  type UiStreamChunkNode,
  type UiTodo,
} from "./agentTypes";
import { normalizeAgentSessionStatus } from "./agentSessionStatus";
import { appendCappedHistory } from "../../../app/lib/runs";

type HydrateInput = {
  sessionId: string | null;
  messages: unknown;
  questions?: unknown;
  todos: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const asString = (value: unknown): string | undefined => {
  return typeof value === "string" ? value : undefined;
};

const asArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
};

const pickRecordValue = (
  record: Record<string, unknown>,
  ...keys: string[]
): unknown => {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
};

const parseTimestamp = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const normalizeRole = (value: unknown): AgentRole => {
  if (value === "user" || value === "assistant" || value === "system") {
    return value;
  }
  return "unknown";
};

const UUID_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_INTERNAL_ID_PATTERN = /^[0-9a-f]{24,}$/i;

const isLikelyInternalIdentifier = (value: string): boolean => {
  return UUID_LIKE_PATTERN.test(value) || HEX_INTERNAL_ID_PATTERN.test(value);
};

const sanitizeAttributionLabel = (value: unknown): string | undefined => {
  const normalized = asString(value)?.trim();
  if (!normalized) {
    return undefined;
  }
  if (isLikelyInternalIdentifier(normalized)) {
    return undefined;
  }
  return normalized;
};

const sanitizeModelAttributionLabel = (value: unknown): string | undefined => {
  const normalized = sanitizeAttributionLabel(value);
  if (!normalized) {
    return undefined;
  }

  const slashParts = normalized.split("/").map((segment) => segment.trim());
  const slashTail = slashParts[slashParts.length - 1];
  if (slashParts.length > 1 && slashTail) {
    return isLikelyInternalIdentifier(slashTail) ? undefined : slashTail;
  }

  const colonParts = normalized.split(":").map((segment) => segment.trim());
  const colonTail = colonParts[colonParts.length - 1];
  if (colonParts.length > 1 && colonTail) {
    return isLikelyInternalIdentifier(colonTail) ? undefined : colonTail;
  }

  return normalized;
};

const extractAttributionFromSource = (
  source: unknown,
): { agent?: string; model?: string } => {
  if (!isRecord(source)) {
    return {};
  }

  const queue: Array<{ value: Record<string, unknown>; depth: number }> = [
    { value: source, depth: 0 },
  ];
  const seen = new Set<Record<string, unknown>>();
  const candidates: Record<string, unknown>[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (seen.has(current.value)) {
      continue;
    }
    seen.add(current.value);
    candidates.push(current.value);

    if (current.depth >= 3) {
      continue;
    }

    const nestedRecords = [
      pickRecordValue(current.value, "properties"),
      pickRecordValue(current.value, "info"),
      pickRecordValue(current.value, "part"),
      pickRecordValue(current.value, "metadata", "meta"),
    ].filter((item): item is Record<string, unknown> => isRecord(item));

    for (const nested of nestedRecords) {
      queue.push({ value: nested, depth: current.depth + 1 });
    }
  }

  let agent: string | undefined;
  let model: string | undefined;

  for (const candidate of candidates) {
    const nextAgent = sanitizeAttributionLabel(
      pickRecordValue(candidate, "agent", "agentID", "agentId", "agent_id"),
    );
    if (nextAgent) {
      agent = nextAgent;
    }

    const nextModel = sanitizeModelAttributionLabel(
      pickRecordValue(
        candidate,
        "model",
        "modelID",
        "modelId",
        "model_id",
        "modelName",
        "model_name",
      ),
    );
    if (nextModel) {
      model = nextModel;
    }
  }

  return {
    agent,
    model,
  };
};

const extractMessageAttribution = (
  ...sources: unknown[]
): { agent?: string; model?: string } => {
  let agent: string | undefined;
  let model: string | undefined;

  for (const source of sources) {
    const next = extractAttributionFromSource(source);
    if (next.agent) {
      agent = next.agent;
    }
    if (next.model) {
      model = next.model;
    }
  }

  return {
    agent,
    model,
  };
};

const mergeMessageAttribution = (
  message: UiMessage,
  attribution: { agent?: string; model?: string },
): UiMessage => {
  const nextAgent = attribution.agent?.trim();
  const nextModel = attribution.model?.trim();
  const hasIncomingAgent =
    typeof nextAgent === "string" && nextAgent.length > 0;
  const hasIncomingModel =
    typeof nextModel === "string" && nextModel.length > 0;

  if (!hasIncomingAgent && !hasIncomingModel) {
    return message;
  }

  const existingAttribution = message.attribution;
  const mergedAgent = hasIncomingAgent ? nextAgent : existingAttribution?.agent;
  const mergedModel = hasIncomingModel ? nextModel : existingAttribution?.model;

  if (!mergedAgent && !mergedModel) {
    return { ...message, attribution: undefined };
  }

  return {
    ...message,
    attribution: {
      ...(mergedAgent ? { agent: mergedAgent } : {}),
      ...(mergedModel ? { model: mergedModel } : {}),
    },
  };
};

const normalizeMessageInfo = (
  value: unknown,
  fallbackSessionId: string,
): UiMessage | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = asString(value.id ?? value.messageID ?? value.messageId);
  if (!id) {
    return null;
  }

  const sessionId =
    asString(value.sessionID ?? value.sessionId) ?? fallbackSessionId;
  if (!sessionId) {
    return null;
  }

  return {
    id,
    sessionId,
    role: normalizeRole(value.role),
    createdAt: parseTimestamp(value.createdAt ?? value.created_at),
    updatedAt: parseTimestamp(value.updatedAt ?? value.updated_at),
    rawInfo: value,
    partsById: {},
    partOrder: [],
  };
};

const normalizePart = (value: unknown): UiPart | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = asString(value.id ?? value.partID ?? value.partId);
  if (!id) {
    return null;
  }

  const type = asString(value.type) ?? "unknown";
  const explicitStreamingValue = pickRecordValue(
    value,
    "streaming",
    "isStreaming",
    "is_streaming",
  );
  const explicitDoneValue = pickRecordValue(
    value,
    "done",
    "isDone",
    "completed",
    "isCompleted",
    "final",
    "isFinal",
  );
  const statusValue = asString(
    pickRecordValue(value, "status") ??
      (isRecord(value.state)
        ? pickRecordValue(value.state, "status")
        : undefined),
  )?.toLowerCase();
  const explicitStreaming =
    typeof explicitStreamingValue === "boolean"
      ? explicitStreamingValue
      : typeof explicitDoneValue === "boolean"
        ? !explicitDoneValue
        : statusValue === "streaming" || statusValue === "in_progress"
          ? true
          : statusValue === "complete" ||
              statusValue === "completed" ||
              statusValue === "done" ||
              statusValue === "final"
            ? false
            : undefined;

  if (type === "text") {
    return {
      kind: "text",
      id,
      type,
      text: asString(value.text) ?? "",
      streaming: explicitStreaming ?? false,
      metadata: value.metadata,
      raw: value,
    };
  }

  if (type === "reasoning") {
    return {
      kind: "reasoning",
      id,
      type,
      text: asString(value.text) ?? "",
      streaming: explicitStreaming ?? false,
      metadata: value.metadata,
      raw: value,
    };
  }

  if (type === "tool") {
    const state = isRecord(value.state) ? value.state : {};
    return {
      kind: "tool",
      id,
      type,
      toolName: asString(value.tool) ?? "tool",
      callId: asString(value.callID ?? value.callId),
      status: asString(state.status) ?? "pending",
      title: asString(state.title),
      input: state.input,
      output: state.output,
      error: state.error,
      metadata: value.metadata,
      raw: value,
    };
  }

  if (type === "file") {
    return {
      kind: "file",
      id,
      type,
      filename: asString(value.filename),
      url: asString(value.url),
      mime: asString(value.mime),
      raw: value,
    };
  }

  if (type === "patch") {
    return {
      kind: "patch",
      id,
      type,
      hash: asString(value.hash),
      files: asArray(value.files),
      raw: value,
    };
  }

  if (type === "step-start") {
    return {
      kind: "step-start",
      id,
      type,
      snapshot: value.snapshot,
      raw: value,
    };
  }

  if (type === "step-finish") {
    return {
      kind: "step-finish",
      id,
      type,
      reason: value.reason,
      tokens: value.tokens,
      cost: value.cost,
      snapshot: value.snapshot,
      raw: value,
    };
  }

  return {
    kind: "unknown",
    id,
    type,
    rawType: type,
    raw: value,
  };
};

const materializeStreamText = (
  baseText: string,
  tail?: UiStreamChunkNode,
): string => {
  if (!tail) {
    return baseText;
  }
  const deltas: string[] = [];
  let cursor: UiStreamChunkNode | undefined = tail;
  while (cursor) {
    deltas.push(cursor.delta);
    cursor = cursor.prev;
  }
  deltas.reverse();
  return `${baseText}${deltas.join("")}`;
};

const toStreamRevision = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const normalizeTodos = (value: unknown): UiTodo[] => {
  return asArray(value).map((item, index) => {
    const record = isRecord(item) ? item : {};
    const id =
      asString(record.id ?? record.todoID ?? record.todoId) ??
      `todo-${index.toString(36)}`;
    return {
      id,
      content: asString(record.content ?? record.text ?? record.title),
      status: asString(record.status),
      priority: asString(record.priority),
      raw: item,
    };
  });
};

const normalizeQuestion = (
  value: unknown,
  receivedAt?: string | number | null,
): UiQuestionRequest | null => {
  if (!isRecord(value)) {
    return null;
  }
  const requestId = asString(value.requestID ?? value.requestId ?? value.id);
  const sessionId = asString(value.sessionID ?? value.sessionId);
  if (!requestId || !sessionId) {
    return null;
  }
  return {
    requestId,
    sessionId,
    questions: asArray(value.questions),
    status: "pending",
    dedupeKey: `${sessionId}:${requestId}`,
    receivedAt:
      parseTimestamp(value.receivedAt ?? value.received_at) ??
      parseTimestamp(receivedAt) ??
      parseTimestamp(value.createdAt ?? value.created_at) ??
      null,
    raw: value,
  };
};

const extractQuestions = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [];
  }
  const maybeQuestions = pickRecordValue(value, "questions", "items", "data");
  return Array.isArray(maybeQuestions) ? maybeQuestions : [];
};

const normalizePermission = (
  value: unknown,
  fallbackSessionId?: string,
  receivedAt?: string | number | null,
): UiPermissionRequest | null => {
  if (!isRecord(value)) {
    return null;
  }
  const nestedPermission = pickRecordValue(value, "permission", "request");
  const nested = isRecord(nestedPermission) ? nestedPermission : null;
  const requestId = asString(
    pickRecordValue(
      value,
      "requestID",
      "requestId",
      "id",
      "permissionID",
      "permissionId",
    ) ??
      (nested
        ? pickRecordValue(
            nested,
            "requestID",
            "requestId",
            "id",
            "permissionID",
            "permissionId",
          )
        : undefined),
  );
  const sessionId =
    asString(
      pickRecordValue(value, "sessionID", "sessionId") ??
        (nested
          ? pickRecordValue(nested, "sessionID", "sessionId")
          : undefined),
    ) ?? fallbackSessionId;
  if (!requestId || !sessionId) {
    return null;
  }

  const kind = asString(
    pickRecordValue(value, "kind", "tool", "action") ??
      (nested
        ? pickRecordValue(nested, "kind", "permission", "tool", "action")
        : undefined),
  );
  const rawPatterns =
    pickRecordValue(
      value,
      "pathPatterns",
      "paths",
      "patterns",
      "path_pattern",
      "pathPattern",
    ) ??
    (nested
      ? pickRecordValue(
          nested,
          "pathPatterns",
          "paths",
          "patterns",
          "path_pattern",
          "pathPattern",
        )
      : undefined);
  const pathPatterns = asArray(rawPatterns)
    .map((item) => asString(item))
    .filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
  const metadataSource =
    pickRecordValue(value, "metadata", "meta") ??
    (nested ? pickRecordValue(nested, "metadata", "meta") : undefined);
  const metadata = isRecord(metadataSource)
    ? Object.entries(metadataSource).reduce<Record<string, string>>(
        (acc, [metaKey, metaValue]) => {
          const normalizedValue = asString(metaValue);
          if (normalizedValue) {
            acc[metaKey] = normalizedValue;
          }
          return acc;
        },
        {},
      )
    : undefined;

  const normalized: UiPermissionRequest = {
    requestId,
    sessionId,
    kind,
    pathPatterns,
    metadata,
    status: "pending",
    dedupeKey: `${sessionId}:${requestId}`,
    receivedAt: receivedAt ?? null,
    raw: value,
  };

  console.debug("[runs] permission payload normalized", {
    requestId: normalized.requestId,
    sessionId: normalized.sessionId,
    permissionType: normalized.kind ?? null,
    pathPatternCount: normalized.pathPatterns?.length ?? 0,
  });

  return normalized;
};

const normalizeDiff = (value: unknown): UiDiffSummary => {
  if (!isRecord(value)) {
    return { raw: value };
  }
  return {
    files: Array.isArray(value.files) ? value.files : undefined,
    raw: value,
  };
};

const appendRawEvent = (
  state: AgentStore,
  event: OpenCodeBusEvent,
): AgentStore => {
  return {
    ...state,
    lastSyncAt: Date.now(),
    rawEvents: appendCappedHistory(state.rawEvents, event),
  };
};

const normalizeEventProperties = (
  properties: unknown,
): Record<string, unknown> => {
  if (!isRecord(properties)) {
    return {};
  }
  const nestedProperties = pickRecordValue(properties, "properties");
  if (isRecord(nestedProperties)) {
    return nestedProperties;
  }
  return properties;
};

const matchOrAdoptSession = (
  state: AgentStore,
  candidateSessionId: string,
): { canApply: boolean; sessionId: string | null } => {
  if (!candidateSessionId) {
    return { canApply: false, sessionId: state.sessionId };
  }
  if (!state.sessionId) {
    return { canApply: true, sessionId: candidateSessionId };
  }
  if (state.sessionId === candidateSessionId) {
    return { canApply: true, sessionId: state.sessionId };
  }
  return { canApply: false, sessionId: state.sessionId };
};

export const createEmptyAgentStore = (sessionId: string | null): AgentStore => {
  return {
    sessionId,
    status: "connecting",
    streamConnected: false,
    lastSyncAt: null,
    messagesById: {},
    messageOrder: [],
    pendingQuestionsById: {},
    resolvedQuestionsById: {},
    failedQuestionsById: {},
    pendingPermissionsById: {},
    resolvedPermissionsById: {},
    failedPermissionsById: {},
    todos: [],
    diffSummary: null,
    rawEvents: [],
  };
};

export const upsertMessage = (
  state: AgentStore,
  info: unknown,
  attributionSource?: unknown,
): AgentStore => {
  const props = normalizeEventProperties(info);
  const messageId = asString(props.id ?? props.messageID ?? props.messageId);
  const candidateSessionId = asString(props.sessionID ?? props.sessionId);

  if (!messageId || !candidateSessionId) {
    return state;
  }

  const sessionResult = matchOrAdoptSession(state, candidateSessionId);
  if (!sessionResult.canApply) {
    return state;
  }

  const existing = state.messagesById[messageId];
  const baseMessage =
    normalizeMessageInfo(
      props,
      sessionResult.sessionId ?? candidateSessionId,
    ) ?? existing;
  if (!baseMessage) {
    return state;
  }

  const nextMessage: UiMessage = {
    ...existing,
    ...baseMessage,
    role:
      baseMessage.role === "unknown" && existing?.role
        ? existing.role
        : baseMessage.role,
    createdAt: baseMessage.createdAt ?? existing?.createdAt,
    updatedAt: baseMessage.updatedAt ?? existing?.updatedAt,
    rawInfo:
      isRecord(existing?.rawInfo) && isRecord(baseMessage.rawInfo)
        ? { ...existing.rawInfo, ...baseMessage.rawInfo }
        : (baseMessage.rawInfo ?? existing?.rawInfo),
    partsById: existing?.partsById ?? baseMessage.partsById,
    partOrder: existing?.partOrder ?? baseMessage.partOrder,
  };

  const attribution = extractMessageAttribution(attributionSource, info);
  const attributedMessage = mergeMessageAttribution(nextMessage, attribution);

  return {
    ...state,
    sessionId: sessionResult.sessionId,
    messagesById: {
      ...state.messagesById,
      [messageId]: attributedMessage,
    },
    messageOrder: state.messagesById[messageId]
      ? state.messageOrder
      : [...state.messageOrder, messageId],
  };
};

export const removeMessage = (
  state: AgentStore,
  messageId: string,
): AgentStore => {
  if (!state.messagesById[messageId]) {
    return state;
  }
  const nextMessages = { ...state.messagesById };
  delete nextMessages[messageId];

  return {
    ...state,
    messagesById: nextMessages,
    messageOrder: state.messageOrder.filter((id) => id !== messageId),
  };
};

export const upsertPart = (
  state: AgentStore,
  rawPart: unknown,
  delta?: string,
  attributionSource?: unknown,
): AgentStore => {
  if (!isRecord(rawPart)) {
    return state;
  }

  const messageId = asString(rawPart.messageID ?? rawPart.messageId);
  const sessionId = asString(rawPart.sessionID ?? rawPart.sessionId);
  const partId = asString(rawPart.id ?? rawPart.partID ?? rawPart.partId);
  if (!messageId || !sessionId || !partId) {
    return state;
  }

  const sessionResult = matchOrAdoptSession(state, sessionId);
  if (!sessionResult.canApply) {
    return state;
  }

  const normalizedPart = normalizePart(rawPart);
  if (!normalizedPart) {
    return state;
  }

  const existingMessage =
    state.messagesById[messageId] ??
    ({
      id: messageId,
      sessionId,
      role: "unknown",
      partsById: {},
      partOrder: [],
    } satisfies UiMessage);

  const existingPart = existingMessage.partsById[partId];
  let nextPart: UiPart = normalizedPart;
  const hasDelta = typeof delta === "string" && delta.length > 0;

  if (normalizedPart.kind === "text" || normalizedPart.kind === "reasoning") {
    const existingTextPart =
      existingPart && existingPart.kind === normalizedPart.kind
        ? existingPart
        : undefined;
    const incomingText = asString(rawPart.text);
    const hasIncomingTextSnapshot =
      typeof incomingText === "string" && incomingText.length > 0;
    const existingStreamBaseText =
      typeof existingTextPart?.streamBaseText === "string"
        ? existingTextPart.streamBaseText
        : (existingTextPart?.text ?? normalizedPart.text);
    const existingStreamTail = existingTextPart?.streamTail;

    if (hasIncomingTextSnapshot) {
      const shouldStream = normalizedPart.streaming;
      const previousRevision = toStreamRevision(
        existingTextPart?.streamRevision,
      );
      const previousRenderedText = materializeStreamText(
        existingStreamBaseText,
        existingStreamTail,
      );
      const targetTextChanged = incomingText !== previousRenderedText;
      const nextStreamRevision =
        previousRevision > 0
          ? previousRevision + (targetTextChanged ? 1 : 0)
          : shouldStream || incomingText.length > 0
            ? 1
            : 0;
      nextPart = {
        ...normalizedPart,
        text: incomingText,
        streaming: shouldStream,
        streamBaseText: shouldStream ? incomingText : undefined,
        streamTail: shouldStream ? undefined : undefined,
        streamText: undefined,
        streamTextLength: incomingText.length,
        streamRevision: nextStreamRevision > 0 ? nextStreamRevision : undefined,
      };
    } else if (hasDelta) {
      const nextStreamTextLength =
        typeof existingTextPart?.streamTextLength === "number"
          ? existingTextPart.streamTextLength + delta.length
          : existingStreamBaseText.length + delta.length;
      const nextStreamRevision =
        toStreamRevision(existingTextPart?.streamRevision) + 1;
      nextPart = {
        ...normalizedPart,
        text: existingStreamBaseText,
        streaming: true,
        streamBaseText: existingStreamBaseText,
        streamTail: {
          delta,
          prev: existingStreamTail,
        },
        streamText: undefined,
        streamTextLength: nextStreamTextLength,
        streamRevision: nextStreamRevision,
      };
    } else if (existingTextPart?.streamTail || existingTextPart?.streaming) {
      const nextStreaming = normalizedPart.streaming;
      const finalizedText = materializeStreamText(
        existingStreamBaseText,
        existingStreamTail,
      );
      const nextStreamRevision = toStreamRevision(
        existingTextPart?.streamRevision,
      );
      nextPart = {
        ...normalizedPart,
        text: nextStreaming ? existingStreamBaseText : finalizedText,
        streaming: nextStreaming,
        streamBaseText: nextStreaming ? existingStreamBaseText : undefined,
        streamTail: nextStreaming ? existingStreamTail : undefined,
        streamText: undefined,
        streamTextLength: nextStreaming
          ? typeof existingTextPart?.streamTextLength === "number"
            ? existingTextPart.streamTextLength
            : finalizedText.length
          : undefined,
        streamRevision:
          nextStreaming && nextStreamRevision > 0 ? nextStreamRevision : undefined,
      };
    } else {
      nextPart = {
        ...normalizedPart,
        streaming: false,
        streamBaseText: undefined,
        streamTail: undefined,
        streamText: undefined,
        streamTextLength: undefined,
        streamRevision: undefined,
      };
    }
  }

  const nextMessage: UiMessage = {
    ...existingMessage,
    partsById: {
      ...existingMessage.partsById,
      [partId]: nextPart,
    },
    partOrder: existingMessage.partsById[partId]
      ? existingMessage.partOrder
      : [...existingMessage.partOrder, partId],
  };

  const attribution = extractMessageAttribution(attributionSource, rawPart);
  const attributedMessage = mergeMessageAttribution(nextMessage, attribution);

  return {
    ...state,
    sessionId: sessionResult.sessionId,
    messagesById: {
      ...state.messagesById,
      [messageId]: attributedMessage,
    },
    messageOrder: state.messagesById[messageId]
      ? state.messageOrder
      : [...state.messageOrder, messageId],
  };
};

export const removePart = (
  state: AgentStore,
  messageId: string,
  partId: string,
): AgentStore => {
  const existingMessage = state.messagesById[messageId];
  if (!existingMessage || !existingMessage.partsById[partId]) {
    return state;
  }

  const nextPartsById = { ...existingMessage.partsById };
  delete nextPartsById[partId];

  return {
    ...state,
    messagesById: {
      ...state.messagesById,
      [messageId]: {
        ...existingMessage,
        partsById: nextPartsById,
        partOrder: existingMessage.partOrder.filter((id) => id !== partId),
      },
    },
  };
};

const extractMessageItems = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [];
  }
  const maybeMessages = pickRecordValue(value, "messages", "items", "data");
  return Array.isArray(maybeMessages) ? maybeMessages : [];
};

const extractTodos = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [];
  }
  const maybeTodos = pickRecordValue(value, "todos", "items", "data");
  return Array.isArray(maybeTodos) ? maybeTodos : [];
};

export const hydrateAgentStore = (input: HydrateInput): AgentStore => {
  const state = createEmptyAgentStore(input.sessionId);
  const nextMessageOrder: string[] = [];
  const nextMessagesById: Record<string, UiMessage> = {};

  for (const item of extractMessageItems(input.messages)) {
    if (!isRecord(item)) {
      continue;
    }

    const info = pickRecordValue(item, "info") ?? item;
    const fallbackSessionId = input.sessionId ?? "";
    const normalizedMessage = normalizeMessageInfo(info, fallbackSessionId);
    if (!normalizedMessage) {
      continue;
    }

    const hydratedAttribution = extractMessageAttribution(item, info);
    const messageWithAttribution = mergeMessageAttribution(
      normalizedMessage,
      hydratedAttribution,
    );

    if (!state.sessionId) {
      state.sessionId = normalizedMessage.sessionId;
    }
    if (state.sessionId && normalizedMessage.sessionId !== state.sessionId) {
      continue;
    }

    const parts = asArray(pickRecordValue(item, "parts"));
    for (const rawPart of parts) {
      const part = normalizePart(rawPart);
      if (!part) {
        continue;
      }
      messageWithAttribution.partsById[part.id] = part;
      if (!messageWithAttribution.partOrder.includes(part.id)) {
        messageWithAttribution.partOrder.push(part.id);
      }

      const partAttribution = extractMessageAttribution(rawPart);
      const mergedMessage = mergeMessageAttribution(
        messageWithAttribution,
        partAttribution,
      );
      if (mergedMessage !== messageWithAttribution) {
        messageWithAttribution.attribution = mergedMessage.attribution;
      }
    }

    nextMessagesById[messageWithAttribution.id] = messageWithAttribution;
    if (!nextMessageOrder.includes(messageWithAttribution.id)) {
      nextMessageOrder.push(messageWithAttribution.id);
    }
  }

  const pendingQuestionsById = extractQuestions(input.questions).reduce<
    Record<string, UiQuestionRequest>
  >((acc, item) => {
    const normalizedQuestion = normalizeQuestion(item);
    if (!normalizedQuestion) {
      return acc;
    }
    acc[normalizedQuestion.requestId] = normalizedQuestion;
    return acc;
  }, {});

  return {
    ...state,
    status: "idle",
    streamConnected: false,
    lastSyncAt: Date.now(),
    messagesById: nextMessagesById,
    messageOrder: nextMessageOrder,
    pendingQuestionsById,
    todos: normalizeTodos(extractTodos(input.todos)),
  };
};

export const reduceOpenCodeEvent = (
  state: AgentStore,
  event: OpenCodeBusEvent,
): AgentStore => {
  const nextState = appendRawEvent(state, event);
  const properties = normalizeEventProperties(event.properties);

  switch (event.type) {
    case "server.connected":
    case "stream.connected":
    case "stream.reconnected":
      return {
        ...nextState,
        streamConnected: true,
        status: nextState.status === "connecting" ? "idle" : nextState.status,
        lastSyncAt: Date.now(),
      };

    case "server.disconnected":
    case "stream.disconnected":
    case "stream.reconnecting":
    case "stream.terminated":
      return {
        ...nextState,
        streamConnected: false,
        lastSyncAt: Date.now(),
      };

    case "session.status": {
      const sessionId = asString(properties.sessionID ?? properties.sessionId);
      const status = normalizeAgentSessionStatus(properties.status);
      if (!sessionId || !status) {
        return nextState;
      }

      const sessionResult = matchOrAdoptSession(nextState, sessionId);
      if (!sessionResult.canApply) {
        return nextState;
      }

      return {
        ...nextState,
        sessionId: sessionResult.sessionId,
        status,
      };
    }

    case "message.updated":
      return upsertMessage(
        nextState,
        pickRecordValue(properties, "info") ?? properties,
        properties,
      );

    case "message.removed": {
      const sessionId = asString(properties.sessionID ?? properties.sessionId);
      const messageId = asString(properties.messageID ?? properties.messageId);
      if (!sessionId || !messageId) {
        return nextState;
      }
      if (nextState.sessionId && nextState.sessionId !== sessionId) {
        return nextState;
      }
      return removeMessage(nextState, messageId);
    }

    case "message.part.updated": {
      const rawPart = pickRecordValue(properties, "part") ?? properties;
      const delta = asString(pickRecordValue(properties, "delta"));
      return upsertPart(nextState, rawPart, delta, properties);
    }

    case "message.part.delta": {
      const sessionId = asString(properties.sessionID ?? properties.sessionId);
      const messageId = asString(properties.messageID ?? properties.messageId);
      const partId = asString(properties.partID ?? properties.partId);
      const field = asString(properties.field);
      const delta = asString(properties.delta);

      if (!sessionId || !messageId || !partId || !delta || field !== "text") {
        return nextState;
      }

      if (nextState.sessionId && nextState.sessionId !== sessionId) {
        return nextState;
      }

      const existingMessage = nextState.messagesById[messageId];
      const existingPart = existingMessage?.partsById[partId];
      const partType =
        existingPart?.kind === "reasoning" ? "reasoning" : "text";

      return upsertPart(
        nextState,
        {
          id: partId,
          partID: partId,
          messageID: messageId,
          sessionID: sessionId,
          type: partType,
          text: "",
        },
        delta,
        properties,
      );
    }

    case "message.part.removed": {
      const sessionId = asString(properties.sessionID ?? properties.sessionId);
      const messageId = asString(properties.messageID ?? properties.messageId);
      const partId = asString(properties.partID ?? properties.partId);
      if (!sessionId || !messageId || !partId) {
        return nextState;
      }
      if (nextState.sessionId && nextState.sessionId !== sessionId) {
        return nextState;
      }
      return removePart(nextState, messageId, partId);
    }

    case "todo.updated": {
      const sessionId = asString(properties.sessionID ?? properties.sessionId);
      if (
        sessionId &&
        nextState.sessionId &&
        nextState.sessionId !== sessionId
      ) {
        return nextState;
      }
      return {
        ...nextState,
        sessionId: nextState.sessionId ?? sessionId ?? null,
        todos: normalizeTodos(
          extractTodos(pickRecordValue(properties, "todos") ?? properties),
        ),
      };
    }

    case "question.asked": {
      const normalized = normalizeQuestion(properties, event.ts);
      if (!normalized) {
        return nextState;
      }
      const failedQuestionsById = { ...nextState.failedQuestionsById };
      delete failedQuestionsById[normalized.requestId];
      const resolvedQuestionsById = { ...nextState.resolvedQuestionsById };
      delete resolvedQuestionsById[normalized.requestId];
      return {
        ...nextState,
        sessionId: nextState.sessionId ?? normalized.sessionId,
        pendingQuestionsById: {
          ...nextState.pendingQuestionsById,
          [normalized.requestId]: normalized,
        },
        resolvedQuestionsById,
        failedQuestionsById,
      };
    }

    case "question.replied":
    case "question.rejected": {
      const requestId = asString(properties.requestID ?? properties.requestId);
      if (!requestId || !nextState.pendingQuestionsById[requestId]) {
        return nextState;
      }
      const pendingQuestionsById = { ...nextState.pendingQuestionsById };
      const resolvedStatus =
        event.type === "question.rejected"
          ? ("rejected" as const)
          : ("replied" as const);
      const resolvedQuestionsById = {
        ...nextState.resolvedQuestionsById,
        [requestId]: {
          ...nextState.pendingQuestionsById[requestId],
          status: resolvedStatus,
          resolvedAt: event.ts ?? null,
        },
      };
      delete pendingQuestionsById[requestId];
      const failedQuestionsById = { ...nextState.failedQuestionsById };
      delete failedQuestionsById[requestId];
      return {
        ...nextState,
        pendingQuestionsById,
        resolvedQuestionsById,
        failedQuestionsById,
      };
    }

    case "permission.asked": {
      const normalized = normalizePermission(
        properties,
        nextState.sessionId ?? undefined,
        event.ts,
      );
      if (!normalized) {
        console.warn("[runs] permission.asked ignored: normalization failed", {
          eventType: event.type,
          runId:
            isRecord(event.raw) && typeof event.raw.runId === "string"
              ? event.raw.runId
              : null,
        });
        return nextState;
      }
      const pendingPermissionsById = {
        ...nextState.pendingPermissionsById,
        [normalized.requestId]: normalized,
      };
      const failedPermissionsById = { ...nextState.failedPermissionsById };
      delete failedPermissionsById[normalized.requestId];
      const resolvedPermissionsById = {
        ...nextState.resolvedPermissionsById,
      };
      delete resolvedPermissionsById[normalized.requestId];
      console.info("[runs] permission added to pending state", {
        requestId: normalized.requestId,
        sessionId: normalized.sessionId,
        permissionType: normalized.kind ?? null,
        pendingCount: Object.keys(pendingPermissionsById).length,
        runId:
          isRecord(event.raw) && typeof event.raw.runId === "string"
            ? event.raw.runId
            : null,
      });
      return {
        ...nextState,
        sessionId: nextState.sessionId ?? normalized.sessionId,
        pendingPermissionsById,
        resolvedPermissionsById,
        failedPermissionsById,
      };
    }

    case "permission.replied":
    case "permission.rejected": {
      const requestId = asString(properties.requestID ?? properties.requestId);
      if (!requestId || !nextState.pendingPermissionsById[requestId]) {
        console.warn("[runs] permission resolution ignored: missing pending", {
          eventType: event.type,
          requestId: requestId ?? null,
          pendingCount: Object.keys(nextState.pendingPermissionsById).length,
          runId:
            isRecord(event.raw) && typeof event.raw.runId === "string"
              ? event.raw.runId
              : null,
        });
        return nextState;
      }
      const pendingPermissionsById = { ...nextState.pendingPermissionsById };
      const resolvedStatus =
        event.type === "permission.rejected"
          ? ("rejected" as const)
          : ("replied" as const);
      const resolvedPermissionsById = {
        ...nextState.resolvedPermissionsById,
        [requestId]: {
          ...nextState.pendingPermissionsById[requestId],
          status: resolvedStatus,
          resolvedAt: event.ts ?? null,
        },
      };
      delete pendingPermissionsById[requestId];
      const failedPermissionsById = { ...nextState.failedPermissionsById };
      delete failedPermissionsById[requestId];
      console.info("[runs] permission removed from pending state", {
        eventType: event.type,
        requestId,
        pendingCount: Object.keys(pendingPermissionsById).length,
        runId:
          isRecord(event.raw) && typeof event.raw.runId === "string"
            ? event.raw.runId
            : null,
      });
      return {
        ...nextState,
        pendingPermissionsById,
        resolvedPermissionsById,
        failedPermissionsById,
      };
    }

    case "session.diff":
      return {
        ...nextState,
        diffSummary: normalizeDiff(properties),
      };

    case "session.error":
      return {
        ...nextState,
        status: "error",
      };

    default:
      return nextState;
  }
};
