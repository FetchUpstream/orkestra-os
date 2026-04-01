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
            summary: "-> Task Map transcript UI",
            status: "running",
            isTask: true,
            subagents: [
              {
                id: "subagent-1",
                label: "Explore android folder (@explorer)",
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
    expect(getByText("-> Task Map transcript UI")).toBeTruthy();
    expect(getByText("Explore android folder (@explorer)")).toBeTruthy();
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
});
