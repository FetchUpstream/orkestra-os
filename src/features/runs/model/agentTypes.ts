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

export type AgentStatus = "connecting" | "idle" | "active" | "error";

export type AgentRole = "user" | "assistant" | "system" | "unknown";

export type UiBasePart = {
  id: string;
  type: string;
  raw?: unknown;
};

export type UiStreamChunkNode = {
  delta: string;
  prev?: UiStreamChunkNode;
};

export type UiTextPart = UiBasePart & {
  kind: "text";
  text: string;
  streaming: boolean;
  streamChunks?: string[];
  streamBaseText?: string;
  streamTail?: UiStreamChunkNode;
  streamText?: string;
  streamTextLength?: number;
  streamRevision?: number;
  metadata?: unknown;
};

export type UiReasoningPart = UiBasePart & {
  kind: "reasoning";
  text: string;
  streaming: boolean;
  streamChunks?: string[];
  streamBaseText?: string;
  streamTail?: UiStreamChunkNode;
  streamText?: string;
  streamTextLength?: number;
  streamRevision?: number;
  metadata?: unknown;
};

export type UiToolPart = UiBasePart & {
  kind: "tool";
  toolName: string;
  callId?: string;
  status: string;
  title?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  metadata?: unknown;
};

export type UiFilePart = UiBasePart & {
  kind: "file";
  filename?: string;
  url?: string;
  mime?: string;
};

export type UiPatchPart = UiBasePart & {
  kind: "patch";
  hash?: string;
  files: unknown[];
};

export type UiStepStartPart = UiBasePart & {
  kind: "step-start";
  snapshot?: unknown;
};

export type UiStepFinishPart = UiBasePart & {
  kind: "step-finish";
  reason?: unknown;
  tokens?: unknown;
  cost?: unknown;
  snapshot?: unknown;
};

export type UiUnknownPart = UiBasePart & {
  kind: "unknown";
  rawType: string;
};

export type UiPart =
  | UiTextPart
  | UiReasoningPart
  | UiToolPart
  | UiFilePart
  | UiPatchPart
  | UiStepStartPart
  | UiStepFinishPart
  | UiUnknownPart;

export type UiMessage = {
  id: string;
  sessionId: string;
  role: AgentRole;
  createdAt?: number;
  updatedAt?: number;
  attribution?: {
    agent?: string;
    model?: string;
  };
  rawInfo?: unknown;
  partsById: Record<string, UiPart>;
  partOrder: string[];
};

export type UiQuestionRequest = {
  requestId: string;
  sessionId: string;
  questions: unknown[];
  sourceKind?: "main" | "subagent";
  sourceLabel?: string;
  status?: "pending" | "replied" | "rejected" | "failed";
  dedupeKey?: string;
  receivedAt?: string | number | null;
  resolvedAt?: string | number | null;
  failureMessage?: string;
  raw?: unknown;
};

export type AgentQuestionState = {
  activeRequest: UiQuestionRequest | null;
  queuedRequests: UiQuestionRequest[];
  resolvedRequests: UiQuestionRequest[];
  failedRequests: UiQuestionRequest[];
};

export type UiPermissionRequest = {
  requestId: string;
  sessionId: string;
  sourceKind?: "main" | "subagent";
  sourceLabel?: string;
  kind?: string;
  pathPatterns?: string[];
  metadata?: Record<string, string>;
  status?: "pending" | "replied" | "rejected" | "failed";
  dedupeKey?: string;
  receivedAt?: string | number | null;
  resolvedAt?: string | number | null;
  failureMessage?: string;
  raw?: unknown;
};

export type AgentPermissionState = {
  activeRequest: UiPermissionRequest | null;
  queuedRequests: UiPermissionRequest[];
  resolvedRequests: UiPermissionRequest[];
  failedRequests: UiPermissionRequest[];
};

export type UiTodo = {
  id: string;
  content?: string;
  status?: string;
  priority?: string;
  raw: unknown;
};

export type UiDiffSummary = {
  files?: unknown[];
  raw: unknown;
};

export type OpenCodeBusEvent = {
  type: string;
  properties?: unknown;
  ts?: string | number | null;
  raw?: unknown;
};

export type AgentStore = {
  sessionId: string | null;
  status: AgentStatus;
  streamConnected: boolean;
  lastSyncAt: number | null;
  messagesById: Record<string, UiMessage>;
  messageOrder: string[];
  pendingQuestionsById: Record<string, UiQuestionRequest>;
  resolvedQuestionsById: Record<string, UiQuestionRequest>;
  failedQuestionsById: Record<string, UiQuestionRequest>;
  pendingPermissionsById: Record<string, UiPermissionRequest>;
  resolvedPermissionsById: Record<string, UiPermissionRequest>;
  failedPermissionsById: Record<string, UiPermissionRequest>;
  todos: UiTodo[];
  diffSummary: UiDiffSummary | null;
  rawEvents: OpenCodeBusEvent[];
};
