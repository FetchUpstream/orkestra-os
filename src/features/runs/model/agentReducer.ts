import {
  type AgentRole,
  type AgentStore,
  type OpenCodeBusEvent,
  type UiDiffSummary,
  type UiMessage,
  type UiPart,
  type UiPermissionRequest,
  type UiQuestionRequest,
  type UiTodo,
} from "./agentTypes";

type HydrateInput = {
  sessionId: string | null;
  messages: unknown;
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
  if (type === "text") {
    return {
      kind: "text",
      id,
      type,
      text: asString(value.text) ?? "",
      streaming: true,
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
      streaming: true,
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

const normalizeQuestion = (value: unknown): UiQuestionRequest | null => {
  if (!isRecord(value)) {
    return null;
  }
  const requestId = asString(value.requestID ?? value.requestId);
  const sessionId = asString(value.sessionID ?? value.sessionId);
  if (!requestId || !sessionId) {
    return null;
  }
  return {
    requestId,
    sessionId,
    questions: asArray(value.questions),
    raw: value,
  };
};

const normalizePermission = (value: unknown): UiPermissionRequest | null => {
  if (!isRecord(value)) {
    return null;
  }
  const requestId = asString(value.requestID ?? value.requestId);
  const sessionId = asString(value.sessionID ?? value.sessionId);
  if (!requestId || !sessionId) {
    return null;
  }
  return {
    requestId,
    sessionId,
    raw: value,
  };
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
    rawEvents: [...state.rawEvents, event],
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
    pendingPermissionsById: {},
    todos: [],
    diffSummary: null,
    rawEvents: [],
  };
};

export const upsertMessage = (state: AgentStore, info: unknown): AgentStore => {
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
    ...baseMessage,
    partsById: existing?.partsById ?? baseMessage.partsById,
    partOrder: existing?.partOrder ?? baseMessage.partOrder,
  };

  return {
    ...state,
    sessionId: sessionResult.sessionId,
    messagesById: {
      ...state.messagesById,
      [messageId]: nextMessage,
    },
    messageOrder: state.messageOrder.includes(messageId)
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

    if (hasDelta) {
      nextPart = {
        ...normalizedPart,
        text: `${existingTextPart?.text ?? normalizedPart.text}${delta}`,
        streaming: true,
      };
    } else if (incomingText && incomingText.length > 0) {
      nextPart = {
        ...normalizedPart,
        text: incomingText,
        streaming: false,
      };
    } else if (existingTextPart?.text) {
      nextPart = {
        ...normalizedPart,
        text: existingTextPart.text,
        streaming: existingTextPart.streaming,
      };
    } else {
      nextPart = {
        ...normalizedPart,
        streaming: false,
      };
    }
  }

  const nextMessage: UiMessage = {
    ...existingMessage,
    partsById: {
      ...existingMessage.partsById,
      [partId]: nextPart,
    },
    partOrder: existingMessage.partOrder.includes(partId)
      ? existingMessage.partOrder
      : [...existingMessage.partOrder, partId],
  };

  return {
    ...state,
    sessionId: sessionResult.sessionId,
    messagesById: {
      ...state.messagesById,
      [messageId]: nextMessage,
    },
    messageOrder: state.messageOrder.includes(messageId)
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
      normalizedMessage.partsById[part.id] = part;
      if (!normalizedMessage.partOrder.includes(part.id)) {
        normalizedMessage.partOrder.push(part.id);
      }
    }

    nextMessagesById[normalizedMessage.id] = normalizedMessage;
    if (!nextMessageOrder.includes(normalizedMessage.id)) {
      nextMessageOrder.push(normalizedMessage.id);
    }
  }

  return {
    ...state,
    status: "idle",
    streamConnected: false,
    lastSyncAt: Date.now(),
    messagesById: nextMessagesById,
    messageOrder: nextMessageOrder,
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
      return {
        ...nextState,
        streamConnected: true,
        status: nextState.status === "connecting" ? "idle" : nextState.status,
        lastSyncAt: Date.now(),
      };

    case "session.status": {
      const sessionId = asString(properties.sessionID ?? properties.sessionId);
      const status = asString(properties.status);
      if (!sessionId || !status) {
        return nextState;
      }

      const sessionResult = matchOrAdoptSession(nextState, sessionId);
      if (!sessionResult.canApply) {
        return nextState;
      }

      if (status !== "idle" && status !== "active" && status !== "error") {
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
      return upsertPart(nextState, rawPart, delta);
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
          text:
            existingPart &&
            (existingPart.kind === "text" || existingPart.kind === "reasoning")
              ? existingPart.text
              : "",
        },
        delta,
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
      const normalized = normalizeQuestion(properties);
      if (!normalized) {
        return nextState;
      }
      const sessionResult = matchOrAdoptSession(
        nextState,
        normalized.sessionId,
      );
      if (!sessionResult.canApply) {
        return nextState;
      }
      return {
        ...nextState,
        sessionId: sessionResult.sessionId,
        pendingQuestionsById: {
          ...nextState.pendingQuestionsById,
          [normalized.requestId]: normalized,
        },
      };
    }

    case "question.replied":
    case "question.rejected": {
      const requestId = asString(properties.requestID ?? properties.requestId);
      if (!requestId || !nextState.pendingQuestionsById[requestId]) {
        return nextState;
      }
      const pendingQuestionsById = { ...nextState.pendingQuestionsById };
      delete pendingQuestionsById[requestId];
      return {
        ...nextState,
        pendingQuestionsById,
      };
    }

    case "permission.asked": {
      const normalized = normalizePermission(properties);
      if (!normalized) {
        return nextState;
      }
      const sessionResult = matchOrAdoptSession(
        nextState,
        normalized.sessionId,
      );
      if (!sessionResult.canApply) {
        return nextState;
      }
      return {
        ...nextState,
        sessionId: sessionResult.sessionId,
        pendingPermissionsById: {
          ...nextState.pendingPermissionsById,
          [normalized.requestId]: normalized,
        },
      };
    }

    case "permission.replied": {
      const requestId = asString(properties.requestID ?? properties.requestId);
      if (!requestId || !nextState.pendingPermissionsById[requestId]) {
        return nextState;
      }
      const pendingPermissionsById = { ...nextState.pendingPermissionsById };
      delete pendingPermissionsById[requestId];
      return {
        ...nextState,
        pendingPermissionsById,
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
