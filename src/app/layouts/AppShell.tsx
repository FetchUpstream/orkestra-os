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
  const [desktopCollapsed, setDesktopCollapsed] = createSignal(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);
  const [projects, setProjects] = createSignal<Project[]>([]);

  const isSidebarVisible = () =>
    isMobile() ? mobileSidebarOpen() : !desktopCollapsed();

  onMount(async () => {
    primeRunSelectionOptionsCache();

    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const updateMobileMode = (matches: boolean) => {
      setIsMobile(matches);
      if (matches) {
        setMobileSidebarOpen(false);
      } else {
        setDesktopCollapsed(false);
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
    if (!isMobile() && desktopCollapsed()) {
      const activeElement = document.activeElement;
      const sidebarElement = document.getElementById("app-sidebar");
      if (
        sidebarElement &&
        activeElement &&
        sidebarElement.contains(activeElement)
      ) {
        (
          document.querySelector(
            '#app-sidebar button[aria-label="Expand sidebar"]',
          ) as HTMLButtonElement | null
        )?.focus();
      }
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
          if (
            active.getAttribute("aria-label") === "Expand sidebar" ||
            active.getAttribute("aria-label") === "Open navigation menu"
          ) {
            firstNavLink.focus();
          }
        }
      });
    }
  });

  const onDesktopCollapse = () => {
    setDesktopCollapsed(true);
  };

  const onDesktopExpand = () => {
    setDesktopCollapsed(false);
  };

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
    return "Board";
  };

  const shellSubtitle = () => {
    if (location.pathname.startsWith("/runs/")) {
      return "Review conversations, diffs, and terminal activity.";
    }
    if (location.pathname === "/projects") {
      return "Manage repositories, tasks, and automation entry points.";
    }
    if (location.pathname.startsWith("/projects/")) {
      return "Inspect project configuration and related work.";
    }
    if (
      location.pathname.startsWith("/tasks/") ||
      location.pathname.includes("/tasks/")
    ) {
      return "Follow task state and execution context.";
    }
    return "Track work across your active projects.";
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
      classList={{
        "app-shell--desktop-collapsed": !isMobile() && desktopCollapsed(),
      }}
      data-desktop-collapsed={
        !isMobile() && desktopCollapsed() ? "true" : "false"
      }
      data-theme="orkestra-dark"
      ref={shellRootRef}
      onKeyDown={handleShellKeyDown}
      style={{
        "grid-template-columns": isMobile()
          ? "1fr"
          : desktopCollapsed()
            ? "3.5rem minmax(0, 1fr)"
            : "17rem minmax(0, 1fr)",
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
          desktopCollapsed={desktopCollapsed}
          onCollapse={onDesktopCollapse}
          onExpand={onDesktopExpand}
        />
      )}
      <div
        class="shell-main min-w-0 overflow-hidden p-2"
        classList={{
          "pl-0": !isMobile(),
        }}
      >
        <div class="shell-content-wrapper flex h-full min-h-0 flex-col gap-2 sm:gap-3">
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
              <>
                <span class="badge badge-outline border-base-content/15 text-base-content/65 bg-base-100 hidden rounded-none px-2 text-[11px] tracking-[0.2em] uppercase md:inline-flex">
                  Dark mode
                </span>
                <span class="badge badge-outline border-base-content/15 text-base-content/65 bg-base-100 rounded-none px-2 text-[11px]">
                  {projects().length} projects
                </span>
              </>
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
