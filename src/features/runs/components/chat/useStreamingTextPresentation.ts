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

import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type Accessor,
} from "solid-js";

type StreamingTextPresentationOptions = {
  messageId: Accessor<string | undefined>;
  targetText: Accessor<string>;
  isStreaming: Accessor<boolean>;
  streamRevision: Accessor<number>;
};

type StreamingTextPresentationState = {
  displayedText: Accessor<string>;
  isAnimating: Accessor<boolean>;
  isCatchingUp: Accessor<boolean>;
};

const BASE_UNITS_PER_SECOND = 84;
const MAX_UNITS_PER_SECOND = 1_800;
const CATCH_UP_BACKLOG_UNITS = 48;

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

const segmentText = (text: string): string[] => {
  if (!text.length) {
    return [];
  }

  if (!graphemeSegmenter) {
    return Array.from(text);
  }

  return Array.from(
    graphemeSegmenter.segment(text),
    (segment) => segment.segment,
  );
};

const useStreamingTextPresentation = (
  options: StreamingTextPresentationOptions,
): StreamingTextPresentationState => {
  const targetUnits = createMemo(() => segmentText(options.targetText()));
  const targetUnitCount = createMemo(() => targetUnits().length);
  const [displayedUnitCount, setDisplayedUnitCount] =
    createSignal(targetUnitCount());
  const [displayedText, setDisplayedText] = createSignal(options.targetText());
  const [isAnimating, setIsAnimating] = createSignal(false);
  const [isCatchingUp, setIsCatchingUp] = createSignal(false);

  let frameId: number | undefined;
  let lastTimestamp = 0;

  const stopAnimation = () => {
    if (frameId !== undefined && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameId);
    }
    frameId = undefined;
    lastTimestamp = 0;
    setIsAnimating(false);
    setIsCatchingUp(false);
  };

  const syncToTarget = () => {
    setDisplayedUnitCount(targetUnitCount());
    setDisplayedText(options.targetText());
    stopAnimation();
  };

  const scheduleAnimation = () => {
    if (frameId !== undefined) {
      return;
    }

    if (typeof requestAnimationFrame !== "function") {
      syncToTarget();
      return;
    }

    frameId = requestAnimationFrame((timestamp) => {
      frameId = undefined;

      if (!options.isStreaming()) {
        syncToTarget();
        return;
      }

      const total = targetUnitCount();
      const units = targetUnits();
      const shown = Math.min(displayedUnitCount(), total);
      if (shown >= total) {
        setIsAnimating(false);
        setIsCatchingUp(false);
        lastTimestamp = timestamp;
        return;
      }

      const deltaMs =
        lastTimestamp > 0
          ? Math.min(64, Math.max(16, timestamp - lastTimestamp))
          : 16;
      lastTimestamp = timestamp;

      const backlog = total - shown;
      const unitsPerSecond = Math.min(
        MAX_UNITS_PER_SECOND,
        BASE_UNITS_PER_SECOND + backlog * 14,
      );
      const nextCount = Math.min(
        total,
        shown + Math.max(1, Math.round((unitsPerSecond * deltaMs) / 1_000)),
      );
      const remaining = total - nextCount;

      setDisplayedUnitCount(nextCount);
      setDisplayedText(
        nextCount >= total
          ? options.targetText()
          : units.slice(0, nextCount).join(""),
      );
      setIsAnimating(remaining > 0);
      setIsCatchingUp(remaining >= CATCH_UP_BACKLOG_UNITS);

      if (remaining > 0) {
        scheduleAnimation();
      }
    });
  };

  createEffect(
    on(options.messageId, () => {
      syncToTarget();
    }),
  );

  createEffect(() => {
    options.streamRevision();

    const targetText = options.targetText();
    const streaming = options.isStreaming();
    const total = targetUnitCount();
    const shown = Math.min(displayedUnitCount(), total);

    if (!streaming) {
      if (displayedText() !== targetText) {
        syncToTarget();
        return;
      }

      stopAnimation();
      return;
    }

    if (!targetText.startsWith(displayedText())) {
      syncToTarget();
      return;
    }

    if (shown >= total) {
      setIsAnimating(false);
      setIsCatchingUp(false);
      return;
    }

    setIsAnimating(true);
    setIsCatchingUp(total - shown >= CATCH_UP_BACKLOG_UNITS);
    scheduleAnimation();
  });

  onCleanup(() => {
    stopAnimation();
  });

  return {
    displayedText,
    isAnimating,
    isCatchingUp,
  };
};

export default useStreamingTextPresentation;
