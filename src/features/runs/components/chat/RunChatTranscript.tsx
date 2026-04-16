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
  onCleanup,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js";
import type { UiAssistantStreamingMetadata } from "../../model/agentTypes";
import RunInlineLoader from "../../../../components/ui/RunInlineLoader";
import { AppIcon } from "../../../../components/ui/icons";
import RunChatAssistantMessage from "./RunChatAssistantMessage";
import RunChatMarkdown from "./RunChatMarkdown";
import RunChatMessage from "./RunChatMessage";
import RunChatSystemMessage from "./RunChatSystemMessage";
import RunChatToolRail, {
  type RunChatToolRailItem,
  type RunChatToolRailSubagentItem,
  type RunChatToolRailSubagentMessage,
} from "./RunChatToolRail";
import RunChatUserMessage from "./RunChatUserMessage";

const DEFAULT_OVERSCAN_PX = 320;
const TRANSCRIPT_ROW_GAP_PX = 18;
const DEFAULT_VIEWPORT_HEIGHT_PX = 720;
const TRANSCRIPT_BOTTOM_TOLERANCE_PX = 1;
const TRANSCRIPT_ANCHOR_TOLERANCE_PX = 2;
const DEFAULT_BOTTOM_SCROLL_MAX_ATTEMPTS = 6;
const DEFAULT_ANCHOR_RESTORE_MAX_ATTEMPTS = 12;
const MAX_ANCHOR_FORCE_RENDER_ROWS = 160;

type RunChatTranscriptPermissionDecision = "deny" | "once" | "always";

export type RunChatTranscriptMetadataEntry = {
  key: string;
  value: string;
};

export type RunChatTranscriptAssistantRow = {
  key: string;
  kind: "assistant-message";
  messageId: string;
  messageKind?: string;
  content: string;
  reasoningContent: string;
  assistantStreaming?: UiAssistantStreamingMetadata;
  toolItems: readonly RunChatToolRailItem[];
  attributionLabel: string;
  hasRenderableContent: boolean;
};

export type RunChatTranscriptUserRow = {
  key: string;
  kind: "user-message";
  messageId: string;
  messageKind?: string;
  content: string;
};

export type RunChatTranscriptSystemRow = {
  key: string;
  kind: "system-message";
  messageId: string;
  messageKind?: string;
  content: string;
};

export type RunChatTranscriptFailedQuestionRow = {
  key: string;
  kind: "failed-question";
  sourceLabel: string;
  failureMessage: string;
};

export type RunChatTranscriptPendingPermissionRow = {
  key: string;
  kind: "pending-permission";
  requestId: string;
  permissionKind: string;
  sourceLabel: string;
  pathPatterns: readonly string[];
  metadata: readonly RunChatTranscriptMetadataEntry[];
  queuedCount: number;
  isReplying: boolean;
  replyError: string;
  onDecision: (decision: RunChatTranscriptPermissionDecision) => void;
};

export type RunChatTranscriptFailedPermissionRow = {
  key: string;
  kind: "failed-permission";
  permissionKind: string;
  sourceLabel: string;
  pathPatterns: readonly string[];
  failureMessage: string;
};

export type RunChatTranscriptPendingPromptRow = {
  key: string;
  kind: "pending-prompt";
  text: string;
  status: "sending" | "reconnecting" | "failed";
  onRetry?: () => void;
  onReconnect?: () => void;
};

export type RunChatTranscriptSessionStatusRow = {
  key: string;
  kind: "session-status";
  status: "reconnecting" | "unresponsive";
  onReconnect?: () => void;
};

export type RunChatTranscriptRow =
  | RunChatTranscriptAssistantRow
  | RunChatTranscriptUserRow
  | RunChatTranscriptSystemRow
  | RunChatTranscriptFailedQuestionRow
  | RunChatTranscriptPendingPermissionRow
  | RunChatTranscriptFailedPermissionRow
  | RunChatTranscriptPendingPromptRow
  | RunChatTranscriptSessionStatusRow;

type RunChatTranscriptProps = {
  rows: readonly RunChatTranscriptRow[];
  class?: string;
  olderAffordance?: JSX.Element;
  canLoadOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  loadOlderLabel?: string;
  scrollElement?: Accessor<HTMLElement | undefined>;
  overscanPx?: number;
  layoutToken?: string;
  apiRef?: (handle: RunChatTranscriptHandle | null) => void;
};

export type RunChatTranscriptAnchor = {
  rowKey: string;
  rowOffset: number;
};

export type RunChatTranscriptHandle = {
  captureAnchor: () => RunChatTranscriptAnchor | null;
  restoreAnchor: (
    anchor: RunChatTranscriptAnchor,
    options?: {
      maxAttempts?: number;
      onComplete?: (restored: boolean) => void;
    },
  ) => void;
  scrollToBottom: (options?: {
    behavior?: ScrollBehavior;
    maxAttempts?: number;
    onComplete?: (atBottom: boolean) => void;
  }) => void;
  cancelPendingViewportWork: () => void;
  getDistanceFromBottom: () => number;
  isNearBottom: (threshold?: number) => boolean;
};

type TranscriptRowLayout = {
  key: string;
  index: number;
  start: number;
  size: number;
  end: number;
  kind: RunChatTranscriptRow["kind"];
};

type TranscriptViewportMetrics = {
  scrollTop: number;
  clientHeight: number;
  listContentTop: number;
};

type TranscriptForcedRenderRange = {
  startIndex: number;
  endIndex: number;
};

