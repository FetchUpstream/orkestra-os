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

import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import RunChatToolRail from "../chat/RunChatToolRail";

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
        ".run-chat-tool-rail__status-slot .run-inline-spinner",
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
                messages: [
                  {
                    id: "msg-1",
                    role: "assistant",
                    content: "Investigating transcript wiring.",
                    toolItems: [
                      {
                        id: "tool-child-1",
                        summary: "-> Bash ls",
                        status: "completed",
                      },
                    ],
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
        ".run-chat-tool-rail__subagent-header .run-inline-spinner",
      ).length,
    ).toBe(0);
    expect(
      container.querySelector(
        ".run-chat-tool-rail__subagent-status-row .run-inline-spinner",
      ),
    ).toBeTruthy();
  });

  it("renders only the last three subagent messages", () => {
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
                messages: [
                  {
                    id: "msg-1",
                    role: "assistant",
                    content: "Oldest message",
                  },
                  {
                    id: "msg-2",
                    role: "assistant",
                    content: "Older message",
                  },
                  {
                    id: "msg-3",
                    role: "assistant",
                    content: "Recent message",
                  },
                  {
                    id: "msg-4",
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
                messages: [],
              },
            ],
          },
        ]}
      />
    ));

    expect(getAllByText("~ Delegating...").length).toBeGreaterThan(0);
  });
});
