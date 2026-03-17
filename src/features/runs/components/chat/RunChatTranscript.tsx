import { For, Show, type Component, type JSX } from "solid-js";

type RunChatTranscriptProps = {
  items: readonly JSX.Element[];
  class?: string;
  olderAffordance?: JSX.Element;
  canLoadOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  loadOlderLabel?: string;
};

const RunChatTranscript: Component<RunChatTranscriptProps> = (props) => {
  const showDefaultLoadOlder = () =>
    Boolean(props.canLoadOlder && props.onLoadOlder && !props.olderAffordance);

  return (
    <section
      class={`run-chat-transcript ${props.class ?? ""}`.trim()}
      aria-label="Chat transcript"
    >
      <div class="run-chat-transcript__older">
        <Show when={props.olderAffordance}>{props.olderAffordance}</Show>
        <Show when={showDefaultLoadOlder()}>
          <button
            type="button"
            class="run-chat-transcript__load-older"
            onClick={() => props.onLoadOlder?.()}
            disabled={props.loadingOlder ?? false}
            aria-label={props.loadOlderLabel ?? "Load older messages"}
          >
            {props.loadingOlder
              ? "Loading..."
              : (props.loadOlderLabel ?? "Load older")}
          </button>
        </Show>
      </div>
      <ol class="run-chat-transcript__list" role="list">
        <For each={props.items}>
          {(item) => <li class="run-chat-transcript__item">{item}</li>}
        </For>
      </ol>
    </section>
  );
};

export default RunChatTranscript;
