import { useLocation } from "@solidjs/router";
import type { Component, JSX } from "solid-js";
import MainContent from "../../components/layout/MainContent";
import SidebarNav from "../../components/layout/SidebarNav";
import Topbar from "../../components/layout/Topbar";

const topbarTitleByPath: Record<string, string> = {
  "/": "Board",
  "/board": "Board",
  "/agents": "Agents",
  "/worktrees": "Worktrees",
  "/reviews": "Reviews",
  "/settings": "Settings",
};

type AppShellProps = {
  children?: JSX.Element;
};

const AppShell: Component<AppShellProps> = (props) => {
  const location = useLocation();
  const title = () => {
    if (location.pathname.startsWith("/tasks/")) return "Task Detail";
    if (location.pathname.startsWith("/runs/")) return "Run Detail";
    return topbarTitleByPath[location.pathname] ?? "OrkestraOS";
  };

  return (
    <div class="app-shell">
      <SidebarNav />
      <div class="shell-main">
        <Topbar title={title()} />
        <div class="shell-body">
          <MainContent>{props.children}</MainContent>
          <aside class="shell-right-panel" aria-hidden="true" />
        </div>
        <section class="shell-bottom-panel" aria-hidden="true" />
      </div>
    </div>
  );
};

export default AppShell;
