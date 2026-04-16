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

import { render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import type { UiAssistantStreamingMetadata } from "../../model/agentTypes";
import RunChatToolRail, {
  type RunChatToolRailItem,
} from "../chat/RunChatToolRail";

const createStreamingMetadata = (
  overrides: Partial<UiAssistantStreamingMetadata> & {
    messageId?: string;
    targetText?: string;
    streamRevision?: number;
    isStreaming?: boolean;
    lifecycle?: UiAssistantStreamingMetadata["lifecycle"];
  } = {},
): UiAssistantStreamingMetadata => {
  const messageId = overrides.messageId ?? "assistant-1";
  const targetText = overrides.targetText ?? "";
  const streamRevision = overrides.streamRevision ?? 0;
  const isStreaming = overrides.isStreaming ?? false;
  const lifecycle =
    overrides.lifecycle ?? (isStreaming ? "streaming" : "settled");

  return {
    messageId,
    isStreaming,
    streamRevision,
    streamToken: `${messageId}:${streamRevision}:${isStreaming ? "live" : lifecycle}`,
    lifecycle,
    targetText,
    reasoningTargetText: "",
    hasVisibleContent: targetText.length > 0,
    isPlaceholderOnly: targetText.length === 0 && isStreaming,
    text: {
      targetText,
      isStreaming,
      streamRevision,
      streamToken: `${messageId}:text:${streamRevision}`,
      lifecycle,
      hasVisibleContent: targetText.length > 0,
      isPlaceholderOnly: targetText.length === 0 && isStreaming,
    },
    reasoning: {
      targetText: "",
      isStreaming: false,
      streamRevision: 0,
      streamToken: `${messageId}:reasoning:0`,
      lifecycle: "static",
      hasVisibleContent: false,
      isPlaceholderOnly: false,
    },
    ...overrides,
  };
};

describe("RunChatToolRail", () => {
  it("renders a failed tool call with a dedicated error icon", () => {
    const { container } = render(() => (
      <RunChatToolRail
        items={[
          {
            id: "tool-1",
            label: "Bash",
            summary: "Command execution failed",
            status: "failed",
          },
        ]}
      />
    ));

    const failedItem = container.querySelector(
      ".run-chat-tool-rail__item--failed",
    );
    const failedIcon = container.querySelector(
      ".run-chat-tool-rail__status-icon--error",
    );

    expect(failedItem).toBeTruthy();
    expect(failedIcon?.tagName.toLowerCase()).toBe("svg");
  });

  it("keeps running and completed status visuals", () => {
    const { container } = render(() => (
      <RunChatToolRail
        items={[
          {
            id: "tool-1",
            label: "Bash",
            summary: "Command in progress",
            status: "running",
          },
          {
            id: "tool-2",
            label: "Write",
            summary: "File updated",
            status: "completed",
          },
        ]}
      />
    ));

    expect(
      container.querySelector(
        ".run-chat-tool-rail__status-slot .run-inline-loader",
      ),
    ).toBeTruthy();
    expect(
      container.querySelector(".run-chat-tool-rail__status-icon--check"),
    ).toBeTruthy();
  });

  it("renders contained subagent output inside a tool item", () => {
    const { container, getByText } = render(() => (
      <RunChatToolRail
        items={[
          {
            id: "tool-1",
            label: "Task",
            summary: "Map transcript UI",
            status: "running",
            isTask: true,
            subagents: [
              {
                id: "subagent-1",
                label: "Explore android folder - chatgpt-5.4",
                status: "running",
                entries: [
                  {
                    id: "entry-1",
                    kind: "text",
                    messageId: "msg-1",
                    role: "assistant",
                    content: "Investigating transcript wiring.",
                    assistantStreaming: createStreamingMetadata({
                      messageId: "msg-1",
                      targetText: "Investigating transcript wiring.",
                    }),
                  },
                  {
                    id: "entry-2",
                    kind: "tool",
                    messageId: "msg-1",
                    role: "assistant",
                    toolItem: {
                      id: "tool-child-1",
                      summary: "-> Bash ls",
                      status: "completed",
                    },
                  },
                ],
              },
            ],
          },
        ]}
      />
    ));

    expect(
      container.querySelector(".run-chat-tool-rail__subagent-panel"),
    ).toBeTruthy();
    expect(getByText("Map transcript UI")).toBeTruthy();
    expect(getByText("Explore android folder - chatgpt-5.4")).toBeTruthy();
    expect(getByText("Investigating transcript wiring.")).toBeTruthy();
    expect(
      container.querySelector(
        ".run-chat-tool-rail__subagent-tool .run-chat-tool-rail__status-icon--check",
      ),
    ).toBeTruthy();
    expect(
      container.querySelectorAll(
        ".run-chat-tool-rail__subagent-header .run-inline-loader",
      ).length,
    ).toBe(0);
    expect(
      container.querySelector(".run-chat-tool-rail__subagent-status-row"),
    ).toBeNull();
  });

  it("caps subagent cards by the last three visible entries", () => {
    const { queryByText, getByText } = render(() => (
      <RunChatToolRail
        items={[
          {
            id: "tool-1",
            label: "Task",
            summary: "Keep panel compact",
            status: "running",
            isTask: true,
            subagents: [
              {
                id: "subagent-1",
                label: "Trim transcript (@fixer)",
                status: "running",
                entries: [
                  {
                    id: "entry-1",
                    kind: "text",
                    messageId: "msg-1",
                    role: "assistant",
                    content: "Oldest message",
                  },
                  {
                    id: "entry-2",
                    kind: "text",
                    messageId: "msg-2",
                    role: "assistant",
                    content: "Older message",
                  },
                  {
                    id: "entry-3",
                    kind: "text",
                    messageId: "msg-3",
                    role: "assistant",
                    content: "Recent message",
                  },
                  {
                    id: "entry-4",
                    kind: "text",
                    messageId: "msg-4",
                    role: "assistant",
                    content: "Newest message",
                  },
                ],
              },
            ],
          },
        ]}
      />
    ));

    expect(queryByText("Oldest message")).toBeNull();
    expect(getByText("Older message")).toBeTruthy();
    expect(getByText("Recent message")).toBeTruthy();
    expect(getByText("Newest message")).toBeTruthy();
  });

  it("caps mixed reasoning, tool, and text sequences by visible entries", () => {
    const { container, queryByText, getByText } = render(() => (
      <RunChatToolRail
        items={[
          {
            id: "tool-1",
            label: "Task",
            summary: "Keep mixed entry tail compact",
            status: "running",
            isTask: true,
            subagents: [
              {
                id: "subagent-1",
                label: "Mixed tail",
                status: "running",
                entries: [
                  {
                    id: "entry-1",
                    kind: "text",
                    messageId: "msg-1",
                    role: "assistant",
                    content: "Trimmed text",
                  },
                  {
                    id: "entry-2",
                    kind: "reasoning",
                    messageId: "msg-2",
                    role: "assistant",
                    content: "Reasoning stays visible",
                  },
                  {
                    id: "entry-3",
                    kind: "tool",
                    messageId: "msg-2",
                    role: "assistant",
                    toolItem: {
                      id: "tool-child-1",
                      summary: "-> Bash pwd",
                      status: "completed",
                    },
                  },
                  {
                    id: "entry-4",
                    kind: "text",
                    messageId: "msg-3",
                    role: "assistant",
                    content: "Newest text",
                  },
                ],
              },
            ],
          },
        ]}
      />
    ));

    expect(queryByText("Trimmed text")).toBeNull();
    expect(getByText("Reasoning stays visible")).toBeTruthy();
    expect(getByText("-> Bash pwd")).toBeTruthy();
    expect(getByText("Newest text")).toBeTruthy();
    expect(
      container.querySelectorAll(".run-chat-tool-rail__subagent-message")
        .length,
    ).toBe(3);
  });

  it("shows a delegating empty state before subagent output arrives", () => {
    const { getAllByText } = render(() => (
      <RunChatToolRail
        items={[
          {
            id: "tool-1",
            label: "Task",
            summary: "~ Delegating...",
            status: "running",
            isTask: true,
            subagents: [
              {
                id: "subagent-1",
                label: "~ Delegating...",
                status: "running",
                entries: [],
              },
            ],
          },
        ]}
      />
    ));

    expect(getAllByText("~ Delegating...").length).toBeGreaterThan(0);
  });

  it("preserves mounted subagent cards and message targets across overlapping updates", async () => {
    const [items, setItems] = createSignal<RunChatToolRailItem[]>([
      {
        id: "tool-1",
        label: "Task",
        summary: "Coordinate concurrent agents",
        status: "running",
        isTask: true,
        subagents: [
          {
            id: "subagent-a",
            label: "Planner",
            status: "running",
            entries: [
              {
                id: "entry-a",
                kind: "text",
                messageId: "msg-a",
                role: "assistant" as const,
                content: "Planner draft",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-a",
                  targetText: "Planner draft",
                  streamRevision: 1,
                  isStreaming: true,
                  lifecycle: "streaming",
                }),
              },
            ],
          },
          {
            id: "subagent-b",
            label: "Researcher",
            status: "running",
            entries: [
              {
                id: "entry-b",
                kind: "text",
                messageId: "msg-b",
                role: "assistant" as const,
                content: "Research notes",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-b",
                  targetText: "Research notes",
                  streamRevision: 1,
                  isStreaming: true,
                  lifecycle: "streaming",
                }),
              },
            ],
          },
        ],
      },
    ]);

    const { container } = render(() => <RunChatToolRail items={items()} />);
    const plannerPanel = () =>
      container.querySelector('[aria-label="Planner output"]');
    const researcherPanel = () =>
      container.querySelector('[aria-label="Researcher output"]');
    const plannerMessage = () =>
      container.querySelector('[data-message-id="msg-a"]');
    const researcherMessage = () =>
      container.querySelector('[data-message-id="msg-b"]');

    const initialPlannerPanel = plannerPanel();
    const initialResearcherPanel = researcherPanel();
    const initialPlannerMessage = plannerMessage();
    const initialResearcherMessage = researcherMessage();

    expect(initialPlannerPanel).toBeTruthy();
    expect(initialResearcherPanel).toBeTruthy();
    expect(initialPlannerMessage).toBeTruthy();
    expect(initialResearcherMessage).toBeTruthy();

    setItems([
      {
        id: "tool-1",
        label: "Task",
        summary: "Coordinate concurrent agents",
        status: "running",
        isTask: true,
        subagents: [
          {
            id: "subagent-a",
            label: "Planner",
            status: "running",
            entries: [
              {
                id: "entry-a",
                kind: "text",
                messageId: "msg-a",
                role: "assistant" as const,
                content: "Planner draft refined",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-a",
                  targetText: "Planner draft refined",
                  streamRevision: 2,
                  isStreaming: true,
                  lifecycle: "streaming",
                }),
              },
            ],
          },
          {
            id: "subagent-b",
            label: "Researcher",
            status: "running",
            entries: [
              {
                id: "entry-b",
                kind: "text",
                messageId: "msg-b",
                role: "assistant" as const,
                content: "Research notes expanded",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-b",
                  targetText: "Research notes expanded",
                  streamRevision: 2,
                  isStreaming: true,
                  lifecycle: "streaming",
                }),
              },
            ],
          },
        ],
      },
    ]);

    await waitFor(() => {
      expect(plannerPanel()).toBe(initialPlannerPanel);
      expect(researcherPanel()).toBe(initialResearcherPanel);
      expect(plannerMessage()).toBe(initialPlannerMessage);
      expect(researcherMessage()).toBe(initialResearcherMessage);
      expect(plannerPanel()?.textContent).toContain("Planner draft refined");
      expect(researcherPanel()?.textContent).toContain(
        "Research notes expanded",
      );
    });
  });

  it("keeps surviving message nodes mounted when the visible child window shifts", async () => {
    const [items, setItems] = createSignal<RunChatToolRailItem[]>([
      {
        id: "tool-1",
        label: "Task",
        summary: "Trim visible history",
        status: "running",
        isTask: true,
        subagents: [
          {
            id: "subagent-1",
            label: "Recorder",
            status: "running",
            entries: [
              {
                id: "entry-1",
                kind: "text",
                messageId: "msg-1",
                role: "assistant" as const,
                content: "One",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-1",
                  targetText: "One",
                }),
              },
              {
                id: "entry-2",
                kind: "text",
                messageId: "msg-2",
                role: "assistant" as const,
                content: "Two",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-2",
                  targetText: "Two",
                }),
              },
              {
                id: "entry-3",
                kind: "text",
                messageId: "msg-3",
                role: "assistant" as const,
                content: "Three",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-3",
                  targetText: "Three",
                }),
              },
              {
                id: "entry-4",
                kind: "text",
                messageId: "msg-4",
                role: "assistant" as const,
                content: "Four",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-4",
                  targetText: "Four",
                }),
              },
            ],
          },
        ],
      },
    ]);

    const { container } = render(() => <RunChatToolRail items={items()} />);
    const messageTwo = () =>
      container.querySelector('[data-message-id="msg-2"]');
    const messageThree = () =>
      container.querySelector('[data-message-id="msg-3"]');
    const messageFour = () =>
      container.querySelector('[data-message-id="msg-4"]');

    const initialMessageThree = messageThree();
    const initialMessageFour = messageFour();

    expect(messageTwo()).toBeTruthy();
    expect(initialMessageThree).toBeTruthy();
    expect(initialMessageFour).toBeTruthy();

    setItems([
      {
        id: "tool-1",
        label: "Task",
        summary: "Trim visible history",
        status: "running",
        isTask: true,
        subagents: [
          {
            id: "subagent-1",
            label: "Recorder",
            status: "running",
            entries: [
              {
                id: "entry-1",
                kind: "text",
                messageId: "msg-1",
                role: "assistant" as const,
                content: "One",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-1",
                  targetText: "One",
                }),
              },
              {
                id: "entry-2",
                kind: "text",
                messageId: "msg-2",
                role: "assistant" as const,
                content: "Two",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-2",
                  targetText: "Two",
                }),
              },
              {
                id: "entry-3",
                kind: "text",
                messageId: "msg-3",
                role: "assistant" as const,
                content: "Three",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-3",
                  targetText: "Three",
                }),
              },
              {
                id: "entry-4",
                kind: "text",
                messageId: "msg-4",
                role: "assistant" as const,
                content: "Four",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-4",
                  targetText: "Four",
                }),
              },
              {
                id: "entry-5",
                kind: "text",
                messageId: "msg-5",
                role: "assistant" as const,
                content: "Five",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-5",
                  targetText: "Five",
                }),
              },
            ],
          },
        ],
      },
    ]);

    await waitFor(() => {
      expect(messageTwo()).toBeNull();
      expect(messageThree()).toBe(initialMessageThree);
      expect(messageFour()).toBe(initialMessageFour);
      expect(container.querySelector('[data-message-id="msg-5"]')).toBeTruthy();
    });
  });

  it("counts a newly started assistant placeholder toward the visible tail", () => {
    const { container, queryByText, getByText } = render(() => (
      <RunChatToolRail
        items={[
          {
            id: "tool-1",
            label: "Task",
            summary: "Track streaming tail",
            status: "running",
            isTask: true,
            subagents: [
              {
                id: "subagent-1",
                label: "Streamer",
                status: "running",
                entries: [
                  {
                    id: "entry-1",
                    kind: "text",
                    messageId: "msg-1",
                    role: "assistant",
                    content: "First visible candidate",
                  },
                  {
                    id: "entry-2",
                    kind: "text",
                    messageId: "msg-2",
                    role: "assistant",
                    content: "Second visible candidate",
                  },
                  {
                    id: "entry-3",
                    kind: "text",
                    messageId: "msg-3",
                    role: "assistant",
                    content: "Third visible candidate",
                  },
                  {
                    id: "entry-4",
                    kind: "assistant-placeholder",
                    messageId: "msg-4",
                    role: "assistant",
                    isStreaming: true,
                    streamToken: "msg-4:placeholder:1",
                  },
                ],
              },
            ],
          },
        ]}
      />
    ));

    expect(queryByText("First visible candidate")).toBeNull();
    expect(getByText("Second visible candidate")).toBeTruthy();
    expect(getByText("Third visible candidate")).toBeTruthy();
    expect(
      container.querySelector(
        ".run-chat-tool-rail__subagent-message .run-inline-loader",
      ),
    ).toBeTruthy();
  });

  it("keeps a completed card visually running until streaming content settles", async () => {
    const [items, setItems] = createSignal<RunChatToolRailItem[]>([
      {
        id: "tool-1",
        label: "Task",
        summary: "Finalize output",
        status: "running",
        isTask: true,
        subagents: [
          {
            id: "subagent-1",
            label: "Finisher",
            status: "completed",
            entries: [
              {
                id: "entry-1",
                kind: "text",
                messageId: "msg-1",
                role: "assistant" as const,
                content: "Still streaming",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-1",
                  targetText: "Still streaming",
                  streamRevision: 1,
                  isStreaming: true,
                  lifecycle: "streaming",
                }),
              },
            ],
          },
        ],
      },
    ]);

    const { container } = render(() => <RunChatToolRail items={items()} />);
    const panel = () =>
      container.querySelector('[aria-label="Finisher output"]');
    const initialPanel = panel();

    expect(initialPanel?.className).toContain(
      "run-chat-tool-rail__subagent-panel--running",
    );
    expect(initialPanel?.className).not.toContain(
      "run-chat-tool-rail__subagent-panel--completed",
    );
    expect(
      container.querySelector(".run-chat-tool-rail__subagent-status-row"),
    ).toBeNull();

    setItems([
      {
        id: "tool-1",
        label: "Task",
        summary: "Finalize output",
        status: "running",
        isTask: true,
        subagents: [
          {
            id: "subagent-1",
            label: "Finisher",
            status: "completed",
            entries: [
              {
                id: "entry-1",
                kind: "text",
                messageId: "msg-1",
                role: "assistant" as const,
                content: "Settled final output",
                assistantStreaming: createStreamingMetadata({
                  messageId: "msg-1",
                  targetText: "Settled final output",
                  streamRevision: 2,
                  isStreaming: false,
                  lifecycle: "settled",
                }),
              },
            ],
          },
        ],
      },
    ]);

    await waitFor(() => {
      expect(panel()).toBe(initialPanel);
      expect(panel()?.className).toContain(
        "run-chat-tool-rail__subagent-panel--completed",
      );
      expect(
        container.querySelector(".run-chat-tool-rail__subagent-status-row"),
      ).toBeTruthy();
    });
  });
});
