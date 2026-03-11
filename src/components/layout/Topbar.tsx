import type { Component, JSX } from "solid-js";

type TopbarProps = {
  title: string;
  actions?: JSX.Element;
};

const Topbar: Component<TopbarProps> = (props) => {
  return (
    <header class="topbar">
      <h1 class="topbar-title">{props.title}</h1>
      <div class="topbar-actions">{props.actions}</div>
    </header>
  );
};

export default Topbar;
