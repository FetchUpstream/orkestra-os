import { A } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Component,
} from "solid-js";
import BackIconLink from "../../../components/ui/BackIconLink";
import MonacoDiffEditor from "../../../components/MonacoDiffEditor";
import MarkdownContent from "../../../components/ui/MarkdownContent";
import { useRunDetailModel } from "../model/useRunDetailModel";
import { formatDateTime, formatRunStatus } from "../../tasks/utils/taskDetail";
import RunTerminal from "../components/RunTerminal";
import type { UiPart, UiToolPart } from "../model/agentTypes";

const RunDetailScreen: Component = () => {
  const model = useRunDetailModel();
  const [activeTab, setActiveTab] = createSignal("operations");
  const [layoutMode, setLayoutMode] = createSignal<"split" | "info-focus">(
    "split",
  );
  const [expandedDiffPaths, setExpandedDiffPaths] = createSignal<
    Record<string, boolean>
  >({});
  const [composerValue, setComposerValue] = createSignal("");
  const isComposerEmpty = createMemo(() => composerValue().trim().length === 0);
  const isComposerSendDisabled = createMemo(
    () =>
      isComposerEmpty() ||
      model.agent.isSubmittingPrompt() ||
      model.agent.state() === "unsupported",
  );
  const isInfoFocus = createMemo(() => layoutMode() === "info-focus");
  const isTerminalTabActive = createMemo(() => activeTab() === "terminal");
  const isAgentTabActive = createMemo(() => activeTab() === "agent");
  const agentEvents = createMemo(() => model.agent.events());
  const agentEventMax = createMemo<number | null>(() => {
    const candidates = [
      (model.agent as Record<string, unknown>).maxEvents,
      (model.agent as Record<string, unknown>).eventBufferLimit,
      (model.agent as Record<string, unknown>).eventsMax,
    ];

    for (const candidate of candidates) {
      if (
        typeof candidate === "number" &&
        Number.isFinite(candidate) &&
        candidate > 0
      ) {
        return Math.floor(candidate);
      }
    }

    return null;
  });
  const agentEventCountLabel = createMemo(() => {
    const count = agentEvents().length;
    const max = agentEventMax();
    return max !== null ? `Events: ${count}/${max}` : `Events: ${count}`;
  });
  let transcriptScrollRef: HTMLDivElement | undefined;
  let transcriptBottomRef: HTMLDivElement | undefined;
  let agentEventLogRef: HTMLDivElement | undefined;
  let transcriptScrollRaf: number | null = null;
  let agentEventLogScrollRaf: number | null = null;
  let transcriptProgrammaticScrollResetRaf: number | null = null;
  let agentEventLogProgrammaticScrollResetRaf: number | null = null;
  let isTranscriptProgrammaticScroll = false;
  let isAgentEventLogProgrammaticScroll = false;
  const [isTranscriptAutoFollowEnabled, setIsTranscriptAutoFollowEnabled] =
    createSignal(true);
  const [
    isAgentEventLogAutoFollowEnabled,
    setIsAgentEventLogAutoFollowEnabled,
  ] = createSignal(true);
  const AUTO_SCROLL_NEAR_BOTTOM_PX = 96;

  const isNearBottom = (
    element: HTMLElement,
    thresholdPx = AUTO_SCROLL_NEAR_BOTTOM_PX,
  ): boolean =>
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    thresholdPx;

  const markTranscriptProgrammaticScroll = () => {
    isTranscriptProgrammaticScroll = true;
    if (transcriptProgrammaticScrollResetRaf !== null) {
      cancelAnimationFrame(transcriptProgrammaticScrollResetRaf);
    }
    transcriptProgrammaticScrollResetRaf = requestAnimationFrame(() => {
      transcriptProgrammaticScrollResetRaf = null;
      isTranscriptProgrammaticScroll = false;
    });
  };

  const markAgentEventLogProgrammaticScroll = () => {
    isAgentEventLogProgrammaticScroll = true;
    if (agentEventLogProgrammaticScrollResetRaf !== null) {
      cancelAnimationFrame(agentEventLogProgrammaticScrollResetRaf);
    }
    agentEventLogProgrammaticScrollResetRaf = requestAnimationFrame(() => {
      agentEventLogProgrammaticScrollResetRaf = null;
      isAgentEventLogProgrammaticScroll = false;
    });
  };

  const scheduleTranscriptScrollToBottom = () => {
    if (transcriptScrollRaf !== null) {
      return;
    }

    transcriptScrollRaf = requestAnimationFrame(() => {
      transcriptScrollRaf = null;
      if (!isTranscriptAutoFollowEnabled()) {
        return;
      }

      markTranscriptProgrammaticScroll();

      if (transcriptBottomRef) {
        transcriptBottomRef.scrollIntoView({
          block: "end",
          inline: "nearest",
          behavior: "auto",
        });
        return;
      }

      if (transcriptScrollRef) {
        transcriptScrollRef.scrollTop = transcriptScrollRef.scrollHeight;
      }
    });
  };

  const scheduleAgentEventLogScrollToBottom = () => {
    if (agentEventLogScrollRaf !== null) {
      return;
    }

    agentEventLogScrollRaf = requestAnimationFrame(() => {
      agentEventLogScrollRaf = null;
      if (!isAgentEventLogAutoFollowEnabled()) {
        return;
      }

      markAgentEventLogProgrammaticScroll();

      if (agentEventLogRef) {
        agentEventLogRef.scrollTop = agentEventLogRef.scrollHeight;
      }
    });
  };

  const INTERNAL_ID_PATTERN =
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

  const formatAgentPayload = (payload: unknown): string => {
    if (payload === undefined) {
      return "undefined";
    }

    try {
      const serialized = JSON.stringify(
        payload,
        (_key, value) =>
          typeof value === "string"
            ? value.replace(INTERNAL_ID_PATTERN, "[internal-id]")
            : value,
        2,
      );
      if (typeof serialized === "string") {
        return serialized;
      }
    } catch {}

    if (typeof payload === "string") {
      return payload.replace(INTERNAL_ID_PATTERN, "[internal-id]");
    }

    return String(payload);
  };

  const formatAgentTimestamp = (value: string | number | null): string => {
    if (value === null) {
      return "Unavailable";
    }

    let normalizedValue: string;
    if (typeof value === "number") {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return String(value);
      }
      normalizedValue = parsed.toISOString();
    } else {
      normalizedValue = value;
    }

    const formatted = formatDateTime(normalizedValue);
    return formatted === "Unavailable" ? String(value) : formatted;
  };

  const getMessageActorLabel = (role: string): string => {
    if (role === "assistant") return "Agent";
    if (role === "user") return "You";
    if (role === "system") return "System";
    return "Message";
  };

  const getPartTypeLabel = (part: UiPart): string => {
    if (part.kind === "unknown") {
      return part.rawType || "unknown";
    }
    return part.type || part.kind;
  };

  const formatPartSnippet = (payload: unknown): string => {
    const serialized = formatAgentPayload(payload);
    if (serialized.length <= 280) {
      return serialized;
    }
    return `${serialized.slice(0, 280)}...`;
  };

  const formatStepMetaValue = (value: unknown): string | null => {
    if (value === null || value === undefined) {
      return null;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      const normalized = String(value)
        .replace(INTERNAL_ID_PATTERN, "[internal-id]")
        .trim();
      return normalized.length > 0 ? normalized : null;
    }

    const formatted = formatPartSnippet(value).trim();
    return formatted.length > 0 ? formatted : null;
  };

  const formatStructuredTokenMeta = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const tokenMap = new Map<string, number>();

    const normalizeKey = (key: string): string =>
      key.toLowerCase().replace(/[^a-z0-9]/g, "");

    const visit = (node: unknown, depth: number): void => {
      if (
        !node ||
        typeof node !== "object" ||
        Array.isArray(node) ||
        depth > 3
      ) {
        return;
      }

      for (const [rawKey, rawValue] of Object.entries(
        node as Record<string, unknown>,
      )) {
        if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
          tokenMap.set(normalizeKey(rawKey), rawValue);
          continue;
        }

        if (
          rawValue &&
          typeof rawValue === "object" &&
          !Array.isArray(rawValue)
        ) {
          visit(rawValue, depth + 1);
        }
      }
    };

    visit(value, 0);

    const pick = (...candidates: string[]): number | null => {
      for (const key of candidates) {
        const tokenCount = tokenMap.get(key);
        if (tokenCount !== undefined) {
          return tokenCount;
        }
      }
      return null;
    };

    const parts: string[] = [];
    const total = pick("total", "totaltokens", "tokens");
    const input = pick("input", "inputtokens", "prompt", "prompttokens");
    const output = pick(
      "output",
      "outputtokens",
      "completion",
      "completiontokens",
    );
    const reasoning = pick("reasoning", "reasoningtokens");
    const cacheRead = pick("cacheread", "cachedinput", "cachedinputtokens");
    const cacheWrite = pick("cachewrite", "cachedoutput", "cachedoutputtokens");

    if (total !== null) {
      parts.push(`total: ${total}`);
    }
    if (input !== null) {
      parts.push(`input: ${input}`);
    }
    if (output !== null) {
      parts.push(`output: ${output}`);
    }
    if (reasoning !== null) {
      parts.push(`reasoning: ${reasoning}`);
    }
    if (cacheRead !== null) {
      parts.push(`cache read: ${cacheRead}`);
    }
    if (cacheWrite !== null) {
      parts.push(`cache write: ${cacheWrite}`);
    }

    return parts.length > 0 ? parts.join(" · ") : null;
  };

  const formatStepTokenValue = (value: unknown): string | null => {
    const structured = formatStructuredTokenMeta(value);
    if (structured) {
      return structured;
    }
    return formatStepMetaValue(value);
  };

  const sanitizeInlineText = (value: string): string =>
    value.replace(INTERNAL_ID_PATTERN, "[internal-id]");

  const TOOL_TEXT_KEYS = ["text", "message", "content", "result"] as const;

  const extractPreferredToolText = (
    value: unknown,
    depth = 0,
  ): string | null => {
    if (value === null || value === undefined || depth > 3) {
      return null;
    }

    if (typeof value === "string") {
      const normalized = sanitizeInlineText(value).trim();
      return normalized.length > 0 ? normalized : null;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const candidate = extractPreferredToolText(item, depth + 1);
        if (candidate) {
          return candidate;
        }
      }
      return null;
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of TOOL_TEXT_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
          continue;
        }
        const candidate = extractPreferredToolText(record[key], depth + 1);
        if (candidate) {
          return candidate;
        }
      }
    }

    return null;
  };

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const getNestedToolValueByKeys = (
    value: unknown,
    keys: readonly string[],
    depth = 0,
  ): unknown => {
    if (!isRecord(value) || depth > 3) {
      return undefined;
    }

    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        return value[key];
      }
    }

    for (const nestedValue of Object.values(value)) {
      const candidate = getNestedToolValueByKeys(nestedValue, keys, depth + 1);
      if (candidate !== undefined) {
        return candidate;
      }
    }

    return undefined;
  };

  const toInlineSummaryText = (value: unknown): string | null => {
    if (value === null || value === undefined) {
      return null;
    }

    const text =
      typeof value === "string"
        ? sanitizeInlineText(value)
        : extractPreferredToolText(value) || formatPartSnippet(value);
    const singleLine = text.replace(/\s+/g, " ").trim();
    if (singleLine.length === 0) {
      return null;
    }
    if (singleLine.length <= 160) {
      return singleLine;
    }
    return `${singleLine.slice(0, 157)}...`;
  };

  const BASH_COMMAND_KEYS = [
    "command",
    "bash",
    "cmd",
    "script",
    "shellCommand",
    "commandLine",
  ] as const;

  const COMMON_SHELL_COMMAND_PATTERN =
    /^(?:\$\s*)?(?:bun|npm|pnpm|yarn|git|ls|cat|cp|mv|rm|mkdir|touch|echo|pwd|cd|grep|awk|sed|chmod|chown|docker|kubectl|python|node|deno|go|cargo|make|sh|bash|zsh)\b/i;

  const SHELL_OPERATOR_PATTERN = /(?:\|\||&&|[|;`$()><])/;

  const toSingleLineToolText = (value: unknown): string | null => {
    if (value === null || value === undefined) {
      return null;
    }

    const text =
      typeof value === "string"
        ? sanitizeInlineText(value)
        : extractPreferredToolText(value) || formatPartSnippet(value);
    const normalized = text.replace(/\s+/g, " ").trim();
    return normalized.length > 0 ? normalized : null;
  };

  const isShellCommandLike = (value: unknown): boolean => {
    if (typeof value !== "string") {
      return false;
    }

    const normalized = value.trim();
    if (normalized.length === 0) {
      return false;
    }

    if (COMMON_SHELL_COMMAND_PATTERN.test(normalized)) {
      return true;
    }

    return SHELL_OPERATOR_PATTERN.test(normalized) && normalized.includes(" ");
  };

  const getBashSummary = (part: UiToolPart) => {
    const preferredCommandValue = getNestedToolValueByKeys(part.input, [
      "command",
    ]);
    const fallbackCommandValue =
      getNestedToolValueByKeys(part.input, BASH_COMMAND_KEYS) ??
      getNestedToolValueByKeys(part.output, BASH_COMMAND_KEYS);
    const command =
      toSingleLineToolText(preferredCommandValue) ||
      toSingleLineToolText(fallbackCommandValue) ||
      "command unavailable";

    const description =
      toSingleLineToolText(
        getNestedToolValueByKeys(part.input, ["description"]),
      ) ||
      toSingleLineToolText(part.title) ||
      toSingleLineToolText(preferredCommandValue) ||
      toSingleLineToolText(getNestedToolValueByKeys(part.input, ["bash"])) ||
      "bash";

    const output =
      extractPreferredToolText(part.output) ||
      extractPreferredToolText(part.error) ||
      "(no output)";

    return {
      description,
      command,
      output,
    };
  };

  const getToolNameCandidates = (
    part: UiToolPart,
  ): Array<string | undefined> => [
    part.toolName,
    isRecord(part.input)
      ? (part.input.toolName as string | undefined)
      : undefined,
    isRecord(part.input) ? (part.input.type as string | undefined) : undefined,
    isRecord(part.input) ? (part.input.name as string | undefined) : undefined,
    isRecord(part.output)
      ? (part.output.toolName as string | undefined)
      : undefined,
    isRecord(part.output)
      ? (part.output.type as string | undefined)
      : undefined,
    isRecord(part.output)
      ? (part.output.name as string | undefined)
      : undefined,
  ];

  const getQueryToolLabel = (part: UiToolPart): string => {
    const directName =
      typeof part.toolName === "string" ? part.toolName.trim() : "";
    if (directName.length > 0) {
      return directName;
    }

    const nestedCandidates = [
      getNestedToolValueByKeys(part.input, ["type", "name", "toolName"]),
      getNestedToolValueByKeys(part.output, ["type", "name", "toolName"]),
    ];

    for (const candidate of nestedCandidates) {
      if (typeof candidate !== "string") {
        continue;
      }
      const normalized = candidate.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }

    return "tool";
  };

  const SEARCH_TOOL_NAMES = new Set(["websearch_web_search_exa"]);
  const QUERY_INPUT_KEYS = [
    "query",
    "searchQuery",
    "searchTerm",
    "queryString",
    "q",
    "keywords",
  ] as const;
  const URL_INPUT_KEYS = ["url", "href", "link"] as const;

  const toQueryText = (value: unknown): string | null => {
    const inline = toInlineSummaryText(value);
    if (!inline) {
      return null;
    }
    return inline.length <= 180 ? inline : `${inline.slice(0, 177)}...`;
  };

  const isSearchToolPart = (part: UiToolPart): boolean => {
    for (const rawName of getToolNameCandidates(part)) {
      if (typeof rawName !== "string") {
        continue;
      }
      const normalized = rawName.trim().toLowerCase();
      if (normalized.length === 0) {
        continue;
      }
      if (SEARCH_TOOL_NAMES.has(normalized) || normalized.includes("search")) {
        return true;
      }
    }
    return false;
  };

  const getInputUrlString = (part: UiToolPart): string | null => {
    if (!isRecord(part.input)) {
      return null;
    }

    const directUrl = toSingleLineToolText(part.input.url);
    if (directUrl) {
      return directUrl;
    }

    const nestedUrl = getNestedToolValueByKeys(part.input, URL_INPUT_KEYS);
    return toSingleLineToolText(nestedUrl);
  };

  const hasInputQueryString = (part: UiToolPart): boolean => {
    if (!isRecord(part.input)) {
      return false;
    }

    const directQuery = part.input.query;
    if (typeof directQuery === "string" && directQuery.trim().length > 0) {
      return true;
    }

    const nestedQuery = getNestedToolValueByKeys(part.input, QUERY_INPUT_KEYS);
    return typeof nestedQuery === "string" && nestedQuery.trim().length > 0;
  };

  const hasInputUrlString = (part: UiToolPart): boolean =>
    getInputUrlString(part) !== null;

  const getQueryToolSummary = (part: UiToolPart): string => {
    const directQuery = isRecord(part.input) ? part.input.query : undefined;
    const directSummary = toQueryText(directQuery);
    if (directSummary) {
      return directSummary;
    }

    const nestedQuery = getNestedToolValueByKeys(part.input, QUERY_INPUT_KEYS);
    const nestedSummary = toQueryText(nestedQuery);
    if (nestedSummary) {
      return nestedSummary;
    }

    return toQueryText(part.input) || "unknown";
  };

  const isQueryToolPart = (part: UiToolPart): boolean =>
    isSearchToolPart(part) ||
    hasInputQueryString(part) ||
    hasInputUrlString(part);

  const TODO_ITEM_TEXT_KEYS = [
    "content",
    "text",
    "title",
    "task",
    "label",
    "name",
  ] as const;

  const getTodoItemsPayload = (part: UiToolPart): unknown[] => {
    const inputTodos = getNestedToolValueByKeys(part.input, ["todos"]);
    if (Array.isArray(inputTodos)) {
      return inputTodos;
    }

    if (Array.isArray(part.output)) {
      return part.output;
    }

    const outputTodos = getNestedToolValueByKeys(part.output, ["todos"]);
    if (Array.isArray(outputTodos)) {
      return outputTodos;
    }

    return [];
  };

  const getTodoItemText = (item: unknown): string | null => {
    if (typeof item === "string") {
      const normalized = sanitizeInlineText(item).trim();
      return normalized.length > 0 ? normalized : null;
    }

    if (typeof item === "number" || typeof item === "boolean") {
      return String(item);
    }

    if (!isRecord(item)) {
      return toSingleLineToolText(item);
    }

    for (const key of TODO_ITEM_TEXT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) {
        continue;
      }
      const candidate = toSingleLineToolText(item[key]);
      if (candidate) {
        return candidate;
      }
    }

    return toSingleLineToolText(item);
  };

  const isTodoListLike = (value: unknown): value is unknown[] => {
    if (!Array.isArray(value)) {
      return false;
    }

    if (value.length === 0) {
      return true;
    }

    return value.every((item) => {
      if (typeof item === "string") {
        return true;
      }

      if (!isRecord(item)) {
        return false;
      }

      return (
        typeof item.status === "string" ||
        TODO_ITEM_TEXT_KEYS.some((key) =>
          Object.prototype.hasOwnProperty.call(item, key),
        )
      );
    });
  };

  const getTodoWriteSummary = (part: UiToolPart): string[] =>
    getTodoItemsPayload(part)
      .map((item) => {
        const text = getTodoItemText(item);
        if (!text) {
          return null;
        }

        const status =
          isRecord(item) && typeof item.status === "string"
            ? item.status.trim().toLowerCase()
            : "";
        const checkbox = status === "completed" ? "[X]" : "[ ]";
        return `${checkbox} ${text}`;
      })
      .filter((line): line is string => line !== null);

  const getToolType = (
    part: UiToolPart,
  ): "bash" | "glob" | "read" | "todowrite" | null => {
    for (const rawName of getToolNameCandidates(part)) {
      if (typeof rawName !== "string") {
        continue;
      }
      const normalized = rawName.trim().toLowerCase();
      if (normalized.length === 0) {
        continue;
      }
      if (normalized === "todowrite" || normalized.endsWith(".todowrite")) {
        return "todowrite";
      }
      if (normalized === "glob" || normalized.endsWith(".glob")) {
        return "glob";
      }
      if (normalized === "read" || normalized.endsWith(".read")) {
        return "read";
      }
      if (normalized === "bash" || normalized.endsWith(".bash")) {
        return "bash";
      }
    }

    if (
      getNestedToolValueByKeys(part.input, ["pattern", "glob"]) !== undefined ||
      getNestedToolValueByKeys(part.output, ["pattern", "glob"]) !== undefined
    ) {
      return "glob";
    }

    if (
      getNestedToolValueByKeys(part.input, [
        "filePath",
        "path",
        "filename",
        "basename",
      ]) !== undefined ||
      getNestedToolValueByKeys(part.output, [
        "filePath",
        "path",
        "filename",
        "basename",
      ]) !== undefined
    ) {
      return "read";
    }

    if (isTodoListLike(getNestedToolValueByKeys(part.input, ["todos"]))) {
      return "todowrite";
    }

    if (
      isTodoListLike(part.output) ||
      isTodoListLike(getNestedToolValueByKeys(part.output, ["todos"]))
    ) {
      return "todowrite";
    }

    const commandLikeInputValue =
      getNestedToolValueByKeys(part.input, BASH_COMMAND_KEYS) ?? part.input;
    if (isShellCommandLike(commandLikeInputValue)) {
      return "bash";
    }

    return null;
  };

  const getGlobSummary = (part: UiToolPart): string => {
    const patternValue =
      getNestedToolValueByKeys(part.input, ["pattern"]) ??
      getNestedToolValueByKeys(part.output, ["pattern"]);
    const pattern =
      toInlineSummaryText(patternValue) ||
      toInlineSummaryText(part.input) ||
      toInlineSummaryText(part.output) ||
      "unknown";
    return `glob: ${pattern}`;
  };

  const getPathTail = (path: string): string => {
    const normalized = path.trim().replace(/[\\/]+$/, "");
    if (normalized.length === 0) {
      return "";
    }
    const segments = normalized.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] || "";
  };

  const getReadSummary = (
    part: UiToolPart,
  ): { title: string; path: string | null } => {
    const fullPathValue =
      getNestedToolValueByKeys(part.input, ["filePath", "path", "filename"]) ??
      getNestedToolValueByKeys(part.output, ["filePath", "path", "filename"]);
    const fullPath = toInlineSummaryText(fullPathValue);

    const explicitTitle =
      toInlineSummaryText(part.title) ||
      toInlineSummaryText(
        getNestedToolValueByKeys(part.input, ["title", "name"]) ??
          getNestedToolValueByKeys(part.output, ["title", "name"]),
      );
    const basename = toInlineSummaryText(
      getNestedToolValueByKeys(part.input, ["basename"]) ??
        getNestedToolValueByKeys(part.output, ["basename"]),
    );
    const pathTail = fullPath ? getPathTail(fullPath) : "";
    const title = explicitTitle || basename || pathTail || "file";

    return { title, path: fullPath || null };
  };

  const getToolFieldEntries = (
    part: UiToolPart,
  ): Array<{ label: string; value: unknown }> => {
    const fields: Array<{ label: string; value: unknown }> = [];

    if (part.title !== undefined) {
      fields.push({ label: "Title", value: part.title });
    }
    if (part.input !== undefined) {
      fields.push({ label: "Input", value: part.input });
    }
    if (part.output !== undefined) {
      fields.push({ label: "Output", value: part.output });
    }
    if (part.error !== undefined) {
      fields.push({ label: "Error", value: part.error });
    }

    return fields;
  };

  const extractSnapshotHash = (snapshot: unknown): string | null => {
    if (typeof snapshot === "string") {
      return formatStepMetaValue(snapshot);
    }

    if (snapshot && typeof snapshot === "object") {
      const record = snapshot as Record<string, unknown>;
      const directHash = formatStepMetaValue(record.hash);
      if (directHash) {
        return directHash;
      }

      const nestedSnapshot = record.snapshot;
      if (nestedSnapshot && typeof nestedSnapshot === "object") {
        const nestedRecord = nestedSnapshot as Record<string, unknown>;
        const nestedHash = formatStepMetaValue(nestedRecord.hash);
        if (nestedHash) {
          return nestedHash;
        }
      }
    }

    return null;
  };

  const getPartSnippet = (part: UiPart): string => {
    if (part.kind === "file") {
      return formatPartSnippet({
        filename: part.filename,
        mime: part.mime,
        url: part.url,
      });
    }

    if (part.kind === "patch") {
      return formatPartSnippet({
        hash: part.hash,
        files: Array.isArray(part.files) ? part.files.length : 0,
      });
    }

    if (part.kind === "step-start") {
      return formatPartSnippet({ snapshot: part.snapshot });
    }

    if (part.kind === "step-finish") {
      return formatPartSnippet({
        reason: part.reason,
        tokens: part.tokens,
        cost: part.cost,
      });
    }

    if (part.kind === "unknown") {
      return formatPartSnippet(part.raw ?? { type: part.rawType });
    }

    return formatPartSnippet(part);
  };

  const getPartScrollRevision = (part: UiPart): string => {
    if (part.kind === "text" || part.kind === "reasoning") {
      return `${part.kind}:${part.text.length}`;
    }

    if (part.kind === "tool") {
      return [
        part.kind,
        part.toolName || "",
        part.status || "",
        typeof part.title === "string" ? part.title.length : "",
      ].join("|");
    }

    if (part.kind === "file") {
      return `${part.kind}:${part.filename}`;
    }

    if (part.kind === "patch") {
      return `${part.kind}:${part.hash}`;
    }

    if (part.kind === "step-start") {
      return part.kind;
    }

    if (part.kind === "step-finish") {
      return `${part.kind}:${formatStepMetaValue(part.reason) || ""}`;
    }

    if (part.kind === "unknown") {
      return `${part.kind}:${part.rawType || ""}`;
    }

    return "";
  };

  const transcript = createMemo(() => {
    const store = model.agent.store();
    const entries: Array<{
      actor: string;
      time: number | null;
      parts: UiPart[];
      stepMeta: {
        snapshotHash?: string;
        reason?: string;
        tokens?: string;
        cost?: string;
      } | null;
    }> = [];

    for (const messageId of store.messageOrder) {
      const message = store.messagesById[messageId];
      if (!message) {
        continue;
      }

      const parts: UiPart[] = [];
      let snapshotHash: string | null = null;
      let finishReason: string | null = null;
      let finishTokens: string | null = null;
      let finishCost: string | null = null;

      for (const partId of message.partOrder) {
        const part = message.partsById[partId];
        if (!part) {
          continue;
        }

        if (part.kind === "step-start") {
          if (!snapshotHash) {
            snapshotHash = extractSnapshotHash(part.snapshot);
          }
          continue;
        }

        if (part.kind === "step-finish") {
          if (!snapshotHash) {
            snapshotHash = extractSnapshotHash(part.snapshot);
          }

          const reason = formatStepMetaValue(part.reason);
          if (reason) {
            finishReason = reason;
          }

          const tokens = formatStepTokenValue(part.tokens);
          if (tokens) {
            finishTokens = tokens;
          }

          const cost = formatStepMetaValue(part.cost);
          if (cost) {
            finishCost = cost;
          }
          continue;
        }

        parts.push(part);
      }

      entries.push({
        actor: getMessageActorLabel(message.role),
        time: message.updatedAt ?? message.createdAt ?? null,
        parts,
        stepMeta:
          snapshotHash || finishReason || finishTokens || finishCost
            ? {
                snapshotHash: snapshotHash || undefined,
                reason: finishReason || undefined,
                tokens: finishTokens || undefined,
                cost: finishCost || undefined,
              }
            : null,
      });
    }

    return entries;
  });

  const transcriptScrollRevision = createMemo(() => {
    const store = model.agent.store();
    const messageCount = store.messageOrder.length;
    if (messageCount === 0) {
      return "0";
    }

    const lastMessageId = store.messageOrder[messageCount - 1];
    const lastMessage = store.messagesById[lastMessageId];
    if (!lastMessage) {
      return `${messageCount}:${lastMessageId}:missing`;
    }

    const lastPartCount = lastMessage.partOrder.length;
    const lastPartId = lastMessage.partOrder[lastPartCount - 1];
    const lastPart = lastPartId ? lastMessage.partsById[lastPartId] : undefined;
    const lastPartRevision = lastPart
      ? getPartScrollRevision(lastPart)
      : "no-part";

    return [
      messageCount,
      lastMessageId,
      lastPartCount,
      lastMessage.updatedAt || lastMessage.createdAt || 0,
      lastPartId || "",
      lastPartRevision,
    ].join(":");
  });

  const agentEventLogScrollRevision = createMemo(() => {
    const events = agentEvents();
    const eventCount = events.length;
    if (eventCount === 0) {
      return "0";
    }

    const lastEvent = events[eventCount - 1];
    return [eventCount, lastEvent.event, String(lastEvent.ts || "")].join(":");
  });
  createEffect(() => {
    const diffActive = activeTab() === "diff";
    model.setIsDiffTabActive(diffActive);
  });

  createEffect(() => {
    if (activeTab() !== "diff") {
      return;
    }

    const files = model.diffFiles();
    setExpandedDiffPaths((current) => {
      const next: Record<string, boolean> = {};
      let didChange = false;

      for (const file of files) {
        if (Object.prototype.hasOwnProperty.call(current, file.path)) {
          next[file.path] = current[file.path] === true;
          continue;
        }

        next[file.path] = true;
        didChange = true;
      }

      if (!didChange) {
        const currentPaths = Object.keys(current);
        if (currentPaths.length !== files.length) {
          didChange = true;
        } else {
          for (const path of currentPaths) {
            if (!Object.prototype.hasOwnProperty.call(next, path)) {
              didChange = true;
              break;
            }
            if (current[path] !== next[path]) {
              didChange = true;
              break;
            }
          }
        }
      }

      return didChange ? next : current;
    });
  });

  createEffect(() => {
    if (activeTab() !== "diff") {
      return;
    }

    const files = model.diffFiles();
    const expanded = expandedDiffPaths();
    const openPaths = files
      .map((file) => file.path)
      .filter((path) => expanded[path] === true);

    for (const path of openPaths) {
      void model.loadDiffFile(path);
    }
  });

  createEffect(() => {
    const revision = transcriptScrollRevision();
    if (revision === "0") {
      return;
    }

    const container = transcriptScrollRef;
    if (!container) {
      return;
    }

    if (isTranscriptAutoFollowEnabled()) {
      scheduleTranscriptScrollToBottom();
    }
  });

  createEffect(() => {
    if (!isAgentTabActive()) {
      return;
    }

    const revision = agentEventLogScrollRevision();
    if (revision === "0") {
      return;
    }

    const container = agentEventLogRef;
    if (!container) {
      return;
    }

    if (isAgentEventLogAutoFollowEnabled()) {
      scheduleAgentEventLogScrollToBottom();
    }
  });

  return (
    <div class="run-detail-page">
      <Show
        when={!model.error()}
        fallback={
          <section class="projects-panel run-detail-card">
            <p class="projects-error">{model.error()}</p>
          </section>
        }
      >
        <Show
          when={!model.isLoading()}
          fallback={
            <section class="projects-panel run-detail-card">
              <p class="project-placeholder-text">Loading run details.</p>
            </section>
          }
        >
          <Show
            when={model.run()}
            fallback={
              <section class="projects-panel run-detail-card">
                <p class="project-placeholder-text">Run not found.</p>
              </section>
            }
          >
            {(runValue) => (
              <section
                class="run-detail-workspace"
                aria-label="Run detail workspace"
              >
                <section
                  class="projects-panel run-detail-topbar"
                  aria-label="Run header"
                >
                  <BackIconLink
                    href={model.backHref()}
                    label={model.backLabel()}
                    class="project-detail-back-link project-detail-back-link--icon task-detail-back-link"
                  />
                  <div class="run-detail-topbar-main">
                    <p class="run-detail-task-context">
                      <Show
                        when={model.task()}
                        fallback={<span>Current task</span>}
                      >
                        {(taskValue) => (
                          <A
                            href={model.taskHref()}
                            class="run-detail-task-link"
                          >
                            {taskValue().displayKey?.trim() || "Current task"} -{" "}
                            {taskValue().title}
                          </A>
                        )}
                      </Show>
                    </p>
                    <span
                      class="run-detail-title"
                      role="heading"
                      aria-level="1"
                    >
                      {model.runLabel()}
                    </span>
                    <p class="run-detail-repo-summary">
                      {model.repositorySummary()}
                    </p>
                  </div>
                  <div class="run-detail-header-row">
                    <span
                      class={`project-task-status project-task-status--${runValue().status}`}
                    >
                      {formatRunStatus(runValue().status)}
                    </span>
                    <div
                      class="run-detail-header-actions"
                      role="group"
                      aria-label="Run actions"
                    >
                      <button
                        type="button"
                        class="run-detail-icon-button"
                        aria-label={
                          isInfoFocus()
                            ? "Return to split mode"
                            : "Expand info panel"
                        }
                        aria-pressed={isInfoFocus() ? "true" : "false"}
                        title={
                          isInfoFocus()
                            ? "Return to split mode"
                            : "Expand info panel"
                        }
                        onClick={() =>
                          setLayoutMode(isInfoFocus() ? "split" : "info-focus")
                        }
                      >
                        <Show
                          when={!isInfoFocus()}
                          fallback={
                            <svg viewBox="0 0 16 16" aria-hidden="true">
                              <path
                                d="M2.5 3.5h11v9h-11v-9Zm5.2 0v9"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.2"
                              />
                            </svg>
                          }
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path
                              d="M2.5 3.5h11v9h-11v-9Zm5.2 0v9M7.2 8h-3"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.2"
                              stroke-linecap="round"
                            />
                          </svg>
                        </Show>
                      </button>
                      <button
                        type="button"
                        class="run-detail-icon-button"
                        aria-label="Pause"
                        title="Pause"
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <rect x="4" y="3" width="3" height="10" rx="1" />
                          <rect x="9" y="3" width="3" height="10" rx="1" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="run-detail-icon-button run-detail-icon-button--danger"
                        aria-label="Cancel"
                        title="Cancel"
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <rect x="4" y="4" width="8" height="8" rx="1.5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="run-detail-icon-button"
                        aria-label="Retry"
                        title="Retry"
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M3 8a5 5 0 0 1 8.5-3.5V2h1.5v4H9V4.5h1.8A3.5 3.5 0 1 0 11.5 8H13a5 5 0 0 1-10 0Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="run-detail-icon-button"
                        aria-label="Open Diff"
                        title="Open Diff"
                        onClick={() => setActiveTab("diff")}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M5 3h1.5v10H5v-2H3v-2h2V7H3V5h2V3Zm5.5 0H12v2h2v2h-2v2h2v2h-2v2h-1.5V3Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="run-detail-icon-button"
                        aria-label="View Logs"
                        title="View Logs"
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <rect
                            x="3"
                            y="2.5"
                            width="10"
                            height="11"
                            rx="1.5"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.3"
                          />
                          <path
                            d="M5.5 6h5M5.5 8.5h5M5.5 11h3.5"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.3"
                            stroke-linecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </section>

                <section
                  class="run-detail-main-grid"
                  classList={{
                    "run-detail-main-grid--info-focus": isInfoFocus(),
                  }}
                  data-layout-mode={layoutMode()}
                >
                  <Show when={!isInfoFocus()}>
                    <section class="projects-panel run-detail-conversation-column">
                      <header class="run-detail-conversation-card-header">
                        <h2 class="run-detail-conversation-title">
                          Chat Workspace
                        </h2>
                      </header>
                      <section
                        class="run-detail-conversation-log"
                        aria-label="Conversation transcript"
                        ref={transcriptScrollRef}
                        onScroll={(event) => {
                          if (isTranscriptProgrammaticScroll) {
                            return;
                          }
                          setIsTranscriptAutoFollowEnabled(
                            isNearBottom(event.currentTarget),
                          );
                        }}
                      >
                        <Show when={model.agent.error().length > 0}>
                          <p class="projects-error">{model.agent.error()}</p>
                        </Show>
                        <Show when={model.agent.state() === "unsupported"}>
                          <p class="project-placeholder-text">
                            Agent stream is not available for this run.
                          </p>
                        </Show>
                        <Show
                          when={transcript().length > 0}
                          fallback={
                            <p class="project-placeholder-text">
                              {model.agent.state() === "starting"
                                ? "Starting agent stream."
                                : "No agent messages yet."}
                            </p>
                          }
                        >
                          <For each={transcript()}>
                            {(entry) => (
                              <article class="run-detail-message">
                                <header>
                                  <strong>{entry.actor}</strong>
                                  <span>
                                    {formatAgentTimestamp(entry.time)}
                                  </span>
                                </header>
                                <Show when={entry.stepMeta}>
                                  {(meta) => (
                                    <dl class="run-detail-step-meta">
                                      <Show when={meta().snapshotHash}>
                                        <div>
                                          <dt>Snapshot</dt>
                                          <dd>{meta().snapshotHash}</dd>
                                        </div>
                                      </Show>
                                      <Show when={meta().reason}>
                                        <div>
                                          <dt>Reason</dt>
                                          <dd>{meta().reason}</dd>
                                        </div>
                                      </Show>
                                      <Show when={meta().tokens}>
                                        <div>
                                          <dt>Tokens</dt>
                                          <dd>{meta().tokens}</dd>
                                        </div>
                                      </Show>
                                      <Show when={meta().cost}>
                                        <div>
                                          <dt>Cost</dt>
                                          <dd>{meta().cost}</dd>
                                        </div>
                                      </Show>
                                    </dl>
                                  )}
                                </Show>
                                <Show
                                  when={entry.parts.length > 0}
                                  fallback={
                                    <p class="project-placeholder-text">
                                      No message parts yet.
                                    </p>
                                  }
                                >
                                  <div class="run-detail-message-parts">
                                    <For each={entry.parts}>
                                      {(part) => (
                                        <Show when={part.kind !== "patch"}>
                                          <>
                                            <Show when={part.kind === "text"}>
                                              <MarkdownContent
                                                content={
                                                  part.kind === "text"
                                                    ? part.text
                                                    : ""
                                                }
                                                class="run-detail-part run-detail-part--text"
                                              />
                                            </Show>

                                            <Show
                                              when={part.kind === "reasoning"}
                                            >
                                              <details
                                                class="run-detail-part run-detail-part--reasoning"
                                                open
                                              >
                                                <summary>Reasoning</summary>
                                                <MarkdownContent
                                                  content={
                                                    part.kind === "reasoning"
                                                      ? part.text
                                                      : ""
                                                  }
                                                />
                                              </details>
                                            </Show>

                                            <Show when={part.kind === "tool"}>
                                              {(() => {
                                                const toolPart =
                                                  part as UiToolPart;
                                                const toolType =
                                                  getToolType(toolPart);

                                                if (toolType === "glob") {
                                                  return (
                                                    <div class="run-detail-part run-detail-part--tool">
                                                      <p class="run-detail-tool-summary-line">
                                                        {getGlobSummary(
                                                          toolPart,
                                                        )}
                                                      </p>
                                                    </div>
                                                  );
                                                }

                                                if (toolType === "read") {
                                                  const readSummary =
                                                    getReadSummary(toolPart);

                                                  return (
                                                    <div class="run-detail-part run-detail-part--tool">
                                                      <p class="run-detail-tool-summary-line">
                                                        {`read: ${readSummary.title}`}
                                                      </p>
                                                      <Show
                                                        when={readSummary.path}
                                                      >
                                                        <p class="run-detail-tool-subtitle">
                                                          {readSummary.path ||
                                                            ""}
                                                        </p>
                                                      </Show>
                                                    </div>
                                                  );
                                                }

                                                if (toolType === "bash") {
                                                  const bashSummary =
                                                    getBashSummary(toolPart);

                                                  return (
                                                    <div class="run-detail-part run-detail-part--tool run-detail-part--tool-bash">
                                                      <p class="run-detail-tool-summary-line">
                                                        {`bash: ${bashSummary.description}`}
                                                      </p>
                                                      <p class="run-detail-tool-shell-command">
                                                        {`$ ${bashSummary.command}`}
                                                      </p>
                                                      <pre class="run-detail-tool-shell-output">
                                                        {bashSummary.output}
                                                      </pre>
                                                    </div>
                                                  );
                                                }

                                                if (toolType === "todowrite") {
                                                  const todoLines =
                                                    getTodoWriteSummary(
                                                      toolPart,
                                                    );

                                                  return (
                                                    <div class="run-detail-part run-detail-part--tool">
                                                      <p class="run-detail-tool-summary-line">
                                                        TODO
                                                      </p>
                                                      <For each={todoLines}>
                                                        {(line) => (
                                                          <p class="run-detail-tool-summary-line run-detail-tool-summary-line--todo-item">
                                                            {line}
                                                          </p>
                                                        )}
                                                      </For>
                                                    </div>
                                                  );
                                                }

                                                if (isQueryToolPart(toolPart)) {
                                                  const queryToolLabel =
                                                    getQueryToolLabel(toolPart);
                                                  const hasQuery =
                                                    hasInputQueryString(
                                                      toolPart,
                                                    );
                                                  const urlSummary = hasQuery
                                                    ? null
                                                    : getInputUrlString(
                                                        toolPart,
                                                      );
                                                  const querySummary =
                                                    getQueryToolSummary(
                                                      toolPart,
                                                    );
                                                  const summaryLine = urlSummary
                                                    ? `${queryToolLabel}: fetching ${urlSummary}`
                                                    : `${queryToolLabel}: ${querySummary}`;

                                                  return (
                                                    <div class="run-detail-part run-detail-part--tool">
                                                      <p class="run-detail-tool-summary-line">
                                                        {summaryLine}
                                                      </p>
                                                    </div>
                                                  );
                                                }

                                                const fields =
                                                  getToolFieldEntries(toolPart);

                                                return (
                                                  <div class="run-detail-part run-detail-part--tool">
                                                    <div class="run-detail-part-tool-header">
                                                      <span>
                                                        {toolPart.toolName ||
                                                          "tool"}
                                                      </span>
                                                      <span class="run-detail-part-tool-status">
                                                        {toolPart.status ||
                                                          "pending"}
                                                      </span>
                                                    </div>
                                                    <Show
                                                      when={fields.length > 0}
                                                    >
                                                      <dl class="run-detail-tool-fields">
                                                        <For each={fields}>
                                                          {(field) => {
                                                            const preferredText =
                                                              extractPreferredToolText(
                                                                field.value,
                                                              );
                                                            const isMarkdownText =
                                                              typeof field.value ===
                                                                "string" ||
                                                              preferredText !==
                                                                null;

                                                            return (
                                                              <div class="run-detail-tool-field">
                                                                <dt>
                                                                  {field.label}
                                                                </dt>
                                                                <dd>
                                                                  <Show
                                                                    when={
                                                                      isMarkdownText
                                                                    }
                                                                    fallback={
                                                                      <pre class="run-detail-tool-field-json">
                                                                        {formatAgentPayload(
                                                                          field.value,
                                                                        )}
                                                                      </pre>
                                                                    }
                                                                  >
                                                                    <MarkdownContent
                                                                      content={
                                                                        typeof field.value ===
                                                                        "string"
                                                                          ? sanitizeInlineText(
                                                                              field.value,
                                                                            )
                                                                          : preferredText ||
                                                                            ""
                                                                      }
                                                                      class="run-detail-tool-field-markdown"
                                                                    />
                                                                  </Show>
                                                                </dd>
                                                              </div>
                                                            );
                                                          }}
                                                        </For>
                                                      </dl>
                                                    </Show>
                                                  </div>
                                                );
                                              })()}
                                            </Show>

                                            <Show
                                              when={
                                                part.kind === "file" ||
                                                part.kind === "unknown"
                                              }
                                            >
                                              <div class="run-detail-part run-detail-part--fallback">
                                                <p class="run-detail-part-fallback-label">
                                                  {getPartTypeLabel(part)}
                                                </p>
                                                <pre>
                                                  {getPartSnippet(part)}
                                                </pre>
                                              </div>
                                            </Show>
                                          </>
                                        </Show>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </article>
                            )}
                          </For>
                          <div ref={transcriptBottomRef} aria-hidden="true" />
                        </Show>
                      </section>
                      <form
                        class="run-detail-composer"
                        aria-label="Message composer"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void (async () => {
                            const success =
                              await model.agent.submitPrompt(composerValue());
                            if (success) {
                              setComposerValue("");
                            }
                          })();
                        }}
                      >
                        <label class="sr-only" for="run-detail-message-input">
                          Message agent
                        </label>
                        <input
                          id="run-detail-message-input"
                          type="text"
                          value={composerValue()}
                          onInput={(event) =>
                            setComposerValue(event.currentTarget.value)
                          }
                          placeholder="Message agent..."
                          aria-label="Message agent"
                        />
                        <button
                          type="submit"
                          class="projects-button-primary"
                          disabled={isComposerSendDisabled()}
                        >
                          Send
                        </button>
                      </form>
                      <Show when={model.agent.submitError().length > 0}>
                        <p class="projects-error">
                          {model.agent.submitError()}
                        </p>
                      </Show>
                    </section>
                  </Show>

                  <aside
                    class="projects-panel run-detail-ops-sidebar"
                    aria-label="Run operations"
                  >
                    <div
                      role="tablist"
                      aria-label="Run detail tab list"
                      class="run-detail-tab-list"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab() === "operations"}
                        class="run-detail-tab"
                        onClick={() => setActiveTab("operations")}
                      >
                        Operations
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab() === "agent"}
                        class="run-detail-tab"
                        onClick={() => setActiveTab("agent")}
                      >
                        Agent
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab() === "files"}
                        class="run-detail-tab"
                        onClick={() => setActiveTab("files")}
                      >
                        Files Changed
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab() === "diff"}
                        class="run-detail-tab"
                        onClick={() => setActiveTab("diff")}
                      >
                        Diff
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab() === "git"}
                        class="run-detail-tab"
                        onClick={() => setActiveTab("git")}
                      >
                        Git
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab() === "terminal"}
                        class="run-detail-tab"
                        onClick={() => setActiveTab("terminal")}
                      >
                        Terminal
                      </button>
                    </div>
                    <div
                      role="tabpanel"
                      aria-label="Run detail tab panel"
                      class="run-detail-tab-panel"
                    >
                      <div
                        class="run-detail-tab-content"
                        classList={{
                          "run-detail-tab-content--hidden":
                            !isTerminalTabActive(),
                        }}
                      >
                        <RunTerminal
                          isVisible={isTerminalTabActive()}
                          isStarting={model.terminal.isStarting()}
                          isReady={model.terminal.isReady()}
                          error={model.terminal.error()}
                          writeTerminal={model.terminal.writeTerminal}
                          resizeTerminal={model.terminal.resizeTerminal}
                          setTerminalFrameHandler={
                            model.terminal.setTerminalFrameHandler
                          }
                        />
                      </div>
                      <Show when={!isTerminalTabActive()}>
                        <Show
                          when={activeTab() === "operations"}
                          fallback={
                            <Show
                              when={activeTab() === "diff"}
                              fallback={
                                <Show
                                  when={isAgentTabActive()}
                                  fallback={
                                    <p class="project-placeholder-text">
                                      {activeTab() === "files"
                                        ? "Files Changed"
                                        : activeTab().charAt(0).toUpperCase() +
                                          activeTab().slice(1)}{" "}
                                      panel placeholder.
                                    </p>
                                  }
                                >
                                  <section
                                    class="run-agent-panel"
                                    aria-label="Agent stream events"
                                  >
                                    <header class="run-agent-panel-header">
                                      <p class="run-agent-event-count">
                                        {agentEventCountLabel()}
                                      </p>
                                    </header>
                                    <Show when={model.agent.error().length > 0}>
                                      <p class="projects-error">
                                        {model.agent.error()}
                                      </p>
                                    </Show>
                                    <Show
                                      when={
                                        model.agent.state() === "unsupported"
                                      }
                                    >
                                      <p class="project-placeholder-text">
                                        Agent stream is not available for this
                                        run.
                                      </p>
                                    </Show>
                                    <Show
                                      when={agentEvents().length > 0}
                                      fallback={
                                        <p class="project-placeholder-text">
                                          {model.agent.state() === "starting"
                                            ? "Starting agent stream."
                                            : "No agent events yet."}
                                        </p>
                                      }
                                    >
                                      <div
                                        class="run-agent-event-log"
                                        ref={agentEventLogRef}
                                        onScroll={(event) => {
                                          if (
                                            isAgentEventLogProgrammaticScroll
                                          ) {
                                            return;
                                          }
                                          setIsAgentEventLogAutoFollowEnabled(
                                            isNearBottom(event.currentTarget),
                                          );
                                        }}
                                      >
                                        <For each={agentEvents()}>
                                          {(item) => (
                                            <article class="run-agent-event-item">
                                              <header>
                                                <time>
                                                  {formatAgentTimestamp(
                                                    item.ts,
                                                  )}
                                                </time>
                                                <strong>{item.event}</strong>
                                              </header>
                                              <pre>
                                                {formatAgentPayload(item.data)}
                                              </pre>
                                            </article>
                                          )}
                                        </For>
                                      </div>
                                    </Show>
                                  </section>
                                </Show>
                              }
                            >
                              <section aria-label="Run diff files">
                                <Show when={model.diffFilesError().length > 0}>
                                  <p class="projects-error">
                                    {model.diffFilesError()}
                                  </p>
                                </Show>
                                <Show
                                  when={model.diffFiles().length > 0}
                                  fallback={
                                    <Show when={!model.isDiffFilesLoading()}>
                                      <p class="project-placeholder-text">
                                        No changed files.
                                      </p>
                                    </Show>
                                  }
                                >
                                  <div class="run-diff-accordion">
                                    <For each={model.diffFiles()}>
                                      {(file) => {
                                        const expanded = () =>
                                          expandedDiffPaths()[file.path] ===
                                          true;
                                        const payload = () =>
                                          model.diffFilePayloads()[file.path];
                                        const isFileLoading = () =>
                                          model.diffFileLoadingPaths()[
                                            file.path
                                          ] === true;

                                        return (
                                          <article class="run-diff-item">
                                            <button
                                              type="button"
                                              class="run-diff-item-header"
                                              aria-expanded={
                                                expanded() ? "true" : "false"
                                              }
                                              onClick={() => {
                                                const previousExpanded =
                                                  expandedDiffPaths()[
                                                    file.path
                                                  ] === true;
                                                const nextExpanded =
                                                  !previousExpanded;
                                                setExpandedDiffPaths(
                                                  (current) => ({
                                                    ...current,
                                                    [file.path]: nextExpanded,
                                                  }),
                                                );
                                              }}
                                            >
                                              <span class="run-diff-item-path">
                                                {file.path}
                                              </span>
                                              <span class="run-diff-item-stats">
                                                <span class="run-diff-item-stat-additions">
                                                  +{file.additions}
                                                </span>
                                                <span class="run-diff-item-stat-deletions">
                                                  -{file.deletions}
                                                </span>
                                              </span>
                                            </button>
                                            <Show when={expanded()}>
                                              <div class="run-diff-item-body">
                                                <Show
                                                  when={!isFileLoading()}
                                                  fallback={
                                                    <p class="project-placeholder-text">
                                                      Loading diff.
                                                    </p>
                                                  }
                                                >
                                                  <Show
                                                    when={payload()}
                                                    fallback={
                                                      <p class="project-placeholder-text">
                                                        Diff unavailable.
                                                      </p>
                                                    }
                                                  >
                                                    {(filePayload) => (
                                                      <>
                                                        <p class="run-diff-item-meta">
                                                          {filePayload().status}
                                                          ,{" "}
                                                          {filePayload()
                                                            .isBinary
                                                            ? "binary"
                                                            : "text"}
                                                          {filePayload()
                                                            .truncated
                                                            ? ", truncated"
                                                            : ""}
                                                        </p>
                                                        <div class="run-detail-monaco-panel">
                                                          <MonacoDiffEditor
                                                            original={
                                                              filePayload()
                                                                .original
                                                            }
                                                            modified={
                                                              filePayload()
                                                                .modified
                                                            }
                                                            language={
                                                              filePayload()
                                                                .language
                                                            }
                                                          />
                                                        </div>
                                                      </>
                                                    )}
                                                  </Show>
                                                </Show>
                                              </div>
                                            </Show>
                                          </article>
                                        );
                                      }}
                                    </For>
                                  </div>
                                </Show>
                              </section>
                            </Show>
                          }
                        >
                          <dl class="task-detail-definition-list run-detail-metadata">
                            <div>
                              <dt>Status</dt>
                              <dd>{formatRunStatus(runValue().status)}</dd>
                            </div>
                            <div>
                              <dt>Duration</dt>
                              <dd>{model.durationLabel()}</dd>
                            </div>
                            <div>
                              <dt>Worktree</dt>
                              <dd>
                                {runValue().worktreeId?.trim() || "Unavailable"}
                              </dd>
                            </div>
                            <div>
                              <dt>Branch</dt>
                              <dd>
                                {runValue().status === "running"
                                  ? "active branch"
                                  : "Unavailable"}
                              </dd>
                            </div>
                            <div>
                              <dt>Model/agent</dt>
                              <dd>
                                {runValue().agentId?.trim() || "Unavailable"}
                              </dd>
                            </div>
                            <div>
                              <dt>Files changed</dt>
                              <dd>Placeholder</dd>
                            </div>
                            <div>
                              <dt>Tests</dt>
                              <dd>Placeholder</dd>
                            </div>
                          </dl>
                        </Show>
                      </Show>
                    </div>
                  </aside>
                </section>
              </section>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default RunDetailScreen;
