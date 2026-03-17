import MarkdownIt from "markdown-it";

export const runChatMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
});

type LinkOpenRule = NonNullable<
  typeof runChatMarkdown.renderer.rules.link_open
>;

const defaultLinkOpenRender =
  runChatMarkdown.renderer.rules.link_open ??
  (((tokens: any, idx: number, options: any, _env: any, self: any) =>
    self.renderToken(tokens, idx, options)) satisfies LinkOpenRule);

runChatMarkdown.renderer.rules.link_open = (
  tokens: any,
  idx: number,
  options: any,
  env: any,
  self: any,
) => {
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
