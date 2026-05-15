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

import MarkdownIt from "markdown-it";

export const runChatMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
});

type LinkOpenRule = NonNullable<
  typeof runChatMarkdown.renderer.rules.link_open
>;

type LinkOpenRuleArgs = Parameters<LinkOpenRule>;

const defaultLinkOpenRender =
  runChatMarkdown.renderer.rules.link_open ??
  (((tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options)) satisfies LinkOpenRule);

runChatMarkdown.renderer.rules.link_open = (...args: LinkOpenRuleArgs) => {
  const [tokens, idx, options, env, self] = args;
  const token = tokens[idx];
  const href = token.attrGet("href") ?? "";

  if (href.startsWith("http://") || href.startsWith("https://")) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }

  return defaultLinkOpenRender(tokens, idx, options, env, self);
};

export function renderRunChatMarkdown(input: string): string {
  return runChatMarkdown.render(input);
}
