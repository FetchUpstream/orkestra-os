import type { Component, JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { AppIcon } from "./icons";

type Props = {
  as?: keyof JSX.IntrinsicElements;
  class?: string;
  srLabel?: string;
  children?: JSX.Element;
} & JSX.HTMLAttributes<HTMLElement>;

const RunInlineLoader: Component<Props> = (props) => {
  const {
    as,
    class: className,
    srLabel = "Waiting for agent output...",
    children,
    ...rest
  } = props;

  return (
    <Dynamic
      component={as ?? "span"}
      class={`run-inline-loading-row${className ? ` ${className}` : ""}`}
      {...rest}
    >
      <AppIcon
        name="status.loading"
        class="run-inline-spinner"
        aria-hidden="true"
      />
      <span class="sr-only">{srLabel}</span>
      {children}
    </Dynamic>
  );
};

export default RunInlineLoader;
