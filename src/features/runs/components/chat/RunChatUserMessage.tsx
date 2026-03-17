import type { Component, JSX } from "solid-js";

type RunChatUserMessageProps = {
  children: JSX.Element;
  class?: string;
};

const RunChatUserMessage: Component<RunChatUserMessageProps> = (props) => {
  return (
    <div class={`run-chat-user-message ${props.class ?? ""}`.trim()}>
      <div class="run-chat-user-message__bubble">{props.children}</div>
    </div>
  );
};

export default RunChatUserMessage;
