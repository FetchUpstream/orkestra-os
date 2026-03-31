import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
  type JSX,
} from "solid-js";
import {
  RunChatAssistantMessage,
  RunChatComposer,
  RunChatMarkdown,
  RunChatMessage,
  RunChatSystemMessage,
  RunChatToolRail,
  RunChatTranscript,
  RunChatUserMessage,
  type RunChatToolRailItem,
} from "./chat";
import type { UiPart, UiPermissionRequest } from "../model/agentTypes";
import { useRunDetailModel } from "../model/useRunDetailModel";
import { formatDateTime } from "../../tasks/utils/taskDetail";
import { AppIcon } from "../../../components/ui/icons";
import RunInlineLoader from "../../../components/ui/RunInlineLoader";

type AgentReadinessPhase =
  | "warming_backend"
  | "creating_session"
  | "ready"
  | "reconnecting"
  | "submit_failed"
  | null;

type NewRunChatWorkspaceProps = {
  model: ReturnType<typeof useRunDetailModel>;
  hideTranscriptScrollbar?: boolean;
};

const TRANSCRIPT_WINDOW_CHUNK = 60;
const AUTO_SCROLL_NEAR_BOTTOM_PX = 96;
const INTERNAL_ID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const INTERNAL_ATTRIBUTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toSingleLine = (value: unknown, maxLength = 140): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const asText =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : null;

  if (asText === null) {
    return null;
  }

  const normalized = asText
    .replace(INTERNAL_ID_PATTERN, "[internal-id]")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`;
};

const getNestedValueByKeys = (
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
    const candidate = getNestedValueByKeys(nestedValue, keys, depth + 1);
    if (candidate !== undefined) {
      return candidate;
    }
  }

  return undefined;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => toSingleLine(item, 200))
    .filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
};

const sanitizeAttributionValue = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim();
  if (!normalized || INTERNAL_ATTRIBUTION_ID_PATTERN.test(normalized)) {
    return "";
  }
  return normalized;
};

const formatMessageAttribution = (value: {
  agent?: string;
  model?: string;
}): string => {
  const agent = sanitizeAttributionValue(value.agent);
  const model = sanitizeAttributionValue(value.model);

  if (agent && model) {
    return `${agent} - ${model}`;
  }
  if (agent) {
    return agent;
  }
  if (model) {
    return model;
  }
  return "";
};

const parsePermissionCardData = (
  permission: UiPermissionRequest,
): {
  requestId: string;
  kind: string;
  pathPatterns: string[];
  metadata: Array<{ key: string; value: string }>;
  failureMessage: string;
} => {
  const raw = isRecord(permission.raw) ? permission.raw : {};
  const metadataRecord =
    permission.metadata && isRecord(permission.metadata)
      ? permission.metadata
      : {};
  const kind =
    toSingleLine(permission.kind, 80) ||
    toSingleLine(raw.kind, 80) ||
    toSingleLine(raw.permission, 80) ||
    "unspecified";
  const pathPatternsFromState = toStringArray(permission.pathPatterns);
  const pathPatternsFromRaw = toStringArray(
    raw.pathPatterns ?? raw.paths ?? raw.patterns,
  );
  const pathPatterns =
    pathPatternsFromState.length > 0
      ? pathPatternsFromState
      : pathPatternsFromRaw;
  const metadata: Array<{ key: string; value: string }> = [
    ...Object.entries(metadataRecord)
      .map(([key, value]) => ({ key, value: toSingleLine(value, 120) || "" }))
      .filter((entry) => entry.value.length > 0),
  ];

  const metadataKeys = new Set(metadata.map((entry) => entry.key));
  const discoveredMetadataEntries: Array<{ label: string; value: unknown }> = [
    { label: "Action", value: raw.action ?? raw.operation ?? raw.op },
    {
      label: "Tool",
      value:
        raw.tool ??
        raw.toolName ??
        raw.command ??
        raw.name ??
        raw.permissionTool,
    },
    {
      label: "Reason",
      value:
        raw.reason ?? raw.description ?? raw.prompt ?? raw.message ?? raw.title,
    },
  ];

  for (const entry of discoveredMetadataEntries) {
    const key = entry.label.toLowerCase();
    if (metadataKeys.has(key)) {
      continue;
    }
    const value = toSingleLine(entry.value, 180);
    if (!value) {
      continue;
    }
    metadata.push({ key, value });
    metadataKeys.add(key);
  }

  return {
    requestId: permission.requestId,
    kind,
    pathPatterns,
    metadata,
    failureMessage:
      toSingleLine(permission.failureMessage, 140) ||
      "Permission request expired before response.",
  };
};

const toToolLabel = (toolName: string | null | undefined): string => {
  const raw = toolName?.trim();
  if (!raw) {
    return "Tool";
  }

  const leaf = raw.includes(".")
    ? (() => {
        const segments = raw.split(".");
        return segments[segments.length - 1] || raw;
      })()
    : raw;
  const normalized = leaf.replace(/[-_]+/g, " ").trim();
  if (normalized.length === 0) {
    return "Tool";
  }

  return normalized
    .split(/\s+/)
    .map(
      (segment: string) => segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join(" ");
};

const buildToolSummary = (part: UiPart): string => {
  if (part.kind !== "tool") {
    return "";
  }

  const toolName = toToolLabel(part.toolName);
  const normalizedToolName = (part.toolName || "").trim().toLowerCase();
  const input = part.input;
  const include = toSingleLine(getNestedValueByKeys(input, ["include"]), 60);

  const asPath = toSingleLine(
    getNestedValueByKeys(input, ["filePath", "path", "filename"]),
  );
  const asCommand = toSingleLine(
    getNestedValueByKeys(input, ["command", "bash", "script", "cmd"]),
  );
  const asUrl = toSingleLine(getNestedValueByKeys(input, ["url", "href"]));
  const asQuery = toSingleLine(
    getNestedValueByKeys(input, ["query", "searchQuery", "q", "keywords"]),
  );
  const asPattern = toSingleLine(
    getNestedValueByKeys(input, ["pattern", "glob"]),
  );
  const asHeader = toSingleLine(getNestedValueByKeys(input, ["header"]));

  let focused =
    toSingleLine(part.title) ||
    asCommand ||
    asUrl ||
    asPath ||
    asQuery ||
    asPattern ||
    asHeader;

  if (normalizedToolName.includes("read") && asPath) {
    focused = asPath;
  } else if (normalizedToolName.includes("bash") && asCommand) {
    focused = asCommand;
  } else if (normalizedToolName.includes("webfetch") && asUrl) {
    focused = asUrl;
  } else if (normalizedToolName.includes("websearch") && asQuery) {
    focused = asQuery;
  } else if (normalizedToolName.includes("glob") && asPattern) {
    focused = asPattern;
  } else if (normalizedToolName.includes("grep")) {
    const grepPattern = asPattern;
    if (grepPattern && include) {
      focused = `${grepPattern} in ${include}`;
    } else if (grepPattern) {
      focused = grepPattern;
    }
  } else if (normalizedToolName.includes("question") && asHeader) {
    focused = asHeader;
  } else if (normalizedToolName.includes("todowrite")) {
    const todos = getNestedValueByKeys(input, ["todos"]);
    if (Array.isArray(todos)) {
      const firstTodo = todos[0];
      const firstText = toSingleLine(
        isRecord(firstTodo)
          ? firstTodo.content || firstTodo.text || firstTodo.title
          : firstTodo,
      );
      focused =
        firstText || `${todos.length} todo${todos.length === 1 ? "" : "s"}`;
    }
  } else if (normalizedToolName.includes("apply_patch")) {
    const patchText = toSingleLine(
      getNestedValueByKeys(input, ["patchText"]),
      4000,
    );
    if (patchText) {
      const matches = patchText.match(/\*\*\*\s(?:Add|Update|Delete)\sFile:/g);
      focused =
        matches && matches.length > 0
          ? `${matches.length} file${matches.length === 1 ? "" : "s"}`
          : "patch";
    }
  } else if (normalizedToolName.includes("background_task")) {
    focused =
      toSingleLine(getNestedValueByKeys(input, ["description", "task"])) ||
      focused;
  } else if (normalizedToolName.includes("background_output")) {
    focused =
      toSingleLine(getNestedValueByKeys(input, ["task_id", "taskId"])) ||
      focused;
  } else if (normalizedToolName.includes("background_cancel")) {
    focused =
      toSingleLine(getNestedValueByKeys(input, ["task_id", "target"])) ||
      (getNestedValueByKeys(input, ["all"]) === true ? "all tasks" : focused);
  } else if (normalizedToolName.includes("lsp_")) {
    focused =
      toSingleLine(
        getNestedValueByKeys(input, ["filePath", "newName", "line"]),
      ) || focused;
  } else if (normalizedToolName.includes("ast_grep_")) {
    focused = toSingleLine(getNestedValueByKeys(input, ["pattern"])) || focused;
  }

  return `-> ${toolName}${focused ? ` ${focused}` : ""}`;
};

const NewRunChatWorkspace: Component<NewRunChatWorkspaceProps> = (props) => {
  const [composerValue, setComposerValue] = createSignal("");
  const [hasVisibleSubmitFailed, setHasVisibleSubmitFailed] =
    createSignal(false);
  const [isTranscriptAutoFollowEnabled, setIsTranscriptAutoFollowEnabled] =
    createSignal(true);
  const [transcriptVisibleCount, setTranscriptVisibleCount] = createSignal(
    TRANSCRIPT_WINDOW_CHUNK,
  );
  const [runChatComposerOffsetPx, setRunChatComposerOffsetPx] =
    createSignal("0px");
  const [overrideAgentId, setOverrideAgentId] = createSignal("");
  const [overrideProviderId, setOverrideProviderId] = createSignal("");
  const [overrideModelId, setOverrideModelId] = createSignal("");
  const [
    composerSelectionValidationError,
    setComposerSelectionValidationError,
  ] = createSignal("");

  let transcriptScrollRef: HTMLDivElement | undefined;
  let transcriptBottomRef: HTMLDivElement | undefined;
  let runChatComposerRef: HTMLDivElement | undefined;
  let transcriptScrollRaf: number | null = null;
  let transcriptProgrammaticScrollResetRaf: number | null = null;
  let isTranscriptProgrammaticScroll = false;

  const agentReadinessPhase = createMemo<AgentReadinessPhase>(() =>
    props.model.agent.readinessPhase(),
  );
  const visibleAgentReadinessPhase = createMemo<AgentReadinessPhase>(() => {
    if (hasVisibleSubmitFailed()) {
      const phase = agentReadinessPhase();
      if (phase !== "ready") {
        return "submit_failed";
      }
    }

    return agentReadinessPhase();
  });
  const agentReadinessCopy = createMemo<string | null>(() => {
    switch (visibleAgentReadinessPhase()) {
      case "warming_backend":
        return "Warming backend.";
      case "creating_session":
        return "Creating session.";
      case "ready":
        return "Ready.";
      case "reconnecting":
        return "Reconnecting stream.";
      case "submit_failed":
        return "Submit failed.";
      default:
        return null;
    }
  });
  const isComposerBlockedByReadiness = createMemo(() => {
    const phase = visibleAgentReadinessPhase();
    return (
      phase === "warming_backend" ||
      phase === "creating_session" ||
      phase === "reconnecting"
    );
  });
  const isTranscriptWaitingForAgentOutput = createMemo(() => {
    const phase = agentReadinessPhase();
    return (
      props.model.agent.state() === "starting" ||
      phase === "warming_backend" ||
      phase === "creating_session" ||
      phase === "reconnecting"
    );
  });
  const isRunCompleted = createMemo(
    () => props.model.run()?.status === "completed",
  );
  const isReadOnlyChatMode = createMemo(
    () => props.model.agent.chatMode?.() === "read_only",
  );
  const mergedSourceBranchLabel = createMemo(() => {
    const branch = props.model.run()?.sourceBranch?.trim();
    return branch && branch.length > 0 ? branch : "branch unavailable";
  });
  const runAgentOptions = createMemo(
    () => props.model.agent.runAgentOptions?.() ?? [],
  );
  const runProviderOptions = createMemo(
    () => props.model.agent.runProviderOptions?.() ?? [],
  );
  const runModelOptions = createMemo(
    () => props.model.agent.runModelOptions?.() ?? [],
  );
  const runSelectionOptionsError = createMemo(
    () => props.model.agent.runSelectionOptionsError?.() ?? "",
  );
  const projectDefaultAgentId = createMemo(
    () => props.model.agent.projectDefaultRunAgentId?.().trim() || "",
  );
  const projectDefaultProviderId = createMemo(
    () => props.model.agent.projectDefaultRunProviderId?.().trim() || "",
  );
  const projectDefaultModelId = createMemo(
    () => props.model.agent.projectDefaultRunModelId?.().trim() || "",
  );
  const runDefaultAgentId = createMemo(
    () => props.model.run()?.agentId?.trim() || projectDefaultAgentId(),
  );
  const runDefaultProviderId = createMemo(
    () => props.model.run()?.providerId?.trim() || projectDefaultProviderId(),
  );
  const runDefaultModelId = createMemo(
    () => props.model.run()?.modelId?.trim() || projectDefaultModelId(),
  );
  const hasRunSelectionOptions = createMemo(() => {
    return (
      runAgentOptions().length > 0 ||
      runProviderOptions().length > 0 ||
      runModelOptions().length > 0
    );
  });
  const inferredProviderIdFromModel = (modelId: string): string => {
    if (!modelId) {
      return "";
    }
    const selectedModel = runModelOptions().find(
      (option) => option.id === modelId,
    );
    return selectedModel?.providerId?.trim() || "";
  };
  const resolveProviderModelSelection = (preferences: {
    providerId?: string;
    modelId?: string;
  }): { providerId: string; modelId: string } => {
    const providers = runProviderOptions();
    const models = runModelOptions();
    const preferredProviderId = preferences.providerId?.trim() || "";
    const preferredModelId = preferences.modelId?.trim() || "";
    const preferredModel = preferredModelId
      ? models.find((option) => option.id === preferredModelId)
      : undefined;

    if (preferredProviderId && preferredModelId) {
      if (
        doesModelMatchProvider(preferredModelId, preferredProviderId) &&
        providers.some((option) => option.id === preferredProviderId) &&
        models.some((option) => option.id === preferredModelId)
      ) {
        return { providerId: preferredProviderId, modelId: preferredModelId };
      }
    }

    if (preferredProviderId) {
      const providerExists = providers.some(
        (option) => option.id === preferredProviderId,
      );
      if (providerExists) {
        const providerModel = models.find(
          (option) =>
            !option.providerId || option.providerId === preferredProviderId,
        );
        if (providerModel) {
          return { providerId: preferredProviderId, modelId: providerModel.id };
        }
      }
    }

    if (preferredModel && preferredModel.id) {
      const modelProviderId = preferredModel.providerId?.trim() || "";
      if (
        !modelProviderId ||
        providers.some((option) => option.id === modelProviderId)
      ) {
        return { providerId: modelProviderId, modelId: preferredModel.id };
      }
    }

    for (const provider of providers) {
      const providerModel = models.find(
        (option) => !option.providerId || option.providerId === provider.id,
      );
      if (providerModel) {
        return { providerId: provider.id, modelId: providerModel.id };
      }
    }

    const firstModel = models[0];
    if (firstModel) {
      return {
        providerId: firstModel.providerId?.trim() || "",
        modelId: firstModel.id,
      };
    }

    return { providerId: "", modelId: "" };
  };
  const selectedProviderId = createMemo(() => {
    const explicitProvider = overrideProviderId().trim();
    if (explicitProvider) {
      const exists = runProviderOptions().some(
        (option) => option.id === explicitProvider,
      );
      if (exists) {
        return explicitProvider;
      }
    }

    const explicitModelProvider = inferredProviderIdFromModel(
      overrideModelId().trim(),
    );
    if (
      explicitModelProvider &&
      runProviderOptions().some((option) => option.id === explicitModelProvider)
    ) {
      return explicitModelProvider;
    }

    const persistedProvider = runDefaultProviderId();
    if (
      persistedProvider &&
      runProviderOptions().some((option) => option.id === persistedProvider)
    ) {
      return persistedProvider;
    }

    const persistedModelProvider =
      inferredProviderIdFromModel(runDefaultModelId());
    if (
      persistedModelProvider &&
      runProviderOptions().some(
        (option) => option.id === persistedModelProvider,
      )
    ) {
      return persistedModelProvider;
    }

    return runProviderOptions()[0]?.id || "";
  });
  const effectiveProviderForModel = createMemo(() => {
    return selectedProviderId();
  });
  const visibleRunModelOptions = createMemo(() => {
    const providerId = effectiveProviderForModel();
    if (!providerId) {
      return runModelOptions();
    }
    return runModelOptions().filter(
      (option) => !option.providerId || option.providerId === providerId,
    );
  });
  const doesModelMatchProvider = (
    modelId: string,
    providerId: string,
  ): boolean => {
    if (!modelId || !providerId) {
      return true;
    }

    const selectedModel = runModelOptions().find(
      (option) => option.id === modelId,
    );
    if (!selectedModel || !selectedModel.providerId) {
      return true;
    }

    return selectedModel.providerId === providerId;
  };
  const selectedModelId = createMemo(() => {
    const explicitModelId = overrideModelId().trim();
    if (
      explicitModelId &&
      doesModelMatchProvider(explicitModelId, effectiveProviderForModel())
    ) {
      return explicitModelId;
    }

    const persistedModelId = runDefaultModelId();
    if (
      persistedModelId &&
      doesModelMatchProvider(persistedModelId, effectiveProviderForModel()) &&
      visibleRunModelOptions().some((option) => option.id === persistedModelId)
    ) {
      return persistedModelId;
    }

    return visibleRunModelOptions()[0]?.id || "";
  });
  const selectedAgentId = createMemo(() => {
    const explicitAgent = overrideAgentId().trim();
    if (
      explicitAgent &&
      runAgentOptions().some((option) => option.id === explicitAgent)
    ) {
      return explicitAgent;
    }

    const persistedAgent = runDefaultAgentId();
    if (
      persistedAgent &&
      runAgentOptions().some((option) => option.id === persistedAgent)
    ) {
      return persistedAgent;
    }

    return runAgentOptions()[0]?.id || "";
  });
  const pendingPermissionRequests = createMemo(() => {
    const state = props.model.agent.permissionState();
    return state.activeRequest ? [state.activeRequest] : [];
  });
  const queuedPermissionRequests = createMemo(() => {
    return props.model.agent.permissionState().queuedRequests;
  });
  const pendingPermissionCards = createMemo(() => {
    return pendingPermissionRequests().map((permission) =>
      parsePermissionCardData(permission),
    );
  });
  const failedPermissionCards = createMemo(() => {
    return props.model.agent
      .permissionState()
      .failedRequests.map((permission) => parsePermissionCardData(permission));
  });
  const hasPendingPermission = createMemo(
    () => pendingPermissionRequests().length > 0,
  );

  createEffect(() => {
    const pending = pendingPermissionCards();
    console.info("[runs] pending permission count changed", {
      runId: props.model.run()?.id ?? null,
      pendingCount: pending.length,
      requestIds: pending.map((card) => card.requestId),
      queuedRequestIds: queuedPermissionRequests().map(
        (item) => item.requestId,
      ),
    });
  });

  createEffect(() => {
    const pending = pendingPermissionCards();
    if (pending.length === 0) {
      return;
    }
    console.debug("[runs] rendering permission transcript items", {
      runId: props.model.run()?.id ?? null,
      pendingCount: pending.length,
      requestIds: pending.map((card) => card.requestId),
      permissionTypes: pending.map((card) => card.kind),
    });
  });
  const setupState = createMemo(() => {
    const state = props.model.run()?.setupState?.trim().toLowerCase();
    if (state === "running" || state === "succeeded" || state === "failed") {
      return state;
    }
    return "pending";
  });
  const setupMessage = createMemo(() => {
    if (setupState() === "running") return "Running setup script...";
    if (setupState() === "succeeded") return "Setup script completed.";
    if (setupState() === "failed") {
      return (
        props.model.run()?.setupErrorMessage?.trim() ||
        "Setup script failed. Please fix it before you continue."
      );
    }
    return "Setup script pending.";
  });
  const cleanupState = createMemo(() => {
    const state = props.model.run()?.cleanupState?.trim().toLowerCase();
    if (state === "running" || state === "succeeded" || state === "failed") {
      return state;
    }
    return "pending";
  });
  const cleanupMessage = createMemo(() => {
    if (cleanupState() === "running") return "Running cleanup script...";
    if (cleanupState() === "succeeded") return "Cleanup script completed.";
    if (cleanupState() === "failed") {
      return "Cleanup script failed. Please investigate.";
    }
    return "Cleanup script pending.";
  });
  const emptyTranscriptMessage = createMemo(() => {
    if (isReadOnlyChatMode()) {
      return "No chat history is available for this completed run.";
    }
    if (props.model.agent.state() === "unsupported") {
      return "Agent stream is not available for this run.";
    }
    return agentReadinessCopy() ?? "No agent messages yet.";
  });

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

  const getPartScrollRevision = (part: UiPart): string => {
    if (part.kind === "text" || part.kind === "reasoning") {
      const streamChunkCount = Array.isArray(part.streamChunks)
        ? part.streamChunks.length
        : 0;
      const streamTextLength =
        typeof part.streamTextLength === "number"
          ? part.streamTextLength
          : typeof part.streamText === "string"
            ? part.streamText.length
            : part.text.length;
      const streamRevision =
        typeof part.streamRevision === "number" ? part.streamRevision : 0;
      return `${part.kind}:${part.streaming ? 1 : 0}:${part.text.length}:${streamChunkCount}:${streamTextLength}:${streamRevision}`;
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
      const reason =
        part.reason === undefined || part.reason === null
          ? ""
          : String(part.reason).replace(INTERNAL_ID_PATTERN, "[internal-id]");
      return `${part.kind}:${reason}`;
    }

    if (part.kind === "unknown") {
      return `${part.kind}:${part.rawType || ""}`;
    }

    return "";
  };

  const transcriptMessageOrder = createMemo(
    () => props.model.agent.store().messageOrder,
  );

  const transcriptHiddenMessageCount = createMemo(() => {
    return Math.max(
      0,
      transcriptMessageOrder().length - transcriptVisibleCount(),
    );
  });

  const visibleTranscriptMessageIds = createMemo(() => {
    const order = transcriptMessageOrder();
    const startIndex = Math.max(0, order.length - transcriptVisibleCount());
    return order.slice(startIndex);
  });

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

  const resolvePartText = (part: UiPart): string => {
    if (part.kind !== "text" && part.kind !== "reasoning") {
      return "";
    }

    if (typeof part.streamText === "string") {
      return part.streamText;
    }

    const streamTail = part.streamTail;
    if (!streamTail) {
      return part.text;
    }

    const deltas: string[] = [];
    let cursor: typeof streamTail | undefined = streamTail;
    while (cursor) {
      deltas.push(cursor.delta);
      cursor = cursor.prev;
    }
    deltas.reverse();

    const baseText =
      typeof part.streamBaseText === "string" ? part.streamBaseText : part.text;
    return `${baseText}${deltas.join("")}`;
  };

  const getStepDetailsSummary = (part: UiPart): string | null => {
    if (part.kind === "step-start") {
      const snapshot = formatAgentPayload(part.snapshot).trim();
      return snapshot.length > 0 ? `Step started: ${snapshot}` : "Step started";
    }

    if (part.kind === "step-finish") {
      const fields = [
        part.reason !== undefined
          ? `reason=${formatAgentPayload(part.reason)}`
          : null,
        part.tokens !== undefined
          ? `tokens=${formatAgentPayload(part.tokens)}`
          : null,
        part.cost !== undefined
          ? `cost=${formatAgentPayload(part.cost)}`
          : null,
      ].filter((value): value is string => value !== null);
      return fields.length > 0
        ? `Step finished: ${fields.join(" | ")}`
        : "Step finished";
    }

    return null;
  };

  const buildChatRows = createMemo(() => {
    return visibleTranscriptMessageIds().map((messageId) => {
      const message = props.model.agent.store().messagesById[messageId];
      if (!message) {
        return null;
      }

      const textParts: string[] = [];
      const reasoningParts: string[] = [];
      const toolItems: RunChatToolRailItem[] = [];

      for (const partId of message.partOrder) {
        const part = message.partsById[partId];
        if (!part) {
          continue;
        }

        if (part.kind === "text") {
          const text = resolvePartText(part);
          if (text.trim().length > 0 || part.streaming) {
            textParts.push(text);
          }
          continue;
        }

        if (part.kind === "reasoning") {
          const text = resolvePartText(part);
          if (text.trim().length > 0 || part.streaming) {
            reasoningParts.push(text);
          }
          continue;
        }

        if (part.kind === "tool") {
          const summary = buildToolSummary(part);
          toolItems.push({
            id: part.id,
            label: part.title?.trim() || part.toolName || "Tool",
            summary,
            status: part.status,
          });
          continue;
        }

        if (part.kind === "patch") {
          continue;
        }

        if (part.kind === "file") {
          continue;
        }

        const stepSummary = getStepDetailsSummary(part);
        if (stepSummary) {
          continue;
        }

        if (part.kind === "unknown") {
          continue;
        }
      }

      const content = textParts.join("\n\n").trim();
      const reasoningContent = reasoningParts.join("\n\n").trim();
      const timestamp = formatAgentTimestamp(
        message.updatedAt ?? message.createdAt ?? null,
      );

      return {
        key: message.id,
        role: message.role,
        content,
        reasoningContent,
        toolItems,
        timestamp,
        attributionLabel: formatMessageAttribution(message.attribution ?? {}),
        hasRenderableContent:
          content.length > 0 ||
          reasoningContent.length > 0 ||
          toolItems.length > 0,
      };
    });
  });

  const chatTranscriptItems = createMemo<JSX.Element[]>(() => {
    const waitingRow = (
      <RunInlineLoader
        as="p"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />
    );

    const messageItems = buildChatRows()
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .map((row) => {
        const reasoningNode =
          row.reasoningContent.length > 0 ? (
            <div class="run-chat-assistant-message__reasoning-inline">
              <RunChatMarkdown
                content={`*Thinking:* ${row.reasoningContent}`}
              />
            </div>
          ) : undefined;

        const toolRailNode =
          row.toolItems.length > 0 ? (
            <RunChatToolRail items={row.toolItems} />
          ) : undefined;
        const attributionNode =
          row.attributionLabel.length > 0 ? (
            <p class="run-chat-assistant-message__attribution">
              {row.attributionLabel}
            </p>
          ) : undefined;

        if (row.role === "assistant") {
          return (
            <RunChatMessage role="assistant" class="run-chat-message-item">
              <RunChatAssistantMessage
                content={row.content.length > 0 ? row.content : " "}
                reasoning={reasoningNode}
                toolRail={toolRailNode}
                details={attributionNode}
              />
              <Show when={!row.hasRenderableContent}>{waitingRow}</Show>
            </RunChatMessage>
          );
        }

        if (row.role === "user") {
          return (
            <RunChatMessage role="user" class="run-chat-message-item">
              <RunChatUserMessage>
                <RunChatMarkdown
                  content={row.content.length > 0 ? row.content : "(empty)"}
                />
              </RunChatUserMessage>
            </RunChatMessage>
          );
        }

        return (
          <RunChatMessage role="system" class="run-chat-message-item">
            <RunChatSystemMessage>
              <RunChatMarkdown
                content={row.content.length > 0 ? row.content : row.timestamp}
              />
            </RunChatSystemMessage>
          </RunChatMessage>
        );
      });

    const pendingPermissionItems = pendingPermissionCards().map((card) => {
      return (
        <RunChatMessage
          role="assistant"
          class="run-chat-message-item"
          ariaLabel="Permission request"
        >
          <RunChatAssistantMessage
            content=" "
            toolRail={
              <section
                class="run-chat-tool-rail"
                aria-label="Permission request tool item"
              >
                <ul class="run-chat-tool-rail__list">
                  <li class="run-chat-tool-rail__item run-chat-tool-rail__item--running">
                    <div class="run-chat-tool-rail__row">
                      <span class="run-chat-tool-rail__line">
                        Permission required: {card.kind}
                      </span>
                    </div>
                    <Show
                      when={card.pathPatterns.length > 0}
                      fallback={
                        <p class="run-chat-tool-rail__details">
                          <strong>Paths:</strong> Any path
                        </p>
                      }
                    >
                      <div class="run-chat-tool-rail__details">
                        <strong>Paths:</strong>
                        <ul class="list-disc pl-5">
                          <For each={card.pathPatterns}>
                            {(pattern) => <li>{pattern}</li>}
                          </For>
                        </ul>
                      </div>
                    </Show>
                    <Show when={card.metadata.length > 0}>
                      <div class="run-chat-tool-rail__details">
                        <strong>Details:</strong>
                        <ul class="list-disc pl-5">
                          <For each={card.metadata}>
                            {(entry) => (
                              <li>
                                {entry.key}: {entry.value}
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    </Show>
                    <Show when={queuedPermissionRequests().length > 0}>
                      <p class="run-chat-tool-rail__details">
                        {queuedPermissionRequests().length} more permission
                        request
                        {queuedPermissionRequests().length === 1 ? "" : "s"}{" "}
                        queued. They will appear after this one is resolved.
                      </p>
                    </Show>
                    <Show
                      when={props.model.agent.permissionReplyError().length > 0}
                    >
                      <p class="projects-error">
                        {props.model.agent.permissionReplyError()}
                      </p>
                    </Show>
                    <div class="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                        disabled={props.model.agent.isReplyingPermission()}
                        onClick={() => {
                          console.info("[runs] permission decision clicked", {
                            runId: props.model.run()?.id ?? null,
                            requestId: card.requestId,
                            decision: "deny",
                            pendingCount: pendingPermissionCards().length,
                          });
                          void props.model.agent.replyPermission(
                            card.requestId,
                            "deny",
                          );
                        }}
                      >
                        {props.model.agent.isReplyingPermission()
                          ? "Sending..."
                          : "Deny"}
                      </button>
                      <button
                        type="button"
                        class="btn btn-sm border-base-content/15 bg-base-100 text-base-content hover:bg-base-100 rounded-none border px-4 text-xs font-medium"
                        disabled={props.model.agent.isReplyingPermission()}
                        onClick={() => {
                          console.info("[runs] permission decision clicked", {
                            runId: props.model.run()?.id ?? null,
                            requestId: card.requestId,
                            decision: "once",
                            pendingCount: pendingPermissionCards().length,
                          });
                          void props.model.agent.replyPermission(
                            card.requestId,
                            "once",
                          );
                        }}
                      >
                        {props.model.agent.isReplyingPermission()
                          ? "Sending..."
                          : "Allow once"}
                      </button>
                      <button
                        type="button"
                        class="btn btn-sm border-primary/40 bg-primary text-primary-content hover:bg-primary rounded-none border px-4 text-xs font-semibold"
                        disabled={props.model.agent.isReplyingPermission()}
                        onClick={() => {
                          console.info("[runs] permission decision clicked", {
                            runId: props.model.run()?.id ?? null,
                            requestId: card.requestId,
                            decision: "always",
                            pendingCount: pendingPermissionCards().length,
                          });
                          void props.model.agent.replyPermission(
                            card.requestId,
                            "always",
                          );
                        }}
                      >
                        {props.model.agent.isReplyingPermission()
                          ? "Sending..."
                          : "Allow"}
                      </button>
                    </div>
                  </li>
                </ul>
              </section>
            }
          />
        </RunChatMessage>
      );
    });

    const failedPermissionItems = failedPermissionCards().map((card) => {
      return (
        <RunChatMessage role="assistant">
          <section
            class="run-chat-tool-rail"
            aria-label="Permission request failed tool item"
          >
            <ul class="run-chat-tool-rail__list">
              <li class="run-chat-tool-rail__item run-chat-tool-rail__item--failed">
                <div class="run-chat-tool-rail__row">
                  <span class="run-chat-tool-rail__line">
                    Permission required: {card.kind}
                  </span>
                  <span class="run-chat-tool-rail__status">
                    <span
                      class="run-chat-tool-rail__status-slot"
                      aria-label="failed"
                    >
                      <AppIcon
                        name="status.error"
                        class="run-chat-tool-rail__status-icon run-chat-tool-rail__status-icon--error"
                        aria-hidden="true"
                        size={14}
                      />
                      <span class="sr-only">failed</span>
                    </span>
                  </span>
                </div>
                <p class="run-chat-tool-rail__details">{card.failureMessage}</p>
                <Show
                  when={card.pathPatterns.length > 0}
                  fallback={
                    <p class="run-chat-tool-rail__details">
                      <strong>Paths:</strong> Any path
                    </p>
                  }
                >
                  <div class="run-chat-tool-rail__details">
                    <strong>Paths:</strong>
                    <ul class="list-disc pl-5">
                      <For each={card.pathPatterns}>
                        {(pattern) => <li>{pattern}</li>}
                      </For>
                    </ul>
                  </div>
                </Show>
              </li>
            </ul>
          </section>
        </RunChatMessage>
      );
    });

    return [
      ...messageItems,
      ...pendingPermissionItems,
      ...failedPermissionItems,
    ];
  });

  createEffect(() => {
    if (transcriptMessageOrder().length === 0) {
      setTranscriptVisibleCount(TRANSCRIPT_WINDOW_CHUNK);
    }
  });

  const transcriptScrollRevision = createMemo(() => {
    const store = props.model.agent.store();
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

  createEffect(() => {
    const phase = agentReadinessPhase();
    if (phase === "submit_failed") {
      setHasVisibleSubmitFailed(true);
      return;
    }

    if (phase === "ready") {
      setHasVisibleSubmitFailed(false);
    }
  });

  createEffect(() => {
    const modelId = overrideModelId().trim();
    if (!modelId) {
      return;
    }

    const providerId = effectiveProviderForModel();
    if (!doesModelMatchProvider(modelId, providerId)) {
      setOverrideModelId("");
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
    const composerElement = runChatComposerRef;
    if (!composerElement || typeof ResizeObserver === "undefined") {
      setRunChatComposerOffsetPx("0px");
      return;
    }

    const updateOffset = () => {
      const composerHeight = Math.ceil(
        composerElement.getBoundingClientRect().height,
      );
      setRunChatComposerOffsetPx(`${Math.max(0, composerHeight)}px`);
      if (isTranscriptAutoFollowEnabled()) {
        scheduleTranscriptScrollToBottom();
      }
    };

    updateOffset();
    const observer = new ResizeObserver(() => updateOffset());
    observer.observe(composerElement);

    onCleanup(() => {
      observer.disconnect();
    });
  });

  onCleanup(() => {
    if (transcriptScrollRaf !== null) {
      cancelAnimationFrame(transcriptScrollRaf);
    }
    if (transcriptProgrammaticScrollResetRaf !== null) {
      cancelAnimationFrame(transcriptProgrammaticScrollResetRaf);
    }
  });

  return (
    <section
      class="run-detail-workspace run-chat-only-workspace"
      aria-label="Run chat workspace"
    >
      <section
        class="run-chat-workspace"
        style={{
          "--run-chat-composer-offset": runChatComposerOffsetPx(),
        }}
      >
        <section
          classList={{
            "run-chat-transcript-scroll": true,
            "run-chat-transcript-scroll--scrollbar-hidden":
              props.hideTranscriptScrollbar === true,
          }}
          aria-label="Conversation transcript"
          ref={transcriptScrollRef}
          style={{
            "padding-bottom": runChatComposerOffsetPx(),
          }}
          onScroll={(event) => {
            if (isTranscriptProgrammaticScroll) {
              return;
            }
            setIsTranscriptAutoFollowEnabled(isNearBottom(event.currentTarget));
          }}
        >
          <Show when={props.model.agent.error().length > 0}>
            <p class="projects-error">{props.model.agent.error()}</p>
          </Show>
          <section
            class="run-setup-status-box"
            data-state={setupState()}
            aria-live="polite"
          >
            <strong>Setup</strong>
            <p>{setupMessage()}</p>
          </section>
          <Show when={cleanupState() !== "pending"}>
            <section
              class="run-cleanup-status-box"
              data-state={cleanupState()}
              aria-live="polite"
            >
              <strong>Cleanup</strong>
              <p>{cleanupMessage()}</p>
            </section>
          </Show>
          <Show
            when={chatTranscriptItems().length > 0}
            fallback={
              <section
                class="run-chat-transcript run-chat-transcript--empty-state"
                aria-label="Chat transcript"
              >
                <Show
                  when={
                    !isReadOnlyChatMode() && isTranscriptWaitingForAgentOutput()
                  }
                  fallback={
                    <p class="project-placeholder-text">
                      {emptyTranscriptMessage()}
                    </p>
                  }
                >
                  <RunInlineLoader
                    as="p"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  />
                </Show>
              </section>
            }
          >
            <RunChatTranscript
              class="run-chat-transcript"
              items={chatTranscriptItems()}
              olderAffordance={
                <Show when={transcriptHiddenMessageCount() > 0}>
                  <button
                    type="button"
                    class="run-detail-load-older-button run-chat-load-older"
                    onClick={() => {
                      const container = transcriptScrollRef;
                      const previousScrollHeight =
                        container?.scrollHeight ?? null;
                      setTranscriptVisibleCount(
                        (current) => current + TRANSCRIPT_WINDOW_CHUNK,
                      );
                      if (!container || previousScrollHeight === null) {
                        return;
                      }

                      requestAnimationFrame(() => {
                        const nextScrollHeight = container.scrollHeight;
                        const offset = nextScrollHeight - previousScrollHeight;
                        if (offset > 0) {
                          markTranscriptProgrammaticScroll();
                          container.scrollTop += offset;
                        }
                      });
                    }}
                  >
                    {`Load older (${transcriptHiddenMessageCount()} hidden)`}
                  </button>
                </Show>
              }
            />
            <div ref={transcriptBottomRef} aria-hidden="true" />
          </Show>
        </section>
        <div
          ref={runChatComposerRef}
          class="run-chat-composer-shell run-chat-composer-shell--pinned"
        >
          <Show
            when={!isRunCompleted()}
            fallback={
              <section
                class="run-chat-composer run-chat-composer--readonly"
                role="status"
                aria-live="polite"
              >
                <p class="project-placeholder-text">
                  {`Work completed and merged into ${mergedSourceBranchLabel()}. You can review the chat, but it can’t be edited.`}
                </p>
              </section>
            }
          >
            <RunChatComposer
              class="run-chat-composer"
              value={composerValue()}
              onInput={setComposerValue}
              onSubmit={(value) => {
                void (async () => {
                  const agentId = selectedAgentId();
                  const providerId = selectedProviderId();
                  const modelId = selectedModelId();
                  const hasValidSelection =
                    !!agentId &&
                    !!providerId &&
                    !!modelId &&
                    doesModelMatchProvider(modelId, providerId);

                  if (!hasValidSelection) {
                    setComposerSelectionValidationError(
                      "Select a valid agent, provider, and model before sending.",
                    );
                    return;
                  }

                  setComposerSelectionValidationError("");
                  const success = await props.model.agent.submitPrompt(value, {
                    agentId,
                    providerId,
                    modelId,
                  });
                  if (success) {
                    setComposerValue("");
                  }
                })();
              }}
              disabled={
                hasPendingPermission() ||
                isComposerBlockedByReadiness() ||
                props.model.agent.state() === "unsupported" ||
                props.model.agent.isReplyingPermission()
              }
              submitting={props.model.agent.isSubmittingPrompt()}
              placeholder="What do you want to do?"
              textareaLabel="Message agent"
              submitLabel="Send"
            />
          </Show>
          <Show when={!isRunCompleted() && hasRunSelectionOptions()}>
            <div class="run-chat-override-grid mt-2 gap-2">
              <label class="projects-field run-chat-override-field">
                <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                  <span class="field-label-text">Provider</span>
                </span>
                <select
                  class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
                  value={selectedProviderId()}
                  onChange={(event) => {
                    const nextProviderId = event.currentTarget.value;
                    setOverrideProviderId(nextProviderId);
                    setComposerSelectionValidationError("");
                    const currentModelId = selectedModelId();
                    if (
                      currentModelId &&
                      !doesModelMatchProvider(currentModelId, nextProviderId)
                    ) {
                      setOverrideModelId("");
                    }
                  }}
                  aria-label="Prompt override provider"
                >
                  <For each={runProviderOptions()}>
                    {(option: { id: string; label: string }) => (
                      <option value={option.id}>{option.label}</option>
                    )}
                  </For>
                </select>
              </label>
              <label class="projects-field run-chat-override-field">
                <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                  <span class="field-label-text">Model</span>
                </span>
                <select
                  class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
                  value={selectedModelId()}
                  onChange={(event) => {
                    const selectedModelId = event.currentTarget.value;
                    setOverrideModelId(selectedModelId);
                    setComposerSelectionValidationError("");

                    if (!selectedModelId) {
                      return;
                    }

                    const selectedModel = runModelOptions().find(
                      (option) => option.id === selectedModelId,
                    );
                    const selectedProviderId =
                      selectedModel?.providerId?.trim();
                    if (selectedProviderId) {
                      setOverrideProviderId(selectedProviderId);
                    }
                  }}
                  aria-label="Prompt override model"
                >
                  <For each={visibleRunModelOptions()}>
                    {(option: { id: string; label: string }) => (
                      <option value={option.id}>{option.label}</option>
                    )}
                  </For>
                </select>
              </label>
              <label class="projects-field run-chat-override-field">
                <span class="field-label text-base-content/55 text-[11px] tracking-[0.18em] uppercase">
                  <span class="field-label-text">Agent</span>
                </span>
                <select
                  class="select select-sm border-base-content/15 bg-base-100 text-base-content h-9 min-h-9 rounded-none px-3 text-xs font-medium"
                  value={selectedAgentId()}
                  onChange={(event) => {
                    const nextAgentId = event.currentTarget.value;
                    setOverrideAgentId(nextAgentId);
                    setComposerSelectionValidationError("");

                    const resolvedFromProject = resolveProviderModelSelection({
                      providerId: projectDefaultProviderId(),
                      modelId: projectDefaultModelId(),
                    });
                    const resolved =
                      resolvedFromProject.providerId &&
                      resolvedFromProject.modelId
                        ? resolvedFromProject
                        : resolveProviderModelSelection({
                            providerId: runDefaultProviderId(),
                            modelId: runDefaultModelId(),
                          });

                    setOverrideProviderId(resolved.providerId);
                    setOverrideModelId(resolved.modelId);
                  }}
                  aria-label="Prompt override agent"
                >
                  <For each={runAgentOptions()}>
                    {(option: { id: string; label: string }) => (
                      <option value={option.id}>{option.label}</option>
                    )}
                  </For>
                </select>
              </label>
            </div>
          </Show>
          <Show
            when={!isRunCompleted() && runSelectionOptionsError().length > 0}
          >
            <p class="project-placeholder-text" aria-live="polite">
              {runSelectionOptionsError()}
            </p>
          </Show>
          <Show
            when={
              !isRunCompleted() && composerSelectionValidationError().length > 0
            }
          >
            <p class="projects-error" aria-live="polite">
              {composerSelectionValidationError()}
            </p>
          </Show>
          <Show when={hasPendingPermission()}>
            <p class="project-placeholder-text" aria-live="polite">
              Prompt submission is blocked until this permission is answered.
            </p>
          </Show>
          <Show
            when={
              !hasPendingPermission() &&
              props.model.agent.permissionReplyError().length > 0
            }
          >
            <p class="projects-error">
              {props.model.agent.permissionReplyError()}
            </p>
          </Show>
          <Show when={props.model.agent.submitError().length > 0}>
            <p class="projects-error">{props.model.agent.submitError()}</p>
          </Show>
        </div>
      </section>
    </section>
  );
};

export default NewRunChatWorkspace;
