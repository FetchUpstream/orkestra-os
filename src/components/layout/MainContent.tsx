import type { Component, JSX } from "solid-js";
import { useLocation } from "@solidjs/router";

type MainContentProps = {
  children: JSX.Element;
};

const MainContent: Component<MainContentProps> = (props) => {
  const location = useLocation();
  const isRunDetailRoute = () => location.pathname.startsWith("/runs/");

  return (
    <main
      class="main-content"
      classList={{
        "main-content--run-detail": isRunDetailRoute(),
      }}
    >
      <div
        class="main-content-inner"
        classList={{
          "main-content-inner--run-detail": isRunDetailRoute(),
        }}
      >
        {props.children}
      </div>
    </main>
  );
};

export default MainContent;
