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

import { Show, type Component, type JSX } from "solid-js";
import type { UiAssistantStreamingMetadata } from "../../model/agentTypes";
import RunChatMarkdown from "./RunChatMarkdown";
import useStreamingTextPresentation from "./useStreamingTextPresentation";

type RunChatAssistantMessageProps = {
  content: string;
  streaming?: UiAssistantStreamingMetadata;
  class?: string;
  reasoning?: JSX.Element;
  toolRail?: JSX.Element;
  details?: JSX.Element;
};

const RunChatAssistantMessage: Component<RunChatAssistantMessageProps> = (
  props,
) => {
  const targetText = () => props.streaming?.targetText ?? props.content;
  const presentation = useStreamingTextPresentation({
    messageId: () => props.streaming?.messageId,
    targetText,
    isStreaming: () => props.streaming?.text.isStreaming ?? false,
    streamRevision: () => props.streaming?.text.streamRevision ?? 0,
  });

  return (
    <div
      class={`run-chat-assistant-message ${props.class ?? ""}`.trim()}
      data-message-id={props.streaming?.messageId}
      data-streaming-state={props.streaming?.lifecycle}
      data-streaming={props.streaming?.isStreaming ? "true" : "false"}
      data-stream-revision={props.streaming?.streamRevision}
      data-stream-token={props.streaming?.streamToken}
      data-stream-animating={presentation.isAnimating() ? "true" : "false"}
      data-stream-catching-up={presentation.isCatchingUp() ? "true" : "false"}
    >
      <Show when={props.reasoning}>
        <div class="run-chat-assistant-message__reasoning">
          {props.reasoning}
        </div>
      </Show>
      <RunChatMarkdown
        content={presentation.displayedText()}
        class="run-chat-assistant-message__content"
      />
      <Show when={props.toolRail}>
        <div class="run-chat-assistant-message__tools">{props.toolRail}</div>
      </Show>
      <Show when={props.details}>
        <div class="run-chat-assistant-message__details">{props.details}</div>
      </Show>
    </div>
  );
};

export default RunChatAssistantMessage;
