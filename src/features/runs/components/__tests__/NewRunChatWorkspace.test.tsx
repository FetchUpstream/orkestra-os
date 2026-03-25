import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import NewRunChatWorkspace from "../NewRunChatWorkspace";

const createModelStub = (
  runStatus: "running" | "completed",
  withPendingPermission = false,
  runOverrides: Record<string, unknown> = {},
  chatMode: "interactive" | "read_only" | "unavailable" = "interactive",
) => {
  const [run, setRun] = createSignal({ status: runStatus, ...runOverrides });

  const model = {
    run,
    agent: {
      chatMode: () => chatMode,
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

    expect(screen.queryByLabelText("Message agent")).toBeNull();
    expect(screen.getByText(/Work completed and merged into/)).toBeTruthy();
  });

  it("shows read-only empty transcript message for read_only mode", () => {
    const { model } = createModelStub("completed", false, {}, "read_only");
    render(() => <NewRunChatWorkspace model={model} />);

    expect(
      screen.getByText("No chat history is available for this completed run."),
    ).toBeTruthy();
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

  it("auto-selects provider override when selecting a model", async () => {
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

    await fireEvent.change(screen.getByLabelText("Prompt override model"), {
      target: { value: "model-2" },
    });

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Prompt override provider") as HTMLSelectElement)
          .value,
      ).toBe("provider-2");
    });

    await fireEvent.input(screen.getByLabelText("Message agent"), {
      target: { value: "Hello" },
    });
    await fireEvent.submit(screen.getByLabelText("Chat composer"));

    expect(submitPromptMock).toHaveBeenCalledWith("Hello", {
      agentId: undefined,
      providerId: "provider-2",
      modelId: "model-2",
    });
  });

  it("clears provider/model overrides when agent changes so submit still succeeds", async () => {
    const submitPromptMock = vi.fn(async () => true);
    const { model } = createModelStub("running");
    model.agent.submitPrompt = submitPromptMock;
    model.agent.runAgentOptions = () => [
      { id: "agent-1", label: "Planner" },
      { id: "agent-2", label: "Builder" },
    ];
    model.agent.runProviderOptions = () => [
      { id: "provider-1", label: "OpenAI" },
      { id: "provider-2", label: "Anthropic" },
    ];
    model.agent.runModelOptions = () => [
      { id: "model-1", label: "GPT-5", providerId: "provider-1" },
      { id: "model-2", label: "Claude", providerId: "provider-2" },
    ];

    render(() => <NewRunChatWorkspace model={model} />);

    await fireEvent.change(screen.getByLabelText("Prompt override provider"), {
      target: { value: "provider-1" },
    });
    await fireEvent.change(screen.getByLabelText("Prompt override model"), {
      target: { value: "model-1" },
    });
    await fireEvent.change(screen.getByLabelText("Prompt override agent"), {
      target: { value: "agent-2" },
    });

    expect(
      (screen.getByLabelText("Prompt override provider") as HTMLSelectElement)
        .value,
    ).toBe("");
    expect(
      (screen.getByLabelText("Prompt override model") as HTMLSelectElement)
        .value,
    ).toBe("");

    await fireEvent.input(screen.getByLabelText("Message agent"), {
      target: { value: "Hello" },
    });
    await fireEvent.submit(screen.getByLabelText("Chat composer"));

    expect(submitPromptMock).toHaveBeenCalledWith("Hello", {
      agentId: "agent-2",
      providerId: undefined,
      modelId: undefined,
    });
    expect(
      (screen.getByLabelText("Message agent") as HTMLTextAreaElement).value,
    ).toBe("");
  });

  it("renders assistant attribution subtitle only for assistant messages", () => {
    const { model } = createModelStub("running");
    model.agent.store = () => ({
      sessionId: "session-1",
      status: "idle",
      streamConnected: true,
      lastSyncAt: Date.now(),
      messageOrder: ["assistant-1", "user-1", "system-1", "assistant-2"],
      messagesById: {
        "assistant-1": {
          id: "assistant-1",
          sessionId: "session-1",
          role: "assistant",
          attribution: { agent: "explorer", model: "k2p5" },
          partsById: {
            "part-1": {
              id: "part-1",
              kind: "text",
              type: "text",
              text: "Hello",
              streaming: false,
            },
          },
          partOrder: ["part-1"],
        },
        "user-1": {
          id: "user-1",
          sessionId: "session-1",
          role: "user",
          attribution: { agent: "should-not-show", model: "should-not-show" },
          partsById: {
            "part-2": {
              id: "part-2",
              kind: "text",
              type: "text",
              text: "User says hi",
              streaming: false,
            },
          },
          partOrder: ["part-2"],
        },
        "system-1": {
          id: "system-1",
          sessionId: "session-1",
          role: "system",
          attribution: { model: "should-not-show" },
          partsById: {
            "part-3": {
              id: "part-3",
              kind: "text",
              type: "text",
              text: "System update",
              streaming: false,
            },
          },
          partOrder: ["part-3"],
        },
        "assistant-2": {
          id: "assistant-2",
          sessionId: "session-1",
          role: "assistant",
          attribution: { agent: "planner" },
          partsById: {
            "part-4": {
              id: "part-4",
              kind: "text",
              type: "text",
              text: "Second assistant",
              streaming: false,
            },
          },
          partOrder: ["part-4"],
        },
      },
      pendingPermissionsById: {},
      pendingQuestionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [],
    });

    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByText("explorer - k2p5")).toBeTruthy();
    expect(screen.getByText("planner")).toBeTruthy();
    expect(screen.queryByText("should-not-show - should-not-show")).toBeNull();
    expect(screen.queryByText("should-not-show")).toBeNull();
  });
});
