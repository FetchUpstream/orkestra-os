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

import { createEmptyAgentStore, reduceOpenCodeEvent } from "./agentReducer";
import type { AgentStore, OpenCodeBusEvent } from "./agentTypes";

type BuildMergedSubagentMessageStoreInput = {
  sessionId: string;
  fetchedStore?: AgentStore | null;
  liveEvents?: readonly OpenCodeBusEvent[];
};

const mergeOrderedIds = (...groups: ReadonlyArray<readonly string[]>) => {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const group of groups) {
    for (const id of group) {
      const normalizedId = id.trim();
      if (!normalizedId || seen.has(normalizedId)) {
        continue;
      }
      seen.add(normalizedId);
      ordered.push(normalizedId);
    }
  }

  return ordered;
};

const toSortableTimestamp = (
  value: number | null | undefined,
): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const compareNullableTimestamps = (
  left: number | null,
  right: number | null,
): number => {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
};

export const buildMergedSubagentMessageStore = ({
  sessionId,
  fetchedStore = null,
  liveEvents = [],
}: BuildMergedSubagentMessageStoreInput): AgentStore => {
  const baseStore = fetchedStore ?? createEmptyAgentStore(sessionId);
  const mergedStore = liveEvents.reduce(
    (store, event) => reduceOpenCodeEvent(store, event),
    baseStore,
  );

  const replayMessageOrder = mergeOrderedIds(
    fetchedStore?.messageOrder ?? [],
    mergedStore.messageOrder,
    Object.keys(fetchedStore?.messagesById ?? {}),
    Object.keys(mergedStore.messagesById),
  ).filter((messageId) => Boolean(mergedStore.messagesById[messageId]));

  const replayIndexByMessageId = new Map(
    replayMessageOrder.map((messageId, index) => [messageId, index]),
  );

  const orderedMessageIds = [...replayMessageOrder].sort((leftId, rightId) => {
    const leftMessage = mergedStore.messagesById[leftId];
    const rightMessage = mergedStore.messagesById[rightId];

    if (!leftMessage || !rightMessage) {
      return leftId.localeCompare(rightId);
    }

    // Prefer explicit creation time when available. If one or both messages do
    // not have a timestamp yet, fall back to the merged replay order derived
    // from fetched history plus live event replay.
    const timestampDelta = compareNullableTimestamps(
      toSortableTimestamp(leftMessage.createdAt),
      toSortableTimestamp(rightMessage.createdAt),
    );
    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    const replayDelta =
      (replayIndexByMessageId.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
      (replayIndexByMessageId.get(rightId) ?? Number.MAX_SAFE_INTEGER);
    if (replayDelta !== 0) {
      return replayDelta;
    }

    return leftId.localeCompare(rightId);
  });

  return {
    ...mergedStore,
    sessionId: mergedStore.sessionId || fetchedStore?.sessionId || sessionId,
    messageOrder: orderedMessageIds,
  };
};
