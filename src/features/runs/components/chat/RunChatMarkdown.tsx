import { createMemo, type Component } from "solid-js";
import { renderRunChatMarkdown } from "../../lib/runChatMarkdown";

type RunChatMarkdownProps = {
  content: string;
  class?: string;
};

const RunChatMarkdown: Component<RunChatMarkdownProps> = (props) => {
  const html = createMemo(() => renderRunChatMarkdown(props.content));

  return (
    <div
      class={`run-chat-markdown ${props.class ?? ""}`.trim()}
      innerHTML={html()}
    />
  );
};

export default RunChatMarkdown;
