import { createMemo, Show, type Component } from "solid-js";
import { renderRunChatMarkdown } from "../../lib/runChatMarkdown";

type RunChatMarkdownProps = {
  content: string;
  class?: string;
  renderMode?: "markdown" | "plain";
};

const RunChatMarkdown: Component<RunChatMarkdownProps> = (props) => {
  const renderMode = createMemo<"markdown" | "plain">(
    () => props.renderMode ?? "markdown",
  );
  const html = createMemo(() =>
    renderMode() === "markdown" ? renderRunChatMarkdown(props.content) : "",
  );
  const className = createMemo(() =>
    `run-chat-markdown ${props.class ?? ""}`.trim(),
  );

  return (
    <Show
      when={renderMode() === "plain"}
      fallback={<div class={className()} innerHTML={html()} />}
    >
      <div class={className()}>
        <pre>{props.content}</pre>
      </div>
    </Show>
  );
};

export default RunChatMarkdown;
