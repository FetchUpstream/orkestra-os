import { A, useLocation } from "@solidjs/router";
import type { Component } from "solid-js";

type NavItemProps = {
  href: string;
  label: string;
};

const NavItem: Component<NavItemProps> = (props) => {
  const location = useLocation();
  const isActive = () =>
    props.href === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(props.href);

  return (
    <A href={props.href} class="nav-item" classList={{ active: isActive() }}>
      {props.label}
    </A>
  );
};

export default NavItem;
