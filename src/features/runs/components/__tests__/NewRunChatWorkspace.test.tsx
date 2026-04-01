import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewRunChatWorkspace from "../NewRunChatWorkspace";

const { getRunOpenCodeSessionMessagesMock, getRunOpenCodeSessionTodosMock } =
  vi.hoisted(() => ({
    getRunOpenCodeSessionMessagesMock: vi.fn(async () => ({
      messages: [],
      raw: [],
    })),
    getRunOpenCodeSessionTodosMock: vi.fn(async () => ({ todos: [], raw: [] })),
  }));

vi.mock("../../../../app/lib/runs", async () => {
  const actual = await vi.importActual<object>("../../../../app/lib/runs");
  return {
    ...actual,
    getRunOpenCodeSessionMessages: getRunOpenCodeSessionMessagesMock,
    getRunOpenCodeSessionTodos: getRunOpenCodeSessionTodosMock,
  };
});

const createModelStub = (
  runStatus: "running" | "completed",
  withPendingPermission = false,
  runOverrides: Record<string, unknown> = {},
  chatMode: "interactive" | "read_only" | "unavailable" = "interactive",
  agentOverrides: {
    pendingPermissionsById?: Record<string, unknown>;
    failedPermissionsById?: Record<string, unknown>;
    isReplyingPermission?: boolean;
    permissionReplyError?: string;
  } = {},
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
        sessionId: "session-1",
        status: "idle",
        streamConnected: true,
        lastSyncAt: Date.now(),
        messageOrder: [],
        messagesById: {},
        pendingQuestionsById: {},
        pendingPermissionsById: withPendingPermission
          ? ((agentOverrides.pendingPermissionsById as
              | Record<string, unknown>
              | undefined) ?? {
              "perm-1": {
                requestId: "perm-1",
                sessionId: "session-1",
                kind: "write",
                pathPatterns: ["src/**/*.ts"],
                metadata: { tool: "write" },
              },
            })
          : {},
        resolvedPermissionsById: {},
        failedPermissionsById: agentOverrides.failedPermissionsById ?? {},
        todos: [],
        diffSummary: null,
        rawEvents: [],
      }),
      isSubmittingPrompt: () => false,
      isReplyingPermission: () => agentOverrides.isReplyingPermission ?? false,
      submitError: () => "",
      permissionReplyError: () => agentOverrides.permissionReplyError ?? "",
      permissionState: () => {
        const store = model.agent.store();
        const pending = Object.values(store.pendingPermissionsById) as Array<
          Record<string, unknown>
        >;
        const failed = Object.values(store.failedPermissionsById) as Array<
          Record<string, unknown>
        >;
        return {
          activeRequest:
            (pending[0] as Record<string, unknown> | undefined) ?? null,
          queuedRequests: pending.slice(1),
          resolvedRequests: [],
          failedRequests: failed,
        };
      },
      submitPrompt: vi.fn(async () => true),
      runAgentOptions: () => [{ id: "agent-1", label: "Planner" }],
      runProviderOptions: () => [{ id: "provider-1", label: "OpenAI" }],
      runModelOptions: () => [
        { id: "model-1", label: "GPT-5", providerId: "provider-1" },
      ],
      projectDefaultRunAgentId: () => "agent-1",
      projectDefaultRunProviderId: () => "provider-1",
      projectDefaultRunModelId: () => "model-1",
      runSelectionOptionsError: () => "",
      replyPermission: vi.fn(async () => true),
    },
  } as unknown as ReturnType<
    typeof import("../../model/useRunDetailModel").useRunDetailModel
  >;

  return { model, setRun };
};

