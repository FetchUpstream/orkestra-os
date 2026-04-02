// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

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
