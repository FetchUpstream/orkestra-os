import { Show, type Component, type JSX } from "solid-js";

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
      <Show when={props.role === "assistant"}>
        <span class="run-chat-message__role" aria-hidden="true">
          Assistant
        </span>
      </Show>
      <Show when={props.role === "user"}>
        <span class="run-chat-message__role" aria-hidden="true">
          You
        </span>
      </Show>
      <Show when={props.role === "system"}>
        <span class="run-chat-message__role" aria-hidden="true">
          System
        </span>
      </Show>
      <div class="run-chat-message__body">{props.children}</div>
    </article>
  );
};

export default RunChatMessage;
