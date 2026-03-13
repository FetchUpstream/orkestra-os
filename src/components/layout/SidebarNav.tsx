import type { Accessor, Component } from "solid-js";
import { navItems } from "../../app/lib/nav";
import NavItem from "../ui/NavItem";

type SidebarNavProps = {
  onCollapse?: () => void;
  onExpand?: () => void;
  onNavigate?: () => void;
  desktopCollapsed?: Accessor<boolean>;
  isVisible?: Accessor<boolean>;
};

const SidebarNav: Component<SidebarNavProps> = (props) => {
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
        <>
          <div class="sidebar-header">
            <div class="sidebar-brand">OrkestraOS</div>
          </div>
          <nav
            class="sidebar-nav"
            aria-label="Main navigation"
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest("a")) {
                props.onNavigate?.();
              }
            }}
          >
            {navItems.map((item) => (
              <NavItem href={item.href} label={item.label} />
            ))}
          </nav>
        </>
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
