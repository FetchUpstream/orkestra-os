import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { c, cpp, java, dart } from "@codemirror/legacy-modes/mode/clike";
import type { Extension } from "@codemirror/state";

type LanguageLoader = () => Extension;

export type ResolveCodeMirrorLanguageInput = {
  language?: string;
  filePath?: string;
};

const firstPartyLanguageLoaders: Record<string, LanguageLoader> = {
  typescript: () => javascript({ typescript: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  "application/typescript": () => javascript({ typescript: true }),
  javascript: () => javascript(),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),
  "application/javascript": () => javascript(),
  "text/javascript": () => javascript(),
  json: () => json(),
  jsonc: () => json(),
  "application/json": () => json(),
  markdown: () => markdown(),
  md: () => markdown(),
  mdx: () => markdown(),
  "text/markdown": () => markdown(),
  html: () => html(),
  htm: () => html(),
  css: () => css(),
  scss: () => css(),
  sass: () => css(),
  yaml: () => yaml(),
  yml: () => yaml(),
  rust: () => rust(),
  rs: () => rust(),
  sql: () => sql(),
  xml: () => xml(),
  svg: () => xml(),
};

// Product requirement: Dart is treated as an explicit curated language.
const curatedLanguageLoaders: Record<string, LanguageLoader> = {
  dart: () => StreamLanguage.define(dart),
};

const legacyLanguageLoaders: Record<string, LanguageLoader> = {
  c: () => StreamLanguage.define(c),
  h: () => StreamLanguage.define(c),
  cpp: () => StreamLanguage.define(cpp),
  cxx: () => StreamLanguage.define(cpp),
  cc: () => StreamLanguage.define(cpp),
  hpp: () => StreamLanguage.define(cpp),
  hxx: () => StreamLanguage.define(cpp),
  java: () => StreamLanguage.define(java),
};

const normalizeToken = (value?: string): string | undefined => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return normalized.startsWith(".") ? normalized.slice(1) : normalized;
};

const getFilenameTokens = (filePath?: string): string[] => {
  if (!filePath) {
    return [];
  }

  const fileName = filePath.split(/[\\/]/).pop()?.toLowerCase();
  if (!fileName) {
    return [];
  }

  const tokens: string[] = [fileName];

  if (fileName === "readme" || fileName.startsWith("readme.")) {
    tokens.push("markdown");
  }

  if (fileName.endsWith(".d.ts")) {
    tokens.push("typescript", "ts");
  }

  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex > -1 && extensionIndex < fileName.length - 1) {
    const extension = fileName.slice(extensionIndex + 1);
    tokens.push(extension);
  }

  return tokens;
};

const buildResolutionTokens = (
  input: ResolveCodeMirrorLanguageInput,
): string[] => {
  const tokens = new Set<string>();

  const normalizedLanguage = normalizeToken(input.language);
  if (normalizedLanguage) {
    tokens.add(normalizedLanguage);
  }

  for (const token of getFilenameTokens(input.filePath)) {
    const normalizedToken = normalizeToken(token);
    if (normalizedToken) {
      tokens.add(normalizedToken);
    }
  }

  return Array.from(tokens);
};

const resolveFromMap = (
  tokens: string[],
  loaders: Record<string, LanguageLoader>,
): Extension | null => {
  for (const token of tokens) {
    const loader = loaders[token];
    if (loader) {
      return loader();
    }
  }

  return null;
};

export const resolveCodeMirrorLanguageExtension = (
  input: ResolveCodeMirrorLanguageInput,
): Extension | null => {
  const tokens = buildResolutionTokens(input);

  return (
    resolveFromMap(tokens, firstPartyLanguageLoaders) ??
    resolveFromMap(tokens, curatedLanguageLoaders) ??
    resolveFromMap(tokens, legacyLanguageLoaders)
  );
};
