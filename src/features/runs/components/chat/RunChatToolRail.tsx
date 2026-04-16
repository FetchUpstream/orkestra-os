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

import { For, Show, createMemo, type Component } from "solid-js";
import RunInlineLoader from "../../../../components/ui/RunInlineLoader";
import { AppIcon } from "../../../../components/ui/icons";
import type { UiAssistantStreamingMetadata } from "../../model/agentTypes";
import RunChatAssistantMessage from "./RunChatAssistantMessage";
import RunChatMarkdown from "./RunChatMarkdown";

const SUBAGENT_VISIBLE_MESSAGE_LIMIT = 3;

export type RunChatToolRailItem = {
  id: string;
  label: string;
  summary?: string;
  status?: string;
  detail?: string;
  open?: boolean;
  isTask?: boolean;
  subagents?: readonly RunChatToolRailSubagentItem[];
};

export type RunChatToolRailSubagentMessage = {
  id: string;
  role: "assistant" | "user" | "system" | "unknown";
  content?: string;
  reasoningContent?: string;
  assistantStreaming?: UiAssistantStreamingMetadata;
  toolItems?: readonly {
    id: string;
    summary: string;
    status?: string;
  }[];
};

export type RunChatToolRailSubagentItem = {
  id: string;
  label: string;
  status?: string;
  messages: readonly RunChatToolRailSubagentMessage[];
};

type RunChatToolRailProps = {
  items: readonly RunChatToolRailItem[];
  class?: string;
  emptyLabel?: string;
};

const normalizeStatus = (
  status?: string,
): "running" | "completed" | "failed" | undefined => {
  if (!status) return undefined;
  const normalized = status.trim().toLowerCase();

  if (
    [
      "loading",
      "pending",
      "running",
      "in_progress",
      "in-progress",
      "started",
      "processing",
      "active",
      "busy",
    ].includes(normalized)
  ) {
    return "running";
  }

  if (
    ["completed", "complete", "success", "succeeded", "done", "idle"].includes(
      normalized,
    )
  ) {
    return "completed";
  }

  if (
    ["failed", "failure", "error", "errored", "cancelled", "canceled"].includes(
      normalized,
    )
  ) {
    return "failed";
  }

  return undefined;
};

const TERMINAL_SUBAGENT_STATUSES = new Set(["completed", "failed"]);

const buildLookupById = <T extends { id: string }>(
  items: readonly T[] | undefined,
): Record<string, T> => {
  const lookup: Record<string, T> = {};
  for (const item of items ?? []) {
    lookup[item.id] = item;
  }
  return lookup;
};

type RunChatToolRailStatusProps = {
  status?: string;
};

const RunChatToolRailStatus: Component<RunChatToolRailStatusProps> = (
  props,
) => {
  const statusModifier = createMemo(() => normalizeStatus(props.status));

  return (
    <Show when={props.status}>
      <span class="run-chat-tool-rail__status">
        <Show when={statusModifier() === "running"}>
          <RunInlineLoader
            class="run-chat-tool-rail__status-slot"
            aria-label={props.status}
            srLabel={props.status}
          />
        </Show>
        <Show when={statusModifier() === "completed"}>
          <span
            class="run-chat-tool-rail__status-slot"
            aria-label={props.status}
          >
            <span
              class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--check"
              aria-hidden="true"
            >
              ✓
            </span>
            <span class="sr-only">{props.status}</span>
          </span>
        </Show>
        <Show when={statusModifier() === "failed"}>
          <span
            class="run-chat-tool-rail__status-slot"
            aria-label={props.status}
          >
            <AppIcon
              name="status.error"
              class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--error"
              aria-hidden="true"
              size={14}
            />
            <span class="sr-only">{props.status}</span>
          </span>
        </Show>
        <Show
          when={
            statusModifier() !== "running" &&
            statusModifier() !== "completed" &&
            statusModifier() !== "failed"
          }
        >
          {props.status}
        </Show>
      </span>
    </Show>
  );
};

