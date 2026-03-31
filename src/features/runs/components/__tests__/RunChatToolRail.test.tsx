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
});
