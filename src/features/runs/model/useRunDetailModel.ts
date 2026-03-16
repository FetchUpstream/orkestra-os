import { useParams } from "@solidjs/router";
import { listen } from "@tauri-apps/api/event";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  ensureRunOpenCode,
  getBufferedRunOpenCodeEvents,
  getRunOpenCodeSessionMessages,
  getRunOpenCodeSessionTodos,
  getRun,
  getRunDiffFile,
  killRunTerminal,
  listRunDiffFiles,
  openRunTerminal,
  resizeRunTerminal,
  setRunDiffWatch,
  submitRunOpenCodePrompt,
  subscribeRunOpenCodeEvents,
  type EnsureRunOpenCodeResult,
  type Run,
  type RunDiffFile,
  type RunDiffFilePayload,
  type RunOpenCodeAgentState,
  type RunOpenCodeEvent,
  type RunTerminalFrame,
  writeRunTerminal,
} from "../../../app/lib/runs";
import { getTask, type Task } from "../../../app/lib/tasks";
import {
  createEmptyAgentStore,
  hydrateAgentStore,
  reduceOpenCodeEvent,
} from "./agentReducer";
import type { AgentStore, OpenCodeBusEvent } from "./agentTypes";

export const useRunDetailModel = () => {
  const params = useParams();
  const [run, setRun] = createSignal<Run | null>(null);
  const [task, setTask] = createSignal<Task | null>(null);
  const [isDiffTabActive, setIsDiffTabActive] = createSignal(false);
  const [diffFiles, setDiffFiles] = createSignal<RunDiffFile[]>([]);
  const [isDiffFilesLoading, setIsDiffFilesLoading] = createSignal(false);
  const [diffFilesError, setDiffFilesError] = createSignal("");
  const [diffFilePayloads, setDiffFilePayloads] = createSignal<
    Record<string, RunDiffFilePayload>
  >({});
  const [diffFileLoadingPaths, setDiffFileLoadingPaths] = createSignal<
    Record<string, boolean>
  >({});
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [terminalSessionId, setTerminalSessionId] = createSignal<string | null>(
    null,
  );
  const [terminalGeneration, setTerminalGeneration] = createSignal<
    number | null
  >(null);
  const [isTerminalStarting, setIsTerminalStarting] = createSignal(false);
  const [isTerminalReady, setIsTerminalReady] = createSignal(false);
  const [terminalError, setTerminalError] = createSignal("");
  const [agentState, setAgentState] =
    createSignal<RunOpenCodeAgentState>("idle");
  const [agentEvents, setAgentEvents] = createSignal<RunOpenCodeEvent[]>([]);
  const [agentStore, setAgentStore] = createSignal<AgentStore>(
    createEmptyAgentStore(null),
  );
  const [agentError, setAgentError] = createSignal("");
  const [isSubmittingPrompt, setIsSubmittingPrompt] = createSignal(false);
  const [submitError, setSubmitError] = createSignal("");
  let activeRunRequestVersion = 0;
  let activeDiffRefreshVersion = 0;
  let diffRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeTerminalRequestVersion = 0;
  let activeAgentRequestVersion = 0;
  let activeAgentSubscriptionVersion = 0;
  let activePromptSubmitVersion = 0;
  let isAgentUiSubscribed = false;
  let removeAgentEventForwarder: (() => void) | null = null;
  let terminalRunId: string | null = null;
  let terminalRouteInstanceId = crypto.randomUUID();
  let terminalFrameHandler: ((frame: RunTerminalFrame) => void) | null = null;

  const areDiffFilesEqual = (
    current: RunDiffFile[],
    next: RunDiffFile[],
  ): boolean => {
    if (current.length !== next.length) return false;

    for (let index = 0; index < current.length; index += 1) {
      const currentFile = current[index];
      const nextFile = next[index];
      if (
        currentFile.path !== nextFile.path ||
        currentFile.additions !== nextFile.additions ||
        currentFile.deletions !== nextFile.deletions ||
        currentFile.status !== nextFile.status
      ) {
        return false;
      }
    }

    return true;
  };

  const hasSameDiffFileMetadata = (
    current: RunDiffFile,
    next: RunDiffFile,
  ): boolean => {
    return (
      current.path === next.path &&
      current.additions === next.additions &&
      current.deletions === next.deletions &&
      current.status === next.status
    );
  };

  const isNotFoundError = (value: unknown): boolean => {
    if (value instanceof Error) {
      return value.message.toLowerCase().includes("not found");
    }

    if (typeof value === "string") {
      return value.toLowerCase().includes("not found");
    }

    if (!value || typeof value !== "object") {
      return false;
    }

    const maybeMessage = (value as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return maybeMessage.toLowerCase().includes("not found");
    }

    return false;
  };

  const isAgentUnsupportedError = (value: unknown): boolean => {
    if (value instanceof Error) {
      const message = value.message.toLowerCase();
      return (
        message.includes("unsupported") ||
        message.includes("not implemented") ||
        message.includes("not available")
      );
    }

    if (typeof value === "string") {
      const message = value.toLowerCase();
      return (
        message.includes("unsupported") ||
        message.includes("not implemented") ||
        message.includes("not available")
      );
    }

    if (!value || typeof value !== "object") {
      return false;
    }

    const maybeMessage = (value as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      const message = maybeMessage.toLowerCase();
      return (
        message.includes("unsupported") ||
        message.includes("not implemented") ||
        message.includes("not available")
      );
    }

    return false;
  };

  const getErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
      return value.message.trim();
    }

    if (typeof value === "string") {
      return value.trim();
    }

    if (!value || typeof value !== "object") {
      return "";
    }

    const maybeMessage = (value as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return maybeMessage.trim();
    }

    return "";
  };

  const normalizeEnsureAgentState = (
    result: EnsureRunOpenCodeResult,
  ): RunOpenCodeAgentState => {
    if (result.state === "unsupported") return "unsupported";
    if (result.state === "error") return "error";
    if (result.state === "running") return "running";
    if (result.state === "starting") return "starting";
    if (result.state === "idle") return "idle";
    if (result.supported === false) return "unsupported";
    return "running";
  };

  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  };

  const parseMaybeJson = (value: unknown): unknown => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    let current: unknown = trimmed;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (typeof current !== "string") {
        return current;
      }

      const candidate = current.trim();
      if (!candidate) {
        return null;
      }

      try {
        const parsed = JSON.parse(candidate);
        current = parsed;

        if (typeof parsed !== "string") {
          return parsed;
        }

        const nestedCandidate = parsed.trim();
        const looksJsonish =
          nestedCandidate.startsWith("{") ||
          nestedCandidate.startsWith("[") ||
          nestedCandidate.startsWith('"');
        if (!looksJsonish) {
          return parsed;
        }
      } catch {
        return attempt === 0 ? value : current;
      }
    }

    return current;
  };

  const preserveIdentifierFields = (
    source: Record<string, unknown>,
    target: Record<string, unknown>,
  ): Record<string, unknown> => {
    const identifierKeys = [
      "sessionID",
      "sessionId",
      "messageID",
      "messageId",
      "partID",
      "partId",
      "id",
    ] as const;

    let changed = false;
    const merged: Record<string, unknown> = { ...target };
    for (const key of identifierKeys) {
      if (merged[key] !== undefined || source[key] === undefined) {
        continue;
      }
      merged[key] = source[key];
      changed = true;
    }

    return changed ? merged : target;
  };

  const normalizePayloadRecord = (
    payload: Record<string, unknown>,
  ): Record<string, unknown> => {
    const normalized: Record<string, unknown> = { ...payload };

    const parsedProperties = parseMaybeJson(normalized.properties);
    if (isRecord(parsedProperties)) {
      normalized.properties = parsedProperties;
    }

    const parsedPart = parseMaybeJson(normalized.part);
    if (isRecord(parsedPart)) {
      normalized.part = parsedPart;
    }

    if (isRecord(normalized.properties)) {
      const properties = { ...normalized.properties };
      const propertiesPart = parseMaybeJson(properties.part);
      if (isRecord(propertiesPart)) {
        properties.part = propertiesPart;
      }
      normalized.properties = properties;
    }

    return normalized;
  };

  const resolveBusEventPayload = (
    eventName: string,
    value: unknown,
  ): { busType: string; busProperties: unknown } => {
    const parsed = parseMaybeJson(value);
    const genericEventName = eventName === "message" || eventName === "unknown";

    if (!isRecord(parsed)) {
      return {
        busType: eventName,
        busProperties: parsed,
      };
    }

    const normalized = normalizePayloadRecord(parsed);

    const nested = normalized.properties;
    const busProperties = isRecord(nested)
      ? preserveIdentifierFields(normalized, nested)
      : normalized;
    const payloadType =
      typeof normalized.type === "string" ? normalized.type.trim() : "";
    const busType = genericEventName && payloadType ? payloadType : eventName;

    return {
      busType,
      busProperties,
    };
  };

  const toOpenCodeBusEvent = (event: RunOpenCodeEvent): OpenCodeBusEvent => {
    const { busType, busProperties } = resolveBusEventPayload(
      event.event,
      event.data,
    );

    return {
      type: busType,
      properties: busProperties,
      ts: event.ts,
      raw: event,
    };
  };

  const extractSessionIdFromMessages = (messages: unknown[]): string | null => {
    for (const item of messages) {
      if (!isRecord(item)) {
        continue;
      }

      const info = isRecord(item.info)
        ? item.info
        : (item as Record<string, unknown>);
      const sessionId = info.sessionID ?? info.sessionId;
      if (typeof sessionId === "string" && sessionId.trim()) {
        return sessionId.trim();
      }
    }
    return null;
  };

  const extractSessionIdFromTodos = (todos: unknown[]): string | null => {
    for (const item of todos) {
      if (!isRecord(item)) {
        continue;
      }
      const sessionId = item.sessionID ?? item.sessionId;
      if (typeof sessionId === "string" && sessionId.trim()) {
        return sessionId.trim();
      }
    }
    return null;
  };

  const extractSessionIdFromEvents = (
    events: RunOpenCodeEvent[],
  ): string | null => {
    for (const item of events) {
      const parsed = resolveBusEventPayload(
        item.event,
        item.data,
      ).busProperties;
      if (!isRecord(parsed)) {
        continue;
      }

      const part = isRecord(parsed.part) ? parsed.part : null;
      const sessionId =
        (typeof parsed.sessionID === "string" ? parsed.sessionID : null) ||
        (typeof parsed.sessionId === "string" ? parsed.sessionId : null) ||
        (part && typeof part.sessionID === "string" ? part.sessionID : null) ||
        (part && typeof part.sessionId === "string" ? part.sessionId : null);

      if (sessionId && sessionId.trim()) {
        return sessionId.trim();
      }
    }
    return null;
  };

  const hydrateAgentSnapshot = async (
    runId: string,
    requestVersion: number,
    baseEvents: RunOpenCodeEvent[] = [],
  ): Promise<void> => {
    const [messagesSnapshot, todosSnapshot] = await Promise.all([
      getRunOpenCodeSessionMessages(runId),
      getRunOpenCodeSessionTodos(runId),
    ]);

    if (
      requestVersion !== activeAgentRequestVersion ||
      params.runId !== runId
    ) {
      return;
    }

    const sessionId =
      extractSessionIdFromMessages(messagesSnapshot.messages) ||
      extractSessionIdFromTodos(todosSnapshot.todos) ||
      extractSessionIdFromEvents(baseEvents) ||
      agentStore().sessionId;

    setAgentStore((current) => {
      const hydrated = hydrateAgentStore({
        sessionId,
        messages: messagesSnapshot.messages,
        todos: todosSnapshot.todos,
      });

      const replayEvents: OpenCodeBusEvent[] =
        baseEvents.length > 0
          ? baseEvents.map(toOpenCodeBusEvent)
          : current.rawEvents;

      return replayEvents.reduce((nextState, item) => {
        return reduceOpenCodeEvent(nextState, item);
      }, hydrated);
    });
  };

  const taskHref = createMemo(() => {
    const taskValue = task();
    const runId = params.runId;
    if (!taskValue) return "";
    const originSearch = runId
      ? `?origin=run&runId=${encodeURIComponent(runId)}`
      : "";
    if (taskValue.projectId) {
      return `/projects/${taskValue.projectId}/tasks/${taskValue.id}${originSearch}`;
    }
    return `/tasks/${taskValue.id}${originSearch}`;
  });

  const backHref = createMemo(() => {
    const taskValue = task();
    if (taskValue?.id) {
      if (taskValue.projectId) {
        return `/projects/${taskValue.projectId}/tasks/${taskValue.id}`;
      }
      return `/tasks/${taskValue.id}`;
    }

    const runValue = run();
    if (runValue?.taskId) {
      if (runValue.projectId) {
        return `/projects/${runValue.projectId}/tasks/${runValue.taskId}`;
      }
      return `/tasks/${runValue.taskId}`;
    }

    return "/projects";
  });

  const backLabel = createMemo(() => {
    return backHref() === "/projects" ? "projects" : "task";
  });

  const runLabel = createMemo(() => {
    const runValue = run();
    if (!runValue) return "Current run";

    const displayKey = runValue.displayKey?.trim();
    if (displayKey) return displayKey;

    if (
      typeof runValue.runNumber === "number" &&
      Number.isFinite(runValue.runNumber)
    ) {
      return `Run #${runValue.runNumber}`;
    }

    const match = runValue.id.match(/(?:^|[^0-9])(\d+)(?:[^0-9]|$)/);
    if (match?.[1]) {
      return `Run #${match[1]}`;
    }

    return "Current run";
  });

  const repositorySummary = createMemo(() => {
    const taskValue = task();
    const runValue = run();
    const repository =
      taskValue?.targetRepositoryName?.trim() || "Repository unavailable";
    const branch = runValue?.sourceBranch?.trim() || "branch unavailable";
    const worktree = runValue?.worktreeId?.trim() || "worktree unavailable";
    return `${repository} / ${branch} / ${worktree}`;
  });

  const durationLabel = createMemo(() => {
    const runValue = run();
    if (!runValue?.startedAt) return "Not started";

    const started = Date.parse(runValue.startedAt);
    const finished = runValue.finishedAt
      ? Date.parse(runValue.finishedAt)
      : Date.now();
    if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) {
      return "Unavailable";
    }

    const totalSeconds = Math.floor((finished - started) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hours = Math.floor(minutes / 60);
    const minutePart = minutes % 60;

    if (hours > 0) {
      return `${hours}h ${minutePart}m`;
    }

    return `${minutes}m ${seconds}s`;
  });

  createEffect(() => {
    const runId = params.runId;
    const requestVersion = ++activeRunRequestVersion;
    if (!runId) {
      setError("Missing run ID.");
      setIsLoading(false);
      setRun(null);
      setTask(null);
      return;
    }

    void (async () => {
      setIsLoading(true);
      setError("");
      setRun(null);
      setTask(null);
      try {
        const loadedRun = await getRun(runId);
        if (
          requestVersion !== activeRunRequestVersion ||
          params.runId !== runId
        ) {
          return;
        }
        setRun(loadedRun);
        try {
          const loadedTask = await getTask(loadedRun.taskId);
          if (
            requestVersion !== activeRunRequestVersion ||
            params.runId !== runId
          ) {
            return;
          }
          setTask(loadedTask);
        } catch {
          if (
            requestVersion !== activeRunRequestVersion ||
            params.runId !== runId
          ) {
            return;
          }
          setTask(null);
        }
      } catch (loadError) {
        if (
          requestVersion !== activeRunRequestVersion ||
          params.runId !== runId
        ) {
          return;
        }
        if (isNotFoundError(loadError)) {
          setError("");
          setRun(null);
          setTask(null);
          return;
        }
        setError("Failed to load run details.");
      } finally {
        if (requestVersion === activeRunRequestVersion) {
          setIsLoading(false);
        }
      }
    })();
  });

  const ensureAgentForRun = async (runId: string): Promise<void> => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      setAgentState("error");
      setAgentError("Missing run.");
      return;
    }

    const requestVersion = activeAgentRequestVersion;
    setAgentState("starting");
    setAgentError("");

    try {
      const result = await ensureRunOpenCode(normalizedRunId);
      if (
        requestVersion !== activeAgentRequestVersion ||
        params.runId !== normalizedRunId
      ) {
        return;
      }

      const nextState = normalizeEnsureAgentState(result);
      setAgentState(nextState);

      const backendError = result.error?.trim();
      if (nextState === "error") {
        setAgentError(backendError || "Failed to initialize agent stream.");
        return;
      }

      await hydrateAgentSnapshot(normalizedRunId, requestVersion);
      if (
        requestVersion !== activeAgentRequestVersion ||
        params.runId !== normalizedRunId
      ) {
        return;
      }

      setAgentError("");
    } catch (ensureError) {
      if (
        requestVersion !== activeAgentRequestVersion ||
        params.runId !== normalizedRunId
      ) {
        return;
      }

      if (isAgentUnsupportedError(ensureError)) {
        setAgentState("unsupported");
        setAgentError("");
        return;
      }

      setAgentState("error");
      const backendError = getErrorMessage(ensureError);
      setAgentError(backendError || "Failed to initialize agent stream.");
    }
  };

  const unsubscribeAgentEvents = (): void => {
    isAgentUiSubscribed = false;
    activeAgentSubscriptionVersion += 1;
    if (removeAgentEventForwarder) {
      removeAgentEventForwarder();
      removeAgentEventForwarder = null;
    }
  };

  const subscribeAgentEvents = async (runId: string): Promise<void> => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return;
    }

    if (agentState() === "unsupported" || agentState() === "error") {
      return;
    }

    const requestVersion = activeAgentRequestVersion;
    const subscriptionVersion = ++activeAgentSubscriptionVersion;
    if (removeAgentEventForwarder) {
      removeAgentEventForwarder();
      removeAgentEventForwarder = null;
    }
    setAgentState("running");
    setAgentError("");

    try {
      const bufferedEvents =
        await getBufferedRunOpenCodeEvents(normalizedRunId);
      if (
        requestVersion !== activeAgentRequestVersion ||
        subscriptionVersion !== activeAgentSubscriptionVersion ||
        !isAgentUiSubscribed ||
        params.runId !== normalizedRunId
      ) {
        return;
      }
      setAgentEvents(bufferedEvents);
      setAgentStore((current) => {
        return bufferedEvents.reduce((nextState, event) => {
          return reduceOpenCodeEvent(nextState, toOpenCodeBusEvent(event));
        }, current);
      });
    } catch (submitError) {
      if (
        requestVersion !== activeAgentRequestVersion ||
        subscriptionVersion !== activeAgentSubscriptionVersion ||
        params.runId !== normalizedRunId
      ) {
        return;
      }
      setAgentState("error");
      setAgentError("Failed to load buffered agent events.");
      return;
    }

    try {
      const removeForwarder = await subscribeRunOpenCodeEvents({
        runId: normalizedRunId,
        onOutputChannel: (event) => {
          if (
            requestVersion !== activeAgentRequestVersion ||
            subscriptionVersion !== activeAgentSubscriptionVersion ||
            !isAgentUiSubscribed ||
            params.runId !== normalizedRunId
          ) {
            return;
          }

          setAgentEvents((current) => [...current, event]);
          const busEvent = toOpenCodeBusEvent(event);
          setAgentStore((current) => reduceOpenCodeEvent(current, busEvent));

          if (busEvent.type === "server.connected") {
            void hydrateAgentSnapshot(normalizedRunId, requestVersion);
          }
        },
      });

      if (
        requestVersion !== activeAgentRequestVersion ||
        subscriptionVersion !== activeAgentSubscriptionVersion ||
        !isAgentUiSubscribed ||
        params.runId !== normalizedRunId
      ) {
        removeForwarder();
        return;
      }

      removeAgentEventForwarder = removeForwarder;
      setAgentState("running");
    } catch {
      if (
        requestVersion !== activeAgentRequestVersion ||
        subscriptionVersion !== activeAgentSubscriptionVersion ||
        params.runId !== normalizedRunId
      ) {
        return;
      }

      setAgentState("error");
      setAgentError("Failed to subscribe to agent events.");
    }
  };

  const submitPrompt = async (text: string): Promise<boolean> => {
    const prompt = text.trim();
    if (!prompt) {
      return false;
    }

    const runId = params.runId?.trim() ?? "";
    if (!runId) {
      setSubmitError("Missing run.");
      return false;
    }

    const requestVersion = activeAgentRequestVersion;
    const submitVersion = ++activePromptSubmitVersion;
    setIsSubmittingPrompt(true);

    try {
      const response = await submitRunOpenCodePrompt({
        runId,
        prompt,
      });

      if (
        requestVersion !== activeAgentRequestVersion ||
        submitVersion !== activePromptSubmitVersion ||
        params.runId !== runId
      ) {
        return false;
      }

      if (response.status === "accepted") {
        setSubmitError("");
        return true;
      }

      setSubmitError(
        response.reason?.trim() ||
          "Prompt submission is not supported for this run.",
      );
      return false;
    } catch (submitError) {
      if (
        requestVersion !== activeAgentRequestVersion ||
        submitVersion !== activePromptSubmitVersion ||
        params.runId !== runId
      ) {
        return false;
      }

      setSubmitError(
        getErrorMessage(submitError) || "Failed to submit prompt.",
      );
      return false;
    } finally {
      if (
        requestVersion === activeAgentRequestVersion &&
        submitVersion === activePromptSubmitVersion &&
        params.runId === runId
      ) {
        setIsSubmittingPrompt(false);
      }
    }
  };

  createEffect(() => {
    const runId = params.runId;
    const requestVersion = ++activeAgentRequestVersion;
    setAgentEvents([]);
    setAgentStore(createEmptyAgentStore(null));
    setAgentError("");
    activePromptSubmitVersion += 1;
    setIsSubmittingPrompt(false);
    setSubmitError("");
    setAgentState("idle");
    isAgentUiSubscribed = true;

    if (!runId) {
      return;
    }

    void (async () => {
      await ensureAgentForRun(runId);
      if (
        requestVersion !== activeAgentRequestVersion ||
        params.runId !== runId
      ) {
        return;
      }

      if (agentState() === "unsupported" || agentState() === "error") {
        return;
      }

      await subscribeAgentEvents(runId);
    })();

    onCleanup(() => {
      unsubscribeAgentEvents();
    });
  });

  const setTerminalFrameHandler = (
    handler: ((frame: RunTerminalFrame) => void) | null,
  ): void => {
    terminalFrameHandler = handler;
  };

  const disposeTerminal = async (): Promise<void> => {
    const sessionId = terminalSessionId();
    const generation = terminalGeneration();
    activeTerminalRequestVersion += 1;
    setIsTerminalStarting(false);
    setIsTerminalReady(false);
    terminalRunId = null;
    setTerminalSessionId(null);
    setTerminalGeneration(null);

    if (!sessionId || generation === null) {
      return;
    }

    try {
      await killRunTerminal({
        sessionId,
        generation,
      });
    } catch {
      // Ignore disposal failures during route transitions.
    }
  };

  const initTerminalForRun = async (runId: string): Promise<void> => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      setTerminalError("Missing run ID.");
      return;
    }

    if (
      terminalRunId === normalizedRunId &&
      (isTerminalStarting() || isTerminalReady())
    ) {
      return;
    }

    if (terminalRunId && terminalRunId !== normalizedRunId) {
      await disposeTerminal();
    }

    const requestVersion = ++activeTerminalRequestVersion;
    terminalRunId = normalizedRunId;
    terminalRouteInstanceId = crypto.randomUUID();
    setIsTerminalStarting(true);
    setIsTerminalReady(false);
    setTerminalError("");
    setTerminalSessionId(null);
    setTerminalGeneration(null);

    try {
      const session = await openRunTerminal({
        runId: normalizedRunId,
        routeInstanceId: terminalRouteInstanceId,
        cols: 120,
        rows: 32,
        onOutput: (frame) => {
          if (requestVersion !== activeTerminalRequestVersion) {
            return;
          }

          if (frame.type === "error") {
            setTerminalError(frame.message || "Terminal stream error.");
          }

          if (frame.type === "closed") {
            setIsTerminalReady(false);
          }

          terminalFrameHandler?.(frame);
        },
      });

      if (requestVersion !== activeTerminalRequestVersion) {
        return;
      }

      setTerminalSessionId(session.sessionId);
      setTerminalGeneration(session.generation);
      setIsTerminalReady(true);
    } catch {
      if (requestVersion !== activeTerminalRequestVersion) {
        return;
      }

      setTerminalError("Failed to start terminal.");
      setTerminalSessionId(null);
      setTerminalGeneration(null);
      setIsTerminalReady(false);
    } finally {
      if (requestVersion === activeTerminalRequestVersion) {
        setIsTerminalStarting(false);
      }
    }
  };

  const writeTerminal = async (data: string): Promise<void> => {
    const sessionId = terminalSessionId();
    const generation = terminalGeneration();
    if (!sessionId || generation === null) {
      return;
    }

    try {
      await writeRunTerminal({
        sessionId,
        generation,
        data,
      });
    } catch {
      setTerminalError("Failed to write to terminal.");
    }
  };

  const resizeTerminal = async (cols: number, rows: number): Promise<void> => {
    const sessionId = terminalSessionId();
    const generation = terminalGeneration();
    if (!sessionId || generation === null) {
      return;
    }

    const normalizedCols = Math.max(1, Math.floor(cols));
    const normalizedRows = Math.max(1, Math.floor(rows));

    try {
      await resizeRunTerminal({
        sessionId,
        generation,
        cols: normalizedCols,
        rows: normalizedRows,
      });
    } catch {
      setTerminalError("Failed to resize terminal.");
    }
  };

  createEffect(() => {
    const runId = params.runId;
    if (!runId) {
      void disposeTerminal();
      return;
    }

    void initTerminalForRun(runId);

    onCleanup(() => {
      void disposeTerminal();
    });
  });

  const refreshDiffFiles = async (): Promise<void> => {
    const runId = params.runId;
    if (!runId || !isDiffTabActive()) return;
    const requestVersion = ++activeDiffRefreshVersion;
    setIsDiffFilesLoading(true);
    setDiffFilesError("");
    try {
      const files = await listRunDiffFiles(runId);
      if (
        params.runId !== runId ||
        requestVersion !== activeDiffRefreshVersion
      ) {
        return;
      }
      const presentPaths = new Set(files.map((file) => file.path));
      const invalidatedPaths = new Set<string>();

      setDiffFiles((current) => {
        const currentByPath = new Map(current.map((file) => [file.path, file]));
        const nextByPath = new Map(files.map((file) => [file.path, file]));

        for (const currentFile of current) {
          const nextFile = nextByPath.get(currentFile.path);
          if (!nextFile || !hasSameDiffFileMetadata(currentFile, nextFile)) {
            invalidatedPaths.add(currentFile.path);
          }
        }

        for (const nextFile of files) {
          if (!currentByPath.has(nextFile.path)) {
            invalidatedPaths.add(nextFile.path);
          }
        }

        const listIsEqual = areDiffFilesEqual(current, files);
        if (listIsEqual) {
          return current;
        }

        const mergedFiles = files.map((file) => {
          const existing = currentByPath.get(file.path);
          if (existing && hasSameDiffFileMetadata(existing, file)) {
            return existing;
          }
          return file;
        });

        return mergedFiles;
      });

      setDiffFilePayloads((current) => {
        let didChange = false;
        const next: Record<string, RunDiffFilePayload> = {};
        for (const [path, payload] of Object.entries(current)) {
          if (presentPaths.has(path) && !invalidatedPaths.has(path)) {
            next[path] = payload;
          } else {
            didChange = true;
          }
        }
        return didChange ? next : current;
      });
      setDiffFileLoadingPaths((current) => {
        let didChange = false;
        const next: Record<string, boolean> = {};
        for (const [path, isLoading] of Object.entries(current)) {
          if (presentPaths.has(path) && !invalidatedPaths.has(path)) {
            next[path] = isLoading;
          } else {
            didChange = true;
          }
        }
        return didChange ? next : current;
      });
    } catch {
      if (
        params.runId !== runId ||
        requestVersion !== activeDiffRefreshVersion
      ) {
        return;
      }
      setDiffFilesError("Failed to load changed files.");
    } finally {
      if (
        params.runId === runId &&
        requestVersion === activeDiffRefreshVersion
      ) {
        setIsDiffFilesLoading(false);
      }
    }
  };

  const loadDiffFile = async (path: string): Promise<void> => {
    const runId = params.runId;
    if (!runId || !path.trim()) return;
    const isCached = diffFilePayloads()[path] !== undefined;
    const isLoading = diffFileLoadingPaths()[path] === true;
    if (isCached || isLoading) {
      return;
    }

    setDiffFileLoadingPaths((current) => ({ ...current, [path]: true }));
    try {
      const payload = await getRunDiffFile(runId, path);
      if (params.runId !== runId) return;
      setDiffFilePayloads((current) => ({ ...current, [path]: payload }));
    } catch (loadError) {
      throw loadError;
    } finally {
      if (params.runId === runId) {
        setDiffFileLoadingPaths((current) => {
          const next = { ...current };
          delete next[path];
          return next;
        });
      }
    }
  };

  createEffect(() => {
    const runId = params.runId;
    if (!runId) {
      return;
    }
    void setRunDiffWatch(runId, true);

    let disposed = false;
    let unlisten: null | (() => void) = null;
    void (async () => {
      const remove = await listen<{ run_id?: string; runId?: string }>(
        "run-diff-updated",
        (event) => {
          const eventRunId = event.payload.run_id ?? event.payload.runId;
          if (eventRunId !== runId || disposed || params.runId !== runId)
            return;

          if (!isDiffTabActive()) {
            return;
          }

          if (diffRefreshDebounceTimer) {
            clearTimeout(diffRefreshDebounceTimer);
          }
          diffRefreshDebounceTimer = setTimeout(() => {
            if (disposed || params.runId !== runId) {
              return;
            }
            void refreshDiffFiles();
          }, 250);
        },
      );
      if (disposed) {
        remove();
        return;
      }
      unlisten = remove;
    })();

    onCleanup(() => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
      if (diffRefreshDebounceTimer) {
        clearTimeout(diffRefreshDebounceTimer);
        diffRefreshDebounceTimer = null;
      }
      void setRunDiffWatch(runId, false);
    });
  });

  createEffect(() => {
    const runId = params.runId;
    const active = isDiffTabActive();
    if (!runId || !active) {
      return;
    }

    void refreshDiffFiles();
  });

  return {
    run,
    task,
    isLoading,
    error,
    taskHref,
    backHref,
    backLabel,
    runLabel,
    repositorySummary,
    durationLabel,
    isDiffTabActive,
    setIsDiffTabActive,
    diffFiles,
    isDiffFilesLoading,
    diffFilesError,
    diffFilePayloads,
    diffFileLoadingPaths,
    loadDiffFile,
    terminal: {
      sessionId: terminalSessionId,
      generation: terminalGeneration,
      isStarting: isTerminalStarting,
      isReady: isTerminalReady,
      error: terminalError,
      initTerminalForRun,
      writeTerminal,
      resizeTerminal,
      disposeTerminal,
      setTerminalFrameHandler,
    },
    agent: {
      state: agentState,
      events: agentEvents,
      store: agentStore,
      error: agentError,
      isSubmittingPrompt,
      submitError,
      submitPrompt,
      ensureAgentForRun,
      subscribeAgentEvents,
      unsubscribeAgentEvents,
    },
  };
};
