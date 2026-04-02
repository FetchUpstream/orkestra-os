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

import type { Component, JSX } from "solid-js";

type TopbarProps = {
  title: JSX.Element;
  subtitle?: string;
  leading?: JSX.Element;
  center?: JSX.Element;
  actions?: JSX.Element;
};

const Topbar: Component<TopbarProps> = (props) => {
  return (
    <header class="navbar border-base-content/15 bg-base-200 relative min-h-11 rounded-none border px-3 py-1.5">
      <div class="flex min-w-0 flex-1 items-center gap-2.5">
        {props.leading ? <div class="shrink-0">{props.leading}</div> : null}
        <div class="min-w-0">
          <div class="text-base-content truncate text-[13px] font-semibold tracking-[0.02em]">
            {props.title}
          </div>
          {props.subtitle ? (
            <p class="text-base-content/55 truncate text-[11px]">
              {props.subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {props.center ? (
        <div class="absolute inset-y-0 left-1/2 hidden -translate-x-1/2 items-center xl:flex">
          {props.center}
        </div>
      ) : null}
      {props.actions ? (
        <div class="flex shrink-0 items-center gap-2">{props.actions}</div>
      ) : null}
    </header>
  );
};

export default Topbar;
