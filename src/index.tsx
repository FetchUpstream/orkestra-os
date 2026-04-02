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

/* @refresh reload */
import * as Sentry from "@sentry/solid";
import { render } from "solid-js/web";
import App from "./App";
import "./index.css";

const sentryDsn =
  import.meta.env.VITE_SENTRY_DSN ??
  "https://a541169297ff911732dfa35021acc406@o4511093307015168.ingest.de.sentry.io/4511093437366352";

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    environment:
      import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
  });
}

render(() => <App />, document.getElementById("root") as HTMLElement);
