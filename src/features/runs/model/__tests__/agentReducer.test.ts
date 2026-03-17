import { describe, expect, it } from "vitest";
import {
  createEmptyAgentStore,
  hydrateAgentStore,
  upsertPart,
} from "../agentReducer";

const getTextPart = (
  state: ReturnType<typeof createEmptyAgentStore>,
  messageId: string,
  partId: string,
) => {
  const message = state.messagesById[messageId];
  const part = message?.partsById[partId];
  if (!part || (part.kind !== "text" && part.kind !== "reasoning")) {
    throw new Error("expected text-like part");
  }
  return part;
};

describe("agentReducer text/reasoning lifecycle", () => {
  it("hydrates historical text and reasoning as finalized by default", () => {
    const hydrated = hydrateAgentStore({
      sessionId: "session-1",
      messages: [
        {
          info: { id: "msg-1", sessionID: "session-1", role: "assistant" },
          parts: [
            { id: "part-text", type: "text", text: "Final answer" },
            { id: "part-reason", type: "reasoning", text: "Final rationale" },
          ],
        },
      ],
      todos: [],
    });

    const textPart = getTextPart(hydrated, "msg-1", "part-text");
    const reasoningPart = getTextPart(hydrated, "msg-1", "part-reason");

    expect(textPart.streaming).toBe(false);
    expect(textPart.streamTail).toBeUndefined();
    expect(reasoningPart.streaming).toBe(false);
    expect(reasoningPart.streamTail).toBeUndefined();
  });

  it("finalizes delta-only paths when update arrives without delta", () => {
    const initial = createEmptyAgentStore("session-1");
    const withDeltaA = upsertPart(
      initial,
      {
        id: "part-1",
        messageID: "msg-1",
        sessionID: "session-1",
        type: "text",
        text: "",
      },
      "Hello",
    );
    const withDeltaB = upsertPart(
      withDeltaA,
      {
        id: "part-1",
        messageID: "msg-1",
        sessionID: "session-1",
        type: "text",
        text: "",
      },
      " world",
    );
    const finalized = upsertPart(withDeltaB, {
      id: "part-1",
      messageID: "msg-1",
      sessionID: "session-1",
      type: "text",
      text: "",
    });

    const part = getTextPart(finalized, "msg-1", "part-1");
    expect(part.streaming).toBe(false);
    expect(part.streamBaseText).toBeUndefined();
    expect(part.streamTail).toBeUndefined();
    expect(part.streamText).toBeUndefined();
    expect(part.streamTextLength).toBeUndefined();
    expect(part.streamRevision).toBeUndefined();
    expect(part.text).toBe("Hello world");
  });

  it("tracks streaming metadata incrementally on delta updates", () => {
    const initial = createEmptyAgentStore("session-1");
    const withDeltaA = upsertPart(
      initial,
      {
        id: "part-1",
        messageID: "msg-1",
        sessionID: "session-1",
        type: "text",
        text: "",
      },
      "Hello",
    );
    const withDeltaB = upsertPart(
      withDeltaA,
      {
        id: "part-1",
        messageID: "msg-1",
        sessionID: "session-1",
        type: "text",
        text: "",
      },
      " world",
    );

    const part = getTextPart(withDeltaB, "msg-1", "part-1");
    expect(part.streaming).toBe(true);
    expect(part.text).toBe("");
    expect(part.streamBaseText).toBe("");
    expect(part.streamTail?.delta).toBe(" world");
    expect(part.streamTail?.prev?.delta).toBe("Hello");
    expect(part.streamText).toBeUndefined();
    expect(part.streamTextLength).toBe(11);
    expect(part.streamRevision).toBe(2);
  });

  it("treats incoming text-only updates as finalized snapshot", () => {
    const next = upsertPart(createEmptyAgentStore("session-1"), {
      id: "part-1",
      messageID: "msg-1",
      sessionID: "session-1",
      type: "text",
      text: "Complete response",
    });

    const part = getTextPart(next, "msg-1", "part-1");
    expect(part.streaming).toBe(false);
    expect(part.streamTail).toBeUndefined();
    expect(part.text).toBe("Complete response");
  });

  it("uses text precedence when text and delta are both present", () => {
    const mixed = upsertPart(
      createEmptyAgentStore("session-1"),
      {
        id: "part-1",
        messageID: "msg-1",
        sessionID: "session-1",
        type: "text",
        text: "Authoritative final text",
      },
      " plus-delta",
    );

    const part = getTextPart(mixed, "msg-1", "part-1");
    expect(part.text).toBe("Authoritative final text");
    expect(part.streaming).toBe(false);
    expect(part.streamTail).toBeUndefined();
  });

  it("keeps snapshot precedence when mixed update is still marked streaming", () => {
    const mixedStreaming = upsertPart(
      createEmptyAgentStore("session-1"),
      {
        id: "part-1",
        messageID: "msg-1",
        sessionID: "session-1",
        type: "text",
        text: "Snapshot wins",
        streaming: true,
      },
      "ignored-delta",
    );

    const part = getTextPart(mixedStreaming, "msg-1", "part-1");
    expect(part.text).toBe("Snapshot wins");
    expect(part.streaming).toBe(true);
    expect(part.streamBaseText).toBe("Snapshot wins");
    expect(part.streamTail).toBeUndefined();
    expect(part.streamTextLength).toBe("Snapshot wins".length);
    expect(part.streamRevision).toBe(1);
  });
});