const getOffsetWithinAncestor = (
  element: HTMLElement,
  ancestor: HTMLElement,
): number | null => {
  let total = 0;
  let current: HTMLElement | null = element;

  while (current && current !== ancestor) {
    total += current.offsetTop;

    const offsetParent: Element | null = current.offsetParent;
    if (offsetParent instanceof HTMLElement) {
      current = offsetParent;
      continue;
    }

    current = current.parentElement;
  }

  return current === ancestor ? total : null;
};

const estimateTranscriptRowHeight = (row: RunChatTranscriptRow): number => {
  switch (row.kind) {
    case "assistant-message": {
      const contentLength = row.content.trim().length;
      const toolBonus = row.toolItems.length > 0 ? 88 : 0;
      const reasoningBonus = row.reasoningContent.trim().length > 0 ? 42 : 0;
      const attributionBonus = row.attributionLabel.trim().length > 0 ? 20 : 0;
      return Math.min(
        560,
        96 +
          toolBonus +
          reasoningBonus +
          attributionBonus +
          Math.min(220, Math.ceil(Math.max(contentLength, 1) / 180) * 22),
      );
    }
    case "user-message":
      return Math.min(
        320,
        76 +
          Math.min(120, Math.ceil(Math.max(row.content.length, 1) / 220) * 20),
      );
    case "system-message":
      return Math.min(
        240,
        58 +
          Math.min(80, Math.ceil(Math.max(row.content.length, 1) / 240) * 18),
      );
    case "failed-question":
      return 160;
    case "pending-permission":
      return (
        220 +
        row.pathPatterns.length * 18 +
        row.metadata.length * 18 +
        (row.queuedCount > 0 ? 24 : 0) +
        (row.replyError.trim().length > 0 ? 28 : 0)
      );
    case "failed-permission":
      return 170 + row.pathPatterns.length * 18;
    case "pending-prompt":
      return row.status === "failed" ? 150 : 116;
    case "session-status":
      return row.status === "unresponsive" ? 104 : 84;
  }
};

const areMetadataEntriesEqual = (
  previous: readonly RunChatTranscriptMetadataEntry[],
  next: readonly RunChatTranscriptMetadataEntry[],
): boolean => {
  if (previous === next) {
    return true;
  }
  if (previous.length !== next.length) {
    return false;
  }

  return previous.every(
    (entry, index) =>
      entry.key === next[index]?.key && entry.value === next[index]?.value,
  );
};

const areSubagentToolItemsEqual = (
  previous:
    | readonly {
        id: string;
        summary: string;
        status?: string;
      }[]
    | undefined,
  next:
    | readonly {
        id: string;
        summary: string;
        status?: string;
      }[]
    | undefined,
): boolean => {
  if (previous === next) {
    return true;
  }
  if (!previous || !next) {
    return previous === next;
  }
  if (previous.length !== next.length) {
    return false;
  }

  return previous.every(
    (item, index) =>
      item.id === next[index]?.id &&
      item.summary === next[index]?.summary &&
      item.status === next[index]?.status,
  );
};

const areSubagentMessagesEqual = (
  previous: readonly RunChatToolRailSubagentMessage[],
  next: readonly RunChatToolRailSubagentMessage[],
): boolean => {
  if (previous === next) {
    return true;
  }
  if (previous.length !== next.length) {
    return false;
  }

  return previous.every((message, index) => {
    const nextMessage = next[index];
    return (
      message.id === nextMessage?.id &&
      message.role === nextMessage?.role &&
      message.content === nextMessage?.content &&
      message.reasoningContent === nextMessage?.reasoningContent &&
      (message.assistantStreaming?.streamToken ?? "") ===
        (nextMessage?.assistantStreaming?.streamToken ?? "") &&
      areSubagentToolItemsEqual(message.toolItems, nextMessage?.toolItems)
    );
  });
};

const areSubagentsEqual = (
  previous: readonly RunChatToolRailSubagentItem[],
  next: readonly RunChatToolRailSubagentItem[],
): boolean => {
  if (previous === next) {
    return true;
  }
  if (previous.length !== next.length) {
    return false;
  }

  return previous.every((subagent, index) => {
    const nextSubagent = next[index];
    return (
      subagent.id === nextSubagent?.id &&
      subagent.label === nextSubagent?.label &&
      subagent.status === nextSubagent?.status &&
      areSubagentMessagesEqual(subagent.messages, nextSubagent?.messages ?? [])
    );
  });
};

const areToolItemsEqual = (
  previous: readonly RunChatToolRailItem[],
  next: readonly RunChatToolRailItem[],
): boolean => {
  if (previous === next) {
    return true;
  }
  if (previous.length !== next.length) {
    return false;
  }

  return previous.every((item, index) => {
    const nextItem = next[index];
    return (
      item.id === nextItem?.id &&
      item.label === nextItem?.label &&
      item.summary === nextItem?.summary &&
      item.status === nextItem?.status &&
      item.detail === nextItem?.detail &&
      item.open === nextItem?.open &&
      item.isTask === nextItem?.isTask &&
      areSubagentsEqual(item.subagents ?? [], nextItem?.subagents ?? [])
    );
  });
};

