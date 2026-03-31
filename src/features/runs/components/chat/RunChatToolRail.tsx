import { For, Show, type Component } from "solid-js";
import RunInlineLoader from "../../../../components/ui/RunInlineLoader";
import { AppIcon } from "../../../../components/ui/icons";

export type RunChatToolRailItem = {
  id: string;
  label: string;
  summary?: string;
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
    [
      "loading",
      "pending",
      "running",
      "in_progress",
      "in-progress",
      "started",
      "processing",
    ].includes(normalized)
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
              const rowSummary = item.summary ?? item.label;

              return (
                <li
                  class={`run-chat-tool-rail__item${statusModifier ? ` run-chat-tool-rail__item--${statusModifier}` : ""}`}
                >
                  <div class="run-chat-tool-rail__row">
                    <span class="run-chat-tool-rail__line">{rowSummary}</span>
                    <Show when={item.status}>
                      <span class="run-chat-tool-rail__status">
                        <Show when={statusModifier === "running"}>
                          <RunInlineLoader
                            class="run-chat-tool-rail__status-slot"
                            aria-label={item.status}
                            srLabel={item.status}
                          />
                        </Show>
                        <Show when={statusModifier === "completed"}>
                          <span
                            class="run-chat-tool-rail__status-slot"
                            aria-label={item.status}
                          >
                            <span
                              class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--check"
                              aria-hidden="true"
                            >
                              ✓
                            </span>
                            <span class="sr-only">{item.status}</span>
                          </span>
                        </Show>
                        <Show when={statusModifier === "failed"}>
                          <span
                            class="run-chat-tool-rail__status-slot"
                            aria-label={item.status}
                          >
                            <AppIcon
                              name="status.error"
                              class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--error"
                              aria-hidden="true"
                              size={14}
                            />
                            <span class="sr-only">{item.status}</span>
                          </span>
                        </Show>
                        <Show
                          when={
                            statusModifier !== "running" &&
                            statusModifier !== "completed" &&
                            statusModifier !== "failed"
                          }
                        >
                          {item.status}
                        </Show>
                      </span>
                    </Show>
                  </div>
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
