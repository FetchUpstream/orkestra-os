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
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type Component,
  type JSX,
} from "solid-js";
import {
  RunChatAssistantMessage,
  RunChatComposer,
  RunChatMarkdown,
  RunChatMessage,
  RunChatSystemMessage,
  RunChatToolRail,
  RunChatTranscript,
  RunChatUserMessage,
  type RunChatToolRailItem,
  type RunChatToolRailSubagentItem,
} from "./chat";
import RunAgentSelectOptions from "./RunAgentSelectOptions";
import type {
  AgentStore,
  OpenCodeBusEvent,
  UiAssistantStreamChannelMetadata,
  UiAssistantStreamingMetadata,
  UiPart,
  UiPermissionRequest,
  UiQuestionRequest,
  UiReasoningPart,
  UiTextPart,
} from "../model/agentTypes";
import { hydrateAgentStore } from "../model/agentReducer";
import { useRunDetailModel } from "../model/useRunDetailModel";
import { formatDateTime } from "../../tasks/utils/taskDetail";
import { AppIcon } from "../../../components/ui/icons";
import RunInlineLoader from "../../../components/ui/RunInlineLoader";
import {
  getRunOpenCodeSessionMessages,
  getRunOpenCodeSessionTodos,
} from "../../../app/lib/runs";
import {
  buildQuestionWizardConfirmSummary,
  buildQuestionWizardFinalAnswers,
  createEmptyQuestionWizardDrafts,
  getQuestionWizardDraft,
  isQuestionWizardComplete,
  isQuestionWizardPromptComplete,
  toggleQuestionWizardOption,
  toggleQuestionWizardCustomAnswer,
  updateQuestionWizardCustomText,
  type QuestionWizardDraftAnswer,
  type QuestionWizardPrompt,
} from "./questionWizard";
import {
  normalizeToolOutputTextForDisplay,
  normalizeToolPathForDisplay,
  type ToolPathDisplayContext,
} from "../lib/normalizeToolPathForDisplay";

type AgentReadinessPhase =
  | "warming_backend"
  | "creating_session"
  | "ready"
  | "reconnecting"
  | "submit_failed"
  | null;

type ChatSessionHealth =
  | "idle"
  | "sending"
  | "send_failed"
  | "reconnecting"
  | "unresponsive";

type NewRunChatWorkspaceProps = {
  model: ReturnType<typeof useRunDetailModel>;
  hideTranscriptScrollbar?: boolean;
};

type ChatRow = {
  key: string;
  role: string;
  content: string;
  reasoningContent: string;
  assistantStreaming?: UiAssistantStreamingMetadata;
  toolItems: RunChatToolRailItem[];
  timestamp: string;
  attributionLabel: string;
  hasRenderableContent: boolean;
};

const resolveTranscriptPartText = (
  part: UiTextPart | UiReasoningPart,
  displayContext: ToolPathDisplayContext,
): string => {
  if (typeof part.streamText === "string") {
    return normalizeToolOutputTextForDisplay(part.streamText, displayContext);
  }

  const streamTail = part.streamTail;
  if (!streamTail) {
    return normalizeToolOutputTextForDisplay(part.text, displayContext);
  }

  const deltas: string[] = [];
  let cursor: typeof streamTail | undefined = streamTail;
  while (cursor) {
    deltas.push(cursor.delta);
    cursor = cursor.prev;
  }
  deltas.reverse();

  const baseText =
    typeof part.streamBaseText === "string" ? part.streamBaseText : part.text;
  return normalizeToolOutputTextForDisplay(
    `${baseText}${deltas.join("")}`,
    displayContext,
  );
};

const resolveAssistantStreamChannel = (
  messageId: string,
  channelKey: "text" | "reasoning",
  parts: Array<UiTextPart | UiReasoningPart>,
  displayContext: ToolPathDisplayContext,
): UiAssistantStreamChannelMetadata => {
  const resolvedParts = parts.map((part) => {
    const targetText = resolveTranscriptPartText(part, displayContext);
    const streamRevision =
      typeof part.streamRevision === "number" &&
      Number.isFinite(part.streamRevision)
        ? part.streamRevision
        : 0;
    const hasStreamHistory =
      part.streaming ||
      typeof part.streamBaseText === "string" ||
      typeof part.streamTail !== "undefined" ||
      streamRevision > 0;
    const lifecycle = part.streaming
      ? "streaming"
      : hasStreamHistory
        ? "settled"
        : "static";
    const hasVisibleContent = targetText.trim().length > 0;

    return {
      targetText,
      isStreaming: part.streaming,
      streamRevision,
      streamToken: `${part.id}:${streamRevision}:${part.streaming ? "live" : lifecycle}:${targetText.length}`,
      lifecycle,
      hasVisibleContent,
      isPlaceholderOnly: !hasVisibleContent && part.streaming,
    };
  });

  const targetText = resolvedParts
    .map((part) => part.targetText)
    .join("\n\n")
    .trim();
  const isStreaming = resolvedParts.some((part) => part.isStreaming);
  const streamRevision = resolvedParts.reduce(
    (maxRevision, part) => Math.max(maxRevision, part.streamRevision),
    0,
  );
  const lifecycle = isStreaming
    ? "streaming"
    : resolvedParts.some((part) => part.lifecycle === "settled")
      ? "settled"
      : "static";
  const hasVisibleContent = targetText.length > 0;

  return {
    targetText,
    isStreaming,
    streamRevision,
    streamToken:
      resolvedParts.length > 0
        ? `${messageId}:${channelKey}:${resolvedParts.map((part) => part.streamToken).join("|")}`
        : `${messageId}:${channelKey}:empty`,
    lifecycle,
    hasVisibleContent,
    isPlaceholderOnly: !hasVisibleContent && isStreaming,
  };
};

const buildAssistantStreamingMetadata = (
  messageId: string,
  textParts: UiTextPart[],
  reasoningParts: UiReasoningPart[],
  displayContext: ToolPathDisplayContext,
): UiAssistantStreamingMetadata => {
  const text = resolveAssistantStreamChannel(
    messageId,
    "text",
    textParts,
    displayContext,
  );
  const reasoning = resolveAssistantStreamChannel(
    messageId,
    "reasoning",
    reasoningParts,
    displayContext,
  );
  const isStreaming = text.isStreaming || reasoning.isStreaming;
  const streamRevision = Math.max(
    text.streamRevision,
    reasoning.streamRevision,
  );
  const lifecycle = isStreaming
    ? "streaming"
    : text.lifecycle === "settled" || reasoning.lifecycle === "settled"
      ? "settled"
      : "static";
  const hasVisibleContent =
    text.hasVisibleContent || reasoning.hasVisibleContent;

  return {
    messageId,
    isStreaming,
    streamRevision,
    streamToken: `${messageId}:${text.streamToken}:${reasoning.streamToken}`,
    lifecycle,
    targetText: text.targetText,
    reasoningTargetText: reasoning.targetText,
    hasVisibleContent,
    isPlaceholderOnly: !hasVisibleContent && isStreaming,
    text,
    reasoning,
  };
};

const toStreamRevision = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const materializeStreamText = (
  baseText: string,
  tail?: UiTextPart["streamTail"] | UiReasoningPart["streamTail"],
): string => {
  if (!tail) {
    return baseText;
  }

  const deltas: string[] = [];
  let cursor = tail;
  while (cursor) {
    deltas.push(cursor.delta);
    cursor = cursor.prev;
  }
  deltas.reverse();
  return `${baseText}${deltas.join("")}`;
};

const buildStreamingTextPart = (
  partId: string,
  partType: "text" | "reasoning",
  rawPart: Record<string, unknown>,
  existingPart: UiPart | undefined,
  delta: string,
  eventType: string,
): UiTextPart | UiReasoningPart => {
  const existingTypedPart =
    existingPart && existingPart.kind === partType ? existingPart : undefined;
  const incomingText =
    typeof rawPart.text === "string" ? rawPart.text : undefined;
  const hasIncomingTextSnapshot = typeof incomingText === "string";
  const explicitStreaming =
    typeof rawPart.streaming === "boolean"
      ? rawPart.streaming
      : eventType === "message.part.delta";
  const existingStreamBaseText =
    typeof existingTypedPart?.streamBaseText === "string"
      ? existingTypedPart.streamBaseText
      : (existingTypedPart?.text ?? "");
  const existingStreamTail = existingTypedPart?.streamTail;

  if (hasIncomingTextSnapshot) {
    const previousRevision = toStreamRevision(
      existingTypedPart?.streamRevision,
    );
    const previousRenderedText = materializeStreamText(
      existingStreamBaseText,
      existingStreamTail,
    );
    const targetTextChanged = incomingText !== previousRenderedText;
    const nextStreamRevision =
      previousRevision > 0
        ? previousRevision + (targetTextChanged ? 1 : 0)
        : explicitStreaming || incomingText.length > 0
          ? 1
          : 0;

    return {
      kind: partType,
      id: partId,
      type: partType,
      text: incomingText,
      streaming: explicitStreaming,
      streamBaseText: explicitStreaming ? incomingText : undefined,
      streamTail: explicitStreaming ? undefined : undefined,
      streamText: undefined,
      streamTextLength: incomingText.length,
      streamRevision: nextStreamRevision > 0 ? nextStreamRevision : undefined,
      raw: rawPart,
    };
  }

  if (delta.length > 0) {
    const nextStreamTextLength =
      typeof existingTypedPart?.streamTextLength === "number"
        ? existingTypedPart.streamTextLength + delta.length
        : existingStreamBaseText.length + delta.length;
    const nextStreamRevision =
      toStreamRevision(existingTypedPart?.streamRevision) + 1;

    return {
      kind: partType,
      id: partId,
      type: partType,
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
      raw: rawPart,
    };
  }

  if (existingTypedPart?.streamTail || existingTypedPart?.streaming) {
    const finalizedText = materializeStreamText(
      existingStreamBaseText,
      existingStreamTail,
    );
    const nextStreamRevision = toStreamRevision(
      existingTypedPart?.streamRevision,
    );

    return {
      kind: partType,
      id: partId,
      type: partType,
      text: explicitStreaming ? existingStreamBaseText : finalizedText,
      streaming: explicitStreaming,
      streamBaseText: explicitStreaming ? existingStreamBaseText : undefined,
      streamTail: explicitStreaming ? existingStreamTail : undefined,
      streamText: undefined,
      streamTextLength: explicitStreaming
        ? typeof existingTypedPart?.streamTextLength === "number"
          ? existingTypedPart.streamTextLength
          : finalizedText.length
        : finalizedText.length,
      streamRevision: nextStreamRevision > 0 ? nextStreamRevision : undefined,
      raw: rawPart,
    };
  }

  return {
    kind: partType,
    id: partId,
    type: partType,
    text: existingTypedPart?.text ?? "",
    streaming: false,
    streamBaseText: undefined,
    streamTail: undefined,
    streamText: undefined,
    streamTextLength: existingTypedPart?.text.length ?? 0,
    streamRevision: undefined,
    raw: rawPart,
  };
};

