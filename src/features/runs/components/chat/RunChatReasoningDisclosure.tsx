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

import { Show, createUniqueId, type Component, type JSX } from "solid-js";

type RunChatReasoningDisclosureProps = {
  content: JSX.Element;
  summary?: string;
  open?: boolean;
  class?: string;
};

const RunChatReasoningDisclosure: Component<RunChatReasoningDisclosureProps> = (
  props,
) => {
  const contentId = createUniqueId();

  return (
    <details
      class={`run-chat-reasoning ${props.class ?? ""}`.trim()}
      open={props.open ?? false}
    >
      <summary aria-controls={contentId}>
        {props.summary ?? "Reasoning"}
      </summary>
      <Show when={props.content}>
        <div id={contentId} class="run-chat-reasoning__content">
          {props.content}
        </div>
      </Show>
    </details>
  );
};

export default RunChatReasoningDisclosure;
