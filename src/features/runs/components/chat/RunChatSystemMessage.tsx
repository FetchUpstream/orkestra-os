import type { Component, JSX } from "solid-js";

type RunChatSystemMessageProps = {
  children: JSX.Element;
  class?: string;
};

const RunChatSystemMessage: Component<RunChatSystemMessageProps> = (props) => {
  return (
    <div
      class={`run-chat-system-message ${props.class ?? ""}`.trim()}
      role="status"
      aria-live="polite"
    >
      <div class="run-chat-system-message__row">{props.children}</div>
    </div>
  );
};

export default RunChatSystemMessage;