const findFirstVisibleRowIndex = (
  layouts: readonly TranscriptRowLayout[],
  threshold: number,
): number => {
  let low = 0;
  let high = layouts.length - 1;
  let result = layouts.length;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((layouts[middle]?.end ?? 0) >= threshold) {
      result = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  return result;
};

const findLastVisibleRowIndex = (
  layouts: readonly TranscriptRowLayout[],
  threshold: number,
): number => {
  let low = 0;
  let high = layouts.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((layouts[middle]?.start ?? 0) <= threshold) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
};

const getTranscriptRowMeasureToken = (
  row: RunChatTranscriptRow | undefined,
): string => {
  if (!row) {
    return "";
  }

  switch (row.kind) {
    case "assistant-message":
      return [
        row.kind,
        row.content,
        row.reasoningContent,
        row.assistantStreaming?.streamToken ?? "",
        row.attributionLabel,
        row.hasRenderableContent ? "1" : "0",
        row.toolItems
          .map((item) => {
            return [
              item.id,
              item.label,
              item.summary ?? "",
              item.status ?? "",
              item.detail ?? "",
              item.open ? "1" : "0",
              item.isTask ? "1" : "0",
              (item.subagents ?? [])
                .map((subagent) => {
                  return [
                    subagent.id,
                    subagent.label,
                    subagent.status ?? "",
                    ...subagent.messages.map((message) => {
                      return [
                        message.id,
                        message.role,
                        message.content ?? "",
                        message.reasoningContent ?? "",
                        message.assistantStreaming?.streamToken ?? "",
                        ...(message.toolItems ?? []).map((toolItem) => {
                          return `${toolItem.id}:${toolItem.summary}:${toolItem.status ?? ""}`;
                        }),
                      ].join("~");
                    }),
                  ].join("=");
                })
                .join(";"),
            ].join(":");
          })
          .join("|"),
      ].join("#");
    case "user-message":
    case "system-message":
      return `${row.kind}#${row.content}`;
    case "failed-question":
      return `${row.kind}#${row.sourceLabel}#${row.failureMessage}`;
    case "pending-permission":
      return [
        row.kind,
        row.permissionKind,
        row.sourceLabel,
        row.queuedCount,
        row.isReplying ? "1" : "0",
        row.replyError,
        row.pathPatterns.join("|"),
        row.metadata.map((entry) => `${entry.key}:${entry.value}`).join("|"),
      ].join("#");
    case "failed-permission":
      return [
        row.kind,
        row.permissionKind,
        row.sourceLabel,
        row.failureMessage,
        row.pathPatterns.join("|"),
      ].join("#");
    case "pending-prompt":
      return `${row.kind}#${row.status}#${row.text}`;
    case "session-status":
      return `${row.kind}#${row.status}`;
  }
};

const AssistantTranscriptRowContent: Component<{
  row: Accessor<RunChatTranscriptAssistantRow>;
}> = (props) => {
  const content = createMemo(() => props.row().content);
  const streaming = createMemo(() => props.row().assistantStreaming);
  const reasoningContent = createMemo(() => props.row().reasoningContent);
  const toolItems = createMemo(() => props.row().toolItems, undefined, {
    equals: areToolItemsEqual,
  });
  const attributionLabel = createMemo(() => props.row().attributionLabel);
  const hasRenderableContent = createMemo(
    () => props.row().hasRenderableContent,
  );

  return (
    <div
      data-run-chat-message-id={props.row().messageId}
      data-run-chat-message-kind={props.row().messageKind ?? "parent"}
    >
      <RunChatMessage role="assistant" class="run-chat-message-item">
        <RunChatAssistantMessage
          content={content().length > 0 ? content() : " "}
          streaming={streaming()}
          isStreamingActive={streaming()?.isStreaming === true}
          reasoning={
            reasoningContent().length > 0 ? (
              <div class="run-chat-assistant-message__reasoning-inline">
                <RunChatMarkdown
                  content={`*Thinking:* ${reasoningContent()}`}
                />
              </div>
            ) : undefined
          }
          toolRail={
            toolItems().length > 0 ? (
              <RunChatToolRail items={toolItems()} />
            ) : undefined
          }
          details={
            attributionLabel().length > 0 ? (
              <p class="run-chat-assistant-message__attribution">
                {attributionLabel()}
              </p>
            ) : undefined
          }
        />
        <Show when={!hasRenderableContent()}>
          <RunInlineLoader
            as="p"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          />
        </Show>
      </RunChatMessage>
    </div>
  );
};

const UserTranscriptRowContent: Component<{
  row: Accessor<RunChatTranscriptUserRow>;
}> = (props) => {
  return (
    <div
      data-run-chat-message-id={props.row().messageId}
      data-run-chat-message-kind={props.row().messageKind ?? "parent"}
    >
      <RunChatMessage role="user" class="run-chat-message-item">
        <RunChatUserMessage>
          <RunChatMarkdown
            content={
              props.row().content.length > 0 ? props.row().content : "(empty)"
            }
          />
        </RunChatUserMessage>
      </RunChatMessage>
    </div>
  );
};

const SystemTranscriptRowContent: Component<{
  row: Accessor<RunChatTranscriptSystemRow>;
}> = (props) => {
  return (
    <div
      data-run-chat-message-id={props.row().messageId}
      data-run-chat-message-kind={props.row().messageKind ?? "parent"}
    >
      <RunChatMessage role="system" class="run-chat-message-item">
        <RunChatSystemMessage>
          <RunChatMarkdown content={props.row().content} />
        </RunChatSystemMessage>
      </RunChatMessage>
    </div>
  );
};

const FailedQuestionTranscriptRowContent: Component<{
  row: Accessor<RunChatTranscriptFailedQuestionRow>;
}> = (props) => {
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
              <strong>Source:</strong> {props.row().sourceLabel}
            </p>
            <p class="run-chat-tool-rail__details">
              {props.row().failureMessage}
            </p>
          </li>
        </ul>
      </section>
    </RunChatMessage>
  );
};