const TRANSCRIPT_WINDOW_CHUNK = 60;
const TRANSCRIPT_NEAR_BOTTOM_THRESHOLD = 96;
const INITIAL_TRANSCRIPT_ANCHOR_MAX_ATTEMPTS = 6;
const INTERNAL_ID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const INTERNAL_ID_DETECTION_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const INTERNAL_ATTRIBUTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const hasCompletedRunStatus = (status: string | null | undefined): boolean => {
  return status === "complete" || status === "completed";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toSingleLine = (value: unknown, maxLength = 140): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const asText =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : null;

  if (asText === null) {
    return null;
  }

  const normalized = asText
    .replace(INTERNAL_ID_PATTERN, "[internal-id]")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`;
};

const toSingleLineWithoutTruncation = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const asText =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : null;

  if (asText === null) {
    return null;
  }

  const normalized = asText
    .replace(INTERNAL_ID_PATTERN, "[internal-id]")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
};

const getNestedValueByKeys = (
  value: unknown,
  keys: readonly string[],
  depth = 0,
): unknown => {
  if (!isRecord(value) || depth > 3) {
    return undefined;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      return value[key];
    }
  }

  for (const nestedValue of Object.values(value)) {
    const candidate = getNestedValueByKeys(nestedValue, keys, depth + 1);
    if (candidate !== undefined) {
      return candidate;
    }
  }

  return undefined;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => toSingleLine(item, 200))
    .filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
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

const getParentSessionIdentifier = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  const nested = getNestedRecord(value, "part", "info", "properties");
  const parentId =
    (typeof value.parentID === "string" ? value.parentID : null) ||
    (typeof value.parentId === "string" ? value.parentId : null) ||
    (nested && typeof nested.parentID === "string" ? nested.parentID : null) ||
    (nested && typeof nested.parentId === "string" ? nested.parentId : null);

  return parentId?.trim() || null;
};

type SubagentMessageSnapshot = {
  id: string;
  role: "assistant" | "user" | "system" | "unknown";
  attribution?: {
    agent?: string;
    model?: string;
  };
  partsById: Record<string, UiPart>;
  partOrder: string[];
};

type SubagentSessionSnapshot = {
  sessionId: string;
  parentSessionId: string | null;
  parentMessageId: string | null;
  assignedTaskPartId: string | null;
  status: string;
  title: string | null;
  agentType: string | null;
  model: string | null;
  messageOrder: string[];
  messagesById: Record<string, SubagentMessageSnapshot>;
};

type SubagentHistorySnapshot = {
  sessionId: string;
  store: AgentStore;
};

const getParentMessageIdentifier = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  const nested = getNestedRecord(value, "info", "part", "properties");
  const parentId =
    (typeof value.parentID === "string" ? value.parentID : null) ||
    (typeof value.parentId === "string" ? value.parentId : null) ||
    (nested && typeof nested.parentID === "string" ? nested.parentID : null) ||
    (nested && typeof nested.parentId === "string" ? nested.parentId : null);

  return parentId?.trim() || null;
};

const getStatusType = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (!isRecord(value)) {
    return null;
  }
  return (
    (typeof value.type === "string" ? value.type.trim() : "") ||
    (typeof value.status === "string" ? value.status.trim() : "") ||
    null
  );
};

const sanitizeSubagentAttributionValue = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || INTERNAL_ATTRIBUTION_ID_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
};

const sanitizeSubagentModelLabel = (value: unknown): string | null => {
  const normalized = sanitizeSubagentAttributionValue(value);
  if (!normalized) {
    return null;
  }

  const slashParts = normalized.split("/").map((segment) => segment.trim());
  const slashTail = slashParts[slashParts.length - 1];
  if (slashParts.length > 1 && slashTail) {
    return INTERNAL_ATTRIBUTION_ID_PATTERN.test(slashTail) ? null : slashTail;
  }

  const colonParts = normalized.split(":").map((segment) => segment.trim());
  const colonTail = colonParts[colonParts.length - 1];
  if (colonParts.length > 1 && colonTail) {
    return INTERNAL_ATTRIBUTION_ID_PATTERN.test(colonTail) ? null : colonTail;
  }

  return normalized;
};

const readSubagentAttribution = (
  value: unknown,
): { agent: string | null; model: string | null } => {
  if (!isRecord(value)) {
    return { agent: null, model: null };
  }

  return {
    agent:
      sanitizeSubagentAttributionValue(
        value.agent ?? value.agentID ?? value.agentId ?? value.agent_id,
      ) ?? null,
    model:
      sanitizeSubagentModelLabel(
        value.model ??
          value.modelID ??
          value.modelId ??
          value.model_id ??
          value.modelName ??
          value.model_name,
      ) ?? null,
  };
};

const formatSubagentLabel = (
  title: string | null,
  agentType: string | null,
  model: string | null,
  hasOutput: boolean,
): string => {
  const normalizedTitle = title?.trim();
  if (normalizedTitle) {
    const normalizedModel = model?.trim();
    return normalizedModel
      ? `${normalizedTitle} - ${normalizedModel}`
      : normalizedTitle;
  }

  if (!hasOutput) {
    return "~ Delegating...";
  }

  const normalizedAgentType = agentType?.trim();
  if (normalizedAgentType) {
    return normalizedAgentType.startsWith("@")
      ? normalizedAgentType
      : `@${normalizedAgentType}`;
  }

  return "Subagent";
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

const extractTaskSubagentSessionIds = (
  part: UiPart,
  rootSessionId: string | null,
): string[] => {
  if (part.kind !== "tool" || !isTaskToolName(part.toolName)) {
    return [];
  }
  const sessionIds = new Set<string>();
  collectSessionIdsFromValue(part.raw, sessionIds, new Set<unknown>());
  return Array.from(sessionIds).filter(
    (sessionId) => sessionId !== rootSessionId,
  );
};

const buildSubagentMessagesFromStore = (
  store: AgentStore,
  displayContext: ToolPathDisplayContext,
) => {
  return store.messageOrder
    .map((messageId) => store.messagesById[messageId])
    .filter(Boolean)
    .map((message) => {
      const textParts: UiTextPart[] = [];
      const reasoningParts: UiReasoningPart[] = [];
      const toolItems: Array<{ id: string; summary: string; status?: string }> =
        [];

      for (const partId of message.partOrder) {
        const part = message.partsById[partId];
        if (!part) continue;
        if (part.kind === "text") {
          const text = resolveTranscriptPartText(part, displayContext);
          if (text.trim().length > 0 || part.streaming) {
            textParts.push(part);
          }
          continue;
        }
        if (part.kind === "reasoning") {
          const text = resolveTranscriptPartText(part, displayContext);
          if (text.trim().length > 0 || part.streaming) {
            reasoningParts.push(part);
          }
          continue;
        }
        if (part.kind === "tool") {
          toolItems.push({
            id: part.id,
            summary: buildToolSummary(part, displayContext),
            status: part.status,
          });
        }
      }

      const assistantStreaming =
        message.role === "assistant"
          ? buildAssistantStreamingMetadata(
              message.id,
              textParts,
              reasoningParts,
              displayContext,
            )
          : undefined;

      return {
        id: message.id,
        role: message.role,
        content: assistantStreaming
          ? assistantStreaming.targetText
          : textParts
              .map((part) => resolveTranscriptPartText(part, displayContext))
              .join("\n\n")
              .trim(),
        reasoningContent: assistantStreaming
          ? assistantStreaming.reasoningTargetText
          : reasoningParts
              .map((part) => resolveTranscriptPartText(part, displayContext))
              .join("\n\n")
              .trim(),
        assistantStreaming,
        toolItems,
      };
    })
    .filter(
      (message) =>
        message.content.length > 0 ||
        message.reasoningContent.length > 0 ||
        message.toolItems.length > 0,
    );
};

const resolveTaskPartIdForParentMessage = (
  parentMessageId: string | null,
  rootMessagesById: Record<
    string,
    { partOrder: string[]; partsById: Record<string, UiPart> }
  >,
): string | null => {
  if (!parentMessageId) {
    return null;
  }
  const parentMessage = rootMessagesById[parentMessageId];
  if (!parentMessage) {
    return null;
  }
  const taskPartIds = parentMessage.partOrder.filter((partId) => {
    const part = parentMessage.partsById[partId];
    return part?.kind === "tool" && isTaskToolName(part.toolName);
  });
  if (taskPartIds.length === 0) {
    return null;
  }
  return taskPartIds[taskPartIds.length - 1] ?? null;
};

const normalizeSubagentRole = (
  value: unknown,
): SubagentMessageSnapshot["role"] => {
  return value === "assistant" ||
    value === "user" ||
    value === "system" ||
    value === "unknown"
    ? value
    : "unknown";
};

const isTaskToolName = (value: unknown): boolean => {
  return typeof value === "string" && value.trim().toLowerCase() === "task";
};

const buildSubagentPanels = (
  rawEvents: readonly OpenCodeBusEvent[],
  rootSessionId: string | null,
  rootMessagesById: Record<
    string,
    { partOrder: string[]; partsById: Record<string, UiPart> }
  >,
  displayContext: ToolPathDisplayContext,
  taskPartSessionIdsByPartId: Record<string, string[]>,
  fetchedSessionHistories: Record<string, SubagentHistorySnapshot>,
): Record<string, RunChatToolRailSubagentItem[]> => {
  const sessions = new Map<string, SubagentSessionSnapshot>();
  let activeTaskPartId: string | null = null;
  const allRootTaskPartIds = Object.values(rootMessagesById).flatMap(
    (message) =>
      message.partOrder.filter((partId) => {
        const part = message.partsById[partId];
        return part?.kind === "tool" && isTaskToolName(part.toolName);
      }),
  );

  const ensureSession = (
    sessionId: string,
    parentSessionId: string | null,
  ): SubagentSessionSnapshot => {
    const existing = sessions.get(sessionId);
    if (existing) {
      if (!existing.parentSessionId && parentSessionId) {
        existing.parentSessionId = parentSessionId;
      }
      return existing;
    }
    const created: SubagentSessionSnapshot = {
      sessionId,
      parentSessionId,
      parentMessageId: null,
      assignedTaskPartId: null,
      status: "running",
      title: null,
      agentType: null,
      model: null,
      messageOrder: [],
      messagesById: {},
    };
    sessions.set(sessionId, created);
    return created;
  };

  for (const event of rawEvents) {
    const properties = getEventRecord(event.properties);
    const sessionId = getSessionIdentifier(properties);
    const parentSessionId = getParentSessionIdentifier(properties);
    const rootPart = getNestedRecord(properties, "part");

    if (
      sessionId &&
      rootSessionId &&
      sessionId === rootSessionId &&
      rootPart &&
      ((event.type === "message.part.updated" &&
        typeof rootPart.type === "string" &&
        rootPart.type === "tool" &&
        isTaskToolName(rootPart.tool)) ||
        (event.type === "message.updated" &&
          typeof rootPart.type === "string" &&
          rootPart.type === "tool" &&
          isTaskToolName(rootPart.tool)))
    ) {
      activeTaskPartId =
        (typeof rootPart.id === "string" ? rootPart.id.trim() : "") ||
        (typeof rootPart.partID === "string" ? rootPart.partID.trim() : "") ||
        (typeof rootPart.partId === "string" ? rootPart.partId.trim() : "") ||
        activeTaskPartId;
    }

    if (!sessionId) {
      continue;
    }

    if (rootSessionId && sessionId === rootSessionId) {
      continue;
    }

    const session = ensureSession(sessionId, parentSessionId);
    if (!session.assignedTaskPartId && activeTaskPartId) {
      session.assignedTaskPartId = activeTaskPartId;
    }

    if (event.type === "session.updated") {
      const info = getNestedRecord(properties, "info") ?? properties;
      const parentMessageId = getParentMessageIdentifier(info);
      if (parentMessageId && !session.parentMessageId) {
        session.parentMessageId = parentMessageId;
      }
      const title =
        (typeof info.title === "string" ? info.title.trim() : "") ||
        (typeof info.slug === "string" ? info.slug.trim() : "");
      if (title) {
        session.title = title;
      }
      const attribution = readSubagentAttribution(info);
      const agentType =
        attribution.agent ||
        (typeof info.agent === "string" ? info.agent.trim() : "") ||
        (typeof info.mode === "string" ? info.mode.trim() : "");
      if (agentType) {
        session.agentType = agentType;
      }
      if (attribution.model) {
        session.model = attribution.model;
      }
      continue;
    }

    if (event.type === "message.updated") {
      const info = getNestedRecord(properties, "info") ?? properties;
      const parentMessageId = getParentMessageIdentifier(info);
      if (parentMessageId && !session.parentMessageId) {
        session.parentMessageId = parentMessageId;
      }
      const attribution = readSubagentAttribution(info);
      const agentType =
        attribution.agent ||
        (typeof info.agent === "string" ? info.agent.trim() : "") ||
        (typeof info.mode === "string" ? info.mode.trim() : "");
      if (agentType && !session.agentType) {
        session.agentType = agentType;
      }
      if (attribution.model && !session.model) {
        session.model = attribution.model;
      }
      const taskPartId = resolveTaskPartIdForParentMessage(
        session.parentMessageId,
        rootMessagesById,
      );
      if (taskPartId && !session.assignedTaskPartId) {
        session.assignedTaskPartId = taskPartId;
      }
    }

    if (event.type === "session.status") {
      const nextStatus = getStatusType(properties.status) || session.status;
      session.status = nextStatus;
      continue;
    }

    if (event.type === "message.updated") {
      const info = getNestedRecord(properties, "info") ?? properties;
      const attribution = readSubagentAttribution(info);
      const messageId =
        (typeof info.id === "string" ? info.id : null) ||
        (typeof info.messageID === "string" ? info.messageID : null) ||
        (typeof info.messageId === "string" ? info.messageId : null);
      if (!messageId?.trim()) {
        continue;
      }
      const normalizedId = messageId.trim();
      const existing = session.messagesById[normalizedId];
      session.messagesById[normalizedId] = {
        id: normalizedId,
        role: normalizeSubagentRole(info.role),
        attribution:
          attribution.agent || attribution.model
            ? {
                ...(attribution.agent ? { agent: attribution.agent } : {}),
                ...(attribution.model ? { model: attribution.model } : {}),
              }
            : existing?.attribution,
        partsById: existing?.partsById ?? {},
        partOrder: existing?.partOrder ?? [],
      };
      if (!session.messageOrder.includes(normalizedId)) {
        session.messageOrder.push(normalizedId);
      }
      continue;
    }

    if (
      event.type !== "message.part.updated" &&
      event.type !== "message.part.delta"
    ) {
      continue;
    }

    const rawPart = getNestedRecord(properties, "part") ?? properties;
    const messageId =
      (typeof rawPart.messageID === "string" ? rawPart.messageID : null) ||
      (typeof rawPart.messageId === "string" ? rawPart.messageId : null);
    const partId =
      (typeof rawPart.id === "string" ? rawPart.id : null) ||
      (typeof rawPart.partID === "string" ? rawPart.partID : null) ||
      (typeof rawPart.partId === "string" ? rawPart.partId : null);
    const partType = typeof rawPart.type === "string" ? rawPart.type : "text";
    if (!messageId?.trim() || !partId?.trim()) {
      continue;
    }

    const normalizedMessageId = messageId.trim();
    const normalizedPartId = partId.trim();
    const existingMessage = session.messagesById[normalizedMessageId] ?? {
      id: normalizedMessageId,
      role: "unknown" as const,
      partsById: {},
      partOrder: [],
    };
    const existingPart = existingMessage.partsById[normalizedPartId];
    const delta = typeof properties.delta === "string" ? properties.delta : "";

    let nextPart: UiPart;
    if (
      partType === "reasoning" ||
      (existingPart && existingPart.kind === "reasoning")
    ) {
      nextPart = buildStreamingTextPart(
        normalizedPartId,
        "reasoning",
        rawPart,
        existingPart,
        delta,
        event.type,
      );
    } else if (partType === "tool") {
      const state = getNestedRecord(rawPart, "state") ?? {};
      nextPart = {
        kind: "tool",
        id: normalizedPartId,
        type: "tool",
        toolName: typeof rawPart.tool === "string" ? rawPart.tool : "tool",
        callId:
          (typeof rawPart.callID === "string" ? rawPart.callID : undefined) ||
          (typeof rawPart.callId === "string" ? rawPart.callId : undefined),
        status: typeof state.status === "string" ? state.status : "pending",
        title: typeof state.title === "string" ? state.title : undefined,
        input: state.input,
        output: state.output,
        error: state.error,
        raw: rawPart,
      };
    } else {
      nextPart = buildStreamingTextPart(
        normalizedPartId,
        "text",
        rawPart,
        existingPart,
        delta,
        event.type,
      );
    }

    session.messagesById[normalizedMessageId] = {
      ...existingMessage,
      partsById: {
        ...existingMessage.partsById,
        [normalizedPartId]: nextPart,
      },
      partOrder: existingMessage.partsById[normalizedPartId]
        ? existingMessage.partOrder
        : [...existingMessage.partOrder, normalizedPartId],
    };
    if (!session.messageOrder.includes(normalizedMessageId)) {
      session.messageOrder.push(normalizedMessageId);
    }
  }

  for (const session of sessions.values()) {
    if (!session.assignedTaskPartId && session.parentMessageId) {
      session.assignedTaskPartId = resolveTaskPartIdForParentMessage(
        session.parentMessageId,
        rootMessagesById,
      );
    }
    if (!session.assignedTaskPartId && allRootTaskPartIds.length === 1) {
      session.assignedTaskPartId = allRootTaskPartIds[0] ?? null;
    }
  }

  for (const [taskPartId, sessionIds] of Object.entries(
    taskPartSessionIdsByPartId,
  )) {
    for (const sessionId of sessionIds) {
      const session = ensureSession(sessionId, null);
      if (!session.assignedTaskPartId) {
        session.assignedTaskPartId = taskPartId;
      }
    }
  }

  return Array.from(sessions.values()).reduce<
    Record<string, RunChatToolRailSubagentItem[]>
  >((acc, session) => {
    const taskPartId = session.assignedTaskPartId;
    if (!taskPartId) {
      return acc;
    }

    const liveMessages = buildSubagentMessagesFromStore(
      {
        sessionId: session.sessionId,
        status: "idle",
        streamConnected: false,
        lastSyncAt: null,
        messagesById: Object.fromEntries(
          session.messageOrder
            .map((messageId) => [messageId, session.messagesById[messageId]])
            .filter((entry) => Boolean(entry[1])),
        ) as AgentStore["messagesById"],
        messageOrder: session.messageOrder,
        pendingQuestionsById: {},
        pendingPermissionsById: {},
        resolvedPermissionsById: {},
        failedPermissionsById: {},
        todos: [],
        diffSummary: null,
        rawEvents: [],
      },
      displayContext,
    );
    const fetchedMessages =
      fetchedSessionHistories[session.sessionId]?.store !== undefined
        ? buildSubagentMessagesFromStore(
            fetchedSessionHistories[session.sessionId].store,
            displayContext,
          )
        : [];
    const messages = liveMessages.length > 0 ? liveMessages : fetchedMessages;

    const fetchedHistoryMessages = Object.values(
      fetchedSessionHistories[session.sessionId]?.store.messagesById ?? {},
    );
    const fallbackAgentType =
      session.agentType ||
      fetchedHistoryMessages
        .map((message) => message.attribution?.agent?.trim() || "")
        .find(Boolean) ||
      null;
    const fallbackModel =
      session.model ||
      fetchedHistoryMessages
        .map((message) => message.attribution?.model?.trim() || "")
        .find(Boolean) ||
      null;

    const subagent: RunChatToolRailSubagentItem = {
      id: session.sessionId,
      label: formatSubagentLabel(
        session.title,
        fallbackAgentType,
        fallbackModel,
        messages.length > 0,
      ),
      status: session.status,
      messages,
    };

    acc[taskPartId] = [...(acc[taskPartId] ?? []), subagent];
    return acc;
  }, {});
};

const sanitizeAttributionValue = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim();
  if (!normalized || INTERNAL_ATTRIBUTION_ID_PATTERN.test(normalized)) {
    return "";
  }
  return normalized;
};

const isOpaqueOptionRawValue = (value: string): boolean => {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return (
    INTERNAL_ID_DETECTION_PATTERN.test(normalized) ||
    /\binternal[-_\s]?id\b/i.test(normalized)
  );
};

const formatMessageAttribution = (value: {
  agent?: string;
  model?: string;
}): string => {
  const agent = sanitizeAttributionValue(value.agent);
  const model = sanitizeAttributionValue(value.model);

  if (agent && model) {
    return `${agent} - ${model}`;
  }
  if (agent) {
    return agent;
  }
  if (model) {
    return model;
  }
  return "";
};

const parsePermissionCardData = (
  permission: UiPermissionRequest,
): {
  requestId: string;
  kind: string;
  sourceLabel: string;
  sourceKind: "main" | "subagent";
  pathPatterns: string[];
  metadata: Array<{ key: string; value: string }>;
  failureMessage: string;
} => {
  const raw = isRecord(permission.raw) ? permission.raw : {};
  const metadataRecord =
    permission.metadata && isRecord(permission.metadata)
      ? permission.metadata
      : {};
  const kind =
    toSingleLine(permission.kind, 80) ||
    toSingleLine(raw.kind, 80) ||
    toSingleLine(raw.permission, 80) ||
    "unspecified";
  const pathPatternsFromState = toStringArray(permission.pathPatterns);
  const pathPatternsFromRaw = toStringArray(
    raw.pathPatterns ?? raw.paths ?? raw.patterns,
  );
  const pathPatterns =
    pathPatternsFromState.length > 0
      ? pathPatternsFromState
      : pathPatternsFromRaw;
  const metadata: Array<{ key: string; value: string }> = [
    ...Object.entries(metadataRecord)
      .map(([key, value]) => ({ key, value: toSingleLine(value, 120) || "" }))
      .filter((entry) => entry.value.length > 0),
  ];

  const metadataKeys = new Set(metadata.map((entry) => entry.key));
  const discoveredMetadataEntries: Array<{ label: string; value: unknown }> = [
    { label: "Action", value: raw.action ?? raw.operation ?? raw.op },
    {
      label: "Tool",
      value:
        raw.tool ??
        raw.toolName ??
        raw.command ??
        raw.name ??
        raw.permissionTool,
    },
    {
      label: "Reason",
      value:
        raw.reason ?? raw.description ?? raw.prompt ?? raw.message ?? raw.title,
    },
  ];

  for (const entry of discoveredMetadataEntries) {
    const key = entry.label.toLowerCase();
    if (metadataKeys.has(key)) {
      continue;
    }
    const value = toSingleLine(entry.value, 180);
    if (!value) {
      continue;
    }
    metadata.push({ key, value });
    metadataKeys.add(key);
  }

  return {
    requestId: permission.requestId,
    kind,
    sourceLabel:
      toSingleLine(permission.sourceLabel, 80) ||
      (permission.sourceKind === "subagent" ? "Subagent" : "Main agent"),
    sourceKind: permission.sourceKind === "subagent" ? "subagent" : "main",
    pathPatterns,
    metadata,
    failureMessage:
      toSingleLine(permission.failureMessage, 140) ||
      "Permission request expired before response.",
  };
};

const parseQuestionPrompts = (questions: unknown[]): QuestionWizardPrompt[] => {
  return questions
    .map((item, index) => {
      const record = isRecord(item) ? item : {};
      const options = Array.isArray(record.options)
        ? record.options
            .map((option) => {
              const optionRecord = isRecord(option) ? option : null;
              const rawValueCandidate =
                optionRecord &&
                (typeof optionRecord.value === "string" ||
                  typeof optionRecord.value === "number" ||
                  typeof optionRecord.value === "boolean")
                  ? String(optionRecord.value)
                  : optionRecord &&
                      (typeof optionRecord.id === "string" ||
                        typeof optionRecord.id === "number" ||
                        typeof optionRecord.id === "boolean")
                    ? String(optionRecord.id)
                    : typeof option === "string" ||
                        typeof option === "number" ||
                        typeof option === "boolean"
                      ? String(option)
                      : optionRecord &&
                          (typeof optionRecord.label === "string" ||
                            typeof optionRecord.label === "number" ||
                            typeof optionRecord.label === "boolean")
                        ? String(optionRecord.label)
                        : "";
              const rawValue = rawValueCandidate.trim();
              if (!rawValue) {
                return null;
              }
              const safeLabel =
                toSingleLine(optionRecord?.label, 80) ||
                (isOpaqueOptionRawValue(rawValue)
                  ? "Option"
                  : toSingleLine(rawValue, 80) || "Option");
              return {
                label: safeLabel,
                value: rawValue,
                description: toSingleLine(optionRecord?.description, 180) || "",
              };
            })
            .filter(
              (option): option is QuestionWizardPrompt["options"][number] =>
                option !== null,
            )
        : [];

      const question =
        toSingleLine(record.question, 300) || `Question ${index + 1}`;
      const header = toSingleLine(record.header, 80) || `Question ${index + 1}`;
      const multiple = record.multiple === true;
      const custom = record.custom === true || options.length === 0;

      return {
        question,
        header,
        options,
        multiple,
        custom,
      };
    })
    .filter((prompt): prompt is QuestionWizardPrompt => Boolean(prompt));
};

const parseQuestionCardData = (
  question: UiQuestionRequest,
): {
  requestId: string;
  sourceLabel: string;
  sourceKind: "main" | "subagent";
  prompts: QuestionWizardPrompt[];
  failureMessage: string;
} => {
  return {
    requestId: question.requestId,
    sourceLabel:
      toSingleLine(question.sourceLabel, 80) ||
      (question.sourceKind === "subagent" ? "Subagent" : "Main agent"),
    sourceKind: question.sourceKind === "subagent" ? "subagent" : "main",
    prompts: parseQuestionPrompts(question.questions),
    failureMessage:
      toSingleLine(question.failureMessage, 140) ||
      "Question request expired before response.",
  };
};

type QuestionComposerTakeoverProps = {
  card: NonNullable<ReturnType<typeof parseQuestionCardData>>;
  queuedCount: number;
  isReplying: boolean;
  replyError: string;
  onReply: (
    requestId: string,
    answers: string[][],
  ) => Promise<boolean> | boolean;
  onReject: (requestId: string) => Promise<boolean> | boolean;
};

const QuestionComposerTakeover: Component<QuestionComposerTakeoverProps> = (
  props,
) => {
  const [activeStepIndex, setActiveStepIndex] = createSignal(0);
  const [draftRequestId, setDraftRequestId] = createSignal("");
  const [isActionInFlight, setIsActionInFlight] = createSignal(false);
  const [draftAnswersByQuestionIndex, setDraftAnswersByQuestionIndex] =
    createSignal<QuestionWizardDraftAnswer[]>([]);
  const hasReviewStep = createMemo(() => props.card.prompts.length > 1);

  createEffect(() => {
    if (draftRequestId() === props.card.requestId) {
      return;
    }
    setDraftRequestId(props.card.requestId);
    setActiveStepIndex(0);
    setDraftAnswersByQuestionIndex(
      createEmptyQuestionWizardDrafts(props.card.prompts.length),
    );
  });

  const reviewStepIndex = createMemo(() =>
    hasReviewStep() ? props.card.prompts.length : -1,
  );
  const isReviewStep = createMemo(
    () => hasReviewStep() && activeStepIndex() === reviewStepIndex(),
  );
  const currentPrompt = createMemo(
    () => props.card.prompts[activeStepIndex()] ?? null,
  );
  const currentDraft = createMemo(() =>
    getQuestionWizardDraft(draftAnswersByQuestionIndex(), activeStepIndex()),
  );
  const finalAnswers = createMemo(() =>
    buildQuestionWizardFinalAnswers(
      props.card.prompts,
      draftAnswersByQuestionIndex(),
    ),
  );
  const reviewSummary = createMemo(() =>
    buildQuestionWizardConfirmSummary(
      props.card.prompts,
      draftAnswersByQuestionIndex(),
    ),
  );
  const isQuestionComplete = (index: number): boolean => {
    const prompt = props.card.prompts[index];
    return prompt
      ? isQuestionWizardPromptComplete(
          prompt,
          getQuestionWizardDraft(draftAnswersByQuestionIndex(), index),
        )
      : false;
  };
  const isAllComplete = createMemo(() =>
    isQuestionWizardComplete(props.card.prompts, draftAnswersByQuestionIndex()),
  );
  const maxUnlockedQuestionStep = createMemo(() => {
    for (let index = 0; index < props.card.prompts.length; index += 1) {
      if (!isQuestionComplete(index)) {
        return index;
      }
    }
    return props.card.prompts.length;
  });
  const canOpenStep = (targetStepIndex: number): boolean => {
    if (targetStepIndex <= activeStepIndex()) {
      return true;
    }
    if (hasReviewStep() && targetStepIndex === reviewStepIndex()) {
      return isAllComplete();
    }
    return targetStepIndex <= maxUnlockedQuestionStep();
  };
  const stepValidationError = createMemo(() => {
    if (isReviewStep()) {
      return isAllComplete() ? "" : "Answer every question before sending.";
    }
    return currentPrompt() && isQuestionComplete(activeStepIndex())
      ? ""
      : "Answer this step before continuing.";
  });

  const updateDraftAt = (
    index: number,
    updater: (draft: QuestionWizardDraftAnswer) => QuestionWizardDraftAnswer,
  ) => {
    setDraftAnswersByQuestionIndex((current) => {
      const next = [...current];
      while (next.length <= index) {
        next.push({
          selectedOptionValues: [],
          useCustomAnswer: false,
          customText: "",
        });
      }
      next[index] = updater(getQuestionWizardDraft(next, index));
      return next;
    });
  };

  const progressLabel = createMemo(() => {
    if (isReviewStep()) {
      return "Review answers";
    }
    return `Question ${activeStepIndex() + 1} of ${props.card.prompts.length}`;
  });
  const currentQuestionKey = createMemo(
    () => `${props.card.requestId}:${activeStepIndex()}`,
  );
  const isInteractionLocked = createMemo(
    () => props.isReplying || isActionInFlight(),
  );
  const runGuardedAction = async (
    action: () => Promise<boolean> | boolean,
  ): Promise<void> => {
    if (isInteractionLocked()) {
      return;
    }
    setIsActionInFlight(true);
    try {
      await action();
    } finally {
      setIsActionInFlight(false);
    }
  };

  return (
    <section
      class="run-chat-tool-rail border-base-content/10 bg-base-100 relative z-10 overflow-hidden rounded-none border shadow-sm"
      aria-label="Question composer takeover"
    >
      <div class="bg-base-100 space-y-4 p-4">
        <div class="border-base-content/10 bg-base-100 space-y-2 border-b pb-3">
          <div class="run-chat-tool-rail__row">
            <span class="run-chat-tool-rail__line">
              {toSingleLine(props.card.prompts[0]?.header, 80) ||
                "Question request"}
            </span>
          </div>
          <div class="text-base-content/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tracking-[0.18em] uppercase">
            <span>{progressLabel()}</span>
            <span>Source: {props.card.sourceLabel}</span>
          </div>
          <Show when={props.queuedCount > 0}>
            <p class="text-base-content/70 text-xs">
              {props.queuedCount} more question request
              {props.queuedCount === 1 ? "" : "s"} queued.
            </p>
          </Show>
        </div>

        <div class="bg-base-100 flex flex-wrap gap-2">
          <For each={props.card.prompts}>
            {(prompt, promptIndex) => (
              <button
                type="button"
                class={`rounded-none border px-3 py-1 text-xs font-medium ${
                  activeStepIndex() === promptIndex()
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : isQuestionComplete(promptIndex())
                      ? "border-base-content/20 bg-base-100 text-base-content"
                      : "border-base-content/10 bg-base-100 text-base-content/55"
                }`}
                disabled={isInteractionLocked() || !canOpenStep(promptIndex())}
                onClick={() => setActiveStepIndex(promptIndex())}
              >
                {promptIndex() + 1}. {prompt.header}
              </button>
            )}
          </For>
          <Show when={hasReviewStep()}>
            <button
              type="button"
              class={`rounded-none border px-3 py-1 text-xs font-medium ${
                isReviewStep()
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-base-content/10 bg-base-100 text-base-content/55"
              }`}
              disabled={
                isInteractionLocked() || !canOpenStep(reviewStepIndex())
              }
              onClick={() => setActiveStepIndex(reviewStepIndex())}
            >
              Review
            </button>
          </Show>
        </div>

        <Show
          when={!isReviewStep() && currentPrompt()}
          fallback={
            <div class="border-base-content/10 bg-base-100 space-y-3 border p-4">
              <p class="text-sm font-semibold">Review answers</p>
              <For each={reviewSummary()}>
                {(item, summaryIndex) => (
                  <div class="border-base-content/10 bg-base-100 border px-3 py-3">
                    <div class="flex items-start justify-between gap-3">
                      <div class="space-y-1">
                        <p class="text-sm font-semibold">{item.header}</p>
                        <p class="text-base-content/70 text-xs">
                          {item.question}
                        </p>
                        <p class="text-base-content text-sm">
                          {item.answers.length > 0
                            ? item.answers.join(", ")
                            : "No answer yet"}
                        </p>
                      </div>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs rounded-none px-2"
                        disabled={isInteractionLocked()}
                        onClick={() => setActiveStepIndex(summaryIndex())}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          }
        >
          {(prompt) => (
            <Show keyed when={currentQuestionKey()}>
              {() => {
                const isOptionChecked = (value: string) =>
                  currentDraft().selectedOptionValues.includes(value);
                const isCustomEnabled = () => prompt().custom;
                const isCustomChecked = () =>
                  isCustomEnabled() && currentDraft().useCustomAnswer;

                return (
                  <div class="border-base-content/10 bg-base-100 space-y-4 border p-4">
                    <div class="space-y-1">
                      <p class="text-sm font-semibold">{prompt().header}</p>
                      <p class="text-base-content/90 text-sm leading-6">
                        {prompt().question}
                      </p>
                    </div>

                    <div class="space-y-2">
                      <For each={prompt().options}>
                        {(option) => {
                          const checked = () => isOptionChecked(option.value);
                          return (
                            <button
                              type="button"
                              aria-label={option.label}
                              data-checked={checked() ? "true" : "false"}
                              class={`flex w-full items-start gap-3 rounded-none border px-3 py-3 text-left transition-colors ${
                                checked()
                                  ? "border-primary/50 bg-base-100"
                                  : "border-base-content/10 bg-base-100 hover:border-base-content/25 hover:bg-base-100"
                              }`}
                              disabled={isInteractionLocked()}
                              onClick={() => {
                                updateDraftAt(activeStepIndex(), (draft) =>
                                  toggleQuestionWizardOption(
                                    prompt(),
                                    draft,
                                    option.value,
                                  ),
                                );
                              }}
                            >
                              <span
                                class={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${
                                  checked()
                                    ? "border-primary bg-primary text-primary-content"
                                    : "border-base-content/30 bg-base-100"
                                }`}
                                aria-hidden="true"
                              >
                                <Show when={checked()}>✓</Show>
                              </span>
                              <span>
                                <span class="block text-sm font-medium">
                                  {option.label}
                                </span>
                                <Show when={option.description.length > 0}>
                                  <span class="text-base-content/70 mt-1 block text-xs">
                                    {option.description}
                                  </span>
                                </Show>
                              </span>
                            </button>
                          );
                        }}
                      </For>

                      <Show when={isCustomEnabled()}>
                        <button
                          type="button"
                          aria-label="Type your own answer"
                          data-checked={isCustomChecked() ? "true" : "false"}
                          class={`flex w-full items-start gap-3 rounded-none border px-3 py-3 text-left transition-colors ${
                            isCustomChecked()
                              ? "border-primary/50 bg-base-100"
                              : "border-base-content/10 bg-base-100 hover:border-base-content/25 hover:bg-base-100"
                          }`}
                          disabled={isInteractionLocked()}
                          onClick={() => {
                            updateDraftAt(activeStepIndex(), (draft) =>
                              toggleQuestionWizardCustomAnswer(prompt(), draft),
                            );
                          }}
                        >
                          <span
                            class={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${
                              isCustomChecked()
                                ? "border-primary bg-primary text-primary-content"
                                : "border-base-content/30 bg-base-100"
                            }`}
                            aria-hidden="true"
                          >
                            <Show when={isCustomChecked()}>✓</Show>
                          </span>
                          <span class="block text-sm font-medium">
                            Type your own answer
                          </span>
                        </button>
                      </Show>
                    </div>

                    <Show when={isCustomEnabled() && isCustomChecked()}>
                      <div class="bg-base-100 space-y-2">
                        <label
                          class="text-base-content/60 text-xs font-semibold tracking-[0.18em] uppercase"
                          for={`question-answer-${props.card.requestId}-${activeStepIndex()}`}
                        >
                          Your answer
                        </label>
                        <textarea
                          id={`question-answer-${props.card.requestId}-${activeStepIndex()}`}
                          class="textarea textarea-bordered bg-base-100 min-h-[96px] w-full rounded-none text-sm leading-6"
                          value={currentDraft().customText}
                          placeholder="Type your answer"
                          disabled={isInteractionLocked()}
                          rows={4}
                          onInput={(event) => {
                            updateDraftAt(activeStepIndex(), (draft) =>
                              updateQuestionWizardCustomText(
                                draft,
                                event.currentTarget.value,
                              ),
                            );
                          }}
                        />
                        <p class="text-base-content/60 text-xs">
                          Type your own answer if none of the options fit.
                        </p>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </Show>
          )}
        </Show>

        <Show
          when={stepValidationError().length > 0 || props.replyError.length > 0}
        >
          <div class="bg-base-100">
            <p
              class={
                props.replyError.length > 0
                  ? "projects-error"
                  : "project-placeholder-text"
              }
            >
              {props.replyError.length > 0
                ? props.replyError
                : stepValidationError()}
            </p>
          </div>
        </Show>

        <div class="border-base-content/10 bg-base-100 flex items-center justify-between gap-2 border-t pt-3">
          <button
            type="button"
            class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
            disabled={isInteractionLocked()}
            onClick={() => {
              void runGuardedAction(() => props.onReject(props.card.requestId));
            }}
          >
            {isInteractionLocked() ? "Sending..." : "Dismiss"}
          </button>
          <div class="flex items-center gap-2">
            <Show when={hasReviewStep() || activeStepIndex() > 0}>
              <button
                type="button"
                class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                disabled={isInteractionLocked() || activeStepIndex() === 0}
                onClick={() =>
                  setActiveStepIndex(Math.max(0, activeStepIndex() - 1))
                }
              >
                Back
              </button>
            </Show>
            <Show
              when={!isReviewStep()}
              fallback={
                <button
                  type="button"
                  class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                  disabled={isInteractionLocked() || !isAllComplete()}
                  onClick={() => {
                    void runGuardedAction(() =>
                      props.onReply(props.card.requestId, finalAnswers()),
                    );
                  }}
                >
                  {isInteractionLocked() ? "Sending..." : "Send answer"}
                </button>
              }
            >
              <button
                type="button"
                class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                disabled={
                  isInteractionLocked() ||
                  !isQuestionComplete(activeStepIndex())
                }
                onClick={() => {
                  if (!hasReviewStep()) {
                    void runGuardedAction(() =>
                      props.onReply(props.card.requestId, finalAnswers()),
                    );
                    return;
                  }
                  setActiveStepIndex(activeStepIndex() + 1);
                }}
              >
                {!hasReviewStep()
                  ? "Send answer"
                  : activeStepIndex() === props.card.prompts.length - 1
                    ? "Review answers"
                    : "Next"}
              </button>
            </Show>
          </div>
        </div>
      </div>
    </section>
  );
};

const toToolLabel = (toolName: string | null | undefined): string => {
  const raw = toolName?.trim();
  if (!raw) {
    return "Tool";
  }

  const leaf = raw.includes(".")
    ? (() => {
        const segments = raw.split(".");
        return segments[segments.length - 1] || raw;
      })()
    : raw;
  const normalized = leaf.replace(/[-_]+/g, " ").trim();
  if (normalized.length === 0) {
    return "Tool";
  }

  return normalized
    .split(/\s+/)
    .map(
      (segment: string) => segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join(" ");
};

const buildToolSummary = (
  part: UiPart,
  displayContext: ToolPathDisplayContext,
): string => {
  if (part.kind !== "tool") {
    return "";
  }

  const toolName = toToolLabel(part.toolName);
  const normalizedToolName = (part.toolName || "").trim().toLowerCase();
  const input = part.input;
  const include = toSingleLine(getNestedValueByKeys(input, ["include"]), 60);

  const rawPath = toSingleLineWithoutTruncation(
    getNestedValueByKeys(input, ["filePath", "path", "filename"]),
  );
  const asPath = rawPath
    ? normalizeToolPathForDisplay(rawPath, displayContext)
    : null;
  const asCommand = toSingleLine(
    getNestedValueByKeys(input, ["command", "bash", "script", "cmd"]),
  );
  const asUrl = toSingleLine(getNestedValueByKeys(input, ["url", "href"]));
  const asQuery = toSingleLine(
    getNestedValueByKeys(input, ["query", "searchQuery", "q", "keywords"]),
  );
  const asPattern = toSingleLine(
    getNestedValueByKeys(input, ["pattern", "glob"]),
  );
  const asHeader = toSingleLine(getNestedValueByKeys(input, ["header"]));

  let focused =
    toSingleLine(part.title) ||
    asCommand ||
    asUrl ||
    asPath ||
    asQuery ||
    asPattern ||
    asHeader;

  if (normalizedToolName.includes("read") && asPath) {
    focused = asPath;
  } else if (normalizedToolName.includes("bash") && asCommand) {
    focused = asCommand;
  } else if (normalizedToolName.includes("webfetch") && asUrl) {
    focused = asUrl;
  } else if (normalizedToolName.includes("websearch") && asQuery) {
    focused = asQuery;
  } else if (normalizedToolName.includes("glob") && asPattern) {
    focused = asPattern;
  } else if (normalizedToolName.includes("grep")) {
    const grepPattern = asPattern;
    if (grepPattern && include) {
      focused = `${grepPattern} in ${include}`;
    } else if (grepPattern) {
      focused = grepPattern;
    }
  } else if (normalizedToolName.includes("question") && asHeader) {
    focused = asHeader;
  } else if (normalizedToolName.includes("todowrite")) {
    const todos = getNestedValueByKeys(input, ["todos"]);
    if (Array.isArray(todos)) {
      const firstTodo = todos[0];
      const firstText = toSingleLine(
        isRecord(firstTodo)
          ? firstTodo.content || firstTodo.text || firstTodo.title
          : firstTodo,
      );
      focused =
        firstText || `${todos.length} todo${todos.length === 1 ? "" : "s"}`;
    }
  } else if (normalizedToolName.includes("apply_patch")) {
    const patchText = toSingleLine(
      getNestedValueByKeys(input, ["patchText"]),
      4000,
    );
    if (patchText) {
      const matches = patchText.match(/\*\*\*\s(?:Add|Update|Delete)\sFile:/g);
      focused =
        matches && matches.length > 0
          ? `${matches.length} file${matches.length === 1 ? "" : "s"}`
          : "patch";
    }
  } else if (normalizedToolName.includes("background_task")) {
    focused =
      toSingleLine(getNestedValueByKeys(input, ["description", "task"])) ||
      focused;
  } else if (normalizedToolName.includes("background_output")) {
    focused =
      toSingleLine(getNestedValueByKeys(input, ["task_id", "taskId"])) ||
      focused;
  } else if (normalizedToolName.includes("background_cancel")) {
    focused =
      toSingleLine(getNestedValueByKeys(input, ["task_id", "target"])) ||
      (getNestedValueByKeys(input, ["all"]) === true ? "all tasks" : focused);
  } else if (normalizedToolName.includes("lsp_")) {
    focused =
      toSingleLineWithoutTruncation(
        getNestedValueByKeys(input, ["filePath", "newName", "line"]),
      ) || focused;
    if (focused) {
      focused = normalizeToolPathForDisplay(focused, displayContext);
    }
  } else if (normalizedToolName.includes("ast_grep_")) {
    focused = toSingleLine(getNestedValueByKeys(input, ["pattern"])) || focused;
  }

  if (normalizedToolName === "task") {
    return focused || "~ Delegating...";
  }

  return `-> ${toolName}${focused ? ` ${focused}` : ""}`;
};

const NewRunChatWorkspace: Component<NewRunChatWorkspaceProps> = (props) => {
  const [composerValue, setComposerValue] = createSignal("");
  const [hasVisibleSubmitFailed, setHasVisibleSubmitFailed] =
    createSignal(false);
  const [
    isInitialTranscriptAnchorCompleted,
    setIsInitialTranscriptAnchorCompleted,
  ] = createSignal(false);
  const [transcriptVisibleCount, setTranscriptVisibleCount] = createSignal(
    TRANSCRIPT_WINDOW_CHUNK,
  );
  const [runChatComposerOffsetPx, setRunChatComposerOffsetPx] =
    createSignal("0px");
  const [isTranscriptNearBottom, setIsTranscriptNearBottom] =
    createSignal(true);
  const [transcriptLayoutRevision, setTranscriptLayoutRevision] =
    createSignal(0);
  const [overrideAgentId, setOverrideAgentId] = createSignal("");
  const [overrideProviderId, setOverrideProviderId] = createSignal("");
  const [overrideModelId, setOverrideModelId] = createSignal("");
  const [fetchedSubagentHistories, setFetchedSubagentHistories] = createSignal<
    Record<string, SubagentHistorySnapshot>
  >({});
  const [
    composerSelectionValidationError,
    setComposerSelectionValidationError,
  ] = createSignal("");

  let transcriptScrollRef: HTMLDivElement | undefined;
  let runChatComposerRef: HTMLDivElement | undefined;
  let transcriptContentRef: HTMLDivElement | undefined;
  let initialTranscriptAnchorRaf: number | null = null;
  let initialTranscriptAnchorVerificationRaf: number | null = null;
  let transcriptBottomSentinelRef: HTMLDivElement | undefined;

  const agentReadinessPhase = createMemo<AgentReadinessPhase>(() =>
    props.model.agent.readinessPhase(),
  );
  const pendingPrompt = createMemo(
    () => props.model.agent.pendingPrompt?.() ?? null,
  );
  const chatSessionHealth = createMemo<ChatSessionHealth>(() => {
    const reportedHealth = props.model.agent.sessionHealth?.();
    if (reportedHealth) {
      return reportedHealth;
    }

    if (props.model.agent.isSubmittingPrompt()) {
      return "sending";
    }

    return "idle";
  });
  const visibleAgentReadinessPhase = createMemo<AgentReadinessPhase>(() => {
    if (hasVisibleSubmitFailed()) {
      const phase = agentReadinessPhase();
      if (phase !== "ready") {
        return "submit_failed";
      }
    }

    return agentReadinessPhase();
  });
  const agentReadinessCopy = createMemo<string | null>(() => {
    switch (visibleAgentReadinessPhase()) {
      case "warming_backend":
        return "Warming backend.";
      case "creating_session":
        return "Creating session.";
      case "ready":
        return "Ready.";
      case "reconnecting":
        return "Reconnecting stream.";
      case "submit_failed":
        return "Submit failed.";
      default:
        return null;
    }
  });
  const isComposerBlockedByReadiness = createMemo(() => {
    const phase = visibleAgentReadinessPhase();
    return (
      phase === "warming_backend" ||
      phase === "creating_session" ||
      phase === "reconnecting" ||
      chatSessionHealth() === "reconnecting" ||
      chatSessionHealth() === "unresponsive"
    );
  });
  const isTranscriptWaitingForAgentOutput = createMemo(() => {
    const phase = agentReadinessPhase();
    return (
      props.model.agent.state() === "starting" ||
      phase === "warming_backend" ||
      phase === "creating_session" ||
      phase === "reconnecting"
    );
  });
  const isRunCompleted = createMemo(() =>
    hasCompletedRunStatus(props.model.run()?.status),
  );
  const isReadOnlyChatMode = createMemo(
    () => props.model.agent.chatMode?.() === "read_only",
  );
  const mergedSourceBranchLabel = createMemo(() => {
    const branch = props.model.run()?.sourceBranch?.trim();
    return branch && branch.length > 0 ? branch : "branch unavailable";
  });
  const runAgentOptions = createMemo(
    () => props.model.agent.runAgentOptions?.() ?? [],
  );
  const runProviderOptions = createMemo(
    () => props.model.agent.runProviderOptions?.() ?? [],
  );
  const runModelOptions = createMemo(
    () => props.model.agent.runModelOptions?.() ?? [],
  );
  const runSelectionOptionsError = createMemo(
    () => props.model.agent.runSelectionOptionsError?.() ?? "",
  );
  const projectDefaultAgentId = createMemo(
    () => props.model.agent.projectDefaultRunAgentId?.().trim() || "",
  );
  const projectDefaultProviderId = createMemo(
    () => props.model.agent.projectDefaultRunProviderId?.().trim() || "",
  );
  const projectDefaultModelId = createMemo(
    () => props.model.agent.projectDefaultRunModelId?.().trim() || "",
  );
  const runDefaultAgentId = createMemo(
    () => props.model.run()?.agentId?.trim() || projectDefaultAgentId(),
  );
  const runDefaultProviderId = createMemo(
    () => props.model.run()?.providerId?.trim() || projectDefaultProviderId(),
  );
  const runDefaultModelId = createMemo(
    () => props.model.run()?.modelId?.trim() || projectDefaultModelId(),
  );
  const hasRunSelectionOptions = createMemo(() => {
    return (
      runAgentOptions().length > 0 ||
      runProviderOptions().length > 0 ||
      runModelOptions().length > 0
    );
  });
  const inferredProviderIdFromModel = (modelId: string): string => {
    if (!modelId) {
      return "";
    }
    const selectedModel = runModelOptions().find(
      (option) => option.id === modelId,
    );
    return selectedModel?.providerId?.trim() || "";
  };
  const resolveProviderModelSelection = (preferences: {
    providerId?: string;
    modelId?: string;
  }): { providerId: string; modelId: string } => {
    const providers = runProviderOptions();
    const models = runModelOptions();
    const preferredProviderId = preferences.providerId?.trim() || "";
    const preferredModelId = preferences.modelId?.trim() || "";
    const preferredModel = preferredModelId
      ? models.find((option) => option.id === preferredModelId)
      : undefined;

    if (preferredProviderId && preferredModelId) {
      if (
        doesModelMatchProvider(preferredModelId, preferredProviderId) &&
        providers.some((option) => option.id === preferredProviderId) &&
        models.some((option) => option.id === preferredModelId)
      ) {
        return { providerId: preferredProviderId, modelId: preferredModelId };
      }
    }

    if (preferredProviderId) {
      const providerExists = providers.some(
        (option) => option.id === preferredProviderId,
      );
      if (providerExists) {
        const providerModel = models.find(
          (option) =>
            !option.providerId || option.providerId === preferredProviderId,
        );
        if (providerModel) {
          return { providerId: preferredProviderId, modelId: providerModel.id };
        }
      }
    }

    if (preferredModel && preferredModel.id) {
      const modelProviderId = preferredModel.providerId?.trim() || "";
      if (
        !modelProviderId ||
        providers.some((option) => option.id === modelProviderId)
      ) {
        return { providerId: modelProviderId, modelId: preferredModel.id };
      }
    }

    for (const provider of providers) {
      const providerModel = models.find(
        (option) => !option.providerId || option.providerId === provider.id,
      );
      if (providerModel) {
        return { providerId: provider.id, modelId: providerModel.id };
      }
    }

    const firstModel = models[0];
    if (firstModel) {
      return {
        providerId: firstModel.providerId?.trim() || "",
        modelId: firstModel.id,
      };
    }

    return { providerId: "", modelId: "" };
  };
  const selectedProviderId = createMemo(() => {
    const explicitProvider = overrideProviderId().trim();
    if (explicitProvider) {
      const exists = runProviderOptions().some(
        (option) => option.id === explicitProvider,
      );
      if (exists) {
        return explicitProvider;
      }
    }

    const explicitModelProvider = inferredProviderIdFromModel(
      overrideModelId().trim(),
    );
    if (
      explicitModelProvider &&
      runProviderOptions().some((option) => option.id === explicitModelProvider)
    ) {
      return explicitModelProvider;
    }

    const persistedProvider = runDefaultProviderId();
    if (
      persistedProvider &&
      runProviderOptions().some((option) => option.id === persistedProvider)
    ) {
      return persistedProvider;
    }

    const persistedModelProvider =
      inferredProviderIdFromModel(runDefaultModelId());
    if (
      persistedModelProvider &&
      runProviderOptions().some(
        (option) => option.id === persistedModelProvider,
      )
    ) {
      return persistedModelProvider;
    }

    return runProviderOptions()[0]?.id || "";
  });
  const effectiveProviderForModel = createMemo(() => {
    return selectedProviderId();
  });
  const visibleRunModelOptions = createMemo(() => {
    const providerId = effectiveProviderForModel();
    if (!providerId) {
      return runModelOptions();
    }
    return runModelOptions().filter(
      (option) => !option.providerId || option.providerId === providerId,
    );
  });
  const doesModelMatchProvider = (
    modelId: string,
    providerId: string,
  ): boolean => {
    if (!modelId || !providerId) {
      return true;
    }

    const selectedModel = runModelOptions().find(
      (option) => option.id === modelId,
    );
    if (!selectedModel || !selectedModel.providerId) {
      return true;
    }

    return selectedModel.providerId === providerId;
  };
  const selectedModelId = createMemo(() => {
    const explicitModelId = overrideModelId().trim();
    if (
      explicitModelId &&
      doesModelMatchProvider(explicitModelId, effectiveProviderForModel())
    ) {
      return explicitModelId;
    }

    const persistedModelId = runDefaultModelId();
    if (
      persistedModelId &&
      doesModelMatchProvider(persistedModelId, effectiveProviderForModel()) &&
      visibleRunModelOptions().some((option) => option.id === persistedModelId)
    ) {
      return persistedModelId;
    }

    return visibleRunModelOptions()[0]?.id || "";
  });
  const selectedAgentId = createMemo(() => {
    const explicitAgent = overrideAgentId().trim();
    if (
      explicitAgent &&
      runAgentOptions().some((option) => option.id === explicitAgent)
    ) {
      return explicitAgent;
    }

    const persistedAgent = runDefaultAgentId();
    if (
      persistedAgent &&
      runAgentOptions().some((option) => option.id === persistedAgent)
    ) {
      return persistedAgent;
    }

    return runAgentOptions()[0]?.id || "";
  });
  const pendingQuestionRequests = createMemo(() => {
    const state = props.model.agent.questionState?.();
    return state?.activeRequest ? [state.activeRequest] : [];
  });
  const queuedQuestionRequests = createMemo(() => {
    return props.model.agent.questionState?.().queuedRequests ?? [];
  });
  const pendingQuestionCards = createMemo(() => {
    return pendingQuestionRequests().map((question) =>
      parseQuestionCardData(question),
    );
  });
  const failedQuestionCards = createMemo(() => {
    return (
      props.model.agent
        .questionState?.()
        .failedRequests.map((question) => parseQuestionCardData(question)) ?? []
    );
  });
  const hasPendingQuestion = createMemo(
    () => pendingQuestionRequests().length > 0,
  );
  const pendingPermissionRequests = createMemo(() => {
    const state = props.model.agent.permissionState();
    return state.activeRequest ? [state.activeRequest] : [];
  });
  const queuedPermissionRequests = createMemo(() => {
    return props.model.agent.permissionState().queuedRequests;
  });
  const pendingPermissionCards = createMemo(() => {
    return pendingPermissionRequests().map((permission) =>
      parsePermissionCardData(permission),
    );
  });
  const failedPermissionCards = createMemo(() => {
    return props.model.agent
      .permissionState()
      .failedRequests.map((permission) => parsePermissionCardData(permission));
  });
  const hasPendingPermission = createMemo(
    () => pendingPermissionRequests().length > 0,
  );
  const activeQuestionCard = createMemo(
    () => pendingQuestionCards()[0] ?? null,
  );

  const setupState = createMemo(() => {
    const state = props.model.run()?.setupState?.trim().toLowerCase();
    if (state === "running" || state === "succeeded" || state === "failed") {
      return state;
    }
    return "pending";
  });
  const setupMessage = createMemo(() => {
    if (setupState() === "running") return "Running setup script...";
    if (setupState() === "succeeded") return "Setup script completed.";
    if (setupState() === "failed") {
      return (
        props.model.run()?.setupErrorMessage?.trim() ||
        "Setup script failed. Please fix it before you continue."
      );
    }
    return "Setup script pending.";
  });
  const cleanupState = createMemo(() => {
    const state = props.model.run()?.cleanupState?.trim().toLowerCase();
    if (state === "running" || state === "succeeded" || state === "failed") {
      return state;
    }
    return "pending";
  });
  const cleanupMessage = createMemo(() => {
    if (cleanupState() === "running") return "Running cleanup script...";
    if (cleanupState() === "succeeded") return "Cleanup script completed.";
    if (cleanupState() === "failed") {
      return "Cleanup script failed. Please investigate.";
    }
    return "Cleanup script pending.";
  });
  const emptyTranscriptMessage = createMemo(() => {
    if (isReadOnlyChatMode()) {
      return "No chat history is available for this completed run.";
    }
    if (props.model.agent.state() === "unsupported") {
      return "Agent stream is not available for this run.";
    }
    return agentReadinessCopy() ?? "No agent messages yet.";
  });

  const transcriptMessageOrder = createMemo(
    () => props.model.agent.store().messageOrder,
  );

  const transcriptHiddenMessageCount = createMemo(() => {
    return Math.max(
      0,
      transcriptMessageOrder().length - transcriptVisibleCount(),
    );
  });

  const visibleTranscriptMessageIds = createMemo(() => {
    const order = transcriptMessageOrder();
    const startIndex = Math.max(0, order.length - transcriptVisibleCount());
    return order.slice(startIndex);
  });
  const hasLoadedInitialTranscriptHistory = createMemo(() => {
    const store = props.model.agent.store();
    return (
      store.lastSyncAt !== null ||
      props.model.agent.state() === "unsupported" ||
      props.model.agent.state() === "error"
    );
  });

  const formatAgentPayload = (payload: unknown): string => {
    if (payload === undefined) {
      return "undefined";
    }

    try {
      const serialized = JSON.stringify(
        payload,
        (_key, value) =>
          typeof value === "string"
            ? value.replace(INTERNAL_ID_PATTERN, "[internal-id]")
            : value,
        2,
      );
      if (typeof serialized === "string") {
        return serialized;
      }
    } catch {}

    if (typeof payload === "string") {
      return payload.replace(INTERNAL_ID_PATTERN, "[internal-id]");
    }

    return String(payload);
  };

  const formatAgentTimestamp = (value: string | number | null): string => {
    if (value === null) {
      return "Unavailable";
    }

    let normalizedValue: string;
    if (typeof value === "number") {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return String(value);
      }
      normalizedValue = parsed.toISOString();
    } else {
      normalizedValue = value;
    }

    const formatted = formatDateTime(normalizedValue);
    return formatted === "Unavailable" ? String(value) : formatted;
  };

  const resolvePartText = (
    part: UiPart,
    displayContext: ToolPathDisplayContext,
  ): string => {
    if (part.kind !== "text" && part.kind !== "reasoning") {
      return "";
    }

    return resolveTranscriptPartText(part, displayContext);
  };

  const toolPathDisplayContext = createMemo<ToolPathDisplayContext>(() => ({
    worktreeId: props.model.run()?.worktreeId,
    targetRepositoryPath: props.model.task()?.targetRepositoryPath,
  }));

  const taskPartSessionIdsByPartId = createMemo(() => {
    const mapping: Record<string, string[]> = {};
    const rootSessionId = props.model.agent.store().sessionId;
    for (const message of Object.values(
      props.model.agent.store().messagesById,
    )) {
      for (const partId of message.partOrder) {
        const part = message.partsById[partId];
        if (!part) {
          continue;
        }
        const sessionIds = extractTaskSubagentSessionIds(part, rootSessionId);
        if (sessionIds.length > 0) {
          mapping[part.id] = sessionIds;
        }
      }
    }
    return mapping;
  });

  createEffect(() => {
    const runId = props.model.run()?.id;
    if (!runId) {
      return;
    }

    const histories = fetchedSubagentHistories();
    const sessionIds = Array.from(
      new Set(Object.values(taskPartSessionIdsByPartId()).flat()),
    );

    for (const sessionId of sessionIds) {
      if (histories[sessionId]) {
        continue;
      }

      void Promise.all([
        getRunOpenCodeSessionMessages({ runId, sessionId }),
        getRunOpenCodeSessionTodos({ runId, sessionId }),
      ])
        .then(([messagesResult, todosResult]) => {
          const hydrated = hydrateAgentStore({
            sessionId,
            messages: messagesResult.messages,
            todos: todosResult.todos,
          });
          setFetchedSubagentHistories((current) => ({
            ...current,
            [sessionId]: { sessionId, store: hydrated },
          }));
        })
        .catch(() => undefined);
    }
  });

  const subagentPanelsByTaskPartId = createMemo(() => {
    return buildSubagentPanels(
      props.model.agent.store().rawEvents ?? [],
      props.model.agent.store().sessionId,
      props.model.agent.store().messagesById,
      toolPathDisplayContext(),
      taskPartSessionIdsByPartId(),
      fetchedSubagentHistories(),
    );
  });

  const getStepDetailsSummary = (part: UiPart): string | null => {
    if (part.kind === "step-start") {
      const snapshot = formatAgentPayload(part.snapshot).trim();
      return snapshot.length > 0 ? `Step started: ${snapshot}` : "Step started";
    }

    if (part.kind === "step-finish") {
      const fields = [
        part.reason !== undefined
          ? `reason=${formatAgentPayload(part.reason)}`
          : null,
        part.tokens !== undefined
          ? `tokens=${formatAgentPayload(part.tokens)}`
          : null,
        part.cost !== undefined
          ? `cost=${formatAgentPayload(part.cost)}`
          : null,
      ].filter((value): value is string => value !== null);
      return fields.length > 0
        ? `Step finished: ${fields.join(" | ")}`
        : "Step finished";
    }

    return null;
  };

  const buildChatRows = createMemo<ChatRow[]>(() => {
    return visibleTranscriptMessageIds()
      .map((messageId) => {
        const message = props.model.agent.store().messagesById[messageId];
        if (!message) {
          return null;
        }

        const textParts: UiTextPart[] = [];
        const reasoningParts: UiReasoningPart[] = [];
        const toolItems: RunChatToolRailItem[] = [];

        for (const partId of message.partOrder) {
          const part = message.partsById[partId];
          if (!part) {
            continue;
          }

          if (part.kind === "text") {
            const text = resolvePartText(part, toolPathDisplayContext());
            if (text.trim().length > 0 || part.streaming) {
              textParts.push(part);
            }
            continue;
          }

          if (part.kind === "reasoning") {
            const text = resolvePartText(part, toolPathDisplayContext());
            if (text.trim().length > 0 || part.streaming) {
              reasoningParts.push(part);
            }
            continue;
          }

          if (part.kind === "tool") {
            const summary = buildToolSummary(part, toolPathDisplayContext());
            const isTask = isTaskToolName(part.toolName);
            toolItems.push({
              id: part.id,
              label: part.title?.trim() || part.toolName || "Tool",
              summary,
              status: part.status,
              isTask,
              subagents: subagentPanelsByTaskPartId()[part.id] ?? [],
            });
            continue;
          }

          if (part.kind === "patch") {
            continue;
          }

          if (part.kind === "file") {
            continue;
          }

          const stepSummary = getStepDetailsSummary(part);
          if (stepSummary) {
            continue;
          }

          if (part.kind === "unknown") {
            continue;
          }
        }

        const assistantStreaming =
          message.role === "assistant"
            ? buildAssistantStreamingMetadata(
                message.id,
                textParts,
                reasoningParts,
                toolPathDisplayContext(),
              )
            : undefined;
        const content = assistantStreaming
          ? assistantStreaming.targetText
          : textParts
              .map((part) => resolvePartText(part, toolPathDisplayContext()))
              .join("\n\n")
              .trim();
        const reasoningContent = assistantStreaming
          ? assistantStreaming.reasoningTargetText
          : reasoningParts
              .map((part) => resolvePartText(part, toolPathDisplayContext()))
              .join("\n\n")
              .trim();
        const timestamp = formatAgentTimestamp(
          message.updatedAt ?? message.createdAt ?? null,
        );

        return {
          key: message.id,
          role: message.role,
          content,
          reasoningContent,
          assistantStreaming,
          toolItems,
          timestamp,
          attributionLabel: formatMessageAttribution(message.attribution ?? {}),
          hasRenderableContent:
            (assistantStreaming?.hasVisibleContent ?? content.length > 0) ||
            (assistantStreaming?.reasoning.hasVisibleContent ??
              reasoningContent.length > 0) ||
            toolItems.length > 0,
        };
      })
      .filter((row): row is ChatRow => row !== null);
  });

  const chatTranscriptItems = createMemo<JSX.Element[]>(() => {
    const waitingRow = (
      <RunInlineLoader
        as="p"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />
    );

    const messageItems = buildChatRows().map((row) => {
      const reasoningNode =
        row.reasoningContent.length > 0 ? (
          <div class="run-chat-assistant-message__reasoning-inline">
            <RunChatMarkdown content={`*Thinking:* ${row.reasoningContent}`} />
          </div>
        ) : undefined;

      const toolRailNode =
        row.toolItems.length > 0 ? (
          <RunChatToolRail items={row.toolItems} />
        ) : undefined;
      const attributionNode =
        row.attributionLabel.length > 0 ? (
          <p class="run-chat-assistant-message__attribution">
            {row.attributionLabel}
          </p>
        ) : undefined;

      if (row.role === "assistant") {
        return (
          <div
            data-run-chat-message-id={row.key}
            data-run-chat-message-kind="parent"
          >
            <RunChatMessage role="assistant" class="run-chat-message-item">
              <RunChatAssistantMessage
                content={row.content.length > 0 ? row.content : " "}
                streaming={row.assistantStreaming}
                isStreamingActive={
                  row.assistantStreaming?.lifecycle === "streaming"
                }
                reasoning={reasoningNode}
                toolRail={toolRailNode}
                details={attributionNode}
              />
              <Show when={!row.hasRenderableContent}>{waitingRow}</Show>
            </RunChatMessage>
          </div>
        );
      }

      if (row.role === "user") {
        return (
          <div
            data-run-chat-message-id={row.key}
            data-run-chat-message-kind="parent"
          >
            <RunChatMessage role="user" class="run-chat-message-item">
              <RunChatUserMessage>
                <RunChatMarkdown
                  content={row.content.length > 0 ? row.content : "(empty)"}
                />
              </RunChatUserMessage>
            </RunChatMessage>
          </div>
        );
      }

      return (
        <div
          data-run-chat-message-id={row.key}
          data-run-chat-message-kind="parent"
        >
          <RunChatMessage role="system" class="run-chat-message-item">
            <RunChatSystemMessage>
              <RunChatMarkdown
                content={row.content.length > 0 ? row.content : row.timestamp}
              />
            </RunChatSystemMessage>
          </RunChatMessage>
        </div>
      );
    });

    const failedQuestionItems = failedQuestionCards().map((card) => {
      return (
        <RunChatMessage role="assistant">
          <section
            class="run-chat-tool-rail"
            aria-label="Question request failed tool item"
          >
            <ul class="run-chat-tool-rail__list">
              <li class="run-chat-tool-rail__item run-chat-tool-rail__item--failed">
                <div class="run-chat-tool-rail__row">
                  <span class="run-chat-tool-rail__line">Question pending</span>
                  <span class="run-chat-tool-rail__status">
                    <span
                      class="run-chat-tool-rail__status-slot"
                      aria-label="failed"
                    >
                      <AppIcon
                        name="status.error"
                        class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--error"
                        aria-hidden="true"
                        size={14}
                      />
                      <span class="sr-only">failed</span>
                    </span>
                  </span>
                </div>
                <p class="run-chat-tool-rail__details">
                  <strong>Source:</strong> {card.sourceLabel}
                </p>
                <p class="run-chat-tool-rail__details">{card.failureMessage}</p>
              </li>
            </ul>
          </section>
        </RunChatMessage>
      );
    });

    const pendingPermissionItems = pendingPermissionCards().map((card) => {
      return (
        <RunChatMessage
          role="assistant"
          class="run-chat-message-item"
          ariaLabel="Permission request"
        >
          <RunChatAssistantMessage
            content=" "
            toolRail={
              <section
                class="run-chat-tool-rail"
                aria-label="Permission request tool item"
              >
                <ul class="run-chat-tool-rail__list">
                  <li class="run-chat-tool-rail__item run-chat-tool-rail__item--running">
                    <div class="run-chat-tool-rail__row">
                      <span class="run-chat-tool-rail__line">
                        Permission required: {card.kind}
                      </span>
                    </div>
                    <p class="run-chat-tool-rail__details">
                      <strong>Source:</strong> {card.sourceLabel}
                    </p>
                    <Show
                      when={card.pathPatterns.length > 0}
                      fallback={
                        <p class="run-chat-tool-rail__details">
                          <strong>Paths:</strong> Any path
                        </p>
                      }
                    >
                      <div class="run-chat-tool-rail__details">
                        <strong>Paths:</strong>
                        <ul class="list-disc pl-5">
                          <For each={card.pathPatterns}>
                            {(pattern) => <li>{pattern}</li>}
                          </For>
                        </ul>
                      </div>
                    </Show>
                    <Show when={card.metadata.length > 0}>
                      <div class="run-chat-tool-rail__details">
                        <strong>Details:</strong>
                        <ul class="list-disc pl-5">
                          <For each={card.metadata}>
                            {(entry) => (
                              <li>
                                {entry.key}: {entry.value}
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    </Show>
                    <Show when={queuedPermissionRequests().length > 0}>
                      <p class="run-chat-tool-rail__details">
                        {queuedPermissionRequests().length} more permission
                        request
                        {queuedPermissionRequests().length === 1
                          ? ""
                          : "s"}{" "}
                        queued. They will appear after this one is resolved.
                      </p>
                    </Show>
                    <Show
                      when={props.model.agent.permissionReplyError().length > 0}
                    >
                      <p class="projects-error">
                        {props.model.agent.permissionReplyError()}
                      </p>
                    </Show>
                    <div class="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                        disabled={props.model.agent.isReplyingPermission()}
                        onClick={() => {
                          console.info("[runs] permission decision clicked", {
                            runId: props.model.run()?.id ?? null,
                            requestId: card.requestId,
                            decision: "deny",
                            pendingCount: pendingPermissionCards().length,
                          });
                          void props.model.agent.replyPermission(
                            card.requestId,
                            "deny",
                          );
                        }}
                      >
                        {props.model.agent.isReplyingPermission()
                          ? "Sending..."
                          : "Deny"}
                      </button>
                      <button
                        type="button"
                        class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                        disabled={props.model.agent.isReplyingPermission()}
                        onClick={() => {
                          console.info("[runs] permission decision clicked", {
                            runId: props.model.run()?.id ?? null,
                            requestId: card.requestId,
                            decision: "once",
                            pendingCount: pendingPermissionCards().length,
                          });
                          void props.model.agent.replyPermission(
                            card.requestId,
                            "once",
                          );
                        }}
                      >
                        {props.model.agent.isReplyingPermission()
                          ? "Sending..."
                          : "Allow once"}
                      </button>
                      <button
                        type="button"
                        class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                        disabled={props.model.agent.isReplyingPermission()}
                        onClick={() => {
                          console.info("[runs] permission decision clicked", {
                            runId: props.model.run()?.id ?? null,
                            requestId: card.requestId,
                            decision: "always",
                            pendingCount: pendingPermissionCards().length,
                          });
                          void props.model.agent.replyPermission(
                            card.requestId,
                            "always",
                          );
                        }}
                      >
                        {props.model.agent.isReplyingPermission()
                          ? "Sending..."
                          : "Allow"}
                      </button>
                    </div>
                  </li>
                </ul>
              </section>
            }
          />
        </RunChatMessage>
      );
    });

    const failedPermissionItems = failedPermissionCards().map((card) => {
      return (
        <RunChatMessage role="assistant">
          <section
            class="run-chat-tool-rail"
            aria-label="Permission request failed tool item"
          >
            <ul class="run-chat-tool-rail__list">
              <li class="run-chat-tool-rail__item run-chat-tool-rail__item--failed">
                <div class="run-chat-tool-rail__row">
                  <span class="run-chat-tool-rail__line">
                    Permission required: {card.kind}
                  </span>
                  <span class="run-chat-tool-rail__status">
                    <span
                      class="run-chat-tool-rail__status-slot"
                      aria-label="failed"
                    >
                      <AppIcon
                        name="status.error"
                        class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--error"
                        aria-hidden="true"
                        size={14}
                      />
                      <span class="sr-only">failed</span>
                    </span>
                  </span>
                </div>
                <p class="run-chat-tool-rail__details">
                  <strong>Source:</strong> {card.sourceLabel}
                </p>
                <p class="run-chat-tool-rail__details">{card.failureMessage}</p>
                <Show
                  when={card.pathPatterns.length > 0}
                  fallback={
                    <p class="run-chat-tool-rail__details">
                      <strong>Paths:</strong> Any path
                    </p>
                  }
                >
                  <div class="run-chat-tool-rail__details">
                    <strong>Paths:</strong>
                    <ul class="list-disc pl-5">
                      <For each={card.pathPatterns}>
                        {(pattern) => <li>{pattern}</li>}
                      </For>
                    </ul>
                  </div>
                </Show>
              </li>
            </ul>
          </section>
        </RunChatMessage>
      );
    });

    const pendingPromptItem = pendingPrompt();
    const optimisticPromptItem = pendingPromptItem ? (
      <RunChatMessage
        role="user"
        class="run-chat-message-item"
        ariaLabel="Pending message"
      >
        <RunChatUserMessage>
          <div class="space-y-2">
            <RunChatMarkdown content={pendingPromptItem.text} />
            <p class="run-chat-user-message__status">
              {pendingPromptItem.status === "failed"
                ? "Send failed"
                : chatSessionHealth() === "reconnecting"
                  ? "Reconnecting…"
                  : "Sending…"}
            </p>
            <Show when={pendingPromptItem.status === "failed"}>
              <div class="run-chat-user-message__actions">
                <button
                  type="button"
                  class="run-chat-user-message__action"
                  onClick={() => {
                    void props.model.agent.retryPendingPrompt?.();
                  }}
                >
                  Retry send
                </button>
                <button
                  type="button"
                  class="run-chat-user-message__action"
                  onClick={() => {
                    void props.model.agent.reconnectSession?.();
                  }}
                >
                  Reconnect
                </button>
              </div>
            </Show>
          </div>
        </RunChatUserMessage>
      </RunChatMessage>
    ) : null;

    const sessionStatusItem =
      chatSessionHealth() === "reconnecting" ||
      chatSessionHealth() === "unresponsive" ? (
        <RunChatMessage
          role="system"
          class="run-chat-message-item"
          ariaLabel="Chat connection status"
        >
          <RunChatSystemMessage>
            <div class="flex w-full flex-wrap items-center justify-between gap-3">
              <span>
                {chatSessionHealth() === "reconnecting"
                  ? "Chat session became unresponsive. Reconnecting…"
                  : "Chat session is unresponsive. Reconnect to recover without restarting the app."}
              </span>
              <Show when={chatSessionHealth() === "unresponsive"}>
                <button
                  type="button"
                  class="btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-3 text-[11px] font-medium"
                  onClick={() => {
                    void props.model.agent.reconnectSession?.();
                  }}
                >
                  Reconnect chat
                </button>
              </Show>
            </div>
          </RunChatSystemMessage>
        </RunChatMessage>
      ) : null;

    return [
      ...messageItems,
      ...(optimisticPromptItem ? [optimisticPromptItem] : []),
      ...failedQuestionItems,
      ...pendingPermissionItems,
      ...failedPermissionItems,
      ...(sessionStatusItem ? [sessionStatusItem] : []),
    ];
  });

  createEffect(() => {
    if (transcriptMessageOrder().length === 0) {
      setTranscriptVisibleCount(TRANSCRIPT_WINDOW_CHUNK);
    }
  });

  const cancelInitialTranscriptAnchorFrames = () => {
    if (initialTranscriptAnchorRaf !== null) {
      cancelAnimationFrame(initialTranscriptAnchorRaf);
      initialTranscriptAnchorRaf = null;
    }

    if (initialTranscriptAnchorVerificationRaf !== null) {
      cancelAnimationFrame(initialTranscriptAnchorVerificationRaf);
      initialTranscriptAnchorVerificationRaf = null;
    }
  };

  const getTranscriptDistanceFromBottom = (): number => {
    const container = transcriptScrollRef;
    if (!container) {
      return 0;
    }

    return Math.max(
      0,
      container.scrollHeight - container.clientHeight - container.scrollTop,
    );
  };

  const isNearTranscriptBottom = (): boolean => {
    return (
      getTranscriptDistanceFromBottom() <= TRANSCRIPT_NEAR_BOTTOM_THRESHOLD
    );
  };

  const syncTranscriptNearBottom = () => {
    setIsTranscriptNearBottom(isNearTranscriptBottom());
  };

  const scrollTranscriptToBottom = (behavior: ScrollBehavior = "auto") => {
    const container = transcriptScrollRef;
    if (!container) {
      return;
    }

    const targetTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: targetTop, behavior });
      return;
    }

    container.scrollTop = targetTop;
  };

  createEffect(
    on(
      () => props.model.run()?.id,
      () => {
        cancelInitialTranscriptAnchorFrames();
        setTranscriptVisibleCount(TRANSCRIPT_WINDOW_CHUNK);
        setIsTranscriptNearBottom(true);
        setIsInitialTranscriptAnchorCompleted(false);
      },
    ),
  );

  createEffect(() => {
    const phase = agentReadinessPhase();
    if (phase === "submit_failed") {
      setHasVisibleSubmitFailed(true);
      return;
    }

    if (phase === "ready") {
      setHasVisibleSubmitFailed(false);
    }
  });

  createEffect(() => {
    const modelId = overrideModelId().trim();
    if (!modelId) {
      return;
    }

    const providerId = effectiveProviderForModel();
    if (!doesModelMatchProvider(modelId, providerId)) {
      setOverrideModelId("");
    }
  });

  createEffect(() => {
    if (isInitialTranscriptAnchorCompleted()) {
      return;
    }

    const container = transcriptScrollRef;
    if (!container || !hasLoadedInitialTranscriptHistory()) {
      return;
    }

    const transcriptItems = chatTranscriptItems();
    const transcriptItemCount = transcriptItems.length;
    transcriptVisibleCount();
    runChatComposerOffsetPx();
    transcriptLayoutRevision();

    if (transcriptItemCount === 0) {
      setIsInitialTranscriptAnchorCompleted(true);
      setIsTranscriptNearBottom(true);
      return;
    }

    if (!transcriptBottomSentinelRef) {
      return;
    }

    cancelInitialTranscriptAnchorFrames();

    const attemptAnchor = (attempt: number) => {
      initialTranscriptAnchorRaf = requestAnimationFrame(() => {
        initialTranscriptAnchorRaf = null;
        if (!transcriptScrollRef || !transcriptBottomSentinelRef) {
          return;
        }

        scrollTranscriptToBottom("auto");
        syncTranscriptNearBottom();

        initialTranscriptAnchorVerificationRaf = requestAnimationFrame(() => {
          initialTranscriptAnchorVerificationRaf = null;
          if (!transcriptScrollRef) {
            return;
          }

          if (isNearTranscriptBottom()) {
            setIsTranscriptNearBottom(true);
            setIsInitialTranscriptAnchorCompleted(true);
            return;
          }

          if (attempt + 1 >= INITIAL_TRANSCRIPT_ANCHOR_MAX_ATTEMPTS) {
            scrollTranscriptToBottom("auto");
            const nearBottom = isNearTranscriptBottom();
            setIsTranscriptNearBottom(nearBottom);
            setIsInitialTranscriptAnchorCompleted(nearBottom);
            return;
          }

          attemptAnchor(attempt + 1);
        });
      });
    };

    attemptAnchor(0);
  });

  createEffect(() => {
    chatTranscriptItems();
    transcriptVisibleCount();
    runChatComposerOffsetPx();
    transcriptLayoutRevision();

    const wasNearBottomBeforeUpdate = isTranscriptNearBottom();

    requestAnimationFrame(() => {
      if (wasNearBottomBeforeUpdate) {
        scrollTranscriptToBottom("auto");
      }
      syncTranscriptNearBottom();
    });
  });

  createEffect(() => {
    const hasTranscriptItems = chatTranscriptItems().length > 0;
    const transcriptContent = transcriptContentRef;
    if (
      !hasTranscriptItems ||
      !transcriptContent ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setTranscriptLayoutRevision((current) => current + 1);
      syncTranscriptNearBottom();
    });
    observer.observe(transcriptContent);

    onCleanup(() => {
      observer.disconnect();
    });
  });

  const onTranscriptScroll = () => {
    syncTranscriptNearBottom();
  };

  const jumpToLatestTranscript = () => {
    scrollTranscriptToBottom("smooth");
    requestAnimationFrame(() => {
      syncTranscriptNearBottom();
    });
  };

  createEffect(() => {
    const composerElement = runChatComposerRef;
    if (!composerElement || typeof ResizeObserver === "undefined") {
      setRunChatComposerOffsetPx("0px");
      return;
    }

    const updateOffset = () => {
      const composerHeight = Math.ceil(
        composerElement.getBoundingClientRect().height,
      );
      setRunChatComposerOffsetPx(`${Math.max(0, composerHeight)}px`);
    };

    updateOffset();
    const observer = new ResizeObserver(() => updateOffset());
    observer.observe(composerElement);

    onCleanup(() => {
      observer.disconnect();
    });
  });

  onCleanup(() => {
    cancelInitialTranscriptAnchorFrames();
  });

  const shouldShowJumpToBottom = createMemo(() => {
    return chatTranscriptItems().length > 0 && !isTranscriptNearBottom();
  });

  return (
    <section
      class="run-detail-workspace run-chat-only-workspace"
      aria-label="Run chat workspace"
    >
      <section
        class="run-chat-workspace"
        style={{
          "--run-chat-composer-offset": runChatComposerOffsetPx(),
        }}
      >
        <section
          classList={{
            "run-chat-transcript-scroll": true,
            "run-chat-transcript-scroll--scrollbar-hidden":
              props.hideTranscriptScrollbar === true,
          }}
          aria-label="Conversation transcript"
          ref={transcriptScrollRef}
          onScroll={onTranscriptScroll}
          style={{
            "padding-bottom": runChatComposerOffsetPx(),
          }}
        >
          <Show when={props.model.agent.error().length > 0}>
            <p class="projects-error">{props.model.agent.error()}</p>
          </Show>
          <section
            class="run-setup-status-box"
            data-state={setupState()}
            aria-live="polite"
          >
            <strong>Setup</strong>
            <p>{setupMessage()}</p>
          </section>
          <Show when={cleanupState() !== "pending"}>
            <section
              class="run-cleanup-status-box"
              data-state={cleanupState()}
              aria-live="polite"
            >
              <strong>Cleanup</strong>
              <p>{cleanupMessage()}</p>
            </section>
          </Show>
          <Show
            when={chatTranscriptItems().length > 0}
            fallback={
              <section
                class="run-chat-transcript run-chat-transcript--empty-state"
                aria-label="Chat transcript"
              >
                <Show
                  when={
                    !isReadOnlyChatMode() && isTranscriptWaitingForAgentOutput()
                  }
                  fallback={
                    <p class="project-placeholder-text">
                      {emptyTranscriptMessage()}
                    </p>
                  }
                >
                  <RunInlineLoader
                    as="p"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  />
                </Show>
              </section>
            }
          >
            <div ref={transcriptContentRef}>
              <RunChatTranscript
                class="run-chat-transcript"
                items={chatTranscriptItems()}
                olderAffordance={
                  <Show when={transcriptHiddenMessageCount() > 0}>
                    <button
                      type="button"
                      class="run-detail-load-older-button run-chat-load-older"
                      onClick={() => {
                        const container = transcriptScrollRef;
                        const previousScrollHeight =
                          container?.scrollHeight ?? null;
                        setTranscriptVisibleCount(
                          (current) => current + TRANSCRIPT_WINDOW_CHUNK,
                        );
                        if (!container || previousScrollHeight === null) {
                          return;
                        }

                        requestAnimationFrame(() => {
                          const nextScrollHeight = container.scrollHeight;
                          const offset =
                            nextScrollHeight - previousScrollHeight;
                          if (offset > 0) {
                            container.scrollTop += offset;
                          }
                        });
                      }}
                    >
                      {`Load older (${transcriptHiddenMessageCount()} hidden)`}
                    </button>
                  </Show>
                }
              />
              <div
                ref={transcriptBottomSentinelRef}
                class="run-chat-transcript__bottom-sentinel"
                aria-hidden="true"
              />
            </div>
          </Show>
        </section>
        <Show when={shouldShowJumpToBottom()}>
          <div class="run-chat-transcript-jump-wrap">
            <button
              type="button"
              class="run-chat-transcript-jump"
              aria-label="Jump to latest chat content"
              onClick={() => jumpToLatestTranscript()}
            >
              <AppIcon name="nav.down" size={14} aria-hidden="true" />
            </button>
          </div>
        </Show>
        <div
          ref={runChatComposerRef}
          class="run-chat-composer-shell run-chat-composer-shell--pinned"
        >
          <Show
            when={!isRunCompleted()}
            fallback={
              <section
                class="run-chat-composer run-chat-composer--readonly"
                role="status"
                aria-live="polite"
              >
                <p class="project-placeholder-text">
                  {`Work completed and merged into ${mergedSourceBranchLabel()}. You can review the chat, but it can’t be edited.`}
                </p>
              </section>
            }
          >
            <Show
              when={activeQuestionCard()}
              fallback={
                <RunChatComposer
                  class="run-chat-composer"
                  value={composerValue()}
                  onInput={setComposerValue}
                  onSubmit={(value) => {
                    void (async () => {
                      const agentId = selectedAgentId();
                      const providerId = selectedProviderId();
                      const modelId = selectedModelId();
                      const hasValidSelection =
                        !!agentId &&
                        !!providerId &&
                        !!modelId &&
                        doesModelMatchProvider(modelId, providerId);

                      if (!hasValidSelection) {
                        setComposerSelectionValidationError(
                          "Select a valid agent, provider, and model before sending.",
                        );
                        return;
                      }

                      setComposerSelectionValidationError("");
                      if (chatSessionHealth() === "unresponsive") {
                        const recovered =
                          (await props.model.agent.reconnectSession?.()) ??
                          false;
                        if (!recovered) {
                          return;
                        }
                      }
                      const success = await props.model.agent.submitPrompt(
                        value,
                        {
                          agentId,
                          providerId,
                          modelId,
                        },
                      );
                      if (success) {
                        setComposerValue("");
                      }
                    })();
                  }}
                  disabled={
                    hasPendingPermission() ||
                    isComposerBlockedByReadiness() ||
                    props.model.agent.state() === "unsupported" ||
                    props.model.agent.isReplyingPermission()
                  }
                  submitting={props.model.agent.isSubmittingPrompt()}
                  placeholder="What do you want to do?"
                  textareaLabel="Message agent"
                  submitLabel="Send"
                />
              }
            >
              {(card) => (
                <QuestionComposerTakeover
                  card={card()}
                  queuedCount={queuedQuestionRequests().length}
                  isReplying={props.model.agent.isReplyingQuestion?.() ?? false}
                  replyError={props.model.agent.questionReplyError?.() ?? ""}
                  onReply={(requestId, answers) =>
                    props.model.agent.replyQuestion?.(requestId, answers) ??
                    false
                  }
                  onReject={(requestId) =>
                    props.model.agent.rejectQuestion?.(requestId) ?? false
                  }
                />
              )}
            </Show>
          </Show>
          <Show
            when={
              !isRunCompleted() &&
              !activeQuestionCard() &&
              hasRunSelectionOptions()
            }
          >
            <div class="run-chat-override-grid mt-2 gap-2">
              <label class="projects-field run-chat-override-field">
                <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                  <span class="field-label-text">Provider</span>
                </span>
                <select
                  class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
                  value={selectedProviderId()}
                  onChange={(event) => {
                    const nextProviderId = event.currentTarget.value;
                    setOverrideProviderId(nextProviderId);
                    setComposerSelectionValidationError("");
                    const currentModelId = selectedModelId();
                    if (
                      currentModelId &&
                      !doesModelMatchProvider(currentModelId, nextProviderId)
                    ) {
                      setOverrideModelId("");
                    }
                  }}
                  aria-label="Prompt override provider"
                >
                  <For each={runProviderOptions()}>
                    {(option: { id: string; label: string }) => (
                      <option value={option.id}>{option.label}</option>
                    )}
                  </For>
                </select>
              </label>
              <label class="projects-field run-chat-override-field">
                <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                  <span class="field-label-text">Model</span>
                </span>
                <select
                  class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
                  value={selectedModelId()}
                  onChange={(event) => {
                    const selectedModelId = event.currentTarget.value;
                    setOverrideModelId(selectedModelId);
                    setComposerSelectionValidationError("");

                    if (!selectedModelId) {
                      return;
                    }

                    const selectedModel = runModelOptions().find(
                      (option) => option.id === selectedModelId,
                    );
                    const selectedProviderId =
                      selectedModel?.providerId?.trim();
                    if (selectedProviderId) {
                      setOverrideProviderId(selectedProviderId);
                    }
                  }}
                  aria-label="Prompt override model"
                >
                  <For each={visibleRunModelOptions()}>
                    {(option: { id: string; label: string }) => (
                      <option value={option.id}>{option.label}</option>
                    )}
                  </For>
                </select>
              </label>
              <label class="projects-field run-chat-override-field">
                <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                  <span class="field-label-text">Agent</span>
                </span>
                <select
                  class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
                  value={selectedAgentId()}
                  onChange={(event) => {
                    const nextAgentId = event.currentTarget.value;
                    setOverrideAgentId(nextAgentId);
                    setComposerSelectionValidationError("");

                    const resolvedFromProject = resolveProviderModelSelection({
                      providerId: projectDefaultProviderId(),
                      modelId: projectDefaultModelId(),
                    });
                    const resolved =
                      resolvedFromProject.providerId &&
                      resolvedFromProject.modelId
                        ? resolvedFromProject
                        : resolveProviderModelSelection({
                            providerId: runDefaultProviderId(),
                            modelId: runDefaultModelId(),
                          });

                    setOverrideProviderId(resolved.providerId);
                    setOverrideModelId(resolved.modelId);
                  }}
                  aria-label="Prompt override agent"
                >
                  <RunAgentSelectOptions options={runAgentOptions()} />
                </select>
              </label>
            </div>
          </Show>
          <Show
            when={!isRunCompleted() && runSelectionOptionsError().length > 0}
          >
            <p class="project-placeholder-text" aria-live="polite">
              {runSelectionOptionsError()}
            </p>
          </Show>
          <Show
            when={
              !isRunCompleted() && composerSelectionValidationError().length > 0
            }
          >
            <p class="projects-error" aria-live="polite">
              {composerSelectionValidationError()}
            </p>
          </Show>
          <Show when={hasPendingPermission()}>
            <p class="project-placeholder-text" aria-live="polite">
              Prompt submission is blocked until this permission is answered.
            </p>
          </Show>
          <Show
            when={
              !hasPendingQuestion() &&
              props.model.agent.questionReplyError?.().length > 0
            }
          >
            <p class="projects-error">
              {props.model.agent.questionReplyError?.()}
            </p>
          </Show>
          <Show
            when={
              !hasPendingQuestion() &&
              !hasPendingPermission() &&
              props.model.agent.permissionReplyError().length > 0
            }
          >
            <p class="projects-error">
              {props.model.agent.permissionReplyError()}
            </p>
          </Show>
          <Show when={props.model.agent.submitError().length > 0}>
            <p class="projects-error">{props.model.agent.submitError()}</p>
          </Show>
        </div>
      </section>
    </section>
  );
};

export default NewRunChatWorkspace;
