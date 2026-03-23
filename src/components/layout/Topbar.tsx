import type { Component, JSX } from "solid-js";

type TopbarProps = {
  title: string;
  subtitle?: string;
  leading?: JSX.Element;
  actions?: JSX.Element;
};

const Topbar: Component<TopbarProps> = (props) => {
  return (
    <header class="navbar border-base-content/15 bg-base-200 min-h-11 rounded-none border px-3 py-1.5">
      <div class="flex min-w-0 flex-1 items-center gap-2.5">
        {props.leading ? <div class="shrink-0">{props.leading}</div> : null}
        <div class="min-w-0">
          <div class="text-base-content truncate text-[13px] font-semibold tracking-[0.02em]">
            {props.title}
          </div>
          {props.subtitle ? (
            <p class="text-base-content/55 truncate text-[11px]">
              {props.subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {props.actions ? (
        <div class="flex shrink-0 items-center gap-2">{props.actions}</div>
      ) : null}
    </header>
  );
};

export default Topbar;
