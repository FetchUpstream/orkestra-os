import { For, Show, type Component } from "solid-js";

type Props = {
  open: boolean;
  loading: boolean;
  results: string[];
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
        <Show
          when={!props.loading}
          fallback={<div class="task-file-mention-row">Searching files…</div>}
        >
          <Show
            when={props.results.length > 0}
            fallback={
              <div class="task-file-mention-row">No matching files</div>
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
