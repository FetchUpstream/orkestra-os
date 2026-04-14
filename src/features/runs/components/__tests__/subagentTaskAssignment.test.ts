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
import type { OpenCodeBusEvent, UiPart } from "../../model/agentTypes";
import {
  buildSubagentSessionAssignments,
  buildTaskPartSessionIdsByPartId,
} from "../subagentTaskAssignment";

const createTaskPart = (id: string, title: string, raw?: unknown): UiPart => ({
  id,
  kind: "tool",
  type: "tool",
  toolName: "task",
  status: "running",
  title,
  raw,
});

const createRootMessagesById = (
  entries: Array<{
    messageId: string;
    parts: UiPart[];
  }>,
) => {
  return Object.fromEntries(
    entries.map(({ messageId, parts }) => [
      messageId,
      {
        partOrder: parts.map((part) => part.id),
        partsById: Object.fromEntries(parts.map((part) => [part.id, part])),
      },
    ]),
  );
};

const createRootTaskEvent = (
  partId: string,
  messageId: string,
  extraPart: Record<string, unknown> = {},
): OpenCodeBusEvent => ({
  type: "message.part.updated",
  properties: {
    sessionID: "session-root",
    part: {
      id: partId,
      partID: partId,
      messageID: messageId,
      sessionID: "session-root",
      type: "tool",
      tool: "task",
      state: { status: "running", title: partId },
      ...extraPart,
    },
  },
});

const createChildMessageEvent = (
  sessionId: string,
  messageId: string,
  info: Record<string, unknown> = {},
): OpenCodeBusEvent => ({
  type: "message.updated",
  properties: {
    sessionID: sessionId,
    info: {
      id: messageId,
      sessionID: sessionId,
      role: "assistant",
      ...info,
    },
  },
});

const createChildSessionEvent = (
  sessionId: string,
  info: Record<string, unknown> = {},
): OpenCodeBusEvent => ({
  type: "session.updated",
  properties: {
    sessionID: sessionId,
    info: {
      id: sessionId,
      sessionID: sessionId,
      ...info,
    },
  },
});

