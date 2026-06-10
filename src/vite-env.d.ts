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
  type MarkdownToken = {
    attrGet(name: string): string | null;
    attrSet(name: string, value: string): void;
  };

  type LinkOpenRule = (
    tokens: MarkdownToken[],
    idx: number,
    options: unknown,
    env: unknown,
    self: { renderToken(tokens: MarkdownToken[], idx: number, options: unknown): string },
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