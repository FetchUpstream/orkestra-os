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
} from "../agentReducer";
import { buildMergedSubagentMessageStore } from "../subagentMessageTimeline";
import type { AgentStore, OpenCodeBusEvent } from "../agentTypes";

const createFetchedStore = (
  sessionId: string,
  messages: Array<{
    id: string;
    createdAt: string;
    text: string;
    role?: "assistant" | "user" | "system" | "unknown";
    agent?: string;
    model?: string;
  }>,
): AgentStore => {
  return hydrateAgentStore({
    sessionId,
    messages: messages.map((message) => ({
      info: {
        id: message.id,
        sessionID: sessionId,
        role: message.role ?? "assistant",
        createdAt: message.createdAt,
        ...(message.agent ? { agent: message.agent } : {}),
        ...(message.model ? { model: message.model } : {}),
      },
      parts: [
        {
          id: `part-${message.id}`,
          type: "text",
          text: message.text,
          messageID: message.id,
          sessionID: sessionId,
        },
      ],
    })),
    todos: [],
  });
};

const createMessageUpdatedEvent = (
  sessionId: string,
  messageId: string,
  createdAt?: string,
  role: "assistant" | "user" | "system" | "unknown" | null = "assistant",
): OpenCodeBusEvent => ({
  type: "message.updated",
  properties: {
    sessionID: sessionId,
    info: {
      id: messageId,
      sessionID: sessionId,
      ...(role ? { role } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
  },
});

const createTextPartUpdatedEvent = (
  sessionId: string,
  messageId: string,
  text: string,
): OpenCodeBusEvent => ({
  type: "message.part.updated",
  properties: {
    sessionID: sessionId,
    part: {
      id: `part-${messageId}`,
      messageID: messageId,
      sessionID: sessionId,
      type: "text",
      text,
    },
  },
});

const createLiveStore = (
  sessionId: string,
  events: OpenCodeBusEvent[],
): AgentStore => {
  return events.reduce(
    (store, event) => reduceOpenCodeEvent(store, event),
    createEmptyAgentStore(sessionId),
  );
};

const getMessageText = (store: AgentStore, messageId: string): string => {
  const message = store.messagesById[messageId];
  if (!message) {
    throw new Error(`missing message ${messageId}`);
  }

  const firstPartId = message.partOrder[0];
  const part = message.partsById[firstPartId];
  if (!part || (part.kind !== "text" && part.kind !== "reasoning")) {
    throw new Error(`missing text part for ${messageId}`);
  }

  return part.text;
};

describe("buildMergedSubagentMessageStore", () => {
  it("merges fetched history with live updates into one ordered timeline", () => {
    const sessionId = "session-child";
    const fetchedStore = createFetchedStore(sessionId, [
      {
        id: "msg-1",
        createdAt: "2026-01-01T00:00:01.000Z",
        text: "Fetched first",
      },
      {
        id: "msg-2",
        createdAt: "2026-01-01T00:00:02.000Z",
        text: "Fetched second",
      },
    ]);

    const mergedStore = buildMergedSubagentMessageStore({
      sessionId,
      fetchedStore,
      liveEvents: [
        createMessageUpdatedEvent(
          sessionId,
          "msg-4",
          "2026-01-01T00:00:04.000Z",
        ),
        createTextPartUpdatedEvent(sessionId, "msg-4", "Live fourth"),
        createMessageUpdatedEvent(
          sessionId,
          "msg-3",
          "2026-01-01T00:00:03.000Z",
        ),
        createTextPartUpdatedEvent(sessionId, "msg-3", "Live third"),
      ],
    });

    expect(mergedStore.messageOrder).toEqual([
      "msg-1",
      "msg-2",
      "msg-3",
      "msg-4",
    ]);
    expect(getMessageText(mergedStore, "msg-1")).toBe("Fetched first");
    expect(getMessageText(mergedStore, "msg-2")).toBe("Fetched second");
    expect(getMessageText(mergedStore, "msg-3")).toBe("Live third");
    expect(getMessageText(mergedStore, "msg-4")).toBe("Live fourth");
  });

  it("orders live-only messages by createdAt instead of first-seen arrival", () => {
    const sessionId = "session-child";
    const liveStore = createLiveStore(sessionId, [
      createMessageUpdatedEvent(sessionId, "msg-3", "2026-01-01T00:00:03.000Z"),
      createTextPartUpdatedEvent(sessionId, "msg-3", "Third"),
      createMessageUpdatedEvent(sessionId, "msg-1", "2026-01-01T00:00:01.000Z"),
      createTextPartUpdatedEvent(sessionId, "msg-1", "First"),
      createMessageUpdatedEvent(sessionId, "msg-2", "2026-01-01T00:00:02.000Z"),
      createTextPartUpdatedEvent(sessionId, "msg-2", "Second"),
    ]);

    const mergedStore = buildMergedSubagentMessageStore({
      sessionId,
      liveEvents: liveStore.rawEvents,
    });

    expect(liveStore.messageOrder).toEqual(["msg-3", "msg-1", "msg-2"]);
    expect(mergedStore.messageOrder).toEqual(["msg-1", "msg-2", "msg-3"]);
  });

  it("preserves coherent ordering across reconnect overlap without duplicating messages", () => {
    const sessionId = "session-child";
    const fetchedStore = createFetchedStore(sessionId, [
      {
        id: "msg-1",
        createdAt: "2026-01-01T00:00:01.000Z",
        text: "Fetched first",
      },
      {
        id: "msg-2",
        createdAt: "2026-01-01T00:00:02.000Z",
        text: "Fetched second",
        agent: "explorer",
        model: "k2p5",
      },
    ]);

    const mergedStore = buildMergedSubagentMessageStore({
      sessionId,
      fetchedStore,
      liveEvents: [
        createMessageUpdatedEvent(sessionId, "msg-2", undefined, null),
        createTextPartUpdatedEvent(sessionId, "msg-2", "Live second"),
        createMessageUpdatedEvent(sessionId, "msg-1", undefined, null),
      ],
    });

    expect(mergedStore.messageOrder).toEqual(["msg-1", "msg-2"]);
    expect(Object.keys(mergedStore.messagesById)).toHaveLength(2);
    expect(mergedStore.messagesById["msg-1"]?.createdAt).toBe(
      Date.parse("2026-01-01T00:00:01.000Z"),
    );
    expect(mergedStore.messagesById["msg-2"]?.createdAt).toBe(
      Date.parse("2026-01-01T00:00:02.000Z"),
    );
    expect(mergedStore.messagesById["msg-2"]?.role).toBe("assistant");
    expect(mergedStore.messagesById["msg-2"]?.attribution).toEqual({
      agent: "explorer",
      model: "k2p5",
    });
    expect(getMessageText(mergedStore, "msg-2")).toBe("Live second");
  });

  it("falls back to deterministic replay order when createdAt is missing", () => {
    const sessionId = "session-child";
    const mergedStore = buildMergedSubagentMessageStore({
      sessionId,
      liveEvents: [
        createMessageUpdatedEvent(sessionId, "msg-b", undefined, null),
        createTextPartUpdatedEvent(sessionId, "msg-b", "Second seen"),
        createMessageUpdatedEvent(sessionId, "msg-a", undefined, null),
        createTextPartUpdatedEvent(sessionId, "msg-a", "Third seen"),
      ],
    });

    expect(mergedStore.messageOrder).toEqual(["msg-b", "msg-a"]);
  });
});
