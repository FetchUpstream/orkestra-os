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
      class="app-shell"
      classList={{
        "app-shell--desktop-collapsed": !isMobile() && desktopCollapsed(),
      }}
      data-desktop-collapsed={
        !isMobile() && desktopCollapsed() ? "true" : "false"
      }
      ref={shellRootRef}
      onKeyDown={handleShellKeyDown}
    >
      {isMobile() ? (
        <>
          <div
            class="sidebar-backdrop"
            classList={{ "sidebar-backdrop-open": mobileSidebarOpen() }}
            aria-hidden={mobileSidebarOpen() ? "false" : "true"}
            onClick={onMobileClose}
          />
          <SidebarNav
            projects={projects}
            isVisible={isSidebarVisible}
            onNavigate={onMobileClose}
          />
        </>
      ) : (
        <SidebarNav
          projects={projects}
          isVisible={() => true}
          desktopCollapsed={desktopCollapsed}
          onCollapse={onDesktopCollapse}
          onExpand={onDesktopExpand}
        />
      )}
      <div class="shell-main">
        <div class="shell-content-wrapper">
          {isMobile() ? (
            <button
              ref={mobileMenuButtonRef}
              type="button"
              class="sidebar-toggle sidebar-toggle--floating"
              aria-label="Open navigation menu"
              aria-controls="app-sidebar"
              aria-expanded={isSidebarVisible() ? "true" : "false"}
              onClick={onMobileOpen}
            >
              Menu
            </button>
          ) : null}
          <div class="shell-body">
            <MainContent>{props.children}</MainContent>
            <aside class="shell-right-panel" aria-hidden="true" />
          </div>
          <section class="shell-bottom-panel" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
};

export default AppShell;
