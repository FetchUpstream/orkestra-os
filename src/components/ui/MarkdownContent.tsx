import { For, createMemo, type Component, type JSX } from "solid-js";

type MarkdownContentProps = {
  content: string;
  class?: string;
  isStreaming?: boolean;
  renderMode?: "markdown" | "plain";
};

type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "code"; language: string; code: string };

type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "em"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; text: string; href: string };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_ITEM_RE = /^[-*]\s+(.*)$/;
const OL_ITEM_RE = /^\d+\.\s+(.*)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const FENCE_RE = /^```([\w-]*)\s*$/;
const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(([^\s)]+)\))/g;
const PARSE_CACHE_LIMIT = 200;
const parseCache = new Map<string, Block[]>();

const isSafeUrl = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("mailto:")
  );
};

const parseInline = (text: string): InlineNode[] => {
  const nodes: InlineNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_RE)) {
    const full = match[0];
    const index = match.index ?? 0;

    if (index > cursor) {
      nodes.push({ type: "text", value: text.slice(cursor, index) });
    }

    if (full.startsWith("**") && full.endsWith("**")) {
      nodes.push({ type: "strong", value: full.slice(2, -2) });
    } else if (full.startsWith("*") && full.endsWith("*")) {
      nodes.push({ type: "em", value: full.slice(1, -1) });
    } else if (full.startsWith("`") && full.endsWith("`")) {
      nodes.push({ type: "code", value: full.slice(1, -1) });
    } else if (full.startsWith("[") && full.includes("](")) {
      const closingBracket = full.indexOf("](");
      const label = full.slice(1, closingBracket);
      const href = full.slice(closingBracket + 2, -1);
      if (isSafeUrl(href)) {
        nodes.push({ type: "link", text: label, href });
      } else {
        nodes.push({ type: "text", value: full });
      }
    } else {
      nodes.push({ type: "text", value: full });
    }

    cursor = index + full.length;
  }

  if (cursor < text.length) {
    nodes.push({ type: "text", value: text.slice(cursor) });
  }

  return nodes;
};

const parseMarkdown = (content: string): Block[] => {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const language = fenceMatch[1] || "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE_RE.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "code", language, code: codeLines.join("\n") });
      continue;
    }

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (UL_ITEM_RE.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const listMatch = lines[index].match(UL_ITEM_RE);
        if (!listMatch) break;
        items.push(listMatch[1].trim());
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (OL_ITEM_RE.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const listMatch = lines[index].match(OL_ITEM_RE);
        if (!listMatch) break;
        items.push(listMatch[1].trim());
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const quoteMatch = lines[index].match(BLOCKQUOTE_RE);
        if (!quoteMatch) break;
        quoteLines.push(quoteMatch[1]);
        index += 1;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !FENCE_RE.test(lines[index]) &&
      !HEADING_RE.test(lines[index]) &&
      !UL_ITEM_RE.test(lines[index]) &&
      !OL_ITEM_RE.test(lines[index]) &&
      !BLOCKQUOTE_RE.test(lines[index])
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
};

const getParsedMarkdown = (content: string): Block[] => {
  const cached = parseCache.get(content);
  if (cached) return cached;

  const parsed = parseMarkdown(content);
  parseCache.set(content, parsed);

  if (parseCache.size > PARSE_CACHE_LIMIT) {
    const oldestKey = parseCache.keys().next().value;
    if (oldestKey) {
      parseCache.delete(oldestKey);
    }
  }

  return parsed;
};

const renderInline = (text: string): JSX.Element[] => {
  const nodes = parseInline(text);
  return nodes.map((node) => {
    if (node.type === "strong") return <strong>{node.value}</strong>;
    if (node.type === "em") return <em>{node.value}</em>;
    if (node.type === "code") return <code>{node.value}</code>;
    if (node.type === "link") {
      return (
        <a href={node.href} target="_blank" rel="noreferrer noopener">
          {node.text}
        </a>
      );
    }
    return <>{node.value}</>;
  });
};

const MarkdownContent: Component<MarkdownContentProps> = (props) => {
  const usePlainText = createMemo(
    () =>
      props.renderMode === "plain" ||
      (props.isStreaming === true && props.renderMode !== "markdown"),
  );
  const blocks = createMemo(() => {
    if (usePlainText()) return [];
    return getParsedMarkdown(props.content);
  });

  return (
    <div class={`markdown-content ${props.class ?? ""}`.trim()}>
      <For each={usePlainText() ? [] : blocks()}>
        {(block) => {
          if (block.type === "heading") {
            if (block.level === 1) return <h1>{renderInline(block.text)}</h1>;
            if (block.level === 2) return <h2>{renderInline(block.text)}</h2>;
            if (block.level === 3) return <h3>{renderInline(block.text)}</h3>;
            if (block.level === 4) return <h4>{renderInline(block.text)}</h4>;
            if (block.level === 5) return <h5>{renderInline(block.text)}</h5>;
            return <h6>{renderInline(block.text)}</h6>;
          }

          if (block.type === "paragraph") {
            return <p>{renderInline(block.text)}</p>;
          }

          if (block.type === "ul") {
            return (
              <ul>
                <For each={block.items}>
                  {(item) => <li>{renderInline(item)}</li>}
                </For>
              </ul>
            );
          }

          if (block.type === "ol") {
            return (
              <ol>
                <For each={block.items}>
                  {(item) => <li>{renderInline(item)}</li>}
                </For>
              </ol>
            );
          }

          if (block.type === "blockquote") {
            return (
              <blockquote>
                <For each={block.lines}>
                  {(line) => <p>{renderInline(line)}</p>}
                </For>
              </blockquote>
            );
          }

          return (
            <pre>
              <code class={block.language ? `language-${block.language}` : ""}>
                {block.code}
              </code>
            </pre>
          );
        }}
      </For>

      <For each={usePlainText() ? [props.content] : []}>
        {(content) => <pre>{content}</pre>}
      </For>
    </div>
  );
};

export default MarkdownContent;
