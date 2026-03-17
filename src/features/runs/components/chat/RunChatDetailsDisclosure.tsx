import { Show, createUniqueId, type Component, type JSX } from "solid-js";

type RunChatDetailsDisclosureProps = {
  summary?: string;
  children: JSX.Element;
  open?: boolean;
  class?: string;
};

const RunChatDetailsDisclosure: Component<RunChatDetailsDisclosureProps> = (
  props,
) => {
  const contentId = createUniqueId();

  return (
    <details
      class={`run-chat-details ${props.class ?? ""}`.trim()}
      open={props.open ?? false}
    >
      <summary aria-controls={contentId}>{props.summary ?? "Details"}</summary>
      <Show when={props.children}>
        <div id={contentId} class="run-chat-details__content">
          {props.children}
        </div>
      </Show>
    </details>
  );
};

export default RunChatDetailsDisclosure;
