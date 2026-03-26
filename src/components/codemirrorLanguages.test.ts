import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCodeMirrorLanguageExtension } from "./codemirrorLanguages";

const {
  javascriptMock,
  jsonMock,
  markdownMock,
  htmlMock,
  cssMock,
  yamlMock,
  rustMock,
  sqlMock,
  xmlMock,
  streamDefineMock,
  cMode,
  cppMode,
  javaMode,
  dartMode,
} = vi.hoisted(() => {
  const javascriptMock = vi.fn(() => ({ extension: "javascript" }));
  const jsonMock = vi.fn(() => ({ extension: "json" }));
  const markdownMock = vi.fn(() => ({ extension: "markdown" }));
  const htmlMock = vi.fn(() => ({ extension: "html" }));
  const cssMock = vi.fn(() => ({ extension: "css" }));
  const yamlMock = vi.fn(() => ({ extension: "yaml" }));
  const rustMock = vi.fn(() => ({ extension: "rust" }));
  const sqlMock = vi.fn(() => ({ extension: "sql" }));
  const xmlMock = vi.fn(() => ({ extension: "xml" }));
  const streamDefineMock = vi.fn((mode: { name: string }) => ({
    extension: `stream:${mode.name}`,
  }));

  const cMode = { name: "c" };
  const cppMode = { name: "cpp" };
  const javaMode = { name: "java" };
  const dartMode = { name: "dart" };

  return {
    javascriptMock,
    jsonMock,
    markdownMock,
    htmlMock,
    cssMock,
    yamlMock,
    rustMock,
    sqlMock,
    xmlMock,
    streamDefineMock,
    cMode,
    cppMode,
    javaMode,
    dartMode,
  };
});

vi.mock("@codemirror/lang-javascript", () => ({
  javascript: javascriptMock,
}));
vi.mock("@codemirror/lang-json", () => ({ json: jsonMock }));
vi.mock("@codemirror/lang-markdown", () => ({ markdown: markdownMock }));
vi.mock("@codemirror/lang-html", () => ({ html: htmlMock }));
vi.mock("@codemirror/lang-css", () => ({ css: cssMock }));
vi.mock("@codemirror/lang-yaml", () => ({ yaml: yamlMock }));
vi.mock("@codemirror/lang-rust", () => ({ rust: rustMock }));
vi.mock("@codemirror/lang-sql", () => ({ sql: sqlMock }));
vi.mock("@codemirror/lang-xml", () => ({ xml: xmlMock }));

vi.mock("@codemirror/language", () => ({
  StreamLanguage: {
    define: streamDefineMock,
  },
}));

vi.mock("@codemirror/legacy-modes/mode/clike", () => ({
  c: cMode,
  cpp: cppMode,
  java: javaMode,
  dart: dartMode,
}));

describe("resolveCodeMirrorLanguageExtension", () => {
  beforeEach(() => {
    javascriptMock.mockClear();
    jsonMock.mockClear();
    markdownMock.mockClear();
    htmlMock.mockClear();
    cssMock.mockClear();
    yamlMock.mockClear();
    rustMock.mockClear();
    sqlMock.mockClear();
    xmlMock.mockClear();
    streamDefineMock.mockClear();
  });

  it("resolves first-party language from file extension", () => {
    resolveCodeMirrorLanguageExtension({ filePath: "src/App.tsx" });

    expect(javascriptMock).toHaveBeenCalledWith({
      typescript: true,
      jsx: true,
    });
  });

  it("uses first-party mapping before curated dart mapping", () => {
    resolveCodeMirrorLanguageExtension({
      language: "json",
      filePath: "main.dart",
    });

    expect(jsonMock).toHaveBeenCalledTimes(1);
    expect(streamDefineMock).not.toHaveBeenCalledWith(dartMode);
  });

  it("supports explicit curated dart mapping", () => {
    const extension = resolveCodeMirrorLanguageExtension({ language: "dart" });

    expect(streamDefineMock).toHaveBeenCalledWith(dartMode);
    expect(extension).toEqual({ extension: "stream:dart" });
  });

  it("falls back to legacy mapping for long-tail languages", () => {
    const extension = resolveCodeMirrorLanguageExtension({
      filePath: "src/native/main.cpp",
    });

    expect(streamDefineMock).toHaveBeenCalledWith(cppMode);
    expect(extension).toEqual({ extension: "stream:cpp" });
  });

  it("supports filename special-case fallback", () => {
    resolveCodeMirrorLanguageExtension({ filePath: "README" });

    expect(markdownMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for unknown languages", () => {
    const extension = resolveCodeMirrorLanguageExtension({
      language: "something-unknown",
      filePath: "file.unknown",
    });

    expect(extension).toBeNull();
  });
});
