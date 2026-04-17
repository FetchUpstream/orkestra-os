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

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}


declare module "markdown-it" {
  type LinkOpenRule = (
    tokens: any[],
    idx: number,
    options: any,
    env: any,
    self: { renderToken(tokens: any[], idx: number, options: any): string },
  ) => string;

  export default class MarkdownIt {
    constructor(options?: { html?: boolean; linkify?: boolean });
    renderer: {
      rules: {
        link_open?: LinkOpenRule;
      };
    };
    render(input: string): string;
  }
}