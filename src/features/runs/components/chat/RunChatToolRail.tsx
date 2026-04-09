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

import { For, Show, type Component } from "solid-js";
import RunInlineLoader from "../../../../components/ui/RunInlineLoader";
import { AppIcon } from "../../../../components/ui/icons";
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

const RunChatToolRail: Component<RunChatToolRailProps> = (props) => {
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
          <For each={props.items}>
            {(item) => {
              const statusModifier = normalizeStatus(item.status);
              const rowSummary = item.summary ?? item.label;
              const isTaskContainer =
                item.isTask && (item.subagents?.length ?? 0) > 0;

              return (
                <li
                  class={`run-chat-tool-rail__item${statusModifier ? ` run-chat-tool-rail__item--${statusModifier}` : ""}${isTaskContainer ? "run-chat-tool-rail__item--task" : ""}`}
                >
                  <div
                    class={
                      isTaskContainer
                        ? "run-chat-tool-rail__task-shell"
                        : undefined
                    }
                  >
                    <div class="run-chat-tool-rail__row">
                      <span
                        class={
                          isTaskContainer
                            ? "run-chat-tool-rail__task-title"
                            : "run-chat-tool-rail__line"
                        }
                      >
                        {rowSummary}
                      </span>
                      <Show when={item.status}>
                        <span class="run-chat-tool-rail__status">
                          <Show when={statusModifier === "running"}>
                            <RunInlineLoader
                              class="run-chat-tool-rail__status-slot"
                              aria-label={item.status}
                              srLabel={item.status}
                            />
                          </Show>
                          <Show when={statusModifier === "completed"}>
                            <span
                              class="run-chat-tool-rail__status-slot"
                              aria-label={item.status}
                            >
                              <span
                                class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--check"
                                aria-hidden="true"
                              >
                                ✓
                              </span>
                              <span class="sr-only">{item.status}</span>
                            </span>
                          </Show>
                          <Show when={statusModifier === "failed"}>
                            <span
                              class="run-chat-tool-rail__status-slot"
                              aria-label={item.status}
                            >
                              <AppIcon
                                name="status.error"
                                class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--error"
                                aria-hidden="true"
                                size={14}
                              />
                              <span class="sr-only">{item.status}</span>
                            </span>
                          </Show>
                          <Show
                            when={
                              statusModifier !== "running" &&
                              statusModifier !== "completed" &&
                              statusModifier !== "failed"
                            }
                          >
                            {item.status}
                          </Show>
                        </span>
                      </Show>
                    </div>
                  </div>
                  <Show when={(item.subagents?.length ?? 0) > 0}>
                    <div class="run-chat-tool-rail__subagents">
                      <For each={item.subagents}>
                        {(subagent) => {
                          const subagentStatus = normalizeStatus(
                            subagent.status,
                          );
                          const visibleMessages = subagent.messages.slice(
                            -SUBAGENT_VISIBLE_MESSAGE_LIMIT,
                          );
                          return (
                            <section
                              class={`run-chat-tool-rail__subagent-panel${subagentStatus ? ` run-chat-tool-rail__subagent-panel--${subagentStatus}` : ""}`}
                              aria-label={`${subagent.label} output`}
                            >
                              <div class="run-chat-tool-rail__subagent-header">
                                <p class="run-chat-tool-rail__subagent-title">
                                  {subagent.label}
                                </p>
                              </div>
                              <div class="run-chat-tool-rail__subagent-body">
                                <For each={visibleMessages}>
                                  {(message) => (
                                    <article class="run-chat-tool-rail__subagent-message">
                                      <Show
                                        when={message.content?.trim().length}
                                      >
                                        <div class="run-chat-tool-rail__subagent-markdown">
                                          <RunChatMarkdown
                                            content={message.content ?? ""}
                                          />
                                        </div>
                                      </Show>
                                      <Show
                                        when={
                                          message.reasoningContent?.trim()
                                            .length
                                        }
                                      >
                                        <div class="run-chat-tool-rail__subagent-reasoning">
                                          <RunChatMarkdown
                                            content={`*Thinking:* ${message.reasoningContent ?? ""}`}
                                          />
                                        </div>
                                      </Show>
                                      <Show
                                        when={
                                          (message.toolItems?.length ?? 0) > 0
                                        }
                                      >
                                        <ul class="run-chat-tool-rail__subagent-tools">
                                          <For each={message.toolItems}>
                                            {(toolItem) => (
                                              <li class="run-chat-tool-rail__subagent-tool">
                                                <span>{toolItem.summary}</span>
                                                <Show when={toolItem.status}>
                                                  <span class="run-chat-tool-rail__status">
                                                    <Show
                                                      when={
                                                        normalizeStatus(
                                                          toolItem.status,
                                                        ) === "running"
                                                      }
                                                    >
                                                      <RunInlineLoader
                                                        class="run-chat-tool-rail__status-slot"
                                                        aria-label={
                                                          toolItem.status
                                                        }
                                                        srLabel={
                                                          toolItem.status
                                                        }
                                                      />
                                                    </Show>
                                                    <Show
                                                      when={
                                                        normalizeStatus(
                                                          toolItem.status,
                                                        ) === "completed"
                                                      }
                                                    >
                                                      <span
                                                        class="run-chat-tool-rail__status-slot"
                                                        aria-label={
                                                          toolItem.status
                                                        }
                                                      >
                                                        <span
                                                          class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--check"
                                                          aria-hidden="true"
                                                        >
                                                          ✓
                                                        </span>
                                                        <span class="sr-only">
                                                          {toolItem.status}
                                                        </span>
                                                      </span>
                                                    </Show>
                                                    <Show
                                                      when={
                                                        normalizeStatus(
                                                          toolItem.status,
                                                        ) === "failed"
                                                      }
                                                    >
                                                      <span
                                                        class="run-chat-tool-rail__status-slot"
                                                        aria-label={
                                                          toolItem.status
                                                        }
                                                      >
                                                        <AppIcon
                                                          name="status.error"
                                                          class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--error"
                                                          aria-hidden="true"
                                                          size={14}
                                                        />
                                                        <span class="sr-only">
                                                          {toolItem.status}
                                                        </span>
                                                      </span>
                                                    </Show>
                                                  </span>
                                                </Show>
                                              </li>
                                            )}
                                          </For>
                                        </ul>
                                      </Show>
                                    </article>
                                  )}
                                </For>
                                <Show
                                  when={
                                    subagent.status &&
                                    subagentStatus !== "running"
                                  }
                                >
                                  <div class="run-chat-tool-rail__subagent-status-row">
                                    <span class="run-chat-tool-rail__status">
                                      <Show
                                        when={subagentStatus === "completed"}
                                      >
                                        <span
                                          class="run-chat-tool-rail__status-slot"
                                          aria-label={subagent.status}
                                        >
                                          <span
                                            class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--check"
                                            aria-hidden="true"
                                          >
                                            ✓
                                          </span>
                                          <span class="sr-only">
                                            {subagent.status}
                                          </span>
                                        </span>
                                      </Show>
                                      <Show when={subagentStatus === "failed"}>
                                        <span
                                          class="run-chat-tool-rail__status-slot"
                                          aria-label={subagent.status}
                                        >
                                          <AppIcon
                                            name="status.error"
                                            class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--error"
                                            aria-hidden="true"
                                            size={14}
                                          />
                                          <span class="sr-only">
                                            {subagent.status}
                                          </span>
                                        </span>
                                      </Show>
                                    </span>
                                  </div>
                                </Show>
                              </div>
                            </section>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </section>
  );
};

export default RunChatToolRail;
