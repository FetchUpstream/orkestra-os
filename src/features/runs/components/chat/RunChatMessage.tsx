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

import { type Component, type JSX } from "solid-js";

export type RunChatRole = "assistant" | "user" | "system";

type RunChatMessageProps = {
  role: RunChatRole;
  children: JSX.Element;
  class?: string;
  ariaLabel?: string;
};

const RunChatMessage: Component<RunChatMessageProps> = (props) => {
  return (
    <article
      class={`run-chat-message run-chat-message--${props.role} ${props.class ?? ""}`.trim()}
      aria-label={props.ariaLabel ?? `${props.role} message`}
    >
      <div
        class={`run-chat-message__body run-chat-message__body--${props.role}`}
      >
        {props.children}
      </div>
    </article>
  );
};

export default RunChatMessage;
