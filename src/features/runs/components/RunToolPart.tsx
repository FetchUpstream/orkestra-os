import { For, Show, createMemo, type Component } from "solid-js";
import MarkdownContent from "../../../components/ui/MarkdownContent";
import type { UiToolPart } from "../model/agentTypes";

type RunToolPartProps = {
  part: UiToolPart;
  formatPayload: (payload: unknown) => string;
};

const INTERNAL_ID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const TOOL_TEXT_KEYS = ["text", "message", "content", "result"] as const;

const BASH_COMMAND_KEYS = [
  "command",
  "bash",
  "cmd",
  "script",
  "shellCommand",
  "commandLine",
] as const;

const QUERY_INPUT_KEYS = [
  "query",
  "searchQuery",
  "searchTerm",
  "queryString",
  "q",
  "keywords",
] as const;

const URL_INPUT_KEYS = ["url", "href", "link"] as const;

const TODO_ITEM_TEXT_KEYS = [
  "content",
  "text",
  "title",
  "task",
  "label",
  "name",
] as const;

const SEARCH_TOOL_NAMES = new Set(["websearch_web_search_exa"]);

const COMMON_SHELL_COMMAND_PATTERN =
  /^(?:\$\s*)?(?:bun|npm|pnpm|yarn|git|ls|cat|cp|mv|rm|mkdir|touch|echo|pwd|cd|grep|awk|sed|chmod|chown|docker|kubectl|python|node|deno|go|cargo|make|sh|bash|zsh)\b/i;

