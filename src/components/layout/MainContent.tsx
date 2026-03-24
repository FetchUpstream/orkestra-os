import type { Component, JSX } from "solid-js";
import { useLocation } from "@solidjs/router";

type MainContentProps = {
  children: JSX.Element;
};

const MainContent: Component<MainContentProps> = (props) => {
  const location = useLocation();
  const isRunDetailRoute = () => location.pathname.startsWith("/runs/");
  const isBoardRoute = () => location.pathname === "/board";
  const isTaskDetailRoute = () => location.pathname.includes("/tasks/");

  return (
    <main
      class="flex-1 overflow-auto"
      classList={{
        "min-h-0": true,
        "bg-base-100": isTaskDetailRoute(),
        "overflow-hidden": isRunDetailRoute(),
      }}
    >
      <div
        class="flex w-full max-w-none flex-col p-0"
        classList={{
          "h-full": !isTaskDetailRoute(),
          "min-h-full": isTaskDetailRoute(),
          "min-h-0": isRunDetailRoute(),
        }}
      >
        <div
          class="card border-base-content/15 bg-base-100 flex-1 rounded-none border"
          classList={{
            "min-h-[calc(100vh-5rem)]": !isRunDetailRoute(),
            "h-full min-h-0 overflow-hidden": isRunDetailRoute(),
            "border-0 bg-transparent": isBoardRoute(),
          }}
        >
          <div
            class="flex min-h-0 flex-col"
            classList={{
              "h-full": !isTaskDetailRoute(),
              "min-h-full": isTaskDetailRoute(),
              "p-0": true,
            }}
          >
            {props.children}
          </div>
        </div>
      </div>
    </main>
  );
};

export default MainContent;
