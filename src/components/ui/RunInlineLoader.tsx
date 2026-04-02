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
import { Dynamic } from "solid-js/web";
import { AppIcon } from "./icons";

type Props = {
  as?: keyof JSX.IntrinsicElements;
  class?: string;
  srLabel?: string;
  children?: JSX.Element;
} & JSX.HTMLAttributes<HTMLElement>;

const RunInlineLoader: Component<Props> = (props) => {
  const {
    as,
    class: className,
    srLabel = "Waiting for agent output...",
    children,
    ...rest
  } = props;

  return (
    <Dynamic
      component={as ?? "span"}
      class={`run-inline-loading-row${className ? ` ${className}` : ""}`}
      {...rest}
    >
      <AppIcon
        name="status.loading"
        class="run-inline-spinner"
        aria-hidden="true"
      />
      <span class="sr-only">{srLabel}</span>
      {children}
    </Dynamic>
  );
};

export default RunInlineLoader;