const SHELL_OPERATOR_PATTERN = /(?:\|\||&&|[|;`$()><])/;

const sanitizeInlineText = (value: string): string =>
  value.replace(INTERNAL_ID_PATTERN, "[internal-id]");

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

const extractPreferredToolText = (value: unknown, depth = 0): string | null => {
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

const getToolNameCandidates = (part: UiToolPart): Array<string | undefined> => [
  part.toolName,
  isRecord(part.input)
    ? (part.input.toolName as string | undefined)
    : undefined,
  isRecord(part.input) ? (part.input.type as string | undefined) : undefined,
  isRecord(part.input) ? (part.input.name as string | undefined) : undefined,
  isRecord(part.output)
    ? (part.output.toolName as string | undefined)
    : undefined,
  isRecord(part.output) ? (part.output.type as string | undefined) : undefined,
  isRecord(part.output) ? (part.output.name as string | undefined) : undefined,
];

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

const RunToolPart: Component<RunToolPartProps> = (props) => {
  const partFields = createMemo(() => ({
    title: props.part.title,
    input: props.part.input,
    output: props.part.output,
    error: props.part.error,
  }));

  const serializedPartFields = createMemo(() => {
    const fields = partFields();
    return {
      title:
        fields.title === undefined ? null : props.formatPayload(fields.title),
      input:
        fields.input === undefined ? null : props.formatPayload(fields.input),
      output:
        fields.output === undefined ? null : props.formatPayload(fields.output),
      error:
        fields.error === undefined ? null : props.formatPayload(fields.error),
    };
  });

  const formatPartSnippet = (
    payload: unknown,
    serializedPayload?: string | null,
  ): string => {
    const serialized = serializedPayload ?? props.formatPayload(payload);
    if (serialized.length <= 280) {
      return serialized;
    }
    return `${serialized.slice(0, 280)}...`;
  };

  const toInlineSummaryText = (
    value: unknown,
    serializedPayload?: string | null,
  ): string | null => {
    if (value === null || value === undefined) {
      return null;
    }

    const text =
      typeof value === "string"
        ? sanitizeInlineText(value)
        : extractPreferredToolText(value) ||
          formatPartSnippet(value, serializedPayload);
    const singleLine = text.replace(/\s+/g, " ").trim();
    if (singleLine.length === 0) {
      return null;
    }
    if (singleLine.length <= 160) {
      return singleLine;
    }
    return `${singleLine.slice(0, 157)}...`;
  };

  const toSingleLineToolText = (
    value: unknown,
    serializedPayload?: string | null,
  ): string | null => {
    if (value === null || value === undefined) {
      return null;
    }

    const text =
      typeof value === "string"
        ? sanitizeInlineText(value)
        : extractPreferredToolText(value) ||
          formatPartSnippet(value, serializedPayload);
    const normalized = text.replace(/\s+/g, " ").trim();
    return normalized.length > 0 ? normalized : null;
  };

  const toQueryText = (
    value: unknown,
    serializedPayload?: string | null,
  ): string | null => {
    const inline = toInlineSummaryText(value, serializedPayload);
    if (!inline) {
      return null;
    }
    return inline.length <= 180 ? inline : `${inline.slice(0, 177)}...`;
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

  const getPathTail = (path: string): string => {
    const normalized = path.trim().replace(/[\\/]+$/, "");
    if (normalized.length === 0) {
      return "";
    }
    const segments = normalized.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] || "";
  };

  const getToolTypeMemo = createMemo(() => getToolType(props.part));

  const globSummary = createMemo(() => {
    const serializedFields = serializedPartFields();
    const fields = partFields();
    const patternValue =
      getNestedToolValueByKeys(fields.input, ["pattern"]) ??
      getNestedToolValueByKeys(fields.output, ["pattern"]);
    const pattern =
      toInlineSummaryText(patternValue) ||
      toInlineSummaryText(fields.input, serializedFields.input) ||
      toInlineSummaryText(fields.output, serializedFields.output) ||
      "unknown";
    return `glob: ${pattern}`;
  });

  const readSummary = createMemo(() => {
    const fields = partFields();
    const serializedFields = serializedPartFields();
    const fullPathValue =
      getNestedToolValueByKeys(fields.input, [
        "filePath",
        "path",
        "filename",
      ]) ??
      getNestedToolValueByKeys(fields.output, ["filePath", "path", "filename"]);
    const fullPath = toInlineSummaryText(fullPathValue);

    const explicitTitle =
      toInlineSummaryText(fields.title, serializedFields.title) ||
      toInlineSummaryText(
        getNestedToolValueByKeys(fields.input, ["title", "name"]) ??
          getNestedToolValueByKeys(fields.output, ["title", "name"]),
      );
    const basename = toInlineSummaryText(
      getNestedToolValueByKeys(fields.input, ["basename"]) ??
        getNestedToolValueByKeys(fields.output, ["basename"]),
    );
    const pathTail = fullPath ? getPathTail(fullPath) : "";
    const title = explicitTitle || basename || pathTail || "file";

    return { title, path: fullPath || null };
  });

  const bashSummary = createMemo(() => {
    const fields = partFields();
    const serializedFields = serializedPartFields();
    const preferredCommandValue = getNestedToolValueByKeys(fields.input, [
      "command",
    ]);
    const fallbackCommandValue =
      getNestedToolValueByKeys(fields.input, BASH_COMMAND_KEYS) ??
      getNestedToolValueByKeys(fields.output, BASH_COMMAND_KEYS);
    const command =
      toSingleLineToolText(preferredCommandValue) ||
      toSingleLineToolText(fallbackCommandValue) ||
      "command unavailable";

    const description =
      toSingleLineToolText(
        getNestedToolValueByKeys(fields.input, ["description"]),
      ) ||
      toSingleLineToolText(fields.title, serializedFields.title) ||
      toSingleLineToolText(preferredCommandValue) ||
      toSingleLineToolText(getNestedToolValueByKeys(fields.input, ["bash"])) ||
      "bash";

    const output =
      extractPreferredToolText(fields.output) ||
      extractPreferredToolText(fields.error) ||
      "(no output)";

    return {
      description,
      command,
      output,
    };
  });

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

  const todoLines = createMemo(() =>
    getTodoItemsPayload(props.part)
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
      .filter((line): line is string => line !== null),
  );

  const isQueryToolPart = createMemo(
    () =>
      isSearchToolPart(props.part) ||
      hasInputQueryString(props.part) ||
      getInputUrlString(props.part) !== null,
  );

  const querySummary = createMemo(() => {
    const fields = partFields();
    const serializedFields = serializedPartFields();
    const directName =
      typeof props.part.toolName === "string" ? props.part.toolName.trim() : "";
    const queryToolLabel =
      directName.length > 0
        ? directName
        : (() => {
            const nestedCandidates = [
              getNestedToolValueByKeys(fields.input, [
                "type",
                "name",
                "toolName",
              ]),
              getNestedToolValueByKeys(fields.output, [
                "type",
                "name",
                "toolName",
              ]),
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
          })();

    const hasQuery = hasInputQueryString(props.part);
    const directQuery = isRecord(fields.input) ? fields.input.query : undefined;
    const directSummary = toQueryText(directQuery);
    const nestedSummary = directSummary
      ? directSummary
      : toQueryText(getNestedToolValueByKeys(fields.input, QUERY_INPUT_KEYS));
    const urlSummary = hasQuery ? null : getInputUrlString(props.part);
    const summaryLine = urlSummary
      ? `${queryToolLabel}: fetching ${urlSummary}`
      : `${queryToolLabel}: ${nestedSummary || toQueryText(fields.input, serializedFields.input) || "unknown"}`;

    return summaryLine;
  });

  const fieldEntries = createMemo(() => {
    const fields = partFields();
    return getToolFieldEntries({ ...props.part, ...fields });
  });

  const serializedFieldByLabel = createMemo(() => {
    const serialized = serializedPartFields();
    return {
      Title: serialized.title,
      Input: serialized.input,
      Output: serialized.output,
      Error: serialized.error,
    } as const;
  });

  return (
    <>
      <Show when={getToolTypeMemo() === "glob"}>
        <div class="run-detail-part run-detail-part--tool">
          <p class="run-detail-tool-summary-line">{globSummary()}</p>
        </div>
      </Show>
      <Show when={getToolTypeMemo() === "read"}>
        <div class="run-detail-part run-detail-part--tool">
          <p class="run-detail-tool-summary-line">{`read: ${readSummary().title}`}</p>
          <Show when={readSummary().path}>
            <p class="run-detail-tool-subtitle">{readSummary().path || ""}</p>
          </Show>
        </div>
      </Show>
      <Show when={getToolTypeMemo() === "bash"}>
        <div class="run-detail-part run-detail-part--tool run-detail-part--tool-bash">
          <p class="run-detail-tool-summary-line">{`bash: ${bashSummary().description}`}</p>
          <p class="run-detail-tool-shell-command">{`$ ${bashSummary().command}`}</p>
          <pre class="run-detail-tool-shell-output">{bashSummary().output}</pre>
        </div>
      </Show>
      <Show when={getToolTypeMemo() === "todowrite"}>
        <div class="run-detail-part run-detail-part--tool">
          <p class="run-detail-tool-summary-line">TODO</p>
          <For each={todoLines()}>
            {(line) => (
              <p class="run-detail-tool-summary-line run-detail-tool-summary-line--todo-item">
                {line}
              </p>
            )}
          </For>
        </div>
      </Show>
      <Show when={getToolTypeMemo() === null && isQueryToolPart()}>
        <div class="run-detail-part run-detail-part--tool">
          <p class="run-detail-tool-summary-line">{querySummary()}</p>
        </div>
      </Show>
      <Show when={getToolTypeMemo() === null && !isQueryToolPart()}>
        <div class="run-detail-part run-detail-part--tool">
          <div class="run-detail-part-tool-header">
            <span>{props.part.toolName || "tool"}</span>
            <span class="run-detail-part-tool-status">
              {props.part.status || "pending"}
            </span>
          </div>
          <Show when={fieldEntries().length > 0}>
            <dl class="run-detail-tool-fields">
              <For each={fieldEntries()}>
                {(field) => {
                  const preferredText = createMemo(() =>
                    extractPreferredToolText(field.value),
                  );
                  const isMarkdownText = createMemo(
                    () =>
                      typeof field.value === "string" ||
                      preferredText() !== null,
                  );
                  const markdownContent = createMemo(() =>
                    typeof field.value === "string"
                      ? sanitizeInlineText(field.value)
                      : preferredText() || "",
                  );
                  const serializedPayload = createMemo(() => {
                    const fromMemoizedField =
                      serializedFieldByLabel()[
                        field.label as "Title" | "Input" | "Output" | "Error"
                      ];
                    return (
                      fromMemoizedField ?? props.formatPayload(field.value)
                    );
                  });

                  return (
                    <div class="run-detail-tool-field">
                      <dt>{field.label}</dt>
                      <dd>
                        <Show
                          when={isMarkdownText()}
                          fallback={
                            <pre class="run-detail-tool-field-json">
                              {serializedPayload()}
                            </pre>
                          }
                        >
                          <MarkdownContent
                            content={markdownContent()}
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
      </Show>
    </>
  );
};

export default RunToolPart;
