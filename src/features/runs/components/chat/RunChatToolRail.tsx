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

import { For, Match, Show, Switch, createMemo, type Component } from "solid-js";
import RunInlineLoader from "../../../../components/ui/RunInlineLoader";
import { AppIcon } from "../../../../components/ui/icons";
import type { UiAssistantStreamingMetadata } from "../../model/agentTypes";
import RunChatAssistantMessage from "./RunChatAssistantMessage";
import RunChatMarkdown from "./RunChatMarkdown";

const SUBAGENT_VISIBLE_ENTRY_LIMIT = 3;

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

export type RunChatToolRailSubagentToolItem = {
  id: string;
  summary: string;
  status?: string;
};

type RunChatToolRailSubagentBaseEntry = {
  id: string;
  messageId: string;
  role: "assistant" | "user" | "system" | "unknown";
  isStreaming?: boolean;
  streamToken?: string;
};

export type RunChatToolRailSubagentEntry =
  | (RunChatToolRailSubagentBaseEntry & {
      kind: "text";
      content: string;
      assistantStreaming?: UiAssistantStreamingMetadata;
    })
  | (RunChatToolRailSubagentBaseEntry & {
      kind: "reasoning";
      content: string;
    })
  | (RunChatToolRailSubagentBaseEntry & {
      kind: "tool";
      toolItem: RunChatToolRailSubagentToolItem;
    })
  | (RunChatToolRailSubagentBaseEntry & {
      kind: "assistant-placeholder";
      role: "assistant";
      isStreaming: true;
      streamToken: string;
    });

export type RunChatToolRailSubagentItem = {
  id: string;
  label: string;
  status?: string;
  entries: readonly RunChatToolRailSubagentEntry[];
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

const isSubagentEntryStreaming = (
  entry: RunChatToolRailSubagentEntry,
): boolean => {
  switch (entry.kind) {
    case "assistant-placeholder":
      return true;
    case "text":
      return (
        entry.isStreaming === true ||
        entry.assistantStreaming?.isStreaming === true
      );
    case "reasoning":
      return entry.isStreaming === true;
    case "tool":
      return false;
  }
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
  toolItem: () => RunChatToolRailSubagentToolItem | undefined;
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

type RunChatToolRailSubagentEntryProps = {
  entry: () => RunChatToolRailSubagentEntry | undefined;
};

const RunChatToolRailSubagentEntryItem: Component<
  RunChatToolRailSubagentEntryProps
> = (props) => {
  const entry = createMemo(() => props.entry());
  const textEntry = createMemo(() => {
    const currentEntry = entry();
    return currentEntry?.kind === "text" ? currentEntry : undefined;
  });
  const reasoningEntry = createMemo(() => {
    const currentEntry = entry();
    return currentEntry?.kind === "reasoning" ? currentEntry : undefined;
  });
  const toolEntry = createMemo(() => {
    const currentEntry = entry();
    return currentEntry?.kind === "tool" ? currentEntry : undefined;
  });
  const placeholderEntry = createMemo(() => {
    const currentEntry = entry();
    return currentEntry?.kind === "assistant-placeholder"
      ? currentEntry
      : undefined;
  });
  const assistantTextEntry = createMemo(() => {
    const currentEntry = textEntry();
    return currentEntry?.role === "assistant" ? currentEntry : undefined;
  });

  return (
    <Show when={entry()}>
      <article
        class="run-chat-tool-rail__subagent-message"
        data-run-chat-subagent-entry-id={entry()?.id}
        data-run-chat-subagent-entry-kind={entry()?.kind}
      >
        <Switch>
          <Match when={placeholderEntry()}>
            <RunInlineLoader
              as="p"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            />
          </Match>
          <Match when={toolEntry()}>
            <ul class="run-chat-tool-rail__subagent-tools">
              <RunChatToolRailSubagentToolItem
                toolItem={() => toolEntry()?.toolItem}
              />
            </ul>
          </Match>
          <Match when={reasoningEntry()}>
            <div class="run-chat-tool-rail__subagent-reasoning">
              <RunChatMarkdown
                content={`*Thinking:* ${reasoningEntry()?.content ?? ""}`}
              />
            </div>
          </Match>
          <Match when={assistantTextEntry()}>
            <RunChatAssistantMessage
              content={
                assistantTextEntry()?.content.length
                  ? (assistantTextEntry()?.content ?? " ")
                  : " "
              }
              streaming={assistantTextEntry()?.assistantStreaming}
              isStreamingActive={
                assistantTextEntry()?.assistantStreaming?.isStreaming === true
              }
            />
          </Match>
          <Match when={textEntry()}>
            <div class="run-chat-tool-rail__subagent-markdown">
              <RunChatMarkdown content={textEntry()?.content ?? ""} />
            </div>
          </Match>
        </Switch>
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
  const visibleEntryIds = createMemo(() => {
    return (
      subagent()
        ?.entries.slice(-SUBAGENT_VISIBLE_ENTRY_LIMIT)
        .map((entry) => entry.id) ?? []
    );
  });
  const entriesById = createMemo(() => buildLookupById(subagent()?.entries));
  const hasActiveStreamingEntry = createMemo(() => {
    return (
      subagent()?.entries.some((entry) => isSubagentEntryStreaming(entry)) ??
      false
    );
  });
  const renderedStatus = createMemo(() => {
    if (hasActiveStreamingEntry()) {
      return "running";
    }

    return subagent()?.status;
  });
  const subagentStatus = createMemo(() => normalizeStatus(renderedStatus()));
  const showCompletedSummaryOnly = createMemo(() => {
    return !hasActiveStreamingEntry() && subagentStatus() === "completed";
  });
  const showTerminalStatusRow = createMemo(() => {
    if (hasActiveStreamingEntry()) {
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
          <Show when={showCompletedSummaryOnly()}>
            <p class="run-chat-tool-rail__subagent-summary">Completed</p>
          </Show>
          <Show when={!showCompletedSummaryOnly()}>
            <For each={visibleEntryIds()}>
              {(entryId) => (
                <RunChatToolRailSubagentEntryItem
                  entry={() => entriesById()[entryId]}
                />
              )}
            </For>
          </Show>
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
