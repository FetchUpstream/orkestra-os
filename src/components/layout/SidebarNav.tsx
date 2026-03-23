import { A, useLocation } from "@solidjs/router";
import { createMemo, type Accessor, type Component } from "solid-js";
import { buildProjectNavItem } from "../../app/lib/nav";
import type { Project } from "../../app/lib/projects";

type SidebarNavProps = {
  projects?: Accessor<Project[]>;
  onCollapse?: () => void;
  onExpand?: () => void;
  onNavigate?: () => void;
  desktopCollapsed?: Accessor<boolean>;
  isVisible?: Accessor<boolean>;
};

const SidebarNav: Component<SidebarNavProps> = (props) => {
  const location = useLocation();
  const projectNavItems = createMemo(() =>
    (props.projects?.() ?? []).map(buildProjectNavItem),
  );

  const isProjectActive = (projectId: string) => {
    const params = new URLSearchParams(location.search);
    return (
      location.pathname === "/board" && params.get("projectId") === projectId
    );
  };

  return (
    <aside
      id="app-sidebar"
      class="sidebar"
      classList={{
        "sidebar-hidden": !props.isVisible?.(),
        "sidebar-collapsed": props.desktopCollapsed?.() ?? false,
      }}
      aria-hidden={props.isVisible && !props.isVisible() ? "true" : undefined}
    >
      {!(props.desktopCollapsed?.() ?? false) ? (
        <div class="sidebar-scroll-region">
          <div class="sidebar-header">
            <div class="sidebar-brand">OrkestraOS</div>
          </div>
          <nav
            class="sidebar-nav"
            aria-label="Project navigation"
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest("a")) {
                props.onNavigate?.();
              }
            }}
          >
            {projectNavItems().map((item) => (
              <A
                href={item.href}
                class="nav-item nav-item--project"
                classList={{ active: isProjectActive(item.id) }}
              >
                <span class="nav-item-avatar" aria-hidden="true">
                  {item.keyAvatar}
                </span>
                <span class="nav-item-label">{item.label}</span>
              </A>
            ))}
          </nav>
        </div>
      ) : null}
      {props.onCollapse || props.onExpand ? (
        <button
          type="button"
          class="sidebar-edge-toggle"
          classList={{
            "sidebar-edge-toggle--collapsed":
              props.desktopCollapsed?.() ?? false,
          }}
          aria-label={
            props.desktopCollapsed?.() ? "Expand sidebar" : "Collapse sidebar"
          }
          title={
            props.desktopCollapsed?.() ? "Expand sidebar" : "Collapse sidebar"
          }
          aria-controls="app-sidebar"
          aria-expanded={props.desktopCollapsed?.() ? "false" : "true"}
          onClick={() => {
            if (props.desktopCollapsed?.()) {
              props.onExpand?.();
              return;
            }
            props.onCollapse?.();
          }}
        >
          <span class="sidebar-chevron" aria-hidden="true">
            ‹
          </span>
        </button>
      ) : null}
    </aside>
  );
};

export default SidebarNav;
