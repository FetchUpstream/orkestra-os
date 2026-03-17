import { Show, type Component, type JSX } from "solid-js";
import RunChatMarkdown from "./RunChatMarkdown";

type RunChatAssistantMessageProps = {
  content: string;
  class?: string;
  reasoning?: JSX.Element;
  toolRail?: JSX.Element;
  details?: JSX.Element;
};

const RunChatAssistantMessage: Component<RunChatAssistantMessageProps> = (
  props,
) => {
  return (
    <div class={`run-chat-assistant-message ${props.class ?? ""}`.trim()}>
      <RunChatMarkdown
        content={props.content}
        class="run-chat-assistant-message__content"
      />
      <Show when={props.reasoning}>
        <div class="run-chat-assistant-message__reasoning">
          {props.reasoning}
        </div>
      </Show>
      <Show when={props.toolRail}>
        <div class="run-chat-assistant-message__tools">{props.toolRail}</div>
      </Show>
      <Show when={props.details}>
        <div class="run-chat-assistant-message__details">{props.details}</div>
      </Show>
    </div>
  );
};

export default RunChatAssistantMessage;