describe("NewRunChatWorkspace", () => {
  beforeEach(() => {
    getRunOpenCodeSessionMessagesMock.mockClear();
    getRunOpenCodeSessionTodosMock.mockClear();
    getRunOpenCodeSessionMessagesMock.mockResolvedValue({
      messages: [],
      raw: [],
    });
    getRunOpenCodeSessionTodosMock.mockResolvedValue({ todos: [], raw: [] });
  });

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

  it("renders actionable permission item in transcript and disables composer", () => {
    const { model } = createModelStub("running", true);
    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByLabelText("Permission request")).toBeTruthy();
    expect(
      screen
        .getByLabelText("Permission request tool item")
        .classList.contains("run-chat-tool-rail"),
    ).toBe(true);
    expect(screen.getByText(/Permission required:\s*write/i)).toBeTruthy();
    expect(screen.getByText("src/**/*.ts")).toBeTruthy();

    const textbox = screen.getByLabelText("Message agent");
    expect(textbox.getAttribute("disabled")).not.toBeNull();
    expect(
      screen.getByText(
        "Prompt submission is blocked until this permission is answered.",
      ),
    ).toBeTruthy();
  });

  it("calls replyPermission when deny/once/always is selected", async () => {
    const replyPermissionMock = vi.fn(async () => true);
    const { model } = createModelStub("running", true);
    model.agent.replyPermission = replyPermissionMock;
    render(() => <NewRunChatWorkspace model={model} />);

    await fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(replyPermissionMock).toHaveBeenCalledWith("perm-1", "deny");

    await fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(replyPermissionMock).toHaveBeenCalledWith("perm-1", "once");

    await fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(replyPermissionMock).toHaveBeenCalledWith("perm-1", "always");
  });

  it("shows in-flight and error state in permission transcript item", () => {
    const { model } = createModelStub("running", true, {}, "interactive", {
      isReplyingPermission: true,
      permissionReplyError: "Could not reply to permission request.",
    });
    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getAllByRole("button", { name: "Sending..." })).toHaveLength(
      3,
    );
    expect(
      screen.getByText("Could not reply to permission request."),
    ).toBeTruthy();
  });

  it("shows queued permission count and advances when first request resolves", () => {
    const pendingPermissions: Record<string, unknown> = {
      "perm-1": {
        requestId: "perm-1",
        sessionId: "session-1",
        kind: "write",
        pathPatterns: ["src/**/*.ts"],
        metadata: { tool: "write" },
      },
      "perm-2": {
        requestId: "perm-2",
        sessionId: "session-1",
        kind: "bash",
        pathPatterns: ["scripts/*.sh"],
        metadata: { tool: "bash" },
      },
    };
    const [store, setStore] = createSignal({
      sessionId: "session-1",
      status: "idle",
      streamConnected: true,
      lastSyncAt: Date.now(),
      messageOrder: [],
      messagesById: {},
      pendingQuestionsById: {},
      pendingPermissionsById: pendingPermissions,
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [],
    });

    const { model } = createModelStub("running", true, {}, "interactive", {
      pendingPermissionsById: pendingPermissions,
    });
    model.agent.store = store as unknown as typeof model.agent.store;

    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getAllByLabelText("Permission request")).toHaveLength(1);
    expect(screen.getByText(/Permission required:\s*write/i)).toBeTruthy();
    expect(
      screen.getByText(
        "1 more permission request queued. They will appear after this one is resolved.",
      ),
    ).toBeTruthy();

    setStore((current) => ({
      ...current,
      pendingPermissionsById: {
        "perm-2": pendingPermissions["perm-2"],
      },
    }));

    expect(screen.getAllByLabelText("Permission request")).toHaveLength(1);
    expect(screen.queryByText(/Permission required:\s*write/i)).toBeNull();
    expect(screen.getByText(/Permission required:\s*bash/i)).toBeTruthy();
    expect(screen.queryByText(/more permission request queued/i)).toBeNull();

    setStore((current) => ({
      ...current,
      pendingPermissionsById: {},
    }));

    expect(screen.queryByLabelText("Permission request")).toBeNull();
  });

  it("renders stale permissions as failed transcript items", () => {
    const { model } = createModelStub("running", false, {}, "interactive", {
      failedPermissionsById: {
        "perm-stale-1": {
          requestId: "perm-stale-1",
          sessionId: "session-1",
          kind: "write",
          pathPatterns: ["src/**/*.ts"],
          failureMessage: "Permission request expired before response.",
        },
      },
    });
    render(() => <NewRunChatWorkspace model={model} />);

    expect(
      screen.getByLabelText("Permission request failed tool item"),
    ).toBeTruthy();
    expect(
      screen.getByText("Permission request expired before response."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
    expect(screen.getByLabelText("Message agent")).toBeTruthy();
    expect(
      screen.queryByText(
        "Prompt submission is blocked until this permission is answered.",
      ),
    ).toBeNull();
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

  it("shows generic cleanup failure copy without exposing error detail", () => {
    const { model, setRun } = createModelStub("running", false, {
      cleanupState: "failed",
      cleanupErrorMessage: "Cleanup failed on lockfile permissions.",
    });
    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByText("Cleanup")).toBeTruthy();
    expect(
      screen.getByText("Cleanup script failed. Please investigate."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Cleanup failed on lockfile permissions."),
    ).toBeNull();

    setRun({
      status: "running",
      cleanupState: "failed",
      cleanupErrorMessage: "   ",
    });
    expect(
      screen.getByText("Cleanup script failed. Please investigate."),
    ).toBeTruthy();
  });

  it("renders grouped subagent output inside the task tool rail", () => {
    const [store] = createSignal({
      sessionId: "session-root",
      status: "active",
      streamConnected: true,
      lastSyncAt: Date.now(),
      messageOrder: ["msg-root"],
      messagesById: {
        "msg-root": {
          id: "msg-root",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-task": {
              id: "part-task",
              kind: "tool",
              type: "tool",
              toolName: "task",
              status: "running",
              title: "Map transcript UI",
            },
          },
          partOrder: ["part-task"],
        },
      },
      pendingQuestionsById: {},
      pendingPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [
        {
          type: "message.part.updated",
          properties: {
            sessionID: "session-root",
            part: {
              id: "part-task",
              partID: "part-task",
              messageID: "msg-root",
              sessionID: "session-root",
              type: "tool",
              tool: "task",
              state: { status: "running", title: "Map transcript UI" },
            },
          },
        },
        {
          type: "message.updated",
          properties: {
            sessionID: "session-child",
            info: {
              id: "msg-child",
              sessionID: "session-child",
              parentID: "msg-root",
              role: "assistant",
            },
          },
        },
        {
          type: "message.part.delta",
          properties: {
            sessionID: "session-child",
            messageID: "msg-child",
            partID: "part-child",
            field: "text",
            delta: "ZIG",
          },
        },
        {
          type: "message.part.delta",
          properties: {
            sessionID: "session-child",
            messageID: "msg-child",
            partID: "part-child",
            field: "text",
            delta: "ZAG",
          },
        },
        {
          type: "session.status",
          properties: {
            sessionID: "session-child",
            status: { type: "idle" },
          },
        },
      ],
    });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    const { container } = render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByText("Subagent")).toBeTruthy();
    expect(screen.getByText("ZIGZAG")).toBeTruthy();
    expect(screen.queryByText(/^ZIG$/)).toBeNull();
    expect(
      container.querySelector(".run-chat-tool-rail__subagent-panel"),
    ).toBeTruthy();
  });

  it("renders child session placeholder output from session.updated before child message parts arrive", () => {
    const [store] = createSignal({
      sessionId: "session-root",
      status: "active",
      streamConnected: true,
      lastSyncAt: Date.now(),
      messageOrder: ["msg-root"],
      messagesById: {
        "msg-root": {
          id: "msg-root",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-task": {
              id: "part-task",
              kind: "tool",
              type: "tool",
              toolName: "task",
              status: "running",
              title: "List workspace files",
            },
          },
          partOrder: ["part-task"],
        },
      },
      pendingQuestionsById: {},
      pendingPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [
        {
          type: "session.updated",
          properties: {
            sessionID: "session-child",
            info: {
              id: "session-child",
              parentID: "msg-root",
              title: "Agent launch to explore repository",
            },
          },
        },
        {
          type: "session.status",
          properties: {
            sessionID: "session-child",
            status: { type: "busy" },
          },
        },
      ],
    });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByText("-> Task List workspace files")).toBeTruthy();
    expect(
      screen.getAllByText("Agent launch to explore repository").length,
    ).toBeGreaterThan(0);
  });

  it("falls back to the latest task tool for non-root foreign session events", () => {
    const [store] = createSignal({
      sessionId: "session-root",
      status: "active",
      streamConnected: true,
      lastSyncAt: Date.now(),
      messageOrder: ["msg-root"],
      messagesById: {
        "msg-root": {
          id: "msg-root",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-task": {
              id: "part-task",
              kind: "tool",
              type: "tool",
              toolName: "task",
              status: "running",
              title: "List workspace files",
            },
          },
          partOrder: ["part-task"],
        },
      },
      pendingQuestionsById: {},
      pendingPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [
        {
          type: "session.updated",
          properties: {
            sessionID: "session-child",
            info: {
              id: "session-child",
              title: "Explorer session",
            },
          },
        },
        {
          type: "message.updated",
          properties: {
            sessionID: "session-child",
            info: {
              id: "msg-child",
              sessionID: "session-child",
              role: "assistant",
            },
          },
        },
        {
          type: "message.part.delta",
          properties: {
            sessionID: "session-child",
            messageID: "msg-child",
            partID: "part-child",
            field: "text",
            delta: "workspace\nREADME.md",
          },
        },
      ],
    });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByText("-> Task List workspace files")).toBeTruthy();
    expect(screen.getByText("workspace")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  it("hydrates task subagent output from fetched child session history", async () => {
    getRunOpenCodeSessionMessagesMock.mockResolvedValue({
      messages: [
        {
          info: {
            id: "msg-child",
            sessionID: "session-child",
            role: "assistant",
          },
          parts: [
            {
              id: "part-child",
              type: "text",
              text: "Fetched child history output",
              messageID: "msg-child",
              sessionID: "session-child",
            },
          ],
        },
      ],
      raw: [],
    } as any);

    const [store] = createSignal({
      sessionId: "session-root",
      status: "active",
      streamConnected: true,
      lastSyncAt: Date.now(),
      messageOrder: ["msg-root"],
      messagesById: {
        "msg-root": {
          id: "msg-root",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-task": {
              id: "part-task",
              kind: "tool",
              type: "tool",
              toolName: "task",
              status: "running",
              title: "List workspace files",
              raw: {
                sessionID: "session-child",
              },
            },
          },
          partOrder: ["part-task"],
        },
      },
      pendingQuestionsById: {},
      pendingPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [],
    });

    const { model } = createModelStub("running", false, { id: "run-1" });
    model.agent.store = store as unknown as typeof model.agent.store;

    render(() => <NewRunChatWorkspace model={model} />);

    await waitFor(() => {
      expect(getRunOpenCodeSessionMessagesMock).toHaveBeenCalledWith({
        runId: "run-1",
        sessionId: "session-child",
      });
      expect(screen.getByText("Fetched child history output")).toBeTruthy();
    });
  });

  it("falls back to agent type instead of numbered subagent labels", () => {
    const [store] = createSignal({
      sessionId: "session-root",
      status: "active",
      streamConnected: true,
      lastSyncAt: Date.now(),
      messageOrder: ["msg-root"],
      messagesById: {
        "msg-root": {
          id: "msg-root",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-task": {
              id: "part-task",
              kind: "tool",
              type: "tool",
              toolName: "task",
              status: "running",
              title: "List workspace files",
            },
          },
          partOrder: ["part-task"],
        },
      },
      pendingQuestionsById: {},
      pendingPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [
        {
          type: "message.updated",
          properties: {
            sessionID: "session-child",
            info: {
              id: "msg-child",
              sessionID: "session-child",
              role: "assistant",
              agent: "explorer",
            },
          },
        },
        {
          type: "message.part.delta",
          properties: {
            sessionID: "session-child",
            messageID: "msg-child",
            partID: "part-child",
            field: "text",
            delta: "hello",
          },
        },
      ],
    });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByText("@explorer")).toBeTruthy();
    expect(screen.queryByText("Subagent 1")).toBeNull();
  });

  it("keeps child output anchored to the task row active when that session starts", () => {
    const [store] = createSignal({
      sessionId: "session-root",
      status: "active",
      streamConnected: true,
      lastSyncAt: Date.now(),
      messageOrder: ["msg-root-1", "msg-root-2"],
      messagesById: {
        "msg-root-1": {
          id: "msg-root-1",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-task-1": {
              id: "part-task-1",
              kind: "tool",
              type: "tool",
              toolName: "task",
              status: "completed",
              title: "First task",
            },
          },
          partOrder: ["part-task-1"],
        },
        "msg-root-2": {
          id: "msg-root-2",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-task-2": {
              id: "part-task-2",
              kind: "tool",
              type: "tool",
              toolName: "task",
              status: "running",
              title: "Second task",
            },
          },
          partOrder: ["part-task-2"],
        },
      },
      pendingQuestionsById: {},
      pendingPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [
        {
          type: "message.part.updated",
          properties: {
            sessionID: "session-root",
            part: {
              id: "part-task-1",
              messageID: "msg-root-1",
              sessionID: "session-root",
              type: "tool",
              tool: "task",
              state: { status: "completed", title: "First task" },
            },
          },
        },
        {
          type: "message.updated",
          properties: {
            sessionID: "session-child-1",
            info: {
              id: "msg-child-1",
              sessionID: "session-child-1",
              role: "assistant",
            },
          },
        },
        {
          type: "message.part.delta",
          properties: {
            sessionID: "session-child-1",
            messageID: "msg-child-1",
            partID: "part-child-1",
            field: "text",
            delta: "First child output",
          },
        },
        {
          type: "message.part.updated",
          properties: {
            sessionID: "session-root",
            part: {
              id: "part-task-2",
              messageID: "msg-root-2",
              sessionID: "session-root",
              type: "tool",
              tool: "task",
              state: { status: "running", title: "Second task" },
            },
          },
        },
        {
          type: "message.updated",
          properties: {
            sessionID: "session-child-2",
            info: {
              id: "msg-child-2",
              sessionID: "session-child-2",
              role: "assistant",
            },
          },
        },
        {
          type: "message.part.delta",
          properties: {
            sessionID: "session-child-2",
            messageID: "msg-child-2",
            partID: "part-child-2",
            field: "text",
            delta: "Second child output",
          },
        },
      ],
    });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    const { container } = render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getAllByText(/-> Task /)).toHaveLength(2);
    const taskRails = Array.from(
      container.querySelectorAll(".run-chat-tool-rail"),
    ).filter((node) => node.textContent?.includes("-> Task "));
    expect(taskRails).toHaveLength(2);
    expect(taskRails[0]?.textContent).toContain("First child output");
    expect(taskRails[0]?.textContent).not.toContain("Second child output");
    expect(taskRails[1]?.textContent).toContain("Second child output");
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

  it("shows concrete default selections and no run-default option", () => {
    const { model } = createModelStub("running", false, {
      agentId: "agent-1",
      providerId: "provider-1",
      modelId: "model-1",
    });
    render(() => <NewRunChatWorkspace model={model} />);

    expect(
      (screen.getByLabelText("Prompt override agent") as HTMLSelectElement)
        .value,
    ).toBe("agent-1");
    expect(
      (screen.getByLabelText("Prompt override provider") as HTMLSelectElement)
        .value,
    ).toBe("provider-1");
    expect(
      (screen.getByLabelText("Prompt override model") as HTMLSelectElement)
        .value,
    ).toBe("model-1");

    expect(
      screen.queryByRole("option", { name: "Use run default" }),
    ).toBeNull();
  });

  it("preserves selected overrides after successful submit", async () => {
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
      agentId: "agent-1",
      providerId: "provider-1",
      modelId: "model-1",
    });
  });

  it("repairs stale override model to a valid model for selected provider", async () => {
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
      ).toBe("model-2");
    });

    await fireEvent.input(screen.getByLabelText("Message agent"), {
      target: { value: "Hello" },
    });
    await fireEvent.submit(screen.getByLabelText("Chat composer"));

    expect(submitPromptMock).toHaveBeenCalledWith("Hello", {
      agentId: "agent-1",
      providerId: "provider-2",
      modelId: "model-2",
    });
  });

  it("keeps provider/model alignment when selecting model after provider change", async () => {
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
      target: { value: "provider-2" },
    });
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
      agentId: "agent-1",
      providerId: "provider-2",
      modelId: "model-2",
    });
  });

  it("re-resolves provider/model when agent changes before submit", async () => {
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
    model.agent.projectDefaultRunProviderId = () => "provider-2";
    model.agent.projectDefaultRunModelId = () => "model-2";

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

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Prompt override provider") as HTMLSelectElement)
          .value,
      ).toBe("provider-2");
      expect(
        (screen.getByLabelText("Prompt override model") as HTMLSelectElement)
          .value,
      ).toBe("model-2");
    });

    await fireEvent.input(screen.getByLabelText("Message agent"), {
      target: { value: "Hello" },
    });
    await fireEvent.submit(screen.getByLabelText("Chat composer"));

    expect(submitPromptMock).toHaveBeenCalledWith("Hello", {
      agentId: "agent-2",
      providerId: "provider-2",
      modelId: "model-2",
    });
    expect(
      (screen.getByLabelText("Message agent") as HTMLTextAreaElement).value,
    ).toBe("");
  });

  it("blocks submit with validation error when no valid provider/model can be resolved", async () => {
    const submitPromptMock = vi.fn(async () => true);
    const { model } = createModelStub("running");
    model.agent.submitPrompt = submitPromptMock;
    model.agent.runModelOptions = () => [];

    render(() => <NewRunChatWorkspace model={model} />);

    await fireEvent.input(screen.getByLabelText("Message agent"), {
      target: { value: "Hello" },
    });
    await fireEvent.submit(screen.getByLabelText("Chat composer"));

    expect(submitPromptMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Select a valid agent, provider, and model before sending.",
      ),
    ).toBeTruthy();
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
      resolvedPermissionsById: {},
      failedPermissionsById: {},
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

  it("renders user and assistant message wrappers for readable bubble width styling", () => {
    const { model } = createModelStub("running");
    model.agent.store = () => ({
      sessionId: "session-1",
      status: "idle",
      streamConnected: true,
      lastSyncAt: Date.now(),
      messageOrder: ["assistant-1", "user-1"],
      messagesById: {
        "assistant-1": {
          id: "assistant-1",
          sessionId: "session-1",
          role: "assistant",
          attribution: {},
          partsById: {
            "part-1": {
              id: "part-1",
              kind: "text",
              type: "text",
              text: "Assistant response",
              streaming: false,
            },
          },
          partOrder: ["part-1"],
        },
        "user-1": {
          id: "user-1",
          sessionId: "session-1",
          role: "user",
          attribution: {},
          partsById: {
            "part-2": {
              id: "part-2",
              kind: "text",
              type: "text",
              text: "User prompt",
              streaming: false,
            },
          },
          partOrder: ["part-2"],
        },
      },
      pendingPermissionsById: {},
      resolvedPermissionsById: {},
      failedPermissionsById: {},
      pendingQuestionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [],
    });

    const { container } = render(() => <NewRunChatWorkspace model={model} />);

    const assistantMessage = container.querySelector(
      ".run-chat-message--assistant .run-chat-message__body--assistant",
    );
    const userBubble = container.querySelector(
      ".run-chat-message--user .run-chat-user-message__bubble",
    );

    expect(assistantMessage).toBeTruthy();
    expect(userBubble).toBeTruthy();
  });
});
