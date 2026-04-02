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

import { createMemo, Show, type Component } from "solid-js";
import { renderRunChatMarkdown } from "../../lib/runChatMarkdown";

type RunChatMarkdownProps = {
  content: string;
  class?: string;
  renderMode?: "markdown" | "plain";
};

const RunChatMarkdown: Component<RunChatMarkdownProps> = (props) => {
  const renderMode = createMemo<"markdown" | "plain">(
    () => props.renderMode ?? "markdown",
  );
  const html = createMemo(() =>
    renderMode() === "markdown" ? renderRunChatMarkdown(props.content) : "",
  );
  const className = createMemo(() =>
    `run-chat-markdown ${props.class ?? ""}`.trim(),
  );

  return (
    <Show
      when={renderMode() === "plain"}
      fallback={<div class={className()} innerHTML={html()} />}
    >
      <div class={className()}>
        <pre>{props.content}</pre>
      </div>
    </Show>
  );
};

export default RunChatMarkdown;
