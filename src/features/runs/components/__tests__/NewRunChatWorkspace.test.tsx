import { render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import NewRunChatWorkspace from "../NewRunChatWorkspace";

const createModelStub = (runStatus: "running" | "completed") => {
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
      }),
      isSubmittingPrompt: () => false,
      submitError: () => "",
      submitPrompt: vi.fn(async () => true),
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
});
