import { For, Show, type Component } from "solid-js";

export type RunChatToolRailItem = {
  id: string;
  label: string;
  status?: string;
  detail?: string;
  open?: boolean;
};

type RunChatToolRailProps = {
  items: readonly RunChatToolRailItem[];
  class?: string;
  emptyLabel?: string;
};

const normalizeStatus = (
  status?: string,
): "running" | "completed" | "failed" | undefined => {
  if (!status) return undefined;
  const normalized = status.trim().toLowerCase();

  if (
    ["running", "in_progress", "in-progress", "started", "processing"].includes(
      normalized,
    )
  ) {
    return "running";
  }

  if (
    ["completed", "complete", "success", "succeeded", "done"].includes(
      normalized,
    )
  ) {
    return "completed";
  }

  if (
    ["failed", "failure", "error", "errored", "cancelled", "canceled"].includes(
      normalized,
    )
  ) {
    return "failed";
  }

  return undefined;
};

const RunChatToolRail: Component<RunChatToolRailProps> = (props) => {
  return (
    <section
      class={`run-chat-tool-rail ${props.class ?? ""}`.trim()}
      aria-label="Tool activity"
    >
      <Show
        when={props.items.length > 0}
        fallback={
          <p class="run-chat-tool-rail__empty">
            {props.emptyLabel ?? "No tool activity"}
          </p>
        }
      >
        <ul class="run-chat-tool-rail__list">
          <For each={props.items}>
            {(item) => {
              const statusModifier = normalizeStatus(item.status);

              return (
                <li
                  class={`run-chat-tool-rail__item${statusModifier ? ` run-chat-tool-rail__item--${statusModifier}` : ""}`}
                >
                  <div class="run-chat-tool-rail__summary">
                    <span class="run-chat-tool-rail__label">{item.label}</span>
                    <Show when={item.status}>
                      <span class="run-chat-tool-rail__status">
                        {item.status}
                      </span>
                    </Show>
                  </div>
                  <Show when={item.detail}>
                    <details
                      class="run-chat-tool-rail__details"
                      open={item.open ?? false}
                    >
                      <summary>Details</summary>
                      <pre>{item.detail}</pre>
                    </details>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </section>
  );
};

export default RunChatToolRail;
