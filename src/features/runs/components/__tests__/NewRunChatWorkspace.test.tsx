import { render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import NewRunChatWorkspace from "../NewRunChatWorkspace";

const createModelStub = (
  runStatus: "running" | "completed",
  withPendingPermission = false,
) => {
  const [run] = createSignal({ status: runStatus });

  return {
    run,
    agent: {
      readinessPhase: () => "ready",
      state: () => "running",
      error: () => "",
      store: () => ({
        messageOrder: [],
        messagesById: {},
        pendingPermissionsById: withPendingPermission
          ? {
              "perm-1": {
                requestId: "perm-1",
                sessionId: "session-1",
                kind: "write",
                pathPatterns: ["src/**/*.ts"],
                metadata: { tool: "write" },
              },
            }
          : {},
      }),
      isSubmittingPrompt: () => false,
      isReplyingPermission: () => false,
      submitError: () => "",
      permissionReplyError: () => "",
      submitPrompt: vi.fn(async () => true),
      replyPermission: vi.fn(async () => true),
    },
  } as unknown as ReturnType<
    typeof import("../../model/useRunDetailModel").useRunDetailModel
  >;
};

describe("NewRunChatWorkspace", () => {
  it("disables composer for completed runs and keeps read-only copy visible", () => {
    const model = createModelStub("completed");
    render(() => <NewRunChatWorkspace model={model} />);

    const textbox = screen.getByLabelText("Message agent");
    expect(textbox.getAttribute("disabled")).not.toBeNull();
    expect(screen.getByText("Run completed. Read-only.")).toBeTruthy();
  });

  it("renders blocking permission card and disables composer", () => {
    const model = createModelStub("running", true);
    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByText("Permission required")).toBeTruthy();
    expect(screen.getByText(/Type:/)).toBeTruthy();
    expect(screen.getByText("write")).toBeTruthy();
    expect(screen.getByText("src/**/*.ts")).toBeTruthy();

    const textbox = screen.getByLabelText("Message agent");
    expect(textbox.getAttribute("disabled")).not.toBeNull();
    expect(
      screen.getByText(
        "Prompt submission is blocked until this permission is answered.",
      ),
    ).toBeTruthy();
  });
});
