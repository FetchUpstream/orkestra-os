import type { Component } from "solid-js";
import { navItems } from "../../app/lib/nav";
import NavItem from "../ui/NavItem";

const SidebarNav: Component = () => {
  return (
    <aside class="sidebar">
      <div class="sidebar-brand">OrkestraOS</div>
      <nav class="sidebar-nav" aria-label="Main navigation">
        {navItems.map((item) => (
          <NavItem href={item.href} label={item.label} />
        ))}
      </nav>
    </aside>
  );
};

export default SidebarNav;
