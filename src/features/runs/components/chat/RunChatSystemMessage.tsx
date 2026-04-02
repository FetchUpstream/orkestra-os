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

import type { Component, JSX } from "solid-js";

type RunChatSystemMessageProps = {
  children: JSX.Element;
  class?: string;
};

const RunChatSystemMessage: Component<RunChatSystemMessageProps> = (props) => {
  return (
    <div
      class={`run-chat-system-message ${props.class ?? ""}`.trim()}
      role="status"
      aria-live="polite"
    >
      <div class="run-chat-system-message__row">{props.children}</div>
    </div>
  );
};

export default RunChatSystemMessage;
