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
} from "solid-js";
import {
  RunChatComposer,
  RunChatTranscript,
  type RunChatTranscriptHandle,
  type RunChatTranscriptRow,
  type RunChatToolRailItem,
  type RunChatToolRailSubagentEntry,
  type RunChatToolRailSubagentItem,
} from "./chat";
import RunAgentSelectOptions from "./RunAgentSelectOptions";
import type {
  AgentRole,
  AgentStore,
  OpenCodeBusEvent,
  UiAssistantStreamChannelMetadata,
  UiAssistantStreamingMetadata,
  UiPart,
  UiPermissionRequest,
  UiQuestionRequest,
  UiReasoningPart,
  UiStreamChunkNode,
  UiTextPart,
} from "../model/agentTypes";
import { hydrateAgentStore } from "../model/agentReducer";
import { buildMergedSubagentMessageStore } from "../model/subagentMessageTimeline";
import { useRunDetailModel } from "../model/useRunDetailModel";
import { formatDateTime } from "../../tasks/utils/taskDetail";
import { AppIcon } from "../../../components/ui/icons";
import RunInlineLoader from "../../../components/ui/RunInlineLoader";
import {
  getRunOpenCodeSessionMessagesPage,
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
import {
  buildSubagentSessionAssignments,
  buildTaskPartSessionIdsByPartId,
  isTaskToolName,
  type SubagentSessionAssignmentSnapshot,
  type SubagentTaskAssignmentSource,
} from "./subagentTaskAssignment";

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
  role: AgentRole;
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
  let cursor: UiStreamChunkNode | undefined = tail;
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
      streamTail: undefined,
      streamText: undefined,
      streamTextLength: incomingText.length,
      streamRevision: nextStreamRevision > 0 ? nextStreamRevision : undefined,
      raw: rawPart,
    };
  }

  if (delta.length > 0) {
    const nextStreamText =
      (existingTypedPart?.streamText ?? existingStreamBaseText) + delta;
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
      streamText: nextStreamText,
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

const TRANSCRIPT_NEAR_BOTTOM_THRESHOLD = 96;
const INITIAL_TRANSCRIPT_ANCHOR_MAX_ATTEMPTS = 6;
const OLDER_TRANSCRIPT_RESTORE_MAX_ATTEMPTS = 12;
const MAX_SUBAGENT_HISTORY_PAGES = 100;
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

const normalizeToSingleLine = (value: unknown): string | null => {
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

  return normalized;
};

const toSingleLine = (value: unknown, maxLength = 140): string | null => {
  const normalized = normalizeToSingleLine(value);
  if (normalized === null) {
    return null;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`;
};

const toSingleLineWithoutTruncation = (value: unknown): string | null =>
  normalizeToSingleLine(value);

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

type SubagentSessionSnapshot = {
  sessionId: string;
  parentSessionId: string | null;
  parentMessageId: string | null;
  assignedTaskPartId: string | null;
  assignmentSource: SubagentTaskAssignmentSource | null;
  assignmentConfidence: number;
  assignmentProvisional: boolean;
  status: string;
  title: string | null;
  agentType: string | null;
  model: string | null;
  liveEvents: OpenCodeBusEvent[];
};

type SubagentHistorySnapshot = {
  sessionId: string;
  store: AgentStore;
};

type FetchedSubagentHistorySnapshot = SubagentHistorySnapshot | null;

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

const buildSubagentEntriesFromStore = (
  store: AgentStore,
  displayContext: ToolPathDisplayContext,
) => {
  const latestMessageId =
    store.messageOrder[store.messageOrder.length - 1] ?? null;

  return store.messageOrder.flatMap<RunChatToolRailSubagentEntry>(
    (messageId) => {
      const message = store.messagesById[messageId];
      if (!message) {
        return [];
      }

      const textParts: UiTextPart[] = [];
      const reasoningParts: UiReasoningPart[] = [];
      const entries: RunChatToolRailSubagentEntry[] = [];

      for (const partId of message.partOrder) {
        const part = message.partsById[partId];
        if (!part) continue;
        if (part.kind === "text") {
          const text = resolveTranscriptPartText(part, displayContext);
          const content = text.trim();
          textParts.push(part);
          if (content.length > 0) {
            entries.push({
              id: `${message.id}:${part.id}:text`,
              kind: "text",
              messageId: message.id,
              role: message.role,
              content,
              assistantStreaming:
                message.role === "assistant"
                  ? buildAssistantStreamingMetadata(
                      message.id,
                      [part],
                      [],
                      displayContext,
                    )
                  : undefined,
              isStreaming: part.streaming,
              streamToken:
                message.role === "assistant"
                  ? undefined
                  : `${message.id}:${part.id}:${part.streaming ? "streaming" : "static"}:${content.length}`,
            });
          }
          continue;
        }
        if (part.kind === "reasoning") {
          const text = resolveTranscriptPartText(part, displayContext);
          const content = text.trim();
          reasoningParts.push(part);
          if (content.length > 0) {
            entries.push({
              id: `${message.id}:${part.id}:reasoning`,
              kind: "reasoning",
              messageId: message.id,
              role: message.role,
              content,
              isStreaming: part.streaming,
              streamToken: `${message.id}:${part.id}:${part.streaming ? "streaming" : "static"}:${content.length}`,
            });
          }
          continue;
        }
        if (part.kind === "tool") {
          entries.push({
            id: `${message.id}:${part.id}:tool`,
            kind: "tool",
            messageId: message.id,
            role: message.role,
            toolItem: {
              id: part.id,
              summary: buildToolSummary(part, displayContext),
              status: part.status,
            },
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
      const hasPendingAssistantTextContent =
        textParts.length > 0 || reasoningParts.length > 0;

      if (
        entries.length === 0 &&
        message.role === "assistant" &&
        latestMessageId === message.id &&
        (message.partOrder.length === 0 ||
          hasPendingAssistantTextContent ||
          assistantStreaming?.isPlaceholderOnly)
      ) {
        entries.push({
          id: `${message.id}:placeholder`,
          kind: "assistant-placeholder",
          messageId: message.id,
          role: "assistant",
          isStreaming: true,
          streamToken:
            assistantStreaming?.streamToken ?? `${message.id}:placeholder`,
        });
      }

      return entries;
    },
  );
};

const buildSubagentPanels = (
  rawEvents: readonly OpenCodeBusEvent[],
  rootSessionId: string | null,
  displayContext: ToolPathDisplayContext,
  subagentAssignmentsBySessionId: Record<
    string,
    SubagentSessionAssignmentSnapshot
  >,
  fetchedSessionHistories: Record<string, FetchedSubagentHistorySnapshot>,
): Record<string, RunChatToolRailSubagentItem[]> => {
  const sessions = new Map<string, SubagentSessionSnapshot>();

  const syncSessionAssignment = (
    session: SubagentSessionSnapshot,
    sessionId: string,
  ): SubagentSessionSnapshot => {
    const assignment = subagentAssignmentsBySessionId[sessionId];
    if (!assignment) {
      return session;
    }

    session.parentSessionId =
      assignment.parentSessionId ?? session.parentSessionId;
    session.parentMessageId =
      assignment.parentMessageId ?? session.parentMessageId;
    session.assignedTaskPartId = assignment.assignedTaskPartId;
    session.assignmentSource = assignment.assignmentSource;
    session.assignmentConfidence = assignment.assignmentConfidence;
    session.assignmentProvisional = assignment.assignmentProvisional;
    return session;
  };

  const ensureSession = (sessionId: string): SubagentSessionSnapshot => {
    const existing = sessions.get(sessionId);
    if (existing) {
      return syncSessionAssignment(existing, sessionId);
    }

    const assignment = subagentAssignmentsBySessionId[sessionId];
    const created: SubagentSessionSnapshot = {
      sessionId,
      parentSessionId: assignment?.parentSessionId ?? null,
      parentMessageId: assignment?.parentMessageId ?? null,
      assignedTaskPartId: assignment?.assignedTaskPartId ?? null,
      assignmentSource: assignment?.assignmentSource ?? null,
      assignmentConfidence: assignment?.assignmentConfidence ?? 0,
      assignmentProvisional: assignment?.assignmentProvisional ?? true,
      status: "running",
      title: null,
      agentType: null,
      model: null,
      liveEvents: [],
    };
    sessions.set(sessionId, created);
    return syncSessionAssignment(created, sessionId);
  };

  for (const event of rawEvents) {
    const properties = getEventRecord(event.properties);
    const sessionId = getSessionIdentifier(properties);

    if (!sessionId) {
      continue;
    }

    if (rootSessionId && sessionId === rootSessionId) {
      continue;
    }

    const session = ensureSession(sessionId);

    if (event.type === "session.updated") {
      const info = getNestedRecord(properties, "info") ?? properties;
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

    if (event.type === "session.status") {
      const nextStatus = getStatusType(properties.status) || session.status;
      session.status = nextStatus;
      session.liveEvents.push(event);
      continue;
    }

    if (event.type === "message.updated") {
      const info = getNestedRecord(properties, "info") ?? properties;
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
      session.liveEvents.push(event);
      continue;
    }

    if (
      event.type === "message.removed" ||
      event.type === "message.part.updated" ||
      event.type === "message.part.delta" ||
      event.type === "message.part.removed"
    ) {
      session.liveEvents.push(event);
    }
  }

  for (const sessionId of Object.keys(subagentAssignmentsBySessionId)) {
    ensureSession(sessionId);
  }

  return Array.from(sessions.values()).reduce<
    Record<string, RunChatToolRailSubagentItem[]>
  >((acc, session) => {
    const taskPartId = session.assignedTaskPartId;
    if (!taskPartId) {
      return acc;
    }

    const fetchedSnapshot = fetchedSessionHistories[session.sessionId] ?? null;
    const mergedStore = buildMergedSubagentMessageStore({
      sessionId: session.sessionId,
      fetchedStore: fetchedSnapshot?.store ?? null,
      liveEvents: session.liveEvents,
    });
    const entries = buildSubagentEntriesFromStore(mergedStore, displayContext);
    const mergedHistoryMessages = mergedStore.messageOrder.flatMap(
      (messageId) => {
        const message = mergedStore.messagesById[messageId];
        return message ? [message] : [];
      },
    );
    const fallbackAgentType =
      session.agentType ||
      mergedHistoryMessages
        .map((message) => message.attribution?.agent?.trim() || "")
        .find(Boolean) ||
      null;
    const fallbackModel =
      session.model ||
      mergedHistoryMessages
        .map((message) => message.attribution?.model?.trim() || "")
        .find(Boolean) ||
      null;

    const subagent: RunChatToolRailSubagentItem = {
      id: session.sessionId,
      label: formatSubagentLabel(
        session.title,
        fallbackAgentType,
        fallbackModel,
        entries.some((entry) => entry.kind !== "assistant-placeholder"),
      ),
      status: session.status,
      entries,
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
          {(prompt) => {
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
  const [transcriptHandle, setTranscriptHandle] =
    createSignal<RunChatTranscriptHandle | null>(null);
  const [
    isInitialTranscriptAnchorCompleted,
    setIsInitialTranscriptAnchorCompleted,
  ] = createSignal(false);
  const [
    isRestoringOlderTranscriptAnchor,
    setIsRestoringOlderTranscriptAnchor,
  ] = createSignal(false);
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
    Record<string, FetchedSubagentHistorySnapshot>
  >({});
  const pendingSubagentHistorySessionIds = new Set<string>();
  const [
    composerSelectionValidationError,
    setComposerSelectionValidationError,
  ] = createSignal("");

  let transcriptScrollRef: HTMLDivElement | undefined;
  let runChatComposerRef: HTMLDivElement | undefined;
  let transcriptContentRef: HTMLDivElement | undefined;

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
  const hasLoadedInitialTranscriptHistory = createMemo(() => {
    const store = props.model.agent.store();
    return (
      store.lastSyncAt !== null ||
      props.model.agent.state() === "unsupported" ||
      props.model.agent.state() === "error"
    );
  });
  const canLoadOlderTranscript = createMemo(
    () => props.model.agent.history?.canLoadOlder?.() ?? false,
  );
  const isLoadingOlderTranscript = createMemo(
    () => props.model.agent.history?.isLoadingOlder?.() ?? false,
  );
  const transcriptHistoryError = createMemo(
    () => props.model.agent.history?.error?.() ?? "",
  );
  const transcriptVirtualizerLayoutToken = createMemo(() => {
    return [
      props.model.agent.error(),
      transcriptHistoryError(),
      setupState(),
      setupMessage(),
      cleanupState(),
      cleanupMessage(),
    ].join("|");
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
    return buildTaskPartSessionIdsByPartId(
      props.model.agent.store().messagesById,
      props.model.agent.store().rawEvents ?? [],
      props.model.agent.store().sessionId,
    );
  });

  const subagentSessionAssignments = createMemo(() => {
    return buildSubagentSessionAssignments(
      props.model.agent.store().rawEvents ?? [],
      props.model.agent.store().sessionId,
      props.model.agent.store().messagesById,
      taskPartSessionIdsByPartId(),
    );
  });

  createEffect(() => {
    const runId = props.model.run()?.id;
    if (!runId) {
      return;
    }

    const histories = fetchedSubagentHistories();
    const sessionIds = Object.values(subagentSessionAssignments())
      .filter((assignment) => assignment.assignedTaskPartId)
      .map((assignment) => assignment.sessionId);

    for (const sessionId of sessionIds) {
      if (histories[sessionId] !== undefined) {
        continue;
      }
      if (pendingSubagentHistorySessionIds.has(sessionId)) {
        continue;
      }

      pendingSubagentHistorySessionIds.add(sessionId);
      const loadSubagentMessages = async (): Promise<unknown[]> => {
        const pages: unknown[][] = [];
        const seenCursors = new Set<string>();
        let before: string | undefined;
        let pageCount = 0;

        while (pageCount < MAX_SUBAGENT_HISTORY_PAGES) {
          pageCount += 1;
          const page = await getRunOpenCodeSessionMessagesPage({
            runId,
            sessionId,
            ...(before ? { before } : {}),
          });
          pages.unshift(page.messages);

          if (!page.hasMore) {
            break;
          }

          const nextCursor =
            typeof page.nextCursor === "string" ? page.nextCursor.trim() : "";
          if (!nextCursor) {
            console.warn(
              "[runs] subagent history pagination stopped: missing next cursor",
              { runId, sessionId, pageCount },
            );
            break;
          }

          if (nextCursor === before || seenCursors.has(nextCursor)) {
            console.warn(
              "[runs] subagent history pagination stopped: repeated next cursor",
              { runId, sessionId, pageCount, nextCursor },
            );
            break;
          }

          if (pageCount >= MAX_SUBAGENT_HISTORY_PAGES) {
            console.warn(
              "[runs] subagent history pagination stopped: page limit reached",
              { runId, sessionId, pageCount: MAX_SUBAGENT_HISTORY_PAGES },
            );
            break;
          }

          seenCursors.add(nextCursor);
          before = nextCursor;
        }

        return pages.flat();
      };

      void Promise.all([
        loadSubagentMessages(),
        getRunOpenCodeSessionTodos({ runId, sessionId }),
      ])
        .then(([messages, todosResult]) => {
          const hydrated = hydrateAgentStore({
            sessionId,
            messages,
            todos: todosResult.todos,
          });
          setFetchedSubagentHistories((current) => ({
            ...current,
            [sessionId]: { sessionId, store: hydrated },
          }));
        })
        .catch(() => {
          setFetchedSubagentHistories((current) => ({
            ...current,
            [sessionId]: null,
          }));
        })
        .finally(() => {
          pendingSubagentHistorySessionIds.delete(sessionId);
        });
    }
  });

  const subagentPanelsByTaskPartId = createMemo(() => {
    return buildSubagentPanels(
      props.model.agent.store().rawEvents ?? [],
      props.model.agent.store().sessionId,
      toolPathDisplayContext(),
      subagentSessionAssignments(),
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
    return transcriptMessageOrder().reduce<ChatRow[]>((rows, messageId) => {
      const message = props.model.agent.store().messagesById[messageId];
      if (!message) {
        return rows;
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

      rows.push({
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
      });

      return rows;
    }, []);
  });

  const chatTranscriptRows = createMemo<RunChatTranscriptRow[]>(() => {
    const messageRows = buildChatRows().map<RunChatTranscriptRow>((row) => {
      if (row.role === "assistant") {
        return {
          key: `message:${row.key}`,
          kind: "assistant-message",
          messageId: row.key,
          messageKind: "parent",
          content: row.content,
          reasoningContent: row.reasoningContent,
          assistantStreaming: row.assistantStreaming,
          toolItems: row.toolItems,
          attributionLabel: row.attributionLabel,
          hasRenderableContent: row.hasRenderableContent,
        };
      }

      if (row.role === "user") {
        return {
          key: `message:${row.key}`,
          kind: "user-message",
          messageId: row.key,
          messageKind: "parent",
          content: row.content,
        };
      }

      return {
        key: `message:${row.key}`,
        kind: "system-message",
        messageId: row.key,
        messageKind: "parent",
        content: row.content.length > 0 ? row.content : row.timestamp,
      };
    });

    const failedQuestionRows = failedQuestionCards().map<RunChatTranscriptRow>(
      (card) => ({
        key: `failed-question:${card.requestId}`,
        kind: "failed-question",
        sourceLabel: card.sourceLabel,
        failureMessage: card.failureMessage,
      }),
    );

    const pendingPermissionRows =
      pendingPermissionCards().map<RunChatTranscriptRow>((card) => ({
        key: `pending-permission:${card.requestId}`,
        kind: "pending-permission",
        requestId: card.requestId,
        permissionKind: card.kind,
        sourceLabel: card.sourceLabel,
        pathPatterns: card.pathPatterns,
        metadata: card.metadata,
        queuedCount: queuedPermissionRequests().length,
        isReplying: props.model.agent.isReplyingPermission(),
        replyError: props.model.agent.permissionReplyError(),
        onDecision: (decision) => {
          console.info("[runs] permission decision clicked", {
            runId: props.model.run()?.id ?? null,
            requestId: card.requestId,
            decision,
            pendingCount: pendingPermissionCards().length,
          });
          void props.model.agent.replyPermission(card.requestId, decision);
        },
      }));

    const failedPermissionRows =
      failedPermissionCards().map<RunChatTranscriptRow>((card) => ({
        key: `failed-permission:${card.requestId}`,
        kind: "failed-permission",
        permissionKind: card.kind,
        sourceLabel: card.sourceLabel,
        pathPatterns: card.pathPatterns,
        failureMessage: card.failureMessage,
      }));

    const pendingPromptItem = pendingPrompt();
    const optimisticPromptRows = pendingPromptItem
      ? [
          {
            key: "pending-prompt",
            kind: "pending-prompt",
            text: pendingPromptItem.text,
            status:
              pendingPromptItem.status === "failed"
                ? "failed"
                : chatSessionHealth() === "reconnecting"
                  ? "reconnecting"
                  : "sending",
            onRetry: () => {
              void props.model.agent.retryPendingPrompt?.();
            },
            onReconnect: () => {
              void props.model.agent.reconnectSession?.();
            },
          } satisfies RunChatTranscriptRow,
        ]
      : [];

    const sessionHealth = chatSessionHealth();
    const sessionStatusRows =
      sessionHealth === "reconnecting" || sessionHealth === "unresponsive"
        ? [
            {
              key: "session-status",
              kind: "session-status",
              status: sessionHealth,
              onReconnect: () => {
                void props.model.agent.reconnectSession?.();
              },
            } satisfies RunChatTranscriptRow,
          ]
        : [];

    return [
      ...messageRows,
      ...optimisticPromptRows,
      ...failedQuestionRows,
      ...pendingPermissionRows,
      ...failedPermissionRows,
      ...sessionStatusRows,
    ];
  });

  const cancelTranscriptViewportWork = () => {
    transcriptHandle()?.cancelPendingViewportWork();
  };

  const getTranscriptDistanceFromBottom = (): number => {
    const handle = transcriptHandle();
    if (handle) {
      return handle.getDistanceFromBottom();
    }

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
    const handle = transcriptHandle();
    if (handle) {
      return handle.isNearBottom(TRANSCRIPT_NEAR_BOTTOM_THRESHOLD);
    }

    return (
      getTranscriptDistanceFromBottom() <= TRANSCRIPT_NEAR_BOTTOM_THRESHOLD
    );
  };

  const syncTranscriptNearBottom = () => {
    setIsTranscriptNearBottom(isNearTranscriptBottom());
  };

  const scrollTranscriptToBottom = (options?: {
    behavior?: ScrollBehavior;
    maxAttempts?: number;
    onComplete?: (atBottom: boolean) => void;
  }) => {
    const handle = transcriptHandle();
    if (handle) {
      handle.scrollToBottom(options);
      return;
    }

    const container = transcriptScrollRef;
    if (!container) {
      options?.onComplete?.(false);
      return;
    }

    const targetTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
    if (typeof container.scrollTo === "function") {
      container.scrollTo({
        top: targetTop,
        behavior: options?.behavior ?? "auto",
      });
      options?.onComplete?.(true);
      return;
    }

    container.scrollTop = targetTop;
    options?.onComplete?.(true);
  };

  createEffect(
    on(
      () => props.model.run()?.id,
      () => {
        cancelTranscriptViewportWork();
        setIsTranscriptNearBottom(true);
        setIsInitialTranscriptAnchorCompleted(false);
        setIsRestoringOlderTranscriptAnchor(false);
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

    const handle = transcriptHandle();
    if (!handle || !hasLoadedInitialTranscriptHistory()) {
      return;
    }

    const transcriptRows = chatTranscriptRows();
    const transcriptItemCount = transcriptRows.length;
    runChatComposerOffsetPx();
    transcriptLayoutRevision();
    if (isRestoringOlderTranscriptAnchor()) {
      return;
    }

    if (transcriptItemCount === 0) {
      setIsInitialTranscriptAnchorCompleted(true);
      setIsTranscriptNearBottom(true);
      return;
    }

    scrollTranscriptToBottom({
      behavior: "auto",
      maxAttempts: INITIAL_TRANSCRIPT_ANCHOR_MAX_ATTEMPTS,
      onComplete: (anchored) => {
        syncTranscriptNearBottom();
        if (anchored) {
          setIsInitialTranscriptAnchorCompleted(true);
        }
      },
    });
  });

  createEffect(() => {
    chatTranscriptRows();
    runChatComposerOffsetPx();
    transcriptLayoutRevision();

    if (
      !isInitialTranscriptAnchorCompleted() ||
      isRestoringOlderTranscriptAnchor()
    ) {
      return;
    }

    const wasNearBottomBeforeUpdate = isTranscriptNearBottom();

    requestAnimationFrame(() => {
      if (wasNearBottomBeforeUpdate && isTranscriptNearBottom()) {
        scrollTranscriptToBottom({ behavior: "auto", maxAttempts: 2 });
      }
      syncTranscriptNearBottom();
    });
  });

  createEffect(() => {
    const hasTranscriptItems = chatTranscriptRows().length > 0;
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
    setIsRestoringOlderTranscriptAnchor(false);
    cancelTranscriptViewportWork();
    scrollTranscriptToBottom({
      behavior: "smooth",
      maxAttempts: 2,
      onComplete: () => {
        syncTranscriptNearBottom();
      },
    });
  };

  const loadOlderTranscript = async (): Promise<void> => {
    if (!canLoadOlderTranscript()) {
      return;
    }

    const handle = transcriptHandle();
    const anchor = handle?.captureAnchor() ?? null;
    const previousScrollTop = transcriptScrollRef?.scrollTop ?? null;
    const previousScrollHeight = transcriptScrollRef?.scrollHeight ?? null;
    if (anchor) {
      setIsRestoringOlderTranscriptAnchor(true);
    }
    const didLoad = (await props.model.agent.history?.loadOlder?.()) ?? false;
    if (!didLoad) {
      setIsRestoringOlderTranscriptAnchor(false);
      syncTranscriptNearBottom();
      return;
    }

    await Promise.resolve();

    const preserveScrollHeightDeltaFallback = () => {
      const container = transcriptScrollRef;
      if (
        !container ||
        previousScrollTop === null ||
        previousScrollHeight === null
      ) {
        return;
      }

      const nextScrollHeight = container.scrollHeight;
      const offset = nextScrollHeight - previousScrollHeight;
      if (offset > 0) {
        container.scrollTop = Math.max(0, previousScrollTop + offset);
      }
    };

    if (handle && anchor) {
      setIsTranscriptNearBottom(false);
      handle.restoreAnchor(anchor, {
        maxAttempts: OLDER_TRANSCRIPT_RESTORE_MAX_ATTEMPTS,
        onComplete: (restored) => {
          if (!restored) {
            preserveScrollHeightDeltaFallback();
          }
          setIsRestoringOlderTranscriptAnchor(false);
          syncTranscriptNearBottom();
        },
      });
      return;
    }

    preserveScrollHeightDeltaFallback();
    setIsRestoringOlderTranscriptAnchor(false);
    syncTranscriptNearBottom();
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
    cancelTranscriptViewportWork();
  });

  const shouldShowJumpToBottom = createMemo(() => {
    return chatTranscriptRows().length > 0 && !isTranscriptNearBottom();
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
          <Show when={transcriptHistoryError().length > 0}>
            <p class="projects-error">{transcriptHistoryError()}</p>
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
            when={chatTranscriptRows().length > 0}
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
                apiRef={setTranscriptHandle}
                rows={chatTranscriptRows()}
                canLoadOlder={canLoadOlderTranscript()}
                loadingOlder={isLoadingOlderTranscript()}
                onLoadOlder={() => {
                  void loadOlderTranscript();
                }}
                loadOlderLabel="Load older history"
                layoutToken={transcriptVirtualizerLayoutToken()}
                scrollElement={() => transcriptScrollRef}
              />
              <div
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

export { buildStreamingTextPart };
export default NewRunChatWorkspace;
