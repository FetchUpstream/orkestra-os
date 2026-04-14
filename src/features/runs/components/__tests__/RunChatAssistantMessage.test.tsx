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

import { render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiAssistantStreamingMetadata } from "../../model/agentTypes";
import RunChatAssistantMessage from "../chat/RunChatAssistantMessage";
import RunChatToolRail from "../chat/RunChatToolRail";

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

const installRafController = () => {
  let now = 0;
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();

  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const handle = nextHandle++;
    callbacks.set(handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    callbacks.delete(handle);
  });

  const flushFrame = async (deltaMs = 16) => {
    const pending = Array.from(callbacks.entries());
    callbacks.clear();
    now += deltaMs;
    pending.forEach(([, callback]) => callback(now));
    await Promise.resolve();
  };

  const flushFrames = async (count: number, deltaMs = 16) => {
    for (let index = 0; index < count; index += 1) {
      await flushFrame(deltaMs);
    }
  };

  return {
    flushFrame,
    flushFrames,
    restore: () => {
      vi.unstubAllGlobals();
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RunChatAssistantMessage", () => {
  it("renders historical streamed content immediately without reanimation or caret", () => {
    const streaming = createStreamingMetadata({
      targetText: "Historical assistant reply",
      streamRevision: 4,
      isStreaming: true,
      lifecycle: "streaming",
    });

    const { container } = render(() => (
      <RunChatAssistantMessage
        content={streaming.targetText}
        streaming={streaming}
        isStreamingActive={true}
      />
    ));

    const message = container.querySelector(".run-chat-assistant-message");
    expect(message?.getAttribute("data-streaming-active")).toBe("false");
    expect(message?.getAttribute("data-stream-animating")).toBe("false");
    expect(screen.getByText("Historical assistant reply")).toBeTruthy();
  });

  it("reveals live assistant text progressively while streaming and snaps on completion", async () => {
    const raf = installRafController();
    const longLiveText = [
      "Hello streamed world, this response keeps growing ",
      "so the presentation layer has to reveal it over multiple frames.",
    ].join("");
    const [streaming, setStreaming] = createSignal(
      createStreamingMetadata({
        targetText: "",
        isStreaming: true,
        lifecycle: "streaming",
      }),
    );

    const { container } = render(() => (
      <RunChatAssistantMessage
        content={streaming().targetText}
        streaming={streaming()}
        isStreamingActive={streaming().isStreaming}
      />
    ));

    const message = () =>
      container.querySelector(".run-chat-assistant-message");
    expect(message()?.getAttribute("data-streaming-active")).toBe("true");

    setStreaming(
      createStreamingMetadata({
        targetText: longLiveText,
        streamRevision: 1,
        isStreaming: true,
        lifecycle: "streaming",
      }),
    );

    await raf.flushFrame();

    await waitFor(() => {
      expect(message()?.textContent).toContain("H");
      expect(message()?.textContent).not.toContain(longLiveText);
      expect(message()?.getAttribute("data-stream-animating")).toBe("true");
      expect(message()?.getAttribute("data-streaming-active")).toBe("true");
    });

    setStreaming(
      createStreamingMetadata({
        targetText: longLiveText,
        streamRevision: 2,
        isStreaming: false,
        lifecycle: "settled",
      }),
    );

    await waitFor(() => {
      expect(message()?.textContent).toContain(longLiveText);
      expect(message()?.getAttribute("data-streaming-active")).toBe("false");
      expect(message()?.getAttribute("data-stream-animating")).toBe("false");
    });

    raf.restore();
  });

  it("does not restart animation during resync replay for an already-complete message", async () => {
    const raf = installRafController();
    const [streaming, setStreaming] = createSignal(
      createStreamingMetadata({
        targetText: "Stable final answer",
        streamRevision: 3,
        isStreaming: false,
        lifecycle: "settled",
      }),
    );

    const { container } = render(() => (
      <RunChatAssistantMessage
        content={streaming().targetText}
        streaming={streaming()}
        isStreamingActive={streaming().isStreaming}
      />
    ));

    const message = () =>
      container.querySelector(".run-chat-assistant-message");

    setStreaming(
      createStreamingMetadata({
        targetText: "Stable final answer",
        streamRevision: 4,
        isStreaming: true,
        lifecycle: "streaming",
      }),
    );

    await raf.flushFrames(3);

    expect(message()?.textContent).toContain("Stable final answer");
    expect(message()?.getAttribute("data-streaming-active")).toBe("false");
    expect(message()?.getAttribute("data-stream-animating")).toBe("false");

    raf.restore();
  });

  it("resets presentation state when switching to a new streaming message", async () => {
    const raf = installRafController();
    const [streaming, setStreaming] = createSignal(
      createStreamingMetadata({
        messageId: "assistant-1",
        targetText: "First streaming answer",
        streamRevision: 1,
        isStreaming: true,
        lifecycle: "streaming",
      }),
    );

    const { container } = render(() => (
      <RunChatAssistantMessage
        content={streaming().targetText}
        streaming={streaming()}
        isStreamingActive={streaming().isStreaming}
      />
    ));

    const message = () =>
      container.querySelector(".run-chat-assistant-message");

    await raf.flushFrame();

    setStreaming(
      createStreamingMetadata({
        messageId: "assistant-2",
        targetText: "",
        streamRevision: 0,
        isStreaming: true,
        lifecycle: "streaming",
      }),
    );

    await waitFor(() => {
      expect(message()?.textContent?.trim()).toBe("");
      expect(message()?.getAttribute("data-message-id")).toBe("assistant-2");
      expect(message()?.getAttribute("data-streaming-active")).toBe("true");
      expect(message()?.getAttribute("data-stream-animating")).toBe("false");
    });

    raf.restore();
  });

  it("catches up aggressively for long streaming backlogs", async () => {
    const raf = installRafController();
    const longText = `${"Chunk ".repeat(120)}**done**`;
    const [streaming, setStreaming] = createSignal(
      createStreamingMetadata({
        targetText: "",
        isStreaming: true,
        lifecycle: "streaming",
      }),
    );

    const { container } = render(() => (
      <RunChatAssistantMessage
        content={streaming().targetText}
        streaming={streaming()}
        isStreamingActive={streaming().isStreaming}
      />
    ));

    setStreaming(
      createStreamingMetadata({
        targetText: longText,
        streamRevision: 1,
        isStreaming: true,
        lifecycle: "streaming",
      }),
    );

    await raf.flushFrame();

    await waitFor(() => {
      const message = container.querySelector(".run-chat-assistant-message");
      expect(message?.textContent).toContain("done");
      expect(message?.getAttribute("data-stream-catching-up")).toBe("false");
    });

    raf.restore();
  });

  it("keeps markdown readable while streaming", async () => {
    const raf = installRafController();
    const [streaming, setStreaming] = createSignal(
      createStreamingMetadata({
        targetText: "",
        isStreaming: true,
        lifecycle: "streaming",
      }),
    );

    const { container } = render(() => (
      <RunChatAssistantMessage
        content={streaming().targetText}
        streaming={streaming()}
        isStreamingActive={streaming().isStreaming}
      />
    ));

    setStreaming(
      createStreamingMetadata({
        targetText: "## Heading\n\n- item one\n- item two",
        streamRevision: 1,
        isStreaming: true,
        lifecycle: "streaming",
      }),
    );

    await raf.flushFrames(12);

    await waitFor(() => {
      expect(
        container.querySelector(".run-chat-assistant-message__content h2"),
      ).toBeTruthy();
      expect(
        container.querySelectorAll(".run-chat-assistant-message__content li")
          .length,
      ).toBeGreaterThan(0);
    });

    raf.restore();
  });

  it("leaves non-assistant transcript rows unaffected in tool rails while subagent assistant messages use the same pipeline", async () => {
    const raf = installRafController();

    const { container, queryByText } = render(() => (
      <RunChatToolRail
        items={[
          {
            id: "tool-1",
            label: "Task",
            summary: "Inspect transcript",
            status: "running",
            isTask: true,
            subagents: [
              {
                id: "subagent-1",
                label: "Inspector (@fixer)",
                status: "running",
                messages: [
                  {
                    id: "msg-user",
                    role: "user",
                    content: "User prompt stays static",
                  },
                  {
                    id: "msg-system",
                    role: "system",
                    content: "System note stays static",
                  },
                  {
                    id: "msg-assistant",
                    role: "assistant",
                    content: "Subagent reply",
                    assistantStreaming: createStreamingMetadata({
                      messageId: "msg-assistant",
                      targetText: "Subagent reply",
                      streamRevision: 1,
                      isStreaming: true,
                      lifecycle: "streaming",
                    }),
                  },
                ],
              },
            ],
          },
        ]}
      />
    ));

    await raf.flushFrame();

    expect(queryByText("User prompt stays static")).toBeTruthy();
    expect(queryByText("System note stays static")).toBeTruthy();
    expect(
      container.querySelector(
        ".run-chat-tool-rail__subagent-message .run-chat-assistant-message",
      ),
    ).toBeTruthy();

    raf.restore();
  });

  it("keeps the active indicator visible when only reasoning is still streaming", () => {
    const streaming = createStreamingMetadata({
      targetText: "Settled answer",
      isStreaming: true,
      lifecycle: "streaming",
      text: {
        targetText: "Settled answer",
        isStreaming: false,
        streamRevision: 2,
        streamToken: "assistant-1:text:2",
        lifecycle: "settled",
        hasVisibleContent: true,
        isPlaceholderOnly: false,
      },
      reasoning: {
        targetText: "Thinking...",
        isStreaming: true,
        streamRevision: 3,
        streamToken: "assistant-1:reasoning:3",
        lifecycle: "streaming",
        hasVisibleContent: true,
        isPlaceholderOnly: false,
      },
    });

    const { container } = render(() => (
      <RunChatAssistantMessage
        content={streaming.targetText}
        streaming={streaming}
        isStreamingActive={true}
        reasoning={<div class="reasoning-slot">Thinking...</div>}
      />
    ));

    const message = container.querySelector(".run-chat-assistant-message");
    expect(message?.getAttribute("data-streaming-active")).toBe("true");
    expect(message?.getAttribute("data-stream-animating")).toBe("false");
  });
});
