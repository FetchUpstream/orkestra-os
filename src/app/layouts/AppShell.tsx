import { useLocation, useNavigate } from "@solidjs/router";
import { onMount, type Component, type JSX } from "solid-js";
import { listProjects } from "../lib/projects";
import MainContent from "../../components/layout/MainContent";
import SidebarNav from "../../components/layout/SidebarNav";
import Topbar from "../../components/layout/Topbar";

const topbarTitleByPath: Record<string, string> = {
  "/": "Board",
  "/board": "Board",
  "/agents": "Agents",
  "/projects": "Projects",
  "/worktrees": "Worktrees",
  "/reviews": "Reviews",
  "/settings": "Settings",
};

type AppShellProps = {
  children?: JSX.Element;
};

const AppShell: Component<AppShellProps> = (props) => {
  const location = useLocation();
  const navigate = useNavigate();

  onMount(async () => {
    try {
      const projects = await listProjects();
      if (projects.length === 0 && location.pathname !== "/projects") {
        navigate("/projects", { replace: true });
      }
    } catch {}
  });

  const title = () => {
    if (location.pathname.startsWith("/tasks/")) return "Task Detail";
    if (location.pathname.includes("/tasks/")) return "Task Detail";
    if (location.pathname.startsWith("/runs/")) return "Run Detail";
    if (location.pathname.startsWith("/projects/")) return "Project Detail";
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