const PendingPermissionTranscriptRowContent: Component<{
  row: Accessor<RunChatTranscriptPendingPermissionRow>;
}> = (props) => {
  const metadata = createMemo(() => props.row().metadata, undefined, {
    equals: areMetadataEntriesEqual,
  });

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
                    Permission required: {props.row().permissionKind}
                  </span>
                </div>
                <p class="run-chat-tool-rail__details">
                  <strong>Source:</strong> {props.row().sourceLabel}
                </p>
                <Show
                  when={props.row().pathPatterns.length > 0}
                  fallback={
                    <p class="run-chat-tool-rail__details">
                      <strong>Paths:</strong> Any path
                    </p>
                  }
                >
                  <div class="run-chat-tool-rail__details">
                    <strong>Paths:</strong>
                    <ul class="list-disc pl-5">
                      <For each={props.row().pathPatterns}>
                        {(pattern) => <li>{pattern}</li>}
                      </For>
                    </ul>
                  </div>
                </Show>
                <Show when={metadata().length > 0}>
                  <div class="run-chat-tool-rail__details">
                    <strong>Details:</strong>
                    <ul class="list-disc pl-5">
                      <For each={metadata()}>
                        {(entry) => (
                          <li>
                            {entry.key}: {entry.value}
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                </Show>
                <Show when={props.row().queuedCount > 0}>
                  <p class="run-chat-tool-rail__details">
                    {props.row().queuedCount} more permission request
                    {props.row().queuedCount === 1 ? "" : "s"} queued. They will
                    appear after this one is resolved.
                  </p>
                </Show>
                <Show when={props.row().replyError.trim().length > 0}>
                  <p class="projects-error">{props.row().replyError}</p>
                </Show>
                <div class="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                    disabled={props.row().isReplying}
                    onClick={() => props.row().onDecision("deny")}
                  >
                    {props.row().isReplying ? "Sending..." : "Deny"}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                    disabled={props.row().isReplying}
                    onClick={() => props.row().onDecision("once")}
                  >
                    {props.row().isReplying ? "Sending..." : "Allow once"}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                    disabled={props.row().isReplying}
                    onClick={() => props.row().onDecision("always")}
                  >
                    {props.row().isReplying ? "Sending..." : "Allow"}
                  </button>
                </div>
              </li>
            </ul>
          </section>
        }
      />
    </RunChatMessage>
  );
};

const FailedPermissionTranscriptRowContent: Component<{
  row: Accessor<RunChatTranscriptFailedPermissionRow>;
}> = (props) => {
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
                Permission required: {props.row().permissionKind}
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
              <strong>Source:</strong> {props.row().sourceLabel}
            </p>
            <p class="run-chat-tool-rail__details">
              {props.row().failureMessage}
            </p>
            <Show
              when={props.row().pathPatterns.length > 0}
              fallback={
                <p class="run-chat-tool-rail__details">
                  <strong>Paths:</strong> Any path
                </p>
              }
            >
              <div class="run-chat-tool-rail__details">
                <strong>Paths:</strong>
                <ul class="list-disc pl-5">
                  <For each={props.row().pathPatterns}>
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
};

const PendingPromptTranscriptRowContent: Component<{
  row: Accessor<RunChatTranscriptPendingPromptRow>;
}> = (props) => {
  return (
    <RunChatMessage
      role="user"
      class="run-chat-message-item"
      ariaLabel="Pending message"
    >
      <RunChatUserMessage>
        <div class="space-y-2">
          <RunChatMarkdown content={props.row().text} />
          <p class="run-chat-user-message__status">
            {props.row().status === "failed"
              ? "Send failed"
              : props.row().status === "reconnecting"
                ? "Reconnecting…"
                : "Sending…"}
          </p>
          <Show when={props.row().status === "failed"}>
            <div class="run-chat-user-message__actions">
              <button
                type="button"
                class="run-chat-user-message__action"
                onClick={() => props.row().onRetry?.()}
              >
                Retry send
              </button>
              <button
                type="button"
                class="run-chat-user-message__action"
                onClick={() => props.row().onReconnect?.()}
              >
                Reconnect
              </button>
            </div>
          </Show>
        </div>
      </RunChatUserMessage>
    </RunChatMessage>
  );
};

const SessionStatusTranscriptRowContent: Component<{
  row: Accessor<RunChatTranscriptSessionStatusRow>;
}> = (props) => {
  return (
    <RunChatMessage
      role="system"
      class="run-chat-message-item"
      ariaLabel="Chat connection status"
    >
      <RunChatSystemMessage>
        <div class="flex w-full flex-wrap items-center justify-between gap-3">
          <span>
            {props.row().status === "reconnecting"
              ? "Chat session became unresponsive. Reconnecting…"
              : "Chat session is unresponsive. Reconnect to recover without restarting the app."}
          </span>
          <Show when={props.row().status === "unresponsive"}>
            <button
              type="button"
              class="btn btn-xs border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-3 text-[11px] font-medium"
              onClick={() => props.row().onReconnect?.()}
            >
              Reconnect chat
            </button>
          </Show>
        </div>
      </RunChatSystemMessage>
    </RunChatMessage>
  );
};

