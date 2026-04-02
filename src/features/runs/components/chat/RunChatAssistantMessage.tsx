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
import RunChatMarkdown from "./RunChatMarkdown";

type RunChatAssistantMessageProps = {
  content: string;
  class?: string;
  reasoning?: JSX.Element;
  toolRail?: JSX.Element;
  details?: JSX.Element;
};

const RunChatAssistantMessage: Component<RunChatAssistantMessageProps> = (
  props,
) => {
  return (
    <div class={`run-chat-assistant-message ${props.class ?? ""}`.trim()}>
      <Show when={props.reasoning}>
        <div class="run-chat-assistant-message__reasoning">
          {props.reasoning}
        </div>
      </Show>
      <RunChatMarkdown
        content={props.content}
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
