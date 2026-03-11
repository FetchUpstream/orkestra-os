import type { Component, JSX } from "solid-js";

type MainContentProps = {
  children: JSX.Element;
};

const MainContent: Component<MainContentProps> = (props) => {
  return (
    <main class="main-content">
      <div class="main-content-inner">{props.children}</div>
    </main>
  );
};

export default MainContent;
