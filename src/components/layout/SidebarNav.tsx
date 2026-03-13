import type { Accessor, Component } from "solid-js";
import { navItems } from "../../app/lib/nav";
import NavItem from "../ui/NavItem";

type SidebarNavProps = {
  onCollapse?: () => void;
  onNavigate?: () => void;
  showCollapseToggle?: boolean;
  isVisible?: Accessor<boolean>;
};

const SidebarNav: Component<SidebarNavProps> = (props) => {
  return (
    <aside
      id="app-sidebar"
      class="sidebar"
      classList={{ "sidebar-hidden": !props.isVisible?.() }}
      aria-hidden={props.isVisible && !props.isVisible() ? "true" : undefined}
    >
      <div class="sidebar-header">
        <div class="sidebar-brand">OrkestraOS</div>
        {props.showCollapseToggle ? (
          <button
            type="button"
            class="sidebar-toggle"
            aria-label="Collapse navigation"
            aria-controls="app-sidebar"
            aria-expanded="true"
            onClick={() => props.onCollapse?.()}
          >
            Collapse
          </button>
        ) : null}
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
    </aside>
  );
};

export default SidebarNav;