describe("subagentTaskAssignment", () => {
  it("keeps overlapping child sessions isolated under their explicit task mappings", () => {
    const rootMessagesById = createRootMessagesById([
      {
        messageId: "msg-root-1",
        parts: [
          createTaskPart("part-task-1", "First task", {
            child: { sessionID: "session-child-1" },
          }),
        ],
      },
      {
        messageId: "msg-root-2",
        parts: [
          createTaskPart("part-task-2", "Second task", {
            child: { sessionID: "session-child-2" },
          }),
        ],
      },
    ]);

    const rawEvents: OpenCodeBusEvent[] = [
      createRootTaskEvent("part-task-1", "msg-root-1"),
      createChildMessageEvent("session-child-1", "msg-child-1"),
      createRootTaskEvent("part-task-2", "msg-root-2"),
      createChildMessageEvent("session-child-2", "msg-child-2"),
      createChildMessageEvent("session-child-1", "msg-child-1b"),
    ];

    const assignments = buildSubagentSessionAssignments(
      rawEvents,
      "session-root",
      rootMessagesById,
      buildTaskPartSessionIdsByPartId(
        rootMessagesById,
        rawEvents,
        "session-root",
      ),
    );

    expect(assignments["session-child-1"]).toMatchObject({
      assignedTaskPartId: "part-task-1",
      assignmentSource: "explicit-task-tool-session",
    });
    expect(assignments["session-child-2"]).toMatchObject({
      assignedTaskPartId: "part-task-2",
      assignmentSource: "explicit-task-tool-session",
    });
  });

  it("rebinds a provisional fallback assignment when authoritative mapping arrives later", () => {
    const rawEvents: OpenCodeBusEvent[] = [
      createRootTaskEvent("part-task-1", "msg-root-1"),
      createRootTaskEvent("part-task-2", "msg-root-2"),
      createChildMessageEvent("session-child", "msg-child"),
    ];
    const initialRootMessagesById = createRootMessagesById([
      {
        messageId: "msg-root-1",
        parts: [createTaskPart("part-task-1", "First task")],
      },
      {
        messageId: "msg-root-2",
        parts: [createTaskPart("part-task-2", "Second task")],
      },
    ]);

    const initialAssignments = buildSubagentSessionAssignments(
      rawEvents,
      "session-root",
      initialRootMessagesById,
      buildTaskPartSessionIdsByPartId(
        initialRootMessagesById,
        rawEvents,
        "session-root",
      ),
    );

    expect(initialAssignments["session-child"]).toMatchObject({
      assignedTaskPartId: "part-task-2",
      assignmentSource: "active-task-fallback",
      assignmentProvisional: true,
    });

    const reboundRootMessagesById = createRootMessagesById([
      {
        messageId: "msg-root-1",
        parts: [
          createTaskPart("part-task-1", "First task", {
            child: { sessionID: "session-child" },
          }),
        ],
      },
      {
        messageId: "msg-root-2",
        parts: [createTaskPart("part-task-2", "Second task")],
      },
    ]);

    const reboundAssignments = buildSubagentSessionAssignments(
      rawEvents,
      "session-root",
      reboundRootMessagesById,
      buildTaskPartSessionIdsByPartId(
        reboundRootMessagesById,
        rawEvents,
        "session-root",
      ),
    );

    expect(reboundAssignments["session-child"]).toMatchObject({
      assignedTaskPartId: "part-task-1",
      assignmentSource: "explicit-task-tool-session",
      assignmentProvisional: false,
    });
  });

  it("does not collapse a parent message with multiple task tools to the last task", () => {
    const rootMessagesById = createRootMessagesById([
      {
        messageId: "msg-root",
        parts: [
          createTaskPart("part-task-1", "First task"),
          createTaskPart("part-task-2", "Second task"),
        ],
      },
    ]);

    const assignments = buildSubagentSessionAssignments(
      [
        createRootTaskEvent("part-task-1", "msg-root"),
        createRootTaskEvent("part-task-2", "msg-root"),
        createChildMessageEvent("session-child", "msg-child", {
          parentID: "msg-root",
        }),
      ],
      "session-root",
      rootMessagesById,
      {},
    );

    expect(assignments["session-child"]).toMatchObject({
      assignedTaskPartId: null,
      assignmentSource: null,
    });
  });

  it("prefers explicit task-session mapping extracted from root task events over fallback routing", () => {
    const rootMessagesById = createRootMessagesById([
      {
        messageId: "msg-root-1",
        parts: [createTaskPart("part-task-1", "First task")],
      },
      {
        messageId: "msg-root-2",
        parts: [createTaskPart("part-task-2", "Second task")],
      },
    ]);
    const rawEvents: OpenCodeBusEvent[] = [
      createRootTaskEvent("part-task-1", "msg-root-1", {
        output: { sessionID: "session-child" },
      }),
      createRootTaskEvent("part-task-2", "msg-root-2"),
      createChildMessageEvent("session-child", "msg-child"),
    ];

    const taskPartSessionIdsByPartId = buildTaskPartSessionIdsByPartId(
      rootMessagesById,
      rawEvents,
      "session-root",
    );
    const assignments = buildSubagentSessionAssignments(
      rawEvents,
      "session-root",
      rootMessagesById,
      taskPartSessionIdsByPartId,
    );

    expect(taskPartSessionIdsByPartId).toEqual({
      "part-task-1": ["session-child"],
    });
    expect(assignments["session-child"]).toMatchObject({
      assignedTaskPartId: "part-task-1",
      assignmentSource: "explicit-task-tool-session",
    });
  });

  it("uses parent session lineage to keep descendants on the correct task", () => {
    const rootMessagesById = createRootMessagesById([
      {
        messageId: "msg-root-1",
        parts: [
          createTaskPart("part-task-1", "First task", {
            child: { sessionID: "session-parent" },
          }),
        ],
      },
      {
        messageId: "msg-root-2",
        parts: [createTaskPart("part-task-2", "Second task")],
      },
    ]);
    const rawEvents: OpenCodeBusEvent[] = [
      createRootTaskEvent("part-task-1", "msg-root-1"),
      createRootTaskEvent("part-task-2", "msg-root-2"),
      createChildSessionEvent("session-grandchild", {
        parentID: "session-parent",
      }),
    ];

    const assignments = buildSubagentSessionAssignments(
      rawEvents,
      "session-root",
      rootMessagesById,
      buildTaskPartSessionIdsByPartId(
        rootMessagesById,
        rawEvents,
        "session-root",
      ),
    );

    expect(assignments["session-grandchild"]).toMatchObject({
      parentSessionId: "session-parent",
      assignedTaskPartId: "part-task-1",
      assignmentSource: "parent-session",
    });
  });
});
