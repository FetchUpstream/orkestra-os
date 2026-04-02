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

import { useLocation, useNavigate } from "@solidjs/router";
import { onMount, type Component } from "solid-js";
import {
  buildBoardHref,
  getBoardProjectIdFromSearch,
  readRememberedBoardProjectId,
} from "../app/lib/boardNavigation";

const StartupRedirectPage: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();

  onMount(() => {
    const projectId =
      getBoardProjectIdFromSearch(location.search) ||
      readRememberedBoardProjectId();
    navigate(buildBoardHref(projectId), { replace: true });
  });

  return null;
};

export default StartupRedirectPage;
