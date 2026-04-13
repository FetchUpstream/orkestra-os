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

import { describe, expect, it } from "vitest";
import {
  createEmptyAgentStore,
  hydrateAgentStore,
  reduceOpenCodeEvent,
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

  it("merges per-message agent/model attribution from update and part events", () => {
    const initial = createEmptyAgentStore(null);
    const withMessage = reduceOpenCodeEvent(initial, {
      type: "message.updated",
      properties: {
        sessionID: "session-1",
        agent: "explorer",
        info: {
          id: "msg-1",
          role: "assistant",
          sessionID: "session-1",
        },
      },
    });

    const withPart = reduceOpenCodeEvent(withMessage, {
      type: "message.part.updated",
      properties: {
        sessionID: "session-1",
        model: "openai/k2p5",
        part: {
          id: "part-1",
          messageID: "msg-1",
          sessionID: "session-1",
          type: "text",
          text: "Hello",
        },
      },
    });

    const preservedOnEmpty = reduceOpenCodeEvent(withPart, {
      type: "message.part.updated",
      properties: {
        sessionID: "session-1",
        agent: "   ",
        part: {
          id: "part-1",
          messageID: "msg-1",
          sessionID: "session-1",
          type: "text",
          text: "Hello again",
        },
      },
    });

    expect(preservedOnEmpty.messagesById["msg-1"]?.attribution).toEqual({
      agent: "explorer",
      model: "k2p5",
    });
  });

  it("suppresses uuid-like agent and model attribution values", () => {
    const next = reduceOpenCodeEvent(createEmptyAgentStore(null), {
      type: "message.updated",
      properties: {
        sessionID: "session-1",
        agent: "550e8400-e29b-41d4-a716-446655440000",
        model: "123e4567-e89b-12d3-a456-426614174000",
        info: {
          id: "msg-1",
          role: "assistant",
          sessionID: "session-1",
        },
      },
    });

    expect(next.messagesById["msg-1"]?.attribution).toBeUndefined();
  });

  it("hydrates attribution from message and part snapshots", () => {
    const hydrated = hydrateAgentStore({
      sessionId: "session-1",
      messages: [
        {
          info: {
            id: "msg-1",
            role: "assistant",
            sessionID: "session-1",
            agent: "explorer",
          },
          parts: [
            {
              id: "part-1",
              type: "text",
              text: "Final answer",
              model: "provider/k2p5",
            },
          ],
        },
      ],
      todos: [],
    });

    expect(hydrated.messagesById["msg-1"]?.attribution).toEqual({
      agent: "explorer",
      model: "k2p5",
    });
  });

  it("prefers payload receivedAt when hydrating questions", () => {
    const hydrated = hydrateAgentStore({
      sessionId: "session-1",
      messages: [],
      questions: [
        {
          id: "question-1",
          sessionID: "session-1",
          received_at: "2026-01-01T00:00:05.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          questions: [{ header: "One", question: "First?", custom: true }],
        },
      ],
      todos: [],
    });

    expect(hydrated.pendingQuestionsById["question-1"]?.receivedAt).toBe(
      Date.parse("2026-01-01T00:00:05.000Z"),
    );
  });

  it("keeps payload receivedAt precedence over event timestamp", () => {
    const next = reduceOpenCodeEvent(createEmptyAgentStore("session-1"), {
      type: "question.asked",
      ts: "2026-01-01T00:00:10.000Z",
      properties: {
        requestID: "question-2",
        sessionID: "session-1",
        receivedAt: "2026-01-01T00:00:03.000Z",
        questions: [{ header: "One", question: "First?", custom: true }],
      },
    });

    expect(next.pendingQuestionsById["question-2"]?.receivedAt).toBe(
      Date.parse("2026-01-01T00:00:03.000Z"),
    );
  });

  it("normalizes nested permission payloads and falls back to active session", () => {
    const base = createEmptyAgentStore("session-1");
    const next = reduceOpenCodeEvent(base, {
      type: "permission.asked",
      properties: {
        permission: {
          id: "perm-1",
          kind: "write",
          paths: ["src/**/*.ts"],
          metadata: {
            tool: "write",
          },
        },
      },
    });

    expect(next.pendingPermissionsById["perm-1"]).toEqual(
      expect.objectContaining({
        requestId: "perm-1",
        sessionId: "session-1",
        kind: "write",
        pathPatterns: ["src/**/*.ts"],
      }),
    );
    expect(next.pendingPermissionsById["perm-1"]?.metadata).toEqual({
      tool: "write",
    });
  });

  it("clears normalized permission requests on permission.replied", () => {
    const withPermission = reduceOpenCodeEvent(
      createEmptyAgentStore("session-1"),
      {
        type: "permission.asked",
        properties: {
          permission: {
            id: "perm-2",
            kind: "bash",
          },
        },
      },
    );

    const cleared = reduceOpenCodeEvent(withPermission, {
      type: "permission.replied",
      properties: {
        requestId: "perm-2",
      },
    });

    expect(cleared.pendingPermissionsById["perm-2"]).toBeUndefined();
    expect(cleared.resolvedPermissionsById["perm-2"]).toMatchObject({
      requestId: "perm-2",
      status: "replied",
    });
  });

  it("clears normalized permission requests on permission.rejected", () => {
    const withPermission = reduceOpenCodeEvent(
      createEmptyAgentStore("session-1"),
      {
        type: "permission.asked",
        properties: {
          permission: {
            id: "perm-3",
            kind: "bash",
          },
        },
      },
    );

    const cleared = reduceOpenCodeEvent(withPermission, {
      type: "permission.rejected",
      properties: {
        requestId: "perm-3",
      },
    });

    expect(cleared.pendingPermissionsById["perm-3"]).toBeUndefined();
    expect(cleared.resolvedPermissionsById["perm-3"]).toMatchObject({
      requestId: "perm-3",
      status: "rejected",
    });
  });

  it("keeps subagent permission requests even when session differs from root", () => {
    const next = reduceOpenCodeEvent(createEmptyAgentStore("session-root"), {
      type: "permission.asked",
      properties: {
        requestID: "perm-sub-1",
        sessionID: "session-child",
        kind: "bash",
      },
    });

    expect(next.pendingPermissionsById["perm-sub-1"]).toMatchObject({
      requestId: "perm-sub-1",
      sessionId: "session-child",
      kind: "bash",
    });
    expect(next.sessionId).toBe("session-root");
  });

  it("stores connection state for server disconnect and reconnect events", () => {
    const disconnected = reduceOpenCodeEvent(createEmptyAgentStore(null), {
      type: "server.disconnected",
      properties: { reason: "socket_closed" },
    });

    expect(disconnected.streamConnected).toBe(false);

    const reconnected = reduceOpenCodeEvent(disconnected, {
      type: "server.connected",
      properties: { reason: "socket_recovered" },
    });

    expect(reconnected.streamConnected).toBe(true);
  });
});
