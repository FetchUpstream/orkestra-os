import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import NewRunChatWorkspace from "../NewRunChatWorkspace";

const createModelStub = (
  runStatus: "running" | "completed",
  withPendingPermission = false,
  runOverrides: Record<string, unknown> = {},
) => {
  const [run, setRun] = createSignal({ status: runStatus, ...runOverrides });

  const model = {
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
      runAgentOptions: () => [{ id: "agent-1", label: "Planner" }],
      runProviderOptions: () => [{ id: "provider-1", label: "OpenAI" }],
      runModelOptions: () => [
        { id: "model-1", label: "GPT-5", providerId: "provider-1" },
      ],
      runSelectionOptionsError: () => "",
      replyPermission: vi.fn(async () => true),
    },
  } as unknown as ReturnType<
    typeof import("../../model/useRunDetailModel").useRunDetailModel
  >;

  return { model, setRun };
};

describe("NewRunChatWorkspace", () => {
  it("disables composer for completed runs and keeps read-only copy visible", () => {
    const { model } = createModelStub("completed");
    render(() => <NewRunChatWorkspace model={model} />);

    const textbox = screen.getByLabelText("Message agent");
    expect(textbox.getAttribute("disabled")).not.toBeNull();
    expect(screen.getByText("Run completed. Read-only.")).toBeTruthy();
  });

  it("renders blocking permission card and disables composer", () => {
    const { model } = createModelStub("running", true);
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

  it("hides cleanup status when cleanup is pending", () => {
    const { model } = createModelStub("running", false, {
      cleanupState: "pending",
    });
    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.queryByText("Cleanup")).toBeNull();
  });

  it("shows cleanup status copy for running and succeeded states", () => {
    const { model, setRun } = createModelStub("running", false, {
      cleanupState: "running",
    });
    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByText("Cleanup")).toBeTruthy();
    expect(screen.getByText("Running cleanup script...")).toBeTruthy();

    setRun({ status: "running", cleanupState: "succeeded" });
    expect(screen.getByText("Cleanup script completed.")).toBeTruthy();
  });

  it("prefers cleanup error detail and falls back to generic copy", () => {
    const { model, setRun } = createModelStub("running", false, {
      cleanupState: "failed",
      cleanupErrorMessage: "Cleanup failed on lockfile permissions.",
    });
    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByText("Cleanup")).toBeTruthy();
    expect(
      screen.getByText("Cleanup failed on lockfile permissions."),
    ).toBeTruthy();

    setRun({
      status: "running",
      cleanupState: "failed",
      cleanupErrorMessage: "   ",
    });
    expect(
      screen.getByText(
        "Cleanup script found issues. The agent has been asked to fix them.",
      ),
    ).toBeTruthy();
  });

  it("updates setup card state without remount", () => {
    const { model, setRun } = createModelStub("running", false, {
      setupState: "running",
    });
    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByText("Running setup script...")).toBeTruthy();

    setRun({ status: "running", setupState: "succeeded" });
    expect(screen.getByText("Setup script completed.")).toBeTruthy();
  });

  it("submits composer message with optional override values", async () => {
    const submitPromptMock = vi.fn(async () => true);
    const { model } = createModelStub("running");
    model.agent.submitPrompt = submitPromptMock;

    render(() => <NewRunChatWorkspace model={model} />);

    await fireEvent.click(
      screen.getByRole("button", {
        name: "Optional: override agent/provider/model",
      }),
    );
    await fireEvent.change(screen.getByLabelText("Prompt override agent"), {
      target: { value: "agent-1" },
    });
    await fireEvent.change(screen.getByLabelText("Prompt override provider"), {
      target: { value: "provider-1" },
    });
    await fireEvent.change(screen.getByLabelText("Prompt override model"), {
      target: { value: "model-1" },
    });
    await fireEvent.input(screen.getByLabelText("Message agent"), {
      target: { value: "Hello" },
    });
    await fireEvent.submit(screen.getByLabelText("Chat composer"));

    expect(submitPromptMock).toHaveBeenCalledWith("Hello", {
      agentId: "agent-1",
      providerId: "provider-1",
      modelId: "model-1",
    });
  });

  it("resets one-shot overrides after successful submit", async () => {
    const submitPromptMock = vi.fn(async () => true);
    const { model } = createModelStub("running");
    model.agent.submitPrompt = submitPromptMock;

    render(() => <NewRunChatWorkspace model={model} />);

    await fireEvent.click(
      screen.getByRole("button", {
        name: "Optional: override agent/provider/model",
      }),
    );
    await fireEvent.change(screen.getByLabelText("Prompt override agent"), {
      target: { value: "agent-1" },
    });
    await fireEvent.change(screen.getByLabelText("Prompt override provider"), {
      target: { value: "provider-1" },
    });
    await fireEvent.change(screen.getByLabelText("Prompt override model"), {
      target: { value: "model-1" },
    });
    await fireEvent.input(screen.getByLabelText("Message agent"), {
      target: { value: "Hello" },
    });
    await fireEvent.submit(screen.getByLabelText("Chat composer"));

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Optional: override agent/provider/model",
        }),
      ).toBeTruthy();
    });
    expect(
      (screen.getByLabelText("Message agent") as HTMLTextAreaElement).value,
    ).toBe("");

    await fireEvent.input(screen.getByLabelText("Message agent"), {
      target: { value: "Second" },
    });
    await fireEvent.submit(screen.getByLabelText("Chat composer"));

    expect(submitPromptMock).toHaveBeenNthCalledWith(1, "Hello", {
      agentId: "agent-1",
      providerId: "provider-1",
      modelId: "model-1",
    });
    expect(submitPromptMock).toHaveBeenNthCalledWith(2, "Second", {
      agentId: undefined,
      providerId: undefined,
      modelId: undefined,
    });
  });

  it("clears stale override model and prevents mismatch submission", async () => {
    const submitPromptMock = vi.fn(async () => true);
    const { model } = createModelStub("running");
    model.agent.submitPrompt = submitPromptMock;
    model.agent.runProviderOptions = () => [
      { id: "provider-1", label: "OpenAI" },
      { id: "provider-2", label: "Anthropic" },
    ];
    model.agent.runModelOptions = () => [
      { id: "model-1", label: "GPT-5", providerId: "provider-1" },
      { id: "model-2", label: "Claude", providerId: "provider-2" },
    ];

    render(() => <NewRunChatWorkspace model={model} />);

    await fireEvent.click(
      screen.getByRole("button", {
        name: "Optional: override agent/provider/model",
      }),
    );
    await fireEvent.change(screen.getByLabelText("Prompt override provider"), {
      target: { value: "provider-1" },
    });
    await fireEvent.change(screen.getByLabelText("Prompt override model"), {
      target: { value: "model-1" },
    });
    await fireEvent.change(screen.getByLabelText("Prompt override provider"), {
      target: { value: "provider-2" },
    });

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Prompt override model") as HTMLSelectElement)
          .value,
      ).toBe("");
    });

    await fireEvent.input(screen.getByLabelText("Message agent"), {
      target: { value: "Hello" },
    });
    await fireEvent.submit(screen.getByLabelText("Chat composer"));

    expect(submitPromptMock).toHaveBeenCalledWith("Hello", {
      agentId: undefined,
      providerId: "provider-2",
      modelId: undefined,
    });
  });
});
