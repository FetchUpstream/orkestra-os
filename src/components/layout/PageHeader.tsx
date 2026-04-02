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

import type { Component } from "solid-js";

type PageHeaderProps = {
  title: string;
};

const PageHeader: Component<PageHeaderProps> = (props) => {
  return <h2 class="page-title">{props.title}</h2>;
};

export default PageHeader;