type RunChatToolRailSubagentToolItemProps = {
  toolItem: () =>
    | {
        id: string;
        summary: string;
        status?: string;
      }
    | undefined;
};

const RunChatToolRailSubagentToolItem: Component<
  RunChatToolRailSubagentToolItemProps
> = (props) => {
  const toolItem = createMemo(() => props.toolItem());

  return (
    <Show when={toolItem()}>
      <li class="run-chat-tool-rail__subagent-tool">
        <span>{toolItem()?.summary}</span>
        <RunChatToolRailStatus status={toolItem()?.status} />
      </li>
    </Show>
  );
};

type RunChatToolRailSubagentMessageProps = {
  message: () => RunChatToolRailSubagentMessage | undefined;
};

const RunChatToolRailSubagentMessageItem: Component<
  RunChatToolRailSubagentMessageProps
> = (props) => {
  const message = createMemo(() => props.message());
  const toolItemIds = createMemo(() => {
    return message()?.toolItems?.map((toolItem) => toolItem.id) ?? [];
  });
  const toolItemsById = createMemo(() => buildLookupById(message()?.toolItems));
  const assistantReasoningNode = (
    <div class="run-chat-tool-rail__subagent-reasoning">
      <RunChatMarkdown
        content={`*Thinking:* ${message()?.reasoningContent ?? ""}`}
      />
    </div>
  );
  const assistantToolRailNode = (
    <ul class="run-chat-tool-rail__subagent-tools">
      <For each={toolItemIds()}>
        {(toolItemId) => (
          <RunChatToolRailSubagentToolItem
            toolItem={() => toolItemsById()[toolItemId]}
          />
        )}
      </For>
    </ul>
  );

  return (
    <Show when={message()}>
      <article class="run-chat-tool-rail__subagent-message">
        <Show
          when={message()?.role === "assistant"}
          fallback={
            <>
              <Show when={message()?.content?.trim().length}>
                <div class="run-chat-tool-rail__subagent-markdown">
                  <RunChatMarkdown content={message()?.content ?? ""} />
                </div>
              </Show>
              <Show when={message()?.reasoningContent?.trim().length}>
                {assistantReasoningNode}
              </Show>
              <Show when={toolItemIds().length > 0}>
                {assistantToolRailNode}
              </Show>
            </>
          }
        >
          <RunChatAssistantMessage
            content={
              message()?.content?.length ? (message()?.content ?? " ") : " "
            }
            streaming={message()?.assistantStreaming}
            isStreamingActive={
              message()?.assistantStreaming?.isStreaming === true
            }
            reasoning={
              message()?.reasoningContent?.trim().length
                ? assistantReasoningNode
                : undefined
            }
            toolRail={
              toolItemIds().length > 0 ? assistantToolRailNode : undefined
            }
          />
        </Show>
      </article>
    </Show>
  );
};

type RunChatToolRailSubagentPanelProps = {
  subagent: () => RunChatToolRailSubagentItem | undefined;
};

const RunChatToolRailSubagentPanel: Component<
  RunChatToolRailSubagentPanelProps