const VirtualizedTranscriptRow: Component<{
  rowKey: string;
  rowCount: number;
  getRow: (key: string) => RunChatTranscriptRow | undefined;
  getLayout: (key: string) => TranscriptRowLayout | undefined;
  onMeasure: (key: string, height: number) => void;
}> = (props) => {
  let rowRef: HTMLLIElement | undefined;
  let measureFrame: number | undefined;

  const row = createMemo(() => props.getRow(props.rowKey));
  const layout = createMemo(() => props.getLayout(props.rowKey));
  const measureToken = createMemo(() => getTranscriptRowMeasureToken(row()));
  const assistantRow = createMemo(() => {
    const current = row();
    return current?.kind === "assistant-message" ? current : undefined;
  });
  const userRow = createMemo(() => {
    const current = row();
    return current?.kind === "user-message" ? current : undefined;
  });
  const systemRow = createMemo(() => {
    const current = row();
    return current?.kind === "system-message" ? current : undefined;
  });
  const failedQuestionRow = createMemo(() => {
    const current = row();
    return current?.kind === "failed-question" ? current : undefined;
  });
  const pendingPermissionRow = createMemo(() => {
    const current = row();
    return current?.kind === "pending-permission" ? current : undefined;
  });
  const failedPermissionRow = createMemo(() => {
    const current = row();
    return current?.kind === "failed-permission" ? current : undefined;
  });
  const pendingPromptRow = createMemo(() => {
    const current = row();
    return current?.kind === "pending-prompt" ? current : undefined;
  });
  const sessionStatusRow = createMemo(() => {
    const current = row();
    return current?.kind === "session-status" ? current : undefined;
  });

  const measure = () => {
    if (!rowRef) {
      return;
    }
    props.onMeasure(props.rowKey, rowRef.getBoundingClientRect().height);
  };

  const scheduleMeasure = () => {
    if (measureFrame !== undefined) {
      return;
    }
    if (typeof requestAnimationFrame !== "function") {
      measure();
      return;
    }
    measureFrame = requestAnimationFrame(() => {
      measureFrame = undefined;
      measure();
    });
  };

  createEffect(() => {
    measureToken();
    scheduleMeasure();
  });

  createEffect(() => {
    const element = rowRef;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      scheduleMeasure();
    });
    observer.observe(element);

    onCleanup(() => {
      observer.disconnect();
    });
  });

  onCleanup(() => {
    if (
      measureFrame !== undefined &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(measureFrame);
    }
  });

  return (
    <li
      ref={rowRef}
      class="run-chat-transcript__item run-chat-transcript__item--virtualized"
      data-run-chat-transcript-row-key={props.rowKey}
      data-run-chat-transcript-row-kind={layout()?.kind}
      aria-posinset={(layout()?.index ?? 0) + 1}
      aria-setsize={props.rowCount}
      style={{ top: `${layout()?.start ?? 0}px` }}
    >
      <Show when={assistantRow()}>
        <AssistantTranscriptRowContent
          row={assistantRow as Accessor<RunChatTranscriptAssistantRow>}
        />
      </Show>
      <Show when={userRow()}>
        <UserTranscriptRowContent
          row={userRow as Accessor<RunChatTranscriptUserRow>}
        />
      </Show>
      <Show when={systemRow()}>
        <SystemTranscriptRowContent
          row={systemRow as Accessor<RunChatTranscriptSystemRow>}
        />
      </Show>
      <Show when={failedQuestionRow()}>
        <FailedQuestionTranscriptRowContent
          row={failedQuestionRow as Accessor<RunChatTranscriptFailedQuestionRow>}
        />
      </Show>
      <Show when={pendingPermissionRow()}>
        <PendingPermissionTranscriptRowContent
          row={pendingPermissionRow as Accessor<RunChatTranscriptPendingPermissionRow>}
        />
      </Show>
      <Show when={failedPermissionRow()}>
        <FailedPermissionTranscriptRowContent
          row={failedPermissionRow as Accessor<RunChatTranscriptFailedPermissionRow>}
        />
      </Show>
      <Show when={pendingPromptRow()}>
        <PendingPromptTranscriptRowContent
          row={pendingPromptRow as Accessor<RunChatTranscriptPendingPromptRow>}
        />
      </Show>
      <Show when={sessionStatusRow()}>
        <SessionStatusTranscriptRowContent
          row={sessionStatusRow as Accessor<RunChatTranscriptSessionStatusRow>}
        />
      </Show>
    </li>
  );
};

