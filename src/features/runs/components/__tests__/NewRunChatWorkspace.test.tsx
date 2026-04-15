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

import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewRunChatWorkspace, {
  buildStreamingTextPart,
} from "../NewRunChatWorkspace";

const installResizeObserverStub = () => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
};

const {
  getRunOpenCodeSessionMessagesPageMock,
  getRunOpenCodeSessionTodosMock,
} = vi.hoisted(() => ({
  getRunOpenCodeSessionMessagesPageMock: vi.fn(async () => ({
    messages: [],
    hasMore: false,
    nextCursor: undefined,
    beforeCursor: undefined,
    raw: [],
  })),
  getRunOpenCodeSessionTodosMock: vi.fn(async () => ({ todos: [], raw: [] })),
}));

vi.mock("../../../../app/lib/runs", async () => {
  const actual = await vi.importActual<object>("../../../../app/lib/runs");
  return {
    ...actual,
    getRunOpenCodeSessionMessagesPage: getRunOpenCodeSessionMessagesPageMock,
    getRunOpenCodeSessionTodos: getRunOpenCodeSessionTodosMock,
  };
});

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const createModelStub = (
  runStatus: "running" | "completed",
  withPendingPermission = false,
  runOverrides: Record<string, unknown> = {},
  chatMode: "interactive" | "read_only" | "unavailable" = "interactive",
  agentOverrides: {
    pendingQuestionsById?: Record<string, unknown>;
    failedQuestionsById?: Record<string, unknown>;
    isReplyingQuestion?: boolean;
    questionReplyError?: string;
    pendingPermissionsById?: Record<string, unknown>;
    failedPermissionsById?: Record<string, unknown>;
    isReplyingPermission?: boolean;
    permissionReplyError?: string;
  } = {},
) => {
  const [run, setRun] = createSignal({ status: runStatus, ...runOverrides });
  const [task] = createSignal({ targetRepositoryPath: null });

  const model = {
    run,
    task,
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
        pendingQuestionsById: agentOverrides.pendingQuestionsById ?? {},
        resolvedQuestionsById: {},
        failedQuestionsById: agentOverrides.failedQuestionsById ?? {},
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
      history: {
        canLoadOlder: () => false,
        isLoadingOlder: () => false,
        error: () => "",
        loadOlder: vi.fn(async () => false),
      },
      isSubmittingPrompt: () => false,
      isReplyingQuestion: () => agentOverrides.isReplyingQuestion ?? false,
      isReplyingPermission: () => agentOverrides.isReplyingPermission ?? false,
      submitError: () => "",
      questionReplyError: () => agentOverrides.questionReplyError ?? "",
      permissionReplyError: () => agentOverrides.permissionReplyError ?? "",
      questionState: () => {
        const store = model.agent.store();
        const pending = Object.values(store.pendingQuestionsById) as Array<
          Record<string, unknown>
        >;
        const failed = Object.values(
          (store as { failedQuestionsById?: Record<string, unknown> })
            .failedQuestionsById ?? {},
        ) as Array<Record<string, unknown>>;
        return {
          activeRequest:
            (pending[0] as Record<string, unknown> | undefined) ?? null,
          queuedRequests: pending.slice(1),
          resolvedRequests: [],
          failedRequests: failed,
        };
      },
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
      replyQuestion: vi.fn(async () => true),
      rejectQuestion: vi.fn(async () => true),
      replyPermission: vi.fn(async () => true),
    },
  } as unknown as ReturnType<
    typeof import("../../model/useRunDetailModel").useRunDetailModel
  >;

  return { model, setRun };
};

