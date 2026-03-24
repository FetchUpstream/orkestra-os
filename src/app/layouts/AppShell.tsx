import { useLocation, useNavigate } from "@solidjs/router";
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Component,
  type JSX,
} from "solid-js";
import { listProjects, type Project } from "../lib/projects";
import { primeRunSelectionOptionsCache } from "../lib/runSelectionOptionsCache";
import MainContent from "../../components/layout/MainContent";
import SidebarNav from "../../components/layout/SidebarNav";
import Topbar from "../../components/layout/Topbar";

type AppShellProps = {
  children?: JSX.Element;
};

const AppShell: Component<AppShellProps> = (props) => {
  const location = useLocation();
  const navigate = useNavigate();
  let mobileMenuButtonRef: HTMLButtonElement | undefined;
  let shellRootRef: HTMLDivElement | undefined;

  const [isMobile, setIsMobile] = createSignal(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);
  const [projects, setProjects] = createSignal<Project[]>([]);

  const isSidebarVisible = () => (isMobile() ? mobileSidebarOpen() : true);

  onMount(async () => {
    primeRunSelectionOptionsCache();

    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const updateMobileMode = (matches: boolean) => {
      setIsMobile(matches);
      if (matches) {
        setMobileSidebarOpen(false);
      }
    };

    updateMobileMode(mediaQuery.matches);

    const handleMediaChange = (event: MediaQueryListEvent) => {
      updateMobileMode(event.matches);
    };

    mediaQuery.addEventListener("change", handleMediaChange);

    onCleanup(() => {
      mediaQuery.removeEventListener("change", handleMediaChange);
    });

    try {
      const projects = await listProjects();
      setProjects(projects);
      if (projects.length === 0 && location.pathname !== "/projects") {
        navigate("/projects", { replace: true });
      }
    } catch (error) {
      console.warn("Failed to load projects during startup", error);
    }
  });

  createEffect(() => {
    if (isMobile()) {
      location.pathname;
      setMobileSidebarOpen(false);
    }
  });

  createEffect(() => {
    if (isMobile() && !mobileSidebarOpen()) {
      if (
        document.activeElement &&
        shellRootRef?.contains(document.activeElement)
      ) {
        mobileMenuButtonRef?.focus();
      }
    }
  });

  createEffect(() => {
    if (isSidebarVisible()) {
      queueMicrotask(() => {
        const firstNavLink = document.querySelector(
          "#app-sidebar .sidebar-nav a",
        ) as HTMLAnchorElement | null;
        if (firstNavLink && document.activeElement?.tagName === "BUTTON") {
          const active = document.activeElement as HTMLElement;
          if (active.getAttribute("aria-label") === "Open navigation menu") {
            firstNavLink.focus();
          }
        }
      });
    }
  });

  const onMobileOpen = () => {
    setMobileSidebarOpen(true);
  };

  const onMobileClose = () => {
    setMobileSidebarOpen(false);
  };

  const shellTitle = () => {
    if (location.pathname.startsWith("/runs/")) return "Run workspace";
    if (location.pathname.startsWith("/tasks/")) return "Task detail";
    if (
      location.pathname.startsWith("/projects/") &&
      location.pathname !== "/projects"
    ) {
      if (location.pathname.includes("/tasks/")) return "Task detail";
      return "Project detail";
    }
    if (location.pathname === "/projects") return "Projects";
    if (location.pathname.startsWith("/projects/")) return "Project settings";
    return "Board";
  };

  const shellSubtitle = () => {
    if (location.pathname.startsWith("/runs/")) {
      return "Review conversations, diffs, and terminal activity.";
    }
    if (location.pathname === "/projects") {
      return "Create a new project workspace and configure repositories.";
    }
    if (location.pathname.startsWith("/projects/")) {
      return "Edit project identity and repository configuration.";
    }
    if (
      location.pathname.startsWith("/tasks/") ||
      location.pathname.includes("/tasks/")
    ) {
      return "Follow task state and execution context.";
    }
    return "Track work across your active projects.";
  };

  const boardProjectId = () => {
    if (location.pathname !== "/board") return "";
    const queryProjectId = new URLSearchParams(location.search).get(
      "projectId",
    );
    if (queryProjectId) return queryProjectId;
    try {
      return window.localStorage.getItem("board.selectedProjectId") ?? "";
    } catch {
      return "";
    }
  };

  const handleShellKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (
    event,
  ) => {
    if (event.key === "Escape" && isMobile() && mobileSidebarOpen()) {
      event.preventDefault();
      onMobileClose();
    }
  };

  return (
    <div
      class="app-shell bg-base-300 text-base-content min-h-screen"
      data-theme="orkestra-dark"
      ref={shellRootRef}
      onKeyDown={handleShellKeyDown}
      style={{
        "grid-template-columns": isMobile() ? "1fr" : "4.5rem minmax(0, 1fr)",
      }}
    >
      {isMobile() ? (
        <>
          <div
            class="sidebar-backdrop bg-neutral/70 fixed inset-0 z-20 transition-opacity duration-200"
            classList={{
              "sidebar-backdrop-open opacity-100": mobileSidebarOpen(),
              "pointer-events-none opacity-0": !mobileSidebarOpen(),
            }}
            aria-hidden={mobileSidebarOpen() ? "false" : "true"}
            onClick={onMobileClose}
          />
          <SidebarNav
            projects={projects}
            isMobile
            isVisible={isSidebarVisible}
            onNavigate={onMobileClose}
          />
        </>
      ) : (
        <SidebarNav
          projects={projects}
          isMobile={false}
          isVisible={() => true}
        />
      )}
      <div class="shell-main min-w-0 overflow-hidden">
        <div class="shell-content-wrapper flex h-full min-h-0 flex-col gap-0">
          <Topbar
            title={shellTitle()}
            subtitle={shellSubtitle()}
            leading={
              isMobile() ? (
                <button
                  ref={mobileMenuButtonRef}
                  type="button"
                  class="btn btn-ghost btn-square btn-sm border-base-content/15 bg-base-100 rounded-none border"
                  aria-label="Open navigation menu"
                  aria-controls="app-sidebar"
                  aria-expanded={isSidebarVisible() ? "true" : "false"}
                  onClick={onMobileOpen}
                >
                  <span aria-hidden="true">☰</span>
                </button>
              ) : null
            }
            actions={
              location.pathname === "/board" ? (
                <>
                  <button
                    type="button"
                    class="btn btn-sm rounded-none border border-amber-500/35 bg-amber-500 px-4 text-xs font-semibold text-black hover:bg-amber-500"
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent("board:create-task"),
                      );
                    }}
                  >
                    New task
                  </button>
                  {boardProjectId() ? (
                    <a
                      href={`/projects/${boardProjectId()}`}
                      class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-base-content/65 hover:bg-base-100 rounded-none border"
                      aria-label="Project settings"
                      title="Project settings"
                    >
                      <span aria-hidden="true">⚙</span>
                    </a>
                  ) : null}
                </>
              ) : undefined
            }
          />
          <div class="shell-body grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-hidden">
            <MainContent>{props.children}</MainContent>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppShell;
