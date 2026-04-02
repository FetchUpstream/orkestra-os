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
import PageHeader from "../components/layout/PageHeader";

const NotFoundPage: Component = () => {
  return (
    <>
      <PageHeader title="Not Found" />
      <p class="page-placeholder">The requested page could not be found.</p>
    </>
  );
};

export default NotFoundPage;
