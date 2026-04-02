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

import { For, Show, type Component } from "solid-js";

type Props = {
  open: boolean;
  loading: boolean;
  results: string[];
  errorText: string | null;
  highlightedIndex: number;
  anchor: { left: number; top: number } | null;
  onHover: (index: number) => void;
  onSelect: (path: string) => void;
};

const TaskFileMentionDropdown: Component<Props> = (props) => {
  return (
    <Show when={props.open && props.anchor}>
      <div
        class="task-file-mention-dropdown"
        style={{
          left: `${props.anchor?.left ?? 0}px`,
          top: `${props.anchor?.top ?? 0}px`,
        }}
      >
        <Show when={Boolean(props.errorText)}>
          <div class="task-file-mention-row task-file-mention-row--error">
            {props.errorText}
          </div>
        </Show>

        <Show when={!props.errorText}>
          <Show
            when={props.results.length > 0}
            fallback={
              <Show when={!props.loading}>
                <div class="task-file-mention-row">No matching files</div>
              </Show>
            }
          >
            <For each={props.results}>
              {(path, index) => (
                <button
                  type="button"
                  class={`task-file-mention-row task-file-mention-option ${props.highlightedIndex === index() ? "is-highlighted" : ""}`}
                  onMouseEnter={() => props.onHover(index())}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    props.onSelect(path);
                  }}
                >
                  {path}
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </Show>
  );
};

export default TaskFileMentionDropdown;
