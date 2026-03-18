import { type Component, type JSX } from "solid-js";

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
      <div class="run-chat-message__body">{props.children}</div>
    </article>
  );
};

export default RunChatMessage;
