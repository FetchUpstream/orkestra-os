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

type RunChatUserMessageProps = {
  children: JSX.Element;
  class?: string;
};

const RunChatUserMessage: Component<RunChatUserMessageProps> = (props) => {
  return (
    <div class={`run-chat-user-message ${props.class ?? ""}`.trim()}>
      <div class="run-chat-user-message__bubble">{props.children}</div>
    </div>
  );
};

export default RunChatUserMessage;