const RunChatTranscript: Component<RunChatTranscriptProps> = (props) => {
  let transcriptSectionRef: HTMLElement | undefined;
  let transcriptListRef: HTMLOListElement | undefined;
  let syncViewportFrame: number | undefined;
  let viewportWorkFrame: number | undefined;
  let viewportVerifyFrame: number | undefined;
  let activeViewportWorkId = 0;
  let hasPendingViewportWork = false;
  let activeViewportWorkCompletion: ((completed: boolean) => void) | undefined;

  const [rowHeights, setRowHeights] = createSignal(new Map<string, number>());
  const [viewportMetrics, setViewportMetrics] =
    createSignal<TranscriptViewportMetrics>({
      scrollTop: 0,
      clientHeight: 0,
      listContentTop: 0,
    });
  const [forcedRenderRange, setForcedRenderRange] =
    createSignal<TranscriptForcedRenderRange | null>(null);

  const cancelViewportFrames = () => {
    if (
      viewportWorkFrame !== undefined &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(viewportWorkFrame);
      viewportWorkFrame = undefined;
    }

    if (
      viewportVerifyFrame !== undefined &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(viewportVerifyFrame);
      viewportVerifyFrame = undefined;
    }
  };

  const clearPendingViewportWork = (
    completed: boolean,
    notify = false,
  ): void => {
    hasPendingViewportWork = false;
    activeViewportWorkId += 1;
    cancelViewportFrames();
    setForcedRenderRange(null);

    const onComplete = activeViewportWorkCompletion;
    activeViewportWorkCompletion = undefined;
    if (notify) {
      onComplete?.(completed);
    }
  };

  const resolveViewportMetrics = (): TranscriptViewportMetrics | null => {
    const scrollElement = props.scrollElement?.();
    const listElement = transcriptListRef;
    if (!scrollElement || !listElement) {
      return null;
    }

    const scrollRect = scrollElement.getBoundingClientRect();
    const listRect = listElement.getBoundingClientRect();
    const nextMetrics = {
      scrollTop: scrollElement.scrollTop,
      clientHeight: scrollElement.clientHeight,
      listContentTop:
        getOffsetWithinAncestor(listElement, scrollElement) ??
        scrollElement.scrollTop + listRect.top - scrollRect.top,
    };

    setViewportMetrics((current) => {
      if (
        current.scrollTop === nextMetrics.scrollTop &&
        current.clientHeight === nextMetrics.clientHeight &&
        current.listContentTop === nextMetrics.listContentTop
      ) {
        return current;
      }
      return nextMetrics;
    });

    return nextMetrics;
  };

  const getBottomScrollTop = (): number => {
    const scrollElement = props.scrollElement?.();
    if (!scrollElement) {
      return 0;
    }

    const metrics = resolveViewportMetrics();
    const inferredContentHeight = metrics
      ? Math.max(
          scrollElement.scrollHeight,
          Math.ceil(metrics.listContentTop + rowLayouts().totalHeight),
        )
      : scrollElement.scrollHeight;

    return Math.max(0, inferredContentHeight - scrollElement.clientHeight);
  };

  const getDistanceFromBottom = (): number => {
    const scrollElement = props.scrollElement?.();
    if (!scrollElement) {
      return 0;
    }

    return Math.max(0, getBottomScrollTop() - scrollElement.scrollTop);
  };

  const scrollElementToTop = (
    scrollElement: HTMLElement,
    top: number,
    behavior: ScrollBehavior,
  ): void => {
    const targetTop = Math.max(0, top);
    if (typeof scrollElement.scrollTo === "function") {
      scrollElement.scrollTo({ top: targetTop, behavior });
      scheduleViewportSync();
      return;
    }

    scrollElement.scrollTop = targetTop;
    scheduleViewportSync();
  };

  const captureAnchor = (): RunChatTranscriptAnchor | null => {
    const metrics = resolveViewportMetrics();
    const layouts = rowLayouts().rows;
    if (!metrics || layouts.length === 0) {
      return null;
    }

    const viewportTop = Math.max(0, metrics.scrollTop - metrics.listContentTop);
    const anchorIndex = Math.min(
      findFirstVisibleRowIndex(layouts, viewportTop),
      layouts.length - 1,
    );
    const anchorLayout = layouts[anchorIndex];
    if (!anchorLayout) {
      return null;
    }

    return {
      rowKey: anchorLayout.key,
      rowOffset: Math.max(0, viewportTop - anchorLayout.start),
    };
  };

  const getAnchorTargetTop = (
    anchor: RunChatTranscriptAnchor,
  ): number | null => {
    const metrics = resolveViewportMetrics();
    const layout = rowLayoutsByKey().get(anchor.rowKey);
    if (!metrics || !layout) {
      return null;
    }

    return Math.max(
      0,
      metrics.listContentTop +
        layout.start +
        Math.min(anchor.rowOffset, Math.max(0, layout.size - 1)),
    );
  };

  const isAnchorAligned = (anchor: RunChatTranscriptAnchor): boolean => {
    const scrollElement = props.scrollElement?.();
    const targetTop = getAnchorTargetTop(anchor);
    if (!scrollElement || targetTop === null) {
      return false;
    }

    return (
      Math.abs(scrollElement.scrollTop - targetTop) <=
      TRANSCRIPT_ANCHOR_TOLERANCE_PX
    );
  };

  const resolveAnchorForceRenderRange = (
    anchor: RunChatTranscriptAnchor,
  ): TranscriptForcedRenderRange | null => {
    const endIndex = props.rows.findIndex((row) => row.key === anchor.rowKey);
    if (endIndex < 0) {
      return null;
    }

    if (endIndex + 1 > MAX_ANCHOR_FORCE_RENDER_ROWS) {
      return null;
    }

    return {
      startIndex: 0,
      endIndex,
    };
  };

  const isForceRenderRangeMeasured = (
    range: TranscriptForcedRenderRange,
  ): boolean => {
    const heights = rowHeights();
    for (let index = range.startIndex; index <= range.endIndex; index += 1) {
      const rowKey = props.rows[index]?.key;
      if (!rowKey || !heights.has(rowKey)) {
        return false;
      }
    }
    return true;
  };

  const runAnchorRestore = (
    anchor: RunChatTranscriptAnchor,
    requestId: number,
    attempt: number,
    maxAttempts: number,
  ) => {
    const range = resolveAnchorForceRenderRange(anchor);
    if (!range) {
      clearPendingViewportWork(false, true);
      return;
    }

    setForcedRenderRange(range);
    viewportWorkFrame = requestAnimationFrame(() => {
      viewportWorkFrame = undefined;
      if (requestId !== activeViewportWorkId) {
        return;
      }

      const scrollElement = props.scrollElement?.();
      const targetTop = getAnchorTargetTop(anchor);
      if (!scrollElement || targetTop === null) {
        clearPendingViewportWork(false, true);
        return;
      }

      scrollElementToTop(scrollElement, targetTop, "auto");

      viewportVerifyFrame = requestAnimationFrame(() => {
        viewportVerifyFrame = undefined;
        if (requestId !== activeViewportWorkId) {
          return;
        }

        const aligned = isAnchorAligned(anchor);
        const measured = isForceRenderRangeMeasured(range);
        if (aligned && measured) {
          clearPendingViewportWork(true, true);
          return;
        }

        if (attempt + 1 >= maxAttempts) {
          clearPendingViewportWork(aligned, true);
          return;
        }

        runAnchorRestore(anchor, requestId, attempt + 1, maxAttempts);
      });
    });
  };

  const runBottomScroll = (
    requestId: number,
    behavior: ScrollBehavior,
    attempt: number,
    maxAttempts: number,
  ) => {
    viewportWorkFrame = requestAnimationFrame(() => {
      viewportWorkFrame = undefined;
      if (requestId !== activeViewportWorkId) {
        return;
      }

      const scrollElement = props.scrollElement?.();
      if (!scrollElement) {
        clearPendingViewportWork(false, true);
        return;
      }

      const targetTop = getBottomScrollTop();
      scrollElementToTop(
        scrollElement,
        targetTop,
        attempt === 0 ? behavior : "auto",
      );

      viewportVerifyFrame = requestAnimationFrame(() => {
        viewportVerifyFrame = undefined;
        if (requestId !== activeViewportWorkId) {
          return;
        }

        const distanceFromBottom = getDistanceFromBottom();
        const bottomStable =
          Math.abs(getBottomScrollTop() - targetTop) <=
          TRANSCRIPT_BOTTOM_TOLERANCE_PX;

        if (
          distanceFromBottom <= TRANSCRIPT_BOTTOM_TOLERANCE_PX &&
          bottomStable
        ) {
          clearPendingViewportWork(true, true);
          return;
        }

        if (attempt + 1 >= maxAttempts) {
          clearPendingViewportWork(
            distanceFromBottom <= TRANSCRIPT_BOTTOM_TOLERANCE_PX,
            true,
          );
          return;
        }

        runBottomScroll(requestId, behavior, attempt + 1, maxAttempts);
      });
    });
  };

  const transcriptHandle: RunChatTranscriptHandle = {
    captureAnchor,
    restoreAnchor: (anchor, options) => {
      clearPendingViewportWork(false);
      hasPendingViewportWork = true;
      activeViewportWorkCompletion = options?.onComplete;
      const requestId = activeViewportWorkId;
      runAnchorRestore(
        anchor,
        requestId,
        0,
        Math.max(
          1,
          options?.maxAttempts ?? DEFAULT_ANCHOR_RESTORE_MAX_ATTEMPTS,
        ),
      );
    },
    scrollToBottom: (options) => {
      clearPendingViewportWork(false);
      hasPendingViewportWork = true;
      activeViewportWorkCompletion = options?.onComplete;
      const requestId = activeViewportWorkId;
      runBottomScroll(
        requestId,
        options?.behavior ?? "auto",
        0,
        Math.max(1, options?.maxAttempts ?? DEFAULT_BOTTOM_SCROLL_MAX_ATTEMPTS),
      );
    },
    cancelPendingViewportWork: () => {
      clearPendingViewportWork(false);
    },
    getDistanceFromBottom,
    isNearBottom: (threshold = 0) => getDistanceFromBottom() <= threshold,
  };

  const syncViewportMetrics = () => {
    resolveViewportMetrics();
  };

  const scheduleViewportSync = () => {
    if (syncViewportFrame !== undefined) {
      return;
    }
    if (typeof requestAnimationFrame !== "function") {
      syncViewportMetrics();
      return;
    }

    syncViewportFrame = requestAnimationFrame(() => {
      syncViewportFrame = undefined;
      syncViewportMetrics();
    });
  };

  const showDefaultLoadOlder = () =>
    Boolean(props.canLoadOlder && props.onLoadOlder && !props.olderAffordance);

  const rowLayouts = createMemo(() => {
    const heights = rowHeights();
    const layouts: TranscriptRowLayout[] = [];
    let offset = 0;

    props.rows.forEach((row, index) => {
      const size = Math.max(
        1,
        heights.get(row.key) ?? estimateTranscriptRowHeight(row),
      );
      layouts.push({
        key: row.key,
        index,
        start: offset,
        size,
        end: offset + size,
        kind: row.kind,
      });
      offset += size;
      if (index < props.rows.length - 1) {
        offset += TRANSCRIPT_ROW_GAP_PX;
      }
    });

    return {
      rows: layouts,
      totalHeight: offset,
    };
  });

  const rowLayoutsByKey = createMemo(() => {
    return new Map(rowLayouts().rows.map((row) => [row.key, row]));
  });

  const rowsByKey = createMemo(() => {
    return new Map(props.rows.map((row) => [row.key, row]));
  });

  const visibleRowLayouts = createMemo(() => {
    const layouts = rowLayouts().rows;
    if (layouts.length === 0) {
      return [] as TranscriptRowLayout[];
    }

    const viewport = viewportMetrics();
    const overscan = Math.max(0, props.overscanPx ?? DEFAULT_OVERSCAN_PX);
    const viewportHeight =
      viewport.clientHeight > 0
        ? viewport.clientHeight
        : DEFAULT_VIEWPORT_HEIGHT_PX;
    const totalHeight = rowLayouts().totalHeight;
    const unclampedVisibleTop =
      viewport.scrollTop - viewport.listContentTop - overscan;
    const unclampedVisibleBottom =
      viewport.scrollTop - viewport.listContentTop + viewportHeight + overscan;
    const visibleTop = Math.max(
      0,
      Math.min(
        unclampedVisibleTop,
        Math.max(0, totalHeight - viewportHeight - overscan),
      ),
    );
    const visibleBottom = Math.max(
      visibleTop,
      Math.min(totalHeight, Math.max(0, unclampedVisibleBottom)),
    );

    const startIndex = findFirstVisibleRowIndex(layouts, visibleTop);
    const endIndex = findLastVisibleRowIndex(layouts, visibleBottom);

    if (startIndex >= layouts.length || endIndex < startIndex) {
      return [] as TranscriptRowLayout[];
    }

    return layouts.slice(startIndex, endIndex + 1);
  });

  const renderedRowLayouts = createMemo(() => {
    const visibleLayouts = visibleRowLayouts();
    const range = forcedRenderRange();
    if (!range) {
      return visibleLayouts;
    }

    const layouts = rowLayouts().rows;
    const startIndex = Math.max(0, range.startIndex);
    const endIndex = Math.min(layouts.length - 1, range.endIndex);
    if (endIndex < startIndex) {
      return visibleLayouts;
    }

    const merged = new Map<string, TranscriptRowLayout>();
    layouts.slice(startIndex, endIndex + 1).forEach((layout) => {
      merged.set(layout.key, layout);
    });
    visibleLayouts.forEach((layout) => {
      merged.set(layout.key, layout);
    });

    return Array.from(merged.values()).sort((left, right) => {
      return left.index - right.index;
    });
  });

  const renderedRowKeys = createMemo(() => {
    return renderedRowLayouts().map((layout) => layout.key);
  });

  const measureRow = (key: string, height: number) => {
    const normalizedHeight = Math.max(1, Math.ceil(height));
    setRowHeights((current) => {
      if (current.get(key) === normalizedHeight) {
        return current;
      }

      const next = new Map(current);
      next.set(key, normalizedHeight);
      return next;
    });
  };

  createEffect(() => {
    const activeKeys = new Set(props.rows.map((row) => row.key));
    setRowHeights((current) => {
      let changed = false;
      const next = new Map<string, number>();

      for (const [key, value] of current.entries()) {
        if (activeKeys.has(key)) {
          next.set(key, value);
          continue;
        }
        changed = true;
      }

      return changed ? next : current;
    });
  });

  createEffect(() => {
    props.rows.length;
    scheduleViewportSync();
  });

  createEffect(() => {
    props.layoutToken;
    scheduleViewportSync();
  });

  createEffect(() => {
    forcedRenderRange();
    scheduleViewportSync();
  });

  createEffect(() => {
    const apiRef = props.apiRef;
    if (!apiRef) {
      return;
    }

    apiRef(transcriptHandle);
    onCleanup(() => {
      apiRef(null);
    });
  });

  createEffect(() => {
    const scrollElement = props.scrollElement?.();
    const listElement = transcriptListRef;
    const sectionElement = transcriptSectionRef;
    if (!scrollElement || !listElement || !sectionElement) {
      return;
    }

    const handleScroll = () => {
      scheduleViewportSync();
    };

    const cancelPendingUserCompetingWork = () => {
      if (hasPendingViewportWork) {
        clearPendingViewportWork(false, true);
      }
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    scrollElement.addEventListener("wheel", cancelPendingUserCompetingWork, {
      passive: true,
    });
    scrollElement.addEventListener(
      "touchstart",
      cancelPendingUserCompetingWork,
      {
        passive: true,
      },
    );
    scrollElement.addEventListener(
      "pointerdown",
      cancelPendingUserCompetingWork,
    );
    window.addEventListener("resize", scheduleViewportSync);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        scheduleViewportSync();
      });
      observer.observe(scrollElement);
      observer.observe(sectionElement);
      observer.observe(listElement);
    }

    scheduleViewportSync();

    onCleanup(() => {
      scrollElement.removeEventListener("scroll", handleScroll);
      scrollElement.removeEventListener(
        "wheel",
        cancelPendingUserCompetingWork,
      );
      scrollElement.removeEventListener(
        "touchstart",
        cancelPendingUserCompetingWork,
      );
      scrollElement.removeEventListener(
        "pointerdown",
        cancelPendingUserCompetingWork,
      );
      window.removeEventListener("resize", scheduleViewportSync);
      observer?.disconnect();
    });
  });

  onCleanup(() => {
    if (
      syncViewportFrame !== undefined &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(syncViewportFrame);
    }

    clearPendingViewportWork(false);
  });

  return (
    <section
      ref={transcriptSectionRef}
      class={`run-chat-transcript ${props.class ?? ""}`.trim()}
      aria-label="Chat transcript"
    >
      <div class="run-chat-transcript__older">
        <Show when={props.olderAffordance}>{props.olderAffordance}</Show>
        <Show when={showDefaultLoadOlder()}>
          <button
            type="button"
            class="run-chat-transcript__load-older"
            onClick={() => props.onLoadOlder?.()}
            disabled={props.loadingOlder ?? false}
            aria-label={props.loadOlderLabel ?? "Load older messages"}
          >
            {props.loadingOlder
              ? "Loading..."
              : (props.loadOlderLabel ?? "Load older")}
          </button>
        </Show>
      </div>
      <ol
        ref={transcriptListRef}
        class="run-chat-transcript__list run-chat-transcript__list--virtualized"
        role="list"
        style={{ height: `${rowLayouts().totalHeight}px` }}
      >
        <For each={renderedRowKeys()}>
          {(rowKey) => (
            <VirtualizedTranscriptRow
              rowKey={rowKey}
              rowCount={props.rows.length}
              getRow={(key) => rowsByKey().get(key)}
              getLayout={(key) => rowLayoutsByKey().get(key)}
              onMeasure={measureRow}
            />
          )}
        </For>
      </ol>
    </section>
  );
};

export default RunChatTranscript;
