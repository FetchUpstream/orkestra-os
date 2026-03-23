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
      class="flex-1 overflow-auto"
      classList={{
        "min-h-0": true,
        "overflow-hidden": isRunDetailRoute(),
      }}
    >
      <div
        class="mx-auto flex w-full max-w-[1600px] flex-col p-2 sm:p-3"
        classList={{
          "h-full min-h-0 max-w-none p-2": isRunDetailRoute(),
        }}
      >
        <div
          class="card border-base-content/15 bg-base-100 flex-1 rounded-none border"
          classList={{
            "min-h-[calc(100vh-5rem)]": !isRunDetailRoute(),
            "h-full min-h-0 overflow-hidden": isRunDetailRoute(),
          }}
        >
          <div
            class="flex h-full min-h-0 flex-col"
            classList={{
              "p-4 sm:p-5": !isRunDetailRoute(),
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