> = (props) => {
  const subagent = createMemo(() => props.subagent());
  const visibleMessageIds = createMemo(() => {
    return (
      subagent()
        ?.messages.slice(-SUBAGENT_VISIBLE_MESSAGE_LIMIT)
        .map((message) => message.id) ?? []
    );
  });
  const messagesById = createMemo(() => buildLookupById(subagent()?.messages));
  const hasActiveStreamingMessage = createMemo(() => {
    return (
      subagent()?.messages.some(
        (message) => message.assistantStreaming?.isStreaming === true,
      ) ?? false
    );
  });
  const renderedStatus = createMemo(() => {
    if (hasActiveStreamingMessage()) {
      return "running";
    }

    return subagent()?.status;
  });
  const subagentStatus = createMemo(() => normalizeStatus(renderedStatus()));
  const showTerminalStatusRow = createMemo(() => {
    if (hasActiveStreamingMessage()) {
      return false;
    }

    const currentStatus = normalizeStatus(subagent()?.status);
    return !!currentStatus && TERMINAL_SUBAGENT_STATUSES.has(currentStatus);
  });

  return (
    <Show when={subagent()}>
      <section
        class={`run-chat-tool-rail__subagent-panel${subagentStatus() ? ` run-chat-tool-rail__subagent-panel--${subagentStatus()}` : ""}`}
        aria-label={`${subagent()?.label} output`}
      >
        <div class="run-chat-tool-rail__subagent-header">
          <p class="run-chat-tool-rail__subagent-title">{subagent()?.label}</p>
        </div>
        <div class="run-chat-tool-rail__subagent-body">
          <For each={visibleMessageIds()}>
            {(messageId) => (
              <RunChatToolRailSubagentMessageItem
                message={() => messagesById()[messageId]}
              />
            )}
          </For>
          <Show when={showTerminalStatusRow()}>
            <div class="run-chat-tool-rail__subagent-status-row">
              <RunChatToolRailStatus status={subagent()?.status} />
            </div>
          </Show>
        </div>
      </section>
    </Show>
  );
};

type RunChatToolRailItemProps = {
  item: () => RunChatToolRailItem | undefined;
};

const RunChatToolRailItemRow: Component<RunChatToolRailItemProps> = (props) => {
  const item = createMemo(() => props.item());
  const statusModifier = createMemo(() => normalizeStatus(item()?.status));
  const rowSummary = createMemo(() => item()?.summary ?? item()?.label ?? "");
  const isTaskContainer = createMemo(
    () => item()?.isTask && (item()?.subagents?.length ?? 0) > 0,
  );
  const itemClass = createMemo(() => {
    return [
      "run-chat-tool-rail__item",
      statusModifier() ? `run-chat-tool-rail__item--${statusModifier()}` : null,
      isTaskContainer() ? "run-chat-tool-rail__item--task" : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ");
  });
  const subagentIds = createMemo(() => {
    return item()?.subagents?.map((subagent) => subagent.id) ?? [];
  });
  const subagentsById = createMemo(() => buildLookupById(item()?.subagents));

  return (
    <Show when={item()}>
      <li class={itemClass()}>
        <div
          class={
            isTaskContainer() ? "run-chat-tool-rail__task-shell" : undefined
          }
        >
          <div class="run-chat-tool-rail__row">
            <span
              class={
                isTaskContainer()
                  ? "run-chat-tool-rail__task-title"
                  : "run-chat-tool-rail__line"
              }
            >
              {rowSummary()}
            </span>
            <RunChatToolRailStatus status={item()?.status} />
          </div>
        </div>
        <Show when={subagentIds().length > 0}>
          <div class="run-chat-tool-rail__subagents">
            <For each={subagentIds()}>
              {(subagentId) => (
                <RunChatToolRailSubagentPanel
                  subagent={() => subagentsById()[subagentId]}
                />
              )}
            </For>
          </div>
        </Show>
      </li>
    </Show>
  );
};

const RunChatToolRail: Component<RunChatToolRailProps> = (props) => {
  // Key nested reconciliation by stable ids instead of rebuilt object
  // references so concurrent child-session updates do not remount cards.
  const itemIds = createMemo(() => props.items.map((item) => item.id));
  const itemsById = createMemo(() => buildLookupById(props.items));

  return (
    <section
      class={`run-chat-tool-rail ${props.class ?? ""}`.trim()}
      aria-label="Tool activity"
    >
      <Show
        when={props.items.length > 0}
        fallback={
          <p class="run-chat-tool-rail__empty">
            {props.emptyLabel ?? "No tool activity"}
          </p>
        }
      >
        <ul class="run-chat-tool-rail__list">
          <For each={itemIds()}>
            {(itemId) => (
              <RunChatToolRailItemRow item={() => itemsById()[itemId]} />
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
};

export default RunChatToolRail;