describe("NewRunChatWorkspace", () => {
  beforeEach(() => {
    installResizeObserverStub();
    getRunOpenCodeSessionMessagesPageMock.mockClear();
    getRunOpenCodeSessionTodosMock.mockClear();
    getRunOpenCodeSessionMessagesPageMock.mockResolvedValue({
      messages: [],
      hasMore: false,
      nextCursor: undefined,
      beforeCursor: undefined,
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

  it("loads older transcript history through the model paging API", async () => {
    const [store, setStore] = createSignal({
      sessionId: "session-1",
      status: "idle",
      streamConnected: true,
      lastSyncAt: Date.now(),
      messageOrder: ["msg-newer"],
      messagesById: {
        "msg-newer": {
          id: "msg-newer",
          sessionId: "session-1",
          role: "assistant",
          partsById: {
            "part-newer": {
              id: "part-newer",
              kind: "text",
              type: "text",
              text: "Newer message",
              streaming: false,
            },
          },
          partOrder: ["part-newer"],
        },
      },
      pendingQuestionsById: {},
      resolvedQuestionsById: {},
      failedQuestionsById: {},
      pendingPermissionsById: {},
      resolvedPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [],
    });
    const loadOlder = vi.fn(async () => {
      setStore((current) => ({
        ...current,
        messageOrder: ["msg-older", ...current.messageOrder],
        messagesById: {
          ...current.messagesById,
          "msg-older": {
            id: "msg-older",
            sessionId: "session-1",
            role: "assistant",
            partsById: {
              "part-older": {
                id: "part-older",
                kind: "text",
                type: "text",
                text: "Older message",
                streaming: false,
              },
            },
            partOrder: ["part-older"],
          },
        },
      }));
      return true;
    });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;
    model.agent.history = {
      canLoadOlder: () => true,
      isLoadingOlder: () => false,
      error: () => "",
      loadOlder,
    } as unknown as typeof model.agent.history;

    render(() => <NewRunChatWorkspace model={model} />);

    fireEvent.click(screen.getByRole("button", { name: "Load older history" }));

    await waitFor(() => {
      expect(loadOlder).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Older message")).toBeTruthy();
    });
  });

  it("preserves the visible transcript anchor when older history is prepended", async () => {
    const [store, setStore] = createSignal({
      sessionId: "session-1",
      status: "idle",
      streamConnected: true,
      lastSyncAt: Date.now(),
      messageOrder: ["msg-1", "msg-2"],
      messagesById: {
        "msg-1": {
          id: "msg-1",
          sessionId: "session-1",
          role: "assistant",
          partsById: {
            "part-1": {
              id: "part-1",
              kind: "text",
              type: "text",
              text: "Earlier message",
              streaming: false,
            },
          },
          partOrder: ["part-1"],
        },
        "msg-2": {
          id: "msg-2",
          sessionId: "session-1",
          role: "assistant",
          partsById: {
            "part-2": {
              id: "part-2",
              kind: "text",
              type: "text",
              text: "Latest message",
              streaming: false,
            },
          },
          partOrder: ["part-2"],
        },
      },
      pendingQuestionsById: {},
      resolvedQuestionsById: {},
      failedQuestionsById: {},
      pendingPermissionsById: {},
      resolvedPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [],
    });

    let scrollTopValue = 0;
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    const loadOlder = vi.fn(async () => {
      setStore((current) => ({
        ...current,
        messageOrder: ["msg-older", ...current.messageOrder],
        messagesById: {
          ...current.messagesById,
          "msg-older": {
            id: "msg-older",
            sessionId: "session-1",
            role: "assistant",
            partsById: {
              "part-older": {
                id: "part-older",
                kind: "text",
                type: "text",
                text: "Older message",
                streaming: false,
              },
            },
            partOrder: ["part-older"],
          },
        },
      }));
      return true;
    });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;
    model.agent.history = {
      canLoadOlder: () => true,
      isLoadingOlder: () => false,
      error: () => "",
      loadOlder,
    } as unknown as typeof model.agent.history;

    render(() => <NewRunChatWorkspace model={model} />);

    const transcript = screen.getByLabelText(
      "Conversation transcript",
    ) as HTMLDivElement;
    Object.defineProperty(transcript, "scrollHeight", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(transcript, "clientHeight", {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(transcript, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (next: number) => {
        scrollTopValue = next;
      },
    });
    Object.defineProperty(transcript, "scrollTo", {
      configurable: true,
      value: ({ top }: { top: number }) => {
        scrollTopValue = top;
      },
    });

    fireEvent.scroll(transcript);
    fireEvent.click(screen.getByRole("button", { name: "Load older history" }));

    await waitFor(() => {
      expect(loadOlder).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Older message")).toBeTruthy();
      expect(scrollTopValue).toBeGreaterThan(0);
    });

    rafSpy.mockRestore();
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

  it("shows subagent source context in permission prompts without raw ids", () => {
    const { model } = createModelStub("running", true, {}, "interactive", {
      pendingPermissionsById: {
        "perm-1": {
          requestId: "perm-1",
          sessionId: "session-child",
          sourceKind: "subagent",
          sourceLabel: "Docs lookup - k2p5",
          kind: "write",
          pathPatterns: ["src/**/*.ts"],
        },
      },
    });

    render(() => <NewRunChatWorkspace model={model} />);

    expect(
      screen.getByText((content, element) => {
        return (
          element?.textContent?.replace(/\s+/g, " ").trim() ===
          "Source: Docs lookup - k2p5"
        );
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/session-child/i)).toBeNull();
  });

  it("renders a single-question takeover without a review step", () => {
    const { model } = createModelStub("running", false, {}, "interactive", {
      pendingQuestionsById: {
        "question-1": {
          requestId: "question-1",
          sessionId: "session-1",
          sourceKind: "main",
          sourceLabel: "Main agent",
          questions: [
            {
              header: "Choose action",
              question: "Which action should I take?",
              options: [{ label: "Apply patch", description: "Modify files" }],
              custom: true,
            },
          ],
        },
      },
    });

    render(() => <NewRunChatWorkspace model={model} />);

    const takeover = screen.getByLabelText("Question composer takeover");
    expect(takeover).toBeTruthy();
    expect(takeover.className).toContain("bg-base-100");
    expect(takeover.className).toContain("overflow-hidden");
    expect(takeover.className).toContain("relative");
    expect(screen.queryByLabelText("Question request")).toBeNull();
    expect(screen.getByText("Question 1 of 1")).toBeTruthy();
    expect(screen.getByText("Which action should I take?")).toBeTruthy();
    expect(screen.getByText("Apply patch")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Type your own answer" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Your answer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Send answer" })
        .getAttribute("disabled"),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Message agent")).toBeNull();
  });

  it("hides custom answer controls when prompt.custom is false", async () => {
    const { model } = createModelStub("running", false, {}, "interactive", {
      pendingQuestionsById: {
        "question-1": {
          requestId: "question-1",
          sessionId: "session-1",
          questions: [
            {
              header: "Choose action",
              question: "Which action should I take?",
              options: [{ label: "Apply patch", description: "Modify files" }],
              custom: false,
            },
          ],
        },
      },
    });

    render(() => <NewRunChatWorkspace model={model} />);

    expect(
      screen.queryByRole("button", { name: "Type your own answer" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Your answer")).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "Apply patch" }));
    expect(screen.getByRole("button", { name: "Send answer" })).toBeTruthy();
  });

  it("submits a single-question answer directly", async () => {
    const replyQuestionMock = vi.fn(async () => true);
    const rejectQuestionMock = vi.fn(async () => true);
    const { model } = createModelStub("running", false, {}, "interactive", {
      pendingQuestionsById: {
        "question-1": {
          requestId: "question-1",
          sessionId: "session-1",
          questions: [
            {
              header: "Choose action",
              question: "Which action should I take?",
              options: [{ label: "Apply patch", description: "Modify files" }],
              custom: true,
            },
          ],
        },
      },
    });
    model.agent.replyQuestion = replyQuestionMock;
    model.agent.rejectQuestion = rejectQuestionMock;
    render(() => <NewRunChatWorkspace model={model} />);

    const optionButton = screen.getByRole("button", { name: "Apply patch" });
    await fireEvent.click(optionButton);
    expect(optionButton.getAttribute("data-checked")).toBe("true");
    expect(screen.queryByLabelText("Your answer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(replyQuestionMock).toHaveBeenCalledWith("question-1", [
      ["Apply patch"],
    ]);

    await fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(rejectQuestionMock).toHaveBeenCalledWith("question-1");
  });

  it("renders safe option labels but submits raw option values", async () => {
    const replyQuestionMock = vi.fn(async () => true);
    const { model } = createModelStub("running", false, {}, "interactive", {
      pendingQuestionsById: {
        "question-1": {
          requestId: "question-1",
          sessionId: "session-1",
          questions: [
            {
              header: "Choose action",
              question: "Which action should I take?",
              options: [
                {
                  label: "Use safe action",
                  value: "tool.patch.apply:internal-unsafe-value",
                  description: "Modify files",
                },
              ],
              custom: false,
            },
          ],
        },
      },
    });
    model.agent.replyQuestion = replyQuestionMock;

    render(() => <NewRunChatWorkspace model={model} />);

    expect(
      screen.getByRole("button", { name: "Use safe action" }),
    ).toBeTruthy();
    expect(
      screen.queryByText("tool.patch.apply:internal-unsafe-value"),
    ).toBeNull();

    await fireEvent.click(
      screen.getByRole("button", { name: "Use safe action" }),
    );
    await fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

    expect(replyQuestionMock).toHaveBeenCalledWith("question-1", [
      ["tool.patch.apply:internal-unsafe-value"],
    ]);
  });

  it("submits raw option id values when display labels are sanitized", async () => {
    const replyQuestionMock = vi.fn(async () => true);
    const { model } = createModelStub("running", false, {}, "interactive", {
      pendingQuestionsById: {
        "question-1": {
          requestId: "question-1",
          sessionId: "session-1",
          questions: [
            {
              header: "Choose action",
              question: "Which action should I take?",
              options: [
                {
                  id: "tool.patch.apply:internal-id-value",
                  label: "Apply patch safely",
                  description: "Modify files",
                },
              ],
              custom: false,
            },
          ],
        },
      },
    });
    model.agent.replyQuestion = replyQuestionMock;

    render(() => <NewRunChatWorkspace model={model} />);

    await fireEvent.click(
      screen.getByRole("button", { name: "Apply patch safely" }),
    );
    await fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

    expect(replyQuestionMock).toHaveBeenCalledWith("question-1", [
      ["tool.patch.apply:internal-id-value"],
    ]);
  });

  it("uses human-readable primitive raw values as option labels", async () => {
    const replyQuestionMock = vi.fn(async () => true);
    const { model } = createModelStub("running", false, {}, "interactive", {
      pendingQuestionsById: {
        "question-1": {
          requestId: "question-1",
          sessionId: "session-1",
          questions: [
            {
              header: "Choose action",
              question: "Which action should I take?",
              options: ["yes", "no"],
              custom: false,
            },
          ],
        },
      },
    });
    model.agent.replyQuestion = replyQuestionMock;

    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByRole("button", { name: "yes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "no" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Option" })).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "yes" }));
    await fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

    expect(replyQuestionMock).toHaveBeenCalledWith("question-1", [["yes"]]);
  });

  it("uses neutral option labels for opaque internal-id raw values", async () => {
    const replyQuestionMock = vi.fn(async () => true);
    const rawValue = "tool.patch.apply:123e4567-e89b-12d3-a456-426614174000";
    const { model } = createModelStub("running", false, {}, "interactive", {
      pendingQuestionsById: {
        "question-1": {
          requestId: "question-1",
          sessionId: "session-1",
          questions: [
            {
              header: "Choose action",
              question: "Which action should I take?",
              options: [{ value: rawValue }],
              custom: false,
            },
          ],
        },
      },
    });
    model.agent.replyQuestion = replyQuestionMock;

    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByRole("button", { name: "Option" })).toBeTruthy();
    expect(screen.queryByText(rawValue)).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "Option" }));
    await fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

    expect(replyQuestionMock).toHaveBeenCalledWith("question-1", [[rawValue]]);
  });

  it("prevents duplicate reply/reject calls on rapid double click", async () => {
    let resolveReply: ((value: boolean) => void) | null = null;
    let resolveReject: ((value: boolean) => void) | null = null;
    const replyQuestionMock = vi.fn(
      () => new Promise<boolean>((resolve) => (resolveReply = resolve)),
    );
    const rejectQuestionMock = vi.fn(
      () => new Promise<boolean>((resolve) => (resolveReject = resolve)),
    );

    const { model } = createModelStub("running", false, {}, "interactive", {
      pendingQuestionsById: {
        "question-1": {
          requestId: "question-1",
          sessionId: "session-1",
          questions: [
            {
              header: "Choose action",
              question: "Which action should I take?",
              options: [{ label: "Apply patch", description: "Modify files" }],
              custom: true,
            },
          ],
        },
      },
    });
    model.agent.replyQuestion = replyQuestionMock;
    model.agent.rejectQuestion = rejectQuestionMock;

    render(() => <NewRunChatWorkspace model={model} />);

    await fireEvent.click(screen.getByRole("button", { name: "Apply patch" }));

    const sendButton = screen.getByRole("button", { name: "Send answer" });
    await fireEvent.click(sendButton);
    await fireEvent.click(sendButton);
    expect(replyQuestionMock).toHaveBeenCalledTimes(1);

    resolveReply?.(true);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    });

    const dismissButton = screen.getByRole("button", { name: "Dismiss" });
    await fireEvent.click(dismissButton);
    expect(screen.getByRole("button", { name: "Sending..." })).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Sending..." }));
    expect(rejectQuestionMock).toHaveBeenCalledTimes(1);
    resolveReject?.(true);
  });

  it("renders checked option state immediately", async () => {
    const { model } = createModelStub("running", false, {}, "interactive", {
      pendingQuestionsById: {
        "question-1": {
          requestId: "question-1",
          sessionId: "session-1",
          questions: [
            {
              header: "Choose action",
              question: "Which action should I take?",
              options: [
                { label: "Apply patch", description: "Modify files" },
                { label: "Explain first", description: "Describe approach" },
              ],
              custom: true,
            },
          ],
        },
      },
    });

    render(() => <NewRunChatWorkspace model={model} />);

    await fireEvent.click(screen.getByRole("button", { name: "Apply patch" }));
    expect(
      screen
        .getByRole("button", { name: "Apply patch" })
        .getAttribute("data-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Explain first" })
        .getAttribute("data-checked"),
    ).toBe("false");

    await fireEvent.click(
      screen.getByRole("button", { name: "Explain first" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Apply patch" })
        .getAttribute("data-checked"),
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Explain first" })
        .getAttribute("data-checked"),
    ).toBe("true");
  });

  it("keeps nested question surfaces opaque", () => {
    const { model } = createModelStub("running", false, {}, "interactive", {
      pendingQuestionsById: {
        "question-1": {
          requestId: "question-1",
          sessionId: "session-1",
          questions: [
            {
              header: "Choose action",
              question: "Which action should I take?",
              options: [{ label: "Apply patch", description: "Modify files" }],
              custom: true,
            },
            {
              header: "Reason",
              question: "Why?",
              options: [],
              custom: true,
            },
          ],
        },
      },
    });

    const { container } = render(() => <NewRunChatWorkspace model={model} />);

    const bgBase100Count = (container.innerHTML.match(/bg-base-100/g) ?? [])
      .length;
    expect(bgBase100Count).toBeGreaterThan(5);
    expect(container.innerHTML.includes("bg-base-100/70")).toBe(false);
    expect(container.innerHTML.includes("bg-base-100/60")).toBe(false);
  });

  it("shows queued question count and failure state", () => {
    const { model } = createModelStub("running", false, {}, "interactive", {
      pendingQuestionsById: {
        "question-1": {
          requestId: "question-1",
          sessionId: "session-1",
          questions: [{ header: "One", question: "First?", custom: true }],
        },
        "question-2": {
          requestId: "question-2",
          sessionId: "session-child",
          sourceKind: "subagent",
          sourceLabel: "Docs lookup - k2p5",
          questions: [{ header: "Two", question: "Second?", custom: true }],
        },
      },
      failedQuestionsById: {
        "question-stale": {
          requestId: "question-stale",
          sessionId: "session-1",
          questions: [{ header: "Stale", question: "Old?", custom: true }],
          failureMessage: "Question request expired before response.",
        },
      },
    });

    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByText("1 more question request queued.")).toBeTruthy();
    expect(
      screen.getByLabelText("Question request failed tool item"),
    ).toBeTruthy();
  });

  it("keeps typed answers behind explicit custom selection and only allows send on review", async () => {
    const replyQuestionMock = vi.fn(async () => false);
    const { model } = createModelStub("running", false, {}, "interactive", {
      pendingQuestionsById: {
        "question-1": {
          requestId: "question-1",
          sessionId: "session-1",
          questions: [
            {
              header: "Choose action",
              question: "Which action should I take?",
              options: [{ label: "Apply patch", description: "Modify files" }],
              custom: true,
            },
            {
              header: "Reason",
              question: "Why?",
              options: [],
              custom: true,
            },
          ],
        },
      },
    });
    model.agent.replyQuestion = replyQuestionMock;

    render(() => <NewRunChatWorkspace model={model} />);

    await fireEvent.click(
      screen.getByRole("button", { name: "Type your own answer" }),
    );
    await fireEvent.input(screen.getByLabelText("Your answer"), {
      target: { value: "My custom answer" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Question 2 of 2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send answer" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Review answers" })
        .getAttribute("disabled"),
    ).not.toBeNull();

    await fireEvent.click(
      screen.getByRole("button", { name: "Type your own answer" }),
    );
    await fireEvent.input(screen.getByLabelText("Your answer"), {
      target: { value: "Because it is needed" },
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "Review answers" }),
    );
    expect(screen.getAllByText("Review answers").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Send answer" })).toBeTruthy();

    await fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(replyQuestionMock).toHaveBeenCalledWith("question-1", [
      ["My custom answer"],
      ["Because it is needed"],
    ]);

    await fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    expect(
      (screen.getByLabelText("Your answer") as HTMLTextAreaElement).value,
    ).toBe("My custom answer");
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
      lastSyncAt: null as number | null,
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
      lastSyncAt: null as number | null,
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
      lastSyncAt: null as number | null,
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

    expect(screen.getByText("List workspace files")).toBeTruthy();
    expect(
      screen.getAllByText("Agent launch to explore repository").length,
    ).toBeGreaterThan(0);
  });

  it("shows delegating state before child session metadata or output arrives", () => {
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

    expect(screen.getAllByText("~ Delegating...").length).toBeGreaterThan(0);
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

    expect(screen.getByText("List workspace files")).toBeTruthy();
    expect(screen.getByText("workspace")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  it("rebinds child output to the authoritative task box when explicit mapping arrives later", async () => {
    const [store, setStore] = createSignal({
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
              status: "running",
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
              state: { status: "running", title: "First task" },
            },
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
            delta: "Child output",
          },
        },
      ],
    });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    const { container } = render(() => <NewRunChatWorkspace model={model} />);

    const getTaskRails = () =>
      Array.from(container.querySelectorAll(".run-chat-tool-rail")).filter(
        (node) =>
          node.textContent?.includes("First task") ||
          node.textContent?.includes("Second task"),
      );

    expect(getTaskRails()).toHaveLength(2);
    expect(getTaskRails()[0]?.textContent).not.toContain("Child output");
    expect(getTaskRails()[1]?.textContent).toContain("Child output");

    setStore((current) => ({
      ...current,
      messagesById: {
        ...current.messagesById,
        "msg-root-1": {
          ...current.messagesById["msg-root-1"],
          partsById: {
            ...current.messagesById["msg-root-1"].partsById,
            "part-task-1": {
              ...current.messagesById["msg-root-1"].partsById["part-task-1"],
              raw: {
                child: {
                  sessionID: "session-child",
                },
              },
            },
          },
        },
      },
      lastSyncAt: current.lastSyncAt + 1,
    }));

    await waitFor(() => {
      expect(getTaskRails()[0]?.textContent).toContain("Child output");
      expect(getTaskRails()[1]?.textContent).not.toContain("Child output");
    });
  });

  it("hydrates task subagent output from fetched child session history", async () => {
    getRunOpenCodeSessionMessagesPageMock.mockResolvedValue({
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
      hasMore: false,
      nextCursor: undefined,
      beforeCursor: undefined,
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
      expect(getRunOpenCodeSessionMessagesPageMock).toHaveBeenCalledWith({
        runId: "run-1",
        sessionId: "session-child",
      });
      expect(screen.getByText("Fetched child history output")).toBeTruthy();
    });
  });

  it("hydrates lineage-routed child sessions from fetched history", async () => {
    getRunOpenCodeSessionMessagesPageMock.mockImplementation(
      async ({ sessionId }: { sessionId: string }) => {
        if (sessionId === "session-grandchild") {
          return {
            messages: [
              {
                info: {
                  id: "msg-grandchild",
                  sessionID: "session-grandchild",
                  role: "assistant",
                },
                parts: [
                  {
                    id: "part-grandchild",
                    type: "text",
                    text: "Fetched lineage output",
                    messageID: "msg-grandchild",
                    sessionID: "session-grandchild",
                  },
                ],
              },
            ],
            hasMore: false,
            nextCursor: undefined,
            beforeCursor: undefined,
            raw: [],
          } as any;
        }

        return {
          messages: [],
          hasMore: false,
          nextCursor: undefined,
          beforeCursor: undefined,
          raw: [],
        } as any;
      },
    );

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
              title: "Map workspace",
              raw: {
                child: {
                  sessionID: "session-parent",
                },
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
      rawEvents: [
        {
          type: "session.updated",
          properties: {
            sessionID: "session-grandchild",
            info: {
              id: "session-grandchild",
              parentID: "session-parent",
              title: "Nested explorer",
            },
          },
        },
      ],
    });

    const { model } = createModelStub("running", false, { id: "run-1" });
    model.agent.store = store as unknown as typeof model.agent.store;

    render(() => <NewRunChatWorkspace model={model} />);

    await waitFor(() => {
      expect(getRunOpenCodeSessionMessagesPageMock).toHaveBeenCalledWith({
        runId: "run-1",
        sessionId: "session-grandchild",
      });
      expect(screen.getByText("Fetched lineage output")).toBeTruthy();
    });
  });

  it("keeps fetched child history visible after live child updates begin", async () => {
    getRunOpenCodeSessionMessagesPageMock.mockResolvedValue({
      messages: [
        {
          info: {
            id: "msg-child-1",
            sessionID: "session-child",
            role: "assistant",
            createdAt: "2026-01-01T00:00:01.000Z",
          },
          parts: [
            {
              id: "part-child-1",
              type: "text",
              text: "Fetched child one",
              messageID: "msg-child-1",
              sessionID: "session-child",
            },
          ],
        },
        {
          info: {
            id: "msg-child-2",
            sessionID: "session-child",
            role: "assistant",
            createdAt: "2026-01-01T00:00:02.000Z",
          },
          parts: [
            {
              id: "part-child-2",
              type: "text",
              text: "Fetched child two",
              messageID: "msg-child-2",
              sessionID: "session-child",
            },
          ],
        },
      ],
      hasMore: false,
      nextCursor: undefined,
      beforeCursor: undefined,
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
              title: "Inspect child session",
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
      rawEvents: [
        {
          type: "message.updated",
          properties: {
            sessionID: "session-child",
            info: {
              id: "msg-child-3",
              sessionID: "session-child",
              role: "assistant",
              createdAt: "2026-01-01T00:00:03.000Z",
            },
          },
        },
        {
          type: "message.part.updated",
          properties: {
            sessionID: "session-child",
            part: {
              id: "part-child-3",
              messageID: "msg-child-3",
              sessionID: "session-child",
              type: "text",
              text: "Live child three",
            },
          },
        },
      ],
    });

    const { model } = createModelStub("running", false, { id: "run-1" });
    model.agent.store = store as unknown as typeof model.agent.store;

    render(() => <NewRunChatWorkspace model={model} />);

    await waitFor(() => {
      expect(screen.getByText("Fetched child one")).toBeTruthy();
      expect(screen.getByText("Fetched child two")).toBeTruthy();
      expect(screen.getByText("Live child three")).toBeTruthy();
    });
  });

  it("renders the last three messages from the merged ordered child timeline", async () => {
    getRunOpenCodeSessionMessagesPageMock.mockResolvedValue({
      messages: [
        {
          info: {
            id: "msg-child-1",
            sessionID: "session-child",
            role: "assistant",
            createdAt: "2026-01-01T00:00:01.000Z",
          },
          parts: [
            {
              id: "part-child-1",
              type: "text",
              text: "Merged first",
              messageID: "msg-child-1",
              sessionID: "session-child",
            },
          ],
        },
        {
          info: {
            id: "msg-child-2",
            sessionID: "session-child",
            role: "assistant",
            createdAt: "2026-01-01T00:00:02.000Z",
          },
          parts: [
            {
              id: "part-child-2",
              type: "text",
              text: "Merged second",
              messageID: "msg-child-2",
              sessionID: "session-child",
            },
          ],
        },
      ],
      hasMore: false,
      nextCursor: undefined,
      beforeCursor: undefined,
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
              title: "Inspect child session",
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
      rawEvents: [
        {
          type: "message.updated",
          properties: {
            sessionID: "session-child",
            info: {
              id: "msg-child-4",
              sessionID: "session-child",
              role: "assistant",
              createdAt: "2026-01-01T00:00:04.000Z",
            },
          },
        },
        {
          type: "message.part.updated",
          properties: {
            sessionID: "session-child",
            part: {
              id: "part-child-4",
              messageID: "msg-child-4",
              sessionID: "session-child",
              type: "text",
              text: "Merged fourth",
            },
          },
        },
        {
          type: "message.updated",
          properties: {
            sessionID: "session-child",
            info: {
              id: "msg-child-3",
              sessionID: "session-child",
              role: "assistant",
              createdAt: "2026-01-01T00:00:03.000Z",
            },
          },
        },
        {
          type: "message.part.updated",
          properties: {
            sessionID: "session-child",
            part: {
              id: "part-child-3",
              messageID: "msg-child-3",
              sessionID: "session-child",
              type: "text",
              text: "Merged third",
            },
          },
        },
      ],
    });

    const { model } = createModelStub("running", false, { id: "run-1" });
    model.agent.store = store as unknown as typeof model.agent.store;

    const { container } = render(() => <NewRunChatWorkspace model={model} />);

    await waitFor(() => {
      expect(screen.queryByText("Merged first")).toBeNull();
      expect(screen.getByText("Merged second")).toBeTruthy();
      expect(screen.getByText("Merged third")).toBeTruthy();
      expect(screen.getByText("Merged fourth")).toBeTruthy();
    });

    const visibleMessages = Array.from(
      container.querySelectorAll(".run-chat-tool-rail__subagent-message"),
    ).map((node) => node.textContent?.replace(/\s+/g, " ").trim() || "");

    expect(visibleMessages).toHaveLength(3);
    expect(visibleMessages[0]).toContain("Merged second");
    expect(visibleMessages[1]).toContain("Merged third");
    expect(visibleMessages[2]).toContain("Merged fourth");
  });

  it("caches streamText across subagent text deltas", () => {
    const snapshotPart = buildStreamingTextPart(
      "part-child",
      "text",
      { text: "Hello" },
      undefined,
      "",
      "message.part.updated",
    );
    const firstDeltaPart = buildStreamingTextPart(
      "part-child",
      "text",
      {},
      snapshotPart,
      " world",
      "message.part.delta",
    );
    const secondDeltaPart = buildStreamingTextPart(
      "part-child",
      "text",
      {},
      firstDeltaPart,
      "!",
      "message.part.delta",
    );

    expect(firstDeltaPart.streamText).toBe("Hello world");
    expect(firstDeltaPart.streamTextLength).toBe(11);
    expect(secondDeltaPart.streamText).toBe("Hello world!");
    expect(secondDeltaPart.streamTextLength).toBe(12);
    expect(secondDeltaPart.streamRevision).toBe(3);
  });

  it("deduplicates subagent history fetches while pending and after failure", async () => {
    const messagesDeferred = createDeferred<{
      messages: never[];
      hasMore: false;
      nextCursor: undefined;
      beforeCursor: undefined;
      raw: never[];
    }>();
    const todosDeferred = createDeferred<{ todos: never[]; raw: never[] }>();
    getRunOpenCodeSessionMessagesPageMock.mockImplementation(
      () => messagesDeferred.promise,
    );
    getRunOpenCodeSessionTodosMock.mockImplementation(
      () => todosDeferred.promise,
    );

    const [store, setStore] = createSignal({
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
      expect(getRunOpenCodeSessionMessagesPageMock).toHaveBeenCalledTimes(1);
      expect(getRunOpenCodeSessionTodosMock).toHaveBeenCalledTimes(1);
    });

    setStore({
      ...store(),
      diffSummary: { filesChanged: 1 },
    });

    await waitFor(() => {
      expect(getRunOpenCodeSessionMessagesPageMock).toHaveBeenCalledTimes(1);
      expect(getRunOpenCodeSessionTodosMock).toHaveBeenCalledTimes(1);
    });

    messagesDeferred.reject(new Error("subagent history failed"));
    todosDeferred.resolve({ todos: [], raw: [] });

    await waitFor(() => {
      expect(getRunOpenCodeSessionMessagesPageMock).toHaveBeenCalledTimes(1);
      expect(getRunOpenCodeSessionTodosMock).toHaveBeenCalledTimes(1);
    });

    setStore({
      ...store(),
      lastSyncAt: store().lastSyncAt + 1,
    });

    await waitFor(() => {
      expect(getRunOpenCodeSessionMessagesPageMock).toHaveBeenCalledTimes(1);
      expect(getRunOpenCodeSessionTodosMock).toHaveBeenCalledTimes(1);
    });
  });

  it("shows session title and model in the subagent header when known", () => {
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
              title: "Map the codebase",
              model: "openai/chatgpt-5.4",
            },
          },
        },
      ],
    });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByText("Map the codebase - chatgpt-5.4")).toBeTruthy();
    expect(screen.queryByText(/^Task$/)).toBeNull();
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

    expect(screen.getByText("First task")).toBeTruthy();
    expect(screen.getByText("Second task")).toBeTruthy();
    const taskRails = Array.from(
      container.querySelectorAll(".run-chat-tool-rail"),
    ).filter(
      (node) =>
        node.textContent?.includes("First task") ||
        node.textContent?.includes("Second task"),
    );
    expect(taskRails).toHaveLength(2);
    expect(taskRails[0]?.textContent).toContain("First child output");
    expect(taskRails[0]?.textContent).not.toContain("Second child output");
    expect(taskRails[1]?.textContent).toContain("Second child output");
  });

  it("keeps the parent task row and sibling child cards stable during overlapping updates", async () => {
    const [store, setStore] = createSignal({
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
              title: "Coordinate concurrent subagents",
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
              messageID: "msg-root",
              sessionID: "session-root",
              type: "tool",
              tool: "task",
              state: {
                status: "running",
                title: "Coordinate concurrent subagents",
              },
            },
          },
        },
        {
          type: "session.updated",
          properties: {
            sessionID: "session-child-a",
            info: {
              id: "session-child-a",
              parentID: "msg-root",
              title: "Planner",
            },
          },
        },
        {
          type: "message.updated",
          properties: {
            sessionID: "session-child-a",
            info: {
              id: "msg-child-a",
              sessionID: "session-child-a",
              parentID: "msg-root",
              role: "assistant",
            },
          },
        },
        {
          type: "message.part.delta",
          properties: {
            sessionID: "session-child-a",
            messageID: "msg-child-a",
            partID: "part-child-a",
            field: "text",
            delta: "Planner draft",
          },
        },
        {
          type: "session.updated",
          properties: {
            sessionID: "session-child-b",
            info: {
              id: "session-child-b",
              parentID: "msg-root",
              title: "Researcher",
            },
          },
        },
        {
          type: "message.updated",
          properties: {
            sessionID: "session-child-b",
            info: {
              id: "msg-child-b",
              sessionID: "session-child-b",
              parentID: "msg-root",
              role: "assistant",
            },
          },
        },
        {
          type: "message.part.delta",
          properties: {
            sessionID: "session-child-b",
            messageID: "msg-child-b",
            partID: "part-child-b",
            field: "text",
            delta: "Research notes",
          },
        },
      ],
    });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    const { container } = render(() => <NewRunChatWorkspace model={model} />);

    const parentRow = () =>
      container.querySelector('[data-run-chat-message-id="msg-root"]');
    const plannerPanel = () =>
      container.querySelector('[aria-label="Planner output"]');
    const researcherPanel = () =>
      container.querySelector('[aria-label="Researcher output"]');
    const plannerMessage = () =>
      container.querySelector('[data-message-id="msg-child-a"]');
    const researcherMessage = () =>
      container.querySelector('[data-message-id="msg-child-b"]');

    const initialParentRow = parentRow();
    const initialPlannerPanel = plannerPanel();
    const initialResearcherPanel = researcherPanel();
    const initialPlannerMessage = plannerMessage();
    const initialResearcherMessage = researcherMessage();

    expect(initialParentRow).toBeTruthy();
    expect(initialPlannerPanel?.textContent).toContain("Planner draft");
    expect(initialResearcherPanel?.textContent).toContain("Research notes");
    expect(initialPlannerMessage).toBeTruthy();
    expect(initialResearcherMessage).toBeTruthy();

    setStore((current) => ({
      ...current,
      rawEvents: [
        ...current.rawEvents,
        {
          type: "message.part.delta",
          properties: {
            sessionID: "session-child-a",
            messageID: "msg-child-a",
            partID: "part-child-a",
            field: "text",
            delta: " expanded",
          },
        },
        {
          type: "message.part.updated",
          properties: {
            sessionID: "session-child-b",
            part: {
              id: "part-child-b",
              messageID: "msg-child-b",
              sessionID: "session-child-b",
              type: "text",
              text: "Research settled",
            },
          },
        },
        {
          type: "session.status",
          properties: {
            sessionID: "session-child-b",
            status: { type: "completed" },
          },
        },
        {
          type: "message.part.delta",
          properties: {
            sessionID: "session-child-a",
            messageID: "msg-child-a",
            partID: "part-child-a",
            field: "text",
            delta: " ongoing",
          },
        },
      ],
    }));

    await waitFor(() => {
      expect(parentRow()).toBe(initialParentRow);
      expect(plannerPanel()).toBe(initialPlannerPanel);
      expect(researcherPanel()).toBe(initialResearcherPanel);
      expect(plannerMessage()).toBe(initialPlannerMessage);
      expect(researcherMessage()).toBe(initialResearcherMessage);
      expect(plannerPanel()?.textContent).toContain(
        "Planner draft expanded ongoing",
      );
      expect(researcherPanel()?.textContent).toContain("Research settled");
      expect(researcherPanel()?.textContent).not.toContain("ongoing");
      expect(
        researcherPanel()?.querySelector(
          ".run-chat-tool-rail__subagent-status-row",
        ),
      ).toBeTruthy();
      expect(
        plannerPanel()?.querySelector(
          ".run-chat-tool-rail__subagent-status-row",
        ),
      ).toBeNull();
    });
  });

  it("anchors once to the true transcript bottom after initial history arrives", async () => {
    const [store, setStore] = createSignal({
      sessionId: "session-root",
      status: "active",
      streamConnected: true,
      lastSyncAt: null as number | null,
      messageOrder: ["msg-root-1", "msg-root-2"],
      messagesById: {
        "msg-root-1": {
          id: "msg-root-1",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-root-1": {
              id: "part-root-1",
              kind: "text",
              type: "text",
              text: "Earlier root message",
              streaming: false,
            },
          },
          partOrder: ["part-root-1"],
        },
        "msg-root-2": {
          id: "msg-root-2",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-root-2": {
              id: "part-root-2",
              kind: "text",
              type: "text",
              text: "Latest root message",
              streaming: false,
            },
          },
          partOrder: ["part-root-2"],
        },
      },
      pendingQuestionsById: {},
      pendingPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [],
    });

    let scrollTopValue = 0;
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    render(() => <NewRunChatWorkspace model={model} />);

    const transcript = screen.getByLabelText(
      "Conversation transcript",
    ) as HTMLDivElement;
    const scrollToMock = vi.fn(({ top }: { top: number }) => {
      scrollTopValue = top;
    });
    Object.defineProperty(transcript, "scrollHeight", {
      value: 1_280,
      configurable: true,
    });
    Object.defineProperty(transcript, "clientHeight", {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(transcript, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (next: number) => {
        scrollTopValue = next;
      },
    });
    Object.defineProperty(transcript, "scrollTo", {
      configurable: true,
      value: scrollToMock,
    });

    expect(scrollToMock).not.toHaveBeenCalled();

    setStore((current) => ({
      ...current,
      lastSyncAt: Date.now(),
    }));

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalled();
      expect(scrollTopValue).toBe(960);
    });

    rafSpy.mockRestore();
  });

  it("keeps transcript pinned when new root messages arrive near bottom", async () => {
    const [store, setStore] = createSignal({
      sessionId: "session-root",
      status: "active",
      streamConnected: true,
      lastSyncAt: null as number | null,
      messageOrder: ["msg-root-1", "msg-root-2"],
      messagesById: {
        "msg-root-1": {
          id: "msg-root-1",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-root-1": {
              id: "part-root-1",
              kind: "text",
              type: "text",
              text: "Earlier root message",
              streaming: false,
            },
          },
          partOrder: ["part-root-1"],
        },
        "msg-root-2": {
          id: "msg-root-2",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-root-2": {
              id: "part-root-2",
              kind: "text",
              type: "text",
              text: "Latest root message",
              streaming: false,
            },
          },
          partOrder: ["part-root-2"],
        },
      },
      pendingQuestionsById: {},
      pendingPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [],
    });

    let scrollTopValue = 0;
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    render(() => <NewRunChatWorkspace model={model} />);

    const transcript = screen.getByLabelText(
      "Conversation transcript",
    ) as HTMLDivElement;
    let scrollToCalls = 0;
    Object.defineProperty(transcript, "scrollHeight", {
      value: 1_280,
      configurable: true,
    });
    Object.defineProperty(transcript, "clientHeight", {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(transcript, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (next: number) => {
        scrollTopValue = next;
      },
    });
    Object.defineProperty(transcript, "scrollTo", {
      configurable: true,
      value: ({ top }: { top: number }) => {
        scrollToCalls += 1;
        scrollTopValue = top;
      },
    });

    setStore((current) => ({
      ...current,
      lastSyncAt: Date.now(),
    }));

    await waitFor(() => {
      expect(scrollToCalls).toBeGreaterThan(0);
      expect(scrollTopValue).toBe(960);
    });

    scrollToCalls = 0;

    setStore((current) => ({
      ...current,
      messageOrder: [...current.messageOrder, "msg-root-3"],
      messagesById: {
        ...current.messagesById,
        "msg-root-3": {
          id: "msg-root-3",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-root-3": {
              id: "part-root-3",
              kind: "text",
              type: "text",
              text: "Newer root message",
              streaming: false,
            },
          },
          partOrder: ["part-root-3"],
        },
      },
    }));

    expect(screen.getByText("Newer root message")).toBeTruthy();
    expect(scrollToCalls).toBeGreaterThan(0);

    rafSpy.mockRestore();
  });

  it("anchors to the transcript bottom even when child output extends below the last parent row", async () => {
    const [store, setStore] = createSignal({
      sessionId: "session-root",
      status: "active",
      streamConnected: true,
      lastSyncAt: null as number | null,
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
              status: "running",
              title: "Inspect workspace",
            },
          },
          partOrder: ["part-task-1"],
        },
        "msg-root-2": {
          id: "msg-root-2",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-root-2": {
              id: "part-root-2",
              kind: "text",
              type: "text",
              text: "Latest parent message",
              streaming: false,
            },
          },
          partOrder: ["part-root-2"],
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
              parentID: "msg-root-1",
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
            delta: "Child output should not anchor",
          },
        },
      ],
    });

    let scrollTopValue = 0;
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    render(() => <NewRunChatWorkspace model={model} />);
    expect(screen.getByText("Child output should not anchor")).toBeTruthy();

    const transcript = screen.getByLabelText(
      "Conversation transcript",
    ) as HTMLDivElement;
    const scrollToMock = vi.fn(({ top }: { top: number }) => {
      scrollTopValue = top;
    });
    Object.defineProperty(transcript, "scrollHeight", {
      value: 1_520,
      configurable: true,
    });
    Object.defineProperty(transcript, "clientHeight", {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(transcript, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (next: number) => {
        scrollTopValue = next;
      },
    });
    Object.defineProperty(transcript, "scrollTo", {
      configurable: true,
      value: scrollToMock,
    });

    setStore((current) => ({
      ...current,
      lastSyncAt: Date.now(),
    }));

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalled();
      expect(scrollTopValue).toBe(1_200);
    });

    rafSpy.mockRestore();
  });

  it("shows a jump-to-bottom button when scrolled up and hides it again near the bottom", async () => {
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
            "part-root-1": {
              id: "part-root-1",
              kind: "text",
              type: "text",
              text: "Earlier root message",
              streaming: false,
            },
          },
          partOrder: ["part-root-1"],
        },
        "msg-root-2": {
          id: "msg-root-2",
          sessionId: "session-root",
          role: "assistant",
          partsById: {
            "part-root-2": {
              id: "part-root-2",
              kind: "text",
              type: "text",
              text: "Latest root message",
              streaming: false,
            },
          },
          partOrder: ["part-root-2"],
        },
      },
      pendingQuestionsById: {},
      pendingPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [],
    });

    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    render(() => <NewRunChatWorkspace model={model} />);

    const transcript = screen.getByLabelText(
      "Conversation transcript",
    ) as HTMLDivElement;
    let scrollTopValue = 960;
    Object.defineProperty(transcript, "scrollHeight", {
      value: 1_280,
      configurable: true,
    });
    Object.defineProperty(transcript, "clientHeight", {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(transcript, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (next: number) => {
        scrollTopValue = next;
      },
    });
    const scrollToMock = vi.fn(({ top }: { top: number }) => {
      scrollTopValue = top;
    });
    Object.defineProperty(transcript, "scrollTo", {
      configurable: true,
      value: scrollToMock,
    });

    fireEvent.scroll(transcript);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: "Jump to latest chat content",
        }),
      ).toBeNull();
    });

    scrollTopValue = 80;
    fireEvent.scroll(transcript);

    const jumpButton = await screen.findByRole("button", {
      name: "Jump to latest chat content",
    });

    await fireEvent.click(jumpButton);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 960,
        behavior: "smooth",
      });
      expect(
        screen.queryByRole("button", {
          name: "Jump to latest chat content",
        }),
      ).toBeNull();
    });

    rafSpy.mockRestore();
  });

  it("virtualizes flattened transcript rows so long chats do not mount everything", async () => {
    const messageOrder = Array.from({ length: 80 }, (_value, index) => {
      return `assistant-${index}`;
    });
    const messagesById = Object.fromEntries(
      messageOrder.map((messageId, index) => [
        messageId,
        {
          id: messageId,
          sessionId: "session-1",
          role: "assistant",
          partsById: {
            [`part-${index}`]: {
              id: `part-${index}`,
              kind: "text",
              type: "text",
              text: `Message ${index}`,
              streaming: false,
            },
          },
          partOrder: [`part-${index}`],
        },
      ]),
    );

    const [store] = createSignal({
      sessionId: "session-1",
      status: "idle",
      streamConnected: true,
      lastSyncAt: null as number | null,
      messageOrder,
      messagesById,
      pendingQuestionsById: {},
      resolvedQuestionsById: {},
      failedQuestionsById: {},
      pendingPermissionsById: {},
      resolvedPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [],
    });

    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    const { container } = render(() => <NewRunChatWorkspace model={model} />);

    const transcript = screen.getByLabelText(
      "Conversation transcript",
    ) as HTMLDivElement;
    let scrollTopValue = 0;
    Object.defineProperty(transcript, "scrollHeight", {
      value: 9_600,
      configurable: true,
    });
    Object.defineProperty(transcript, "clientHeight", {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(transcript, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (next: number) => {
        scrollTopValue = next;
      },
    });
    Object.defineProperty(transcript, "scrollTo", {
      configurable: true,
      value: ({ top }: { top: number }) => {
        scrollTopValue = top;
      },
    });

    fireEvent.scroll(transcript);

    await waitFor(() => {
      const mountedRows = container.querySelectorAll(
        "[data-run-chat-transcript-row-key]",
      );
      expect(mountedRows.length).toBeGreaterThan(0);
      expect(mountedRows.length).toBeLessThan(messageOrder.length);
    });

    expect(screen.getByText("Message 0")).toBeTruthy();
    expect(screen.queryByText("Message 79")).toBeNull();

    rafSpy.mockRestore();
  });

  it("keeps the visible streaming tail row mounted while content streams", async () => {
    const olderMessageOrder = Array.from({ length: 24 }, (_value, index) => {
      return `assistant-${index}`;
    });
    const olderMessagesById = Object.fromEntries(
      olderMessageOrder.map((messageId, index) => [
        messageId,
        {
          id: messageId,
          sessionId: "session-1",
          role: "assistant",
          partsById: {
            [`part-${index}`]: {
              id: `part-${index}`,
              kind: "text",
              type: "text",
              text: `Older message ${index}`,
              streaming: false,
            },
          },
          partOrder: [`part-${index}`],
        },
      ]),
    );
    const [store, setStore] = createSignal({
      sessionId: "session-1",
      status: "active",
      streamConnected: true,
      lastSyncAt: null as number | null,
      messageOrder: [...olderMessageOrder, "assistant-live"],
      messagesById: {
        ...olderMessagesById,
        "assistant-live": {
          id: "assistant-live",
          sessionId: "session-1",
          role: "assistant",
          partsById: {
            "part-live": {
              id: "part-live",
              kind: "text",
              type: "text",
              text: "Tail",
              streamText: "Tail",
              streamTextLength: 4,
              streamRevision: 1,
              streaming: true,
            },
          },
          partOrder: ["part-live"],
        },
      },
      pendingQuestionsById: {},
      resolvedQuestionsById: {},
      failedQuestionsById: {},
      pendingPermissionsById: {},
      resolvedPermissionsById: {},
      failedPermissionsById: {},
      todos: [],
      diffSummary: null,
      rawEvents: [],
    });

    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(16);
        return 1;
      });

    const { model } = createModelStub("running");
    model.agent.store = store as unknown as typeof model.agent.store;

    const { container } = render(() => <NewRunChatWorkspace model={model} />);

    const transcript = screen.getByLabelText(
      "Conversation transcript",
    ) as HTMLDivElement;
    let scrollTopValue = 3_200;
    Object.defineProperty(transcript, "scrollHeight", {
      value: 4_200,
      configurable: true,
    });
    Object.defineProperty(transcript, "clientHeight", {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(transcript, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (next: number) => {
        scrollTopValue = next;
      },
    });
    Object.defineProperty(transcript, "scrollTo", {
      configurable: true,
      value: ({ top }: { top: number }) => {
        scrollTopValue = top;
      },
    });

    fireEvent.scroll(transcript);

    await waitFor(() => {
      expect(screen.getByText("Tail")).toBeTruthy();
    });

    const liveNodeBefore = container.querySelector(
      '.run-chat-assistant-message[data-message-id="assistant-live"]',
    );
    expect(liveNodeBefore).toBeTruthy();

    setStore((current) => ({
      ...current,
      messagesById: {
        ...current.messagesById,
        "assistant-live": {
          ...current.messagesById["assistant-live"],
          partsById: {
            ...current.messagesById["assistant-live"].partsById,
            "part-live": {
              ...current.messagesById["assistant-live"].partsById["part-live"],
              text: "Tail updated",
              streamText: "Tail updated",
              streamTextLength: 12,
              streamRevision: 2,
              streaming: true,
            },
          },
        },
      },
    }));

    await waitFor(() => {
      expect(screen.getByText("Tail updated")).toBeTruthy();
    });

    const liveNodeAfter = container.querySelector(
      '.run-chat-assistant-message[data-message-id="assistant-live"]',
    );
    expect(liveNodeAfter).toBe(liveNodeBefore);

    rafSpy.mockRestore();
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

  it("shows immediate pending composer state while prompt submission is in flight", async () => {
    const pendingSubmit = (() => {
      let resolve!: (accepted: boolean) => void;
      const promise = new Promise<boolean>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    })();
    const [isSubmittingPrompt, setIsSubmittingPrompt] = createSignal(false);
    const submitPromptMock = vi.fn(async () => {
      setIsSubmittingPrompt(true);
      const accepted = await pendingSubmit.promise;
      setIsSubmittingPrompt(false);
      return accepted;
    });
    const { model } = createModelStub("running");
    model.agent.submitPrompt = submitPromptMock;
    model.agent.isSubmittingPrompt = isSubmittingPrompt;

    render(() => <NewRunChatWorkspace model={model} />);

    await fireEvent.input(screen.getByLabelText("Message agent"), {
      target: { value: "Hello" },
    });
    await fireEvent.submit(screen.getByLabelText("Chat composer"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" }).textContent).toBe(
        "Sending...",
      );
      expect(
        (screen.getByLabelText("Message agent") as HTMLTextAreaElement)
          .disabled,
      ).toBe(true);
    });

    pendingSubmit.resolve(true);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" }).textContent).toBe(
        "Send",
      );
    });
  });

  it("preserves unsent composer text when prompt submission fails", async () => {
    const submitPromptMock = vi.fn(async () => false);
    const { model } = createModelStub("running");
    model.agent.submitPrompt = submitPromptMock;
    model.agent.submitError = () => "Failed to submit prompt.";

    render(() => <NewRunChatWorkspace model={model} />);

    await fireEvent.input(screen.getByLabelText("Message agent"), {
      target: { value: "Keep this draft" },
    });
    await fireEvent.submit(screen.getByLabelText("Chat composer"));

    expect(submitPromptMock).toHaveBeenCalledWith("Keep this draft", {
      agentId: "agent-1",
      providerId: "provider-1",
      modelId: "model-1",
    });
    expect(
      (screen.getByLabelText("Message agent") as HTMLTextAreaElement).value,
    ).toBe("Keep this draft");
    expect(screen.getByText("Failed to submit prompt.")).toBeTruthy();
  });

  it("surfaces reconnecting status and blocks composer while stream reconnects", () => {
    const { model } = createModelStub("running");
    model.agent.readinessPhase = () => "reconnecting";
    render(() => <NewRunChatWorkspace model={model} />);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(
      (screen.getByLabelText("Message agent") as HTMLTextAreaElement).disabled,
    ).toBe(true);
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
