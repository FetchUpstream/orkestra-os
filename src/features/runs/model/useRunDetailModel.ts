import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { listen } from "@tauri-apps/api/event";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  bootstrapRunOpenCode,
  appendCappedHistory,
  getRun,
  getRunGitMergeStatus,
  getRunDiffFile,
  killRunTerminal,
  listRunDiffFiles,
  mergeRunWorktreeIntoSource,
  openRunTerminal,
  rebaseRunWorktreeOntoSource,
  replyRunOpenCodePermission,
  resizeRunTerminal,
  setRunDiffWatch,
  submitRunOpenCodePrompt,
  subscribeRunOpenCodeEvents,
  unsubscribeRunOpenCodeEvents,
  type BootstrapRunOpenCodeResult,
  type Run,
  type RunSelectionOption,
  type RunModelOption,
  type RunDiffFile,
  type RunDiffFilePayload,
  type RunGitMergeStatus,
  type RunOpenCodeAgentState,
  type RunOpenCodeChatMode,
  type RunOpenCodeEvent,
  type RunTerminalFrame,
  writeRunTerminal,
} from "../../../app/lib/runs";
import {
  getRunSelectionOptionsWithCache,
  readRunSelectionOptionsCache,
} from "../../../app/lib/runSelectionOptionsCache";
import { getTask, type Task } from "../../../app/lib/tasks";
import {
  createEmptyAgentStore,
  hydrateAgentStore,
  reduceOpenCodeEvent,
} from "./agentReducer";
import type { AgentStore, OpenCodeBusEvent } from "./agentTypes";
import { setRunCommitPending } from "./commitUiState";
import {
  validateReviewAnchor,
  type RunReviewAnchorTrust,
  type RunReviewAnchorTrustReason,
} from "./reviewAnchorValidation";

export type RunReviewCommentSide = "original" | "modified";

export type RunReviewDraftComment = {
  id: string;
  filePath: string;
  side: RunReviewCommentSide;
  line: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  anchorTrust: RunReviewAnchorTrust;
  anchorTrustReason?: RunReviewAnchorTrustReason;
  anchorLineSnippet?: string;
};

export type RunDraftReviewSubmissionPlan = {
  message: string;
  submittedCommentIds: string[];
  eligibleCount: number;
  ineligibleCount: number;
  fileCount: number;
  isSubmittable: boolean;
  blockedReason: string;
};

type UpsertRunReviewDraftCommentInput = {
  id?: string;
  filePath: string;
  side: RunReviewCommentSide;
  line: number;
  body: string;
  anchorLineSnippet?: string;
};

type ValidateRunReviewDraftAnchorsForFileInput = {
  filePath: string;
  side: RunReviewCommentSide;
  modifiedLineCount: number;
  commentableModifiedLines: Set<number>;
  modifiedLineTextByLine: Map<number, string>;
};

export const useRunDetailModel = () => {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
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
  const [reviewDraftComments, setReviewDraftComments] = createSignal<
    RunReviewDraftComment[]
  >([]);
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
  const [agentChatMode, setAgentChatMode] =
    createSignal<RunOpenCodeChatMode>("unavailable");
  const [agentEvents, setAgentEvents] = createSignal<RunOpenCodeEvent[]>([]);
  const [agentStore, setAgentStore] = createSignal<AgentStore>(
    createEmptyAgentStore(null),
  );
  const [agentError, setAgentError] = createSignal("");
  const [agentReadinessPhase, setAgentReadinessPhase] = createSignal<
    | "warming_backend"
    | "creating_session"
    | "ready"
    | "reconnecting"
    | "submit_failed"
    | null
  >(null);
  const [isSubmittingPrompt, setIsSubmittingPrompt] = createSignal(false);
  const [submitError, setSubmitError] = createSignal("");
  const [runAgentOptions, setRunAgentOptions] = createSignal<
    RunSelectionOption[]
  >([]);
  const [runProviderOptions, setRunProviderOptions] = createSignal<
    RunSelectionOption[]
  >([]);
  const [runModelOptions, setRunModelOptions] = createSignal<RunModelOption[]>(
    [],
  );
  const [runSelectionOptionsError, setRunSelectionOptionsError] =
    createSignal("");
  const [isReplyingPermission, setIsReplyingPermission] = createSignal(false);
  const [permissionReplyError, setPermissionReplyError] = createSignal("");
  const [gitStatus, setGitStatus] = createSignal<RunGitMergeStatus | null>(
    null,
  );
  const [isGitStatusLoading, setIsGitStatusLoading] = createSignal(false);
  const [gitStatusError, setGitStatusError] = createSignal("");
  const [isGitRebasePending, setIsGitRebasePending] = createSignal(false);
  const [isGitMergePending, setIsGitMergePending] = createSignal(false);
  const [gitActionError, setGitActionError] = createSignal("");
  const [gitLastActionMessage, setGitLastActionMessage] = createSignal("");
  const [postMergeCompletionMessage, setPostMergeCompletionMessage] =
    createSignal("");
  let activeRunRequestVersion = 0;
  let activeRunRefreshVersion = 0;
  let activeDiffRefreshVersion = 0;
  let diffRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeTerminalRequestVersion = 0;
  let activeAgentRequestVersion = 0;
  let activeAgentSubscriptionVersion = 0;
  let activePromptSubmitVersion = 0;
  let isAgentUiSubscribed = false;
  let activeAgentSubscriberId: string | null = null;
  let activeAgentSubscriberRunId: string | null = null;
  let removeAgentEventForwarder: (() => void) | null = null;
  let pendingAgentEvents: RunOpenCodeEvent[] = [];
  let agentFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let agentFlushFrameId: number | null = null;
  let isAgentSnapshotHydrating = false;
  let pendingAgentSnapshotHydrate = false;
  let pendingAgentSnapshotReplayEvents: RunOpenCodeEvent[] = [];
  let agentResubscribeTimer: ReturnType<typeof setTimeout> | null = null;
  let isAgentResubscribeInFlight = false;
  let pendingAgentResubscribe = false;
  let terminalRunId: string | null = null;
  let terminalRouteInstanceId = crypto.randomUUID();
  let terminalFrameHandler: ((frame: RunTerminalFrame) => void) | null = null;
  let terminalRequestedSize: { cols: number; rows: number } | null = null;
  let terminalAppliedSize: { cols: number; rows: number } | null = null;
  let postMergeRedirectTimer: ReturnType<typeof setTimeout> | null = null;
  let cleanupRefreshFollowUpTimer: ReturnType<typeof setTimeout> | null = null;
  const sentGitConflictFingerprints = new Set<string>();

  const clearPostMergeRedirectTimer = (): void => {
    if (postMergeRedirectTimer) {
      clearTimeout(postMergeRedirectTimer);
      postMergeRedirectTimer = null;
    }
  };

  const clearCleanupRefreshFollowUpTimer = (): void => {
    if (cleanupRefreshFollowUpTimer) {
      clearTimeout(cleanupRefreshFollowUpTimer);
      cleanupRefreshFollowUpTimer = null;
    }
  };

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

  const isTerminalInputEnabled = createMemo(() => {
    const status = run()?.status;
    if (!status) {
      return false;
    }

    return (
      status === "queued" || status === "preparing" || status === "running"
    );
  });

  const isTerminalInputBlocked = createMemo(
    () => run()?.status === "completed",
  );

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

  const getDraftCommentsForFile = (
    filePath: string,
  ): RunReviewDraftComment[] => {
    const normalizedPath = filePath.trim();
    if (!normalizedPath) {
      return [];
    }

    return reviewDraftComments()
      .filter((comment) => comment.filePath === normalizedPath)
      .sort((left, right) => {
        if (left.line !== right.line) {
          return left.line - right.line;
        }
        return left.createdAt.localeCompare(right.createdAt);
      });
  };

  const sortDraftCommentsForSubmission = (
    comments: RunReviewDraftComment[],
  ): RunReviewDraftComment[] => {
    return [...comments].sort((left, right) => {
      if (left.filePath !== right.filePath) {
        return left.filePath.localeCompare(right.filePath);
      }
      if (left.line !== right.line) {
        return left.line - right.line;
      }
      if (left.createdAt !== right.createdAt) {
        return left.createdAt.localeCompare(right.createdAt);
      }
      return left.id.localeCompare(right.id);
    });
  };

  const isDraftCommentEligibleForSubmission = (
    comment: RunReviewDraftComment,
  ): boolean => {
    const filePath = comment.filePath.trim();
    const body = comment.body.trim();
    const line = Number.isFinite(comment.line)
      ? Math.floor(comment.line)
      : Number.NaN;

    return (
      comment.anchorTrust === "trusted" &&
      comment.side === "modified" &&
      filePath.length > 0 &&
      Number.isFinite(line) &&
      line >= 1 &&
      body.length > 0
    );
  };

  const formatDraftReviewSubmissionMessage = (
    comments: RunReviewDraftComment[],
  ): string => {
    const groupedByFile = new Map<string, RunReviewDraftComment[]>();
    for (const comment of comments) {
      const filePath = comment.filePath.trim();
      const entry = groupedByFile.get(filePath);
      if (entry) {
        entry.push(comment);
      } else {
        groupedByFile.set(filePath, [comment]);
      }
    }

    const fileCount = groupedByFile.size;
    const commentCount = comments.length;
    const lines: string[] = [
      "# Review: Requested changes",
      "Please address the following review comments on the modified files.",
      "",
      `Summary: ${commentCount} comment${commentCount === 1 ? "" : "s"} across ${fileCount} file${fileCount === 1 ? "" : "s"}.`,
      "",
    ];

    for (const [filePath, fileComments] of groupedByFile.entries()) {
      lines.push(`File: \`${filePath}\``);
      lines.push("");

      for (const comment of fileComments) {
        const bodyLines = comment.body.trim().split(/\r?\n/);
        lines.push(`- Side: ${comment.side} · Line: ${comment.line}`);
        for (const bodyLine of bodyLines) {
          if (bodyLine.trim().length === 0) {
            lines.push("  >");
          } else {
            lines.push(`  > ${bodyLine}`);
          }
        }
        lines.push("");
      }
    }

    return lines.join("\n").trim();
  };

  const getDraftCommentsNeedingAttention = (): RunReviewDraftComment[] => {
    return reviewDraftComments()
      .filter((comment) => comment.anchorTrust !== "trusted")
      .sort((left, right) => {
        if (left.filePath !== right.filePath) {
          return left.filePath.localeCompare(right.filePath);
        }
        if (left.line !== right.line) {
          return left.line - right.line;
        }
        return left.createdAt.localeCompare(right.createdAt);
      });
  };

  const getDraftReviewSubmissionPlan = (): RunDraftReviewSubmissionPlan => {
    const drafts = reviewDraftComments();
    const eligibleDrafts = sortDraftCommentsForSubmission(
      drafts.filter((comment) => isDraftCommentEligibleForSubmission(comment)),
    );
    const ineligibleCount = drafts.length - eligibleDrafts.length;
    const fileCount = new Set(
      eligibleDrafts.map((comment) => comment.filePath.trim()),
    ).size;

    if (eligibleDrafts.length === 0) {
      return {
        message: "",
        submittedCommentIds: [],
        eligibleCount: 0,
        ineligibleCount,
        fileCount: 0,
        isSubmittable: false,
        blockedReason:
          "Add at least one trusted draft comment on modified lines to submit review.",
      };
    }

    if (ineligibleCount > 0) {
      return {
        message: "",
        submittedCommentIds: [],
        eligibleCount: eligibleDrafts.length,
        ineligibleCount,
        fileCount,
        isSubmittable: false,
        blockedReason: `Resolve or remove ${ineligibleCount} draft comment${ineligibleCount === 1 ? "" : "s"} that cannot be submitted yet.`,
      };
    }

    return {
      message: formatDraftReviewSubmissionMessage(eligibleDrafts),
      submittedCommentIds: eligibleDrafts.map((comment) => comment.id),
      eligibleCount: eligibleDrafts.length,
      ineligibleCount,
      fileCount,
      isSubmittable: true,
      blockedReason: "",
    };
  };

  const upsertDraftComment = (
    input: UpsertRunReviewDraftCommentInput,
  ): RunReviewDraftComment | null => {
    const normalizedFilePath = input.filePath.trim();
    const normalizedBody = input.body.trim();
    const normalizedLine = Number.isFinite(input.line)
      ? Math.max(1, Math.floor(input.line))
      : NaN;
    if (
      !normalizedFilePath ||
      !normalizedBody ||
      !Number.isFinite(normalizedLine)
    ) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const normalizedAnchorSnippet =
      input.anchorLineSnippet?.trim() || undefined;
    const existingId = input.id?.trim() || "";
    let saved: RunReviewDraftComment | null = null;

    setReviewDraftComments((current) => {
      const next = [...current];
      if (existingId) {
        const existingIndex = next.findIndex(
          (comment) => comment.id === existingId,
        );
        if (existingIndex >= 0) {
          const previous = next[existingIndex];
          const updated: RunReviewDraftComment = {
            ...previous,
            filePath: normalizedFilePath,
            side: input.side,
            line: normalizedLine,
            body: normalizedBody,
            updatedAt: timestamp,
            anchorTrust: "trusted",
            anchorTrustReason: undefined,
            anchorLineSnippet: normalizedAnchorSnippet,
          };
          next[existingIndex] = updated;
          saved = updated;
          return next;
        }
      }

      const created: RunReviewDraftComment = {
        id: crypto.randomUUID(),
        filePath: normalizedFilePath,
        side: input.side,
        line: normalizedLine,
        body: normalizedBody,
        createdAt: timestamp,
        updatedAt: timestamp,
        anchorTrust: "trusted",
        anchorTrustReason: "created",
        anchorLineSnippet: normalizedAnchorSnippet,
      };
      saved = created;
      next.push(created);
      return next;
    });

    return saved;
  };

  const removeDraftComment = (commentId: string): void => {
    const normalizedId = commentId.trim();
    if (!normalizedId) {
      return;
    }

    setReviewDraftComments((current) =>
      current.filter((comment) => comment.id !== normalizedId),
    );
  };

  const removeDraftComments = (commentIds: readonly string[]): void => {
    const normalizedIds = new Set(
      commentIds
        .map((commentId) => commentId.trim())
        .filter((commentId) => commentId.length > 0),
    );
    if (normalizedIds.size === 0) {
      return;
    }

    setReviewDraftComments((current) =>
      current.filter((comment) => !normalizedIds.has(comment.id)),
    );
  };

  const markDraftAnchorTrustByDiffInvalidation = (
    invalidatedPaths: ReadonlySet<string>,
    presentPaths: ReadonlySet<string>,
  ): void => {
    if (invalidatedPaths.size === 0) {
      return;
    }

    setReviewDraftComments((current) => {
      let didChange = false;
      const next = current.map((comment) => {
        if (!invalidatedPaths.has(comment.filePath)) {
          return comment;
        }

        const nextTrust: RunReviewAnchorTrust = presentPaths.has(
          comment.filePath,
        )
          ? "needs_validation"
          : "untrusted";
        const nextReason: RunReviewAnchorTrustReason = presentPaths.has(
          comment.filePath,
        )
          ? "diff_changed"
          : "file_removed";

        if (
          comment.anchorTrust === nextTrust &&
          comment.anchorTrustReason === nextReason
        ) {
          return comment;
        }

        didChange = true;
        return {
          ...comment,
          anchorTrust: nextTrust,
          anchorTrustReason: nextReason,
          updatedAt: new Date().toISOString(),
        };
      });

      return didChange ? next : current;
    });
  };

  const validateDraftAnchorsForFile = (
    input: ValidateRunReviewDraftAnchorsForFileInput,
  ): void => {
    const normalizedPath = input.filePath.trim();
    if (!normalizedPath) {
      return;
    }

    const normalizedLineCount = Number.isFinite(input.modifiedLineCount)
      ? Math.max(0, Math.floor(input.modifiedLineCount))
      : 0;
    const normalizedCommentableLines = new Set<number>();
    for (const line of input.commentableModifiedLines) {
      if (!Number.isFinite(line)) {
        continue;
      }
      normalizedCommentableLines.add(Math.max(1, Math.floor(line)));
    }

    const normalizedLineTextByLine = new Map<number, string>();
    for (const [line, text] of input.modifiedLineTextByLine.entries()) {
      if (!Number.isFinite(line)) {
        continue;
      }
      normalizedLineTextByLine.set(Math.max(1, Math.floor(line)), text);
    }

    setReviewDraftComments((current) => {
      let didChange = false;
      const next = current.map((comment) => {
        if (
          comment.filePath !== normalizedPath ||
          comment.side !== input.side
        ) {
          return comment;
        }

        if (comment.anchorTrustReason === "file_removed") {
          return comment;
        }

        const validation = validateReviewAnchor({
          side: comment.side,
          line: comment.line,
          anchorLineSnippet: comment.anchorLineSnippet,
          modifiedLineCount: normalizedLineCount,
          commentableModifiedLines: normalizedCommentableLines,
          modifiedLineTextByLine: normalizedLineTextByLine,
        });

        if (
          comment.anchorTrust === validation.trust &&
          comment.anchorTrustReason === validation.reason
        ) {
          return comment;
        }

        didChange = true;
        return {
          ...comment,
          anchorTrust: validation.trust,
          anchorTrustReason: validation.reason,
          updatedAt: new Date().toISOString(),
        };
      });

      return didChange ? next : current;
    });
  };

  const isInformationalGitStateMessage = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    const backendStateMatch = normalized.match(
      /^rebase\/merge backend state:\s*([a-z0-9_-]+)\.?$/,
    );
    if (!backendStateMatch) {
      return false;
    }

    const backendState = backendStateMatch[1];
    return backendState === "mergeable";
  };

  const normalizeReadinessPhase = (
    result: BootstrapRunOpenCodeResult,
  ): "warming_backend" | "creating_session" | "ready" | "reconnecting" => {
    const phase = result.readyPhase?.trim().toLowerCase() ?? "";
    if (phase.includes("reconnect")) return "reconnecting";
    if (phase.includes("create") || phase.includes("session")) {
      return "creating_session";
    }
    if (
      phase.includes("warm") &&
      (phase.includes("handle") ||
        phase.includes("ready") ||
        phase.includes("running"))
    ) {
      return "ready";
    }
    if (
      phase.includes("boot") ||
      phase.includes("cold") ||
      phase.includes("start") ||
      phase.includes("warm")
    ) {
      return "warming_backend";
    }
    if (phase.includes("ready") || result.streamConnected) return "ready";
    if (result.state === "starting") return "creating_session";
    if (result.state === "running") return "ready";
    return "warming_backend";
  };

  const resolveChatMode = (
    result: BootstrapRunOpenCodeResult,
  ): RunOpenCodeChatMode => {
    if (
      result.chatMode === "interactive" ||
      result.chatMode === "read_only" ||
      result.chatMode === "unavailable"
    ) {
      return result.chatMode;
    }
    return result.state === "unsupported" ? "unavailable" : "interactive";
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

  const extractSessionIdFromBusProperties = (value: unknown): string | null => {
    if (!isRecord(value)) {
      return null;
    }

    const part = isRecord(value.part) ? value.part : null;
    const sessionId =
      (typeof value.sessionID === "string" ? value.sessionID : null) ||
      (typeof value.sessionId === "string" ? value.sessionId : null) ||
      (part && typeof part.sessionID === "string" ? part.sessionID : null) ||
      (part && typeof part.sessionId === "string" ? part.sessionId : null);

    if (!sessionId || !sessionId.trim()) {
      return null;
    }

    return sessionId.trim();
  };

  const hydrateAgentSnapshot = async (
    runId: string,
    requestVersion: number,
    subscriptionVersion: number,
    baseEvents: RunOpenCodeEvent[] = [],
  ): Promise<void> => {
    const bootstrap = await bootstrapRunOpenCode(runId);
    const chatMode = resolveChatMode(bootstrap);

    if (
      requestVersion !== activeAgentRequestVersion ||
      subscriptionVersion !== activeAgentSubscriptionVersion ||
      !isAgentUiSubscribed ||
      params.runId !== runId
    ) {
      return;
    }

    setAgentChatMode(chatMode);

    if (chatMode === "unavailable") {
      setAgentState("unsupported");
      setAgentError("");
      return;
    }

    if (bootstrap.state === "error") {
      setAgentState("error");
      setAgentError(
        bootstrap.reason?.trim() || "Failed to initialize agent stream.",
      );
      return;
    }

    const replaySource = appendCappedHistory(
      bootstrap.bufferedEvents,
      baseEvents,
    );
    setAgentEvents((current) => appendCappedHistory(current, replaySource));
    setAgentReadinessPhase(normalizeReadinessPhase(bootstrap));
    setAgentState(bootstrap.state);
    setAgentError("");

    const sessionId =
      bootstrap.sessionId?.trim() ||
      extractSessionIdFromMessages(bootstrap.messages) ||
      extractSessionIdFromTodos(bootstrap.todos) ||
      extractSessionIdFromEvents(replaySource) ||
      agentStore().sessionId;

    setAgentStore((current) => {
      const hydrated = hydrateAgentStore({
        sessionId,
        messages: bootstrap.messages,
        todos: bootstrap.todos,
      });

      const replayEvents: OpenCodeBusEvent[] =
        replaySource.length > 0
          ? replaySource.map(toOpenCodeBusEvent)
          : current.rawEvents;

      return replayEvents.reduce((nextState, item) => {
        return reduceOpenCodeEvent(nextState, item);
      }, hydrated);
    });
  };

  const clearPendingAgentSnapshotHydrate = (): void => {
    isAgentSnapshotHydrating = false;
    pendingAgentSnapshotHydrate = false;
    pendingAgentSnapshotReplayEvents = [];
  };

  const clearPendingAgentResubscribe = (): void => {
    pendingAgentResubscribe = false;
    isAgentResubscribeInFlight = false;
    if (agentResubscribeTimer) {
      clearTimeout(agentResubscribeTimer);
      agentResubscribeTimer = null;
    }
  };

  const requestAgentResubscribe = (
    runId: string,
    requestVersion: number,
    subscriptionVersion: number,
  ): void => {
    if (
      requestVersion !== activeAgentRequestVersion ||
      subscriptionVersion !== activeAgentSubscriptionVersion ||
      !isAgentUiSubscribed ||
      params.runId !== runId
    ) {
      return;
    }

    pendingAgentResubscribe = true;
    if (agentResubscribeTimer) {
      return;
    }

    agentResubscribeTimer = setTimeout(() => {
      agentResubscribeTimer = null;

      if (!pendingAgentResubscribe || isAgentResubscribeInFlight) {
        return;
      }

      if (
        requestVersion !== activeAgentRequestVersion ||
        subscriptionVersion !== activeAgentSubscriptionVersion ||
        !isAgentUiSubscribed ||
        params.runId !== runId
      ) {
        pendingAgentResubscribe = false;
        return;
      }

      pendingAgentResubscribe = false;
      isAgentResubscribeInFlight = true;
      void subscribeAgentEvents(runId).finally(() => {
        isAgentResubscribeInFlight = false;

        if (pendingAgentResubscribe) {
          requestAgentResubscribe(
            runId,
            activeAgentRequestVersion,
            activeAgentSubscriptionVersion,
          );
        }
      });
    }, 150);
  };

  const requestAgentSnapshotHydrate = (
    runId: string,
    requestVersion: number,
    subscriptionVersion: number,
    baseEvents: RunOpenCodeEvent[] = [],
  ): void => {
    if (
      requestVersion !== activeAgentRequestVersion ||
      subscriptionVersion !== activeAgentSubscriptionVersion ||
      !isAgentUiSubscribed ||
      params.runId !== runId
    ) {
      return;
    }

    if (baseEvents.length > 0) {
      pendingAgentSnapshotReplayEvents = appendCappedHistory(
        pendingAgentSnapshotReplayEvents,
        baseEvents,
      );
    }

    if (isAgentSnapshotHydrating) {
      pendingAgentSnapshotHydrate = true;
      return;
    }

    isAgentSnapshotHydrating = true;
    const replayEvents = pendingAgentSnapshotReplayEvents;
    pendingAgentSnapshotReplayEvents = [];

    void hydrateAgentSnapshot(
      runId,
      requestVersion,
      subscriptionVersion,
      replayEvents,
    ).finally(() => {
      isAgentSnapshotHydrating = false;

      if (
        requestVersion !== activeAgentRequestVersion ||
        subscriptionVersion !== activeAgentSubscriptionVersion ||
        !isAgentUiSubscribed ||
        params.runId !== runId
      ) {
        pendingAgentSnapshotHydrate = false;
        pendingAgentSnapshotReplayEvents = [];
        return;
      }

      if (pendingAgentSnapshotHydrate) {
        pendingAgentSnapshotHydrate = false;
        requestAgentSnapshotHydrate(runId, requestVersion, subscriptionVersion);
      }
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

  const runDetailOrigin = createMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return searchParams.get("origin")?.trim().toLowerCase() || "";
  });

  const backHref = createMemo(() => {
    if (runDetailOrigin() === "board") {
      const projectId =
        task()?.projectId?.trim() || run()?.projectId?.trim() || "";
      if (projectId) {
        return `/board?projectId=${encodeURIComponent(projectId)}`;
      }
      return "/board";
    }

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
    if (runDetailOrigin() === "board") {
      return "board";
    }
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

  const isRunCompleted = createMemo(() => run()?.status === "completed");
  const runDefaultProviderId = createMemo(
    () => run()?.providerId?.trim() || "",
  );
  const visibleRunModelOptions = createMemo(() => {
    const providerId = runDefaultProviderId();
    if (!providerId) {
      return runModelOptions();
    }
    return runModelOptions().filter(
      (option) => !option.providerId || option.providerId === providerId,
    );
  });

  const boardHref = createMemo(() => {
    const projectId =
      task()?.projectId?.trim() || run()?.projectId?.trim() || "";
    if (projectId) {
      return `/board?projectId=${encodeURIComponent(projectId)}`;
    }
    return "/board";
  });

  const refreshRunDetails = async (runId: string): Promise<void> => {
    const refreshVersion = ++activeRunRefreshVersion;
    const loadedRun = await getRun(runId);
    if (params.runId !== runId || refreshVersion !== activeRunRefreshVersion) {
      return;
    }
    setRun(loadedRun);
    try {
      const loadedTask = await getTask(loadedRun.taskId);
      if (
        params.runId !== runId ||
        refreshVersion !== activeRunRefreshVersion
      ) {
        return;
      }
      setTask(loadedTask);
    } catch {
      if (
        params.runId !== runId ||
        refreshVersion !== activeRunRefreshVersion
      ) {
        return;
      }
      setTask(null);
    }
  };

  const refreshRunSelectionOptions = async (): Promise<void> => {
    const cachedOptions = readRunSelectionOptionsCache();
    if (cachedOptions) {
      setRunSelectionOptionsError("");
      setRunAgentOptions(cachedOptions.agents);
      setRunProviderOptions(cachedOptions.providers);
      setRunModelOptions(cachedOptions.models);
      return;
    }

    setRunSelectionOptionsError("");
    try {
      const options = await getRunSelectionOptionsWithCache();
      setRunAgentOptions(options.agents);
      setRunProviderOptions(options.providers);
      setRunModelOptions(options.models);
    } catch {
      setRunSelectionOptionsError("Failed to load run options.");
      setRunAgentOptions([]);
      setRunProviderOptions([]);
      setRunModelOptions([]);
    }
  };

  const refreshGitMergeStatus = async (): Promise<void> => {
    const runId = params.runId?.trim() ?? "";
    if (!runId) {
      setGitStatus(null);
      setGitStatusError("Missing run ID.");
      return;
    }

    setIsGitStatusLoading(true);
    setGitStatusError("");
    try {
      const status = await getRunGitMergeStatus(runId);
      if (params.runId !== runId) {
        return;
      }
      setGitStatus(status);
    } catch {
      if (params.runId !== runId) {
        return;
      }
      setGitStatus(null);
      setGitStatusError("Failed to load git merge status.");
    } finally {
      if (params.runId === runId) {
        setIsGitStatusLoading(false);
      }
    }
  };

  const sendGitConflictToChatOnce = async (
    summary: unknown,
    fingerprint: unknown,
  ): Promise<void> => {
    const normalizedSummary = typeof summary === "string" ? summary.trim() : "";
    const normalizedFingerprint =
      typeof fingerprint === "string" ? fingerprint.trim() : "";
    if (!normalizedSummary) {
      return;
    }

    const dedupeKey = normalizedFingerprint || normalizedSummary;
    if (!dedupeKey || sentGitConflictFingerprints.has(dedupeKey)) {
      return;
    }

    sentGitConflictFingerprints.add(dedupeKey);
    const accepted = await submitPrompt(normalizedSummary);
    if (!accepted) {
      sentGitConflictFingerprints.delete(dedupeKey);
    }
  };

  const rebaseWorktreeOntoSource = async (): Promise<void> => {
    const runId = params.runId?.trim() ?? "";
    if (!runId || isGitRebasePending()) {
      return;
    }

    setIsGitRebasePending(true);
    setGitActionError("");
    setGitLastActionMessage("");
    setPostMergeCompletionMessage("");
    clearPostMergeRedirectTimer();
    try {
      const result = await rebaseRunWorktreeOntoSource(runId);
      if (params.runId !== runId) {
        return;
      }

      if (result.status === "failed") {
        const failedMessage = result.message?.trim() || "";
        if (isInformationalGitStateMessage(failedMessage)) {
          setGitLastActionMessage(failedMessage);
        } else {
          setGitActionError(
            failedMessage ||
              gitStatus()?.rebaseDisabledReason?.trim() ||
              "Rebase failed.",
          );
        }
      } else if (result.message?.trim()) {
        setGitLastActionMessage(result.message.trim());
      }
      if (result.status === "conflict") {
        setGitActionError(result.message?.trim() || "Rebase has conflicts.");
        await sendGitConflictToChatOnce(
          result.conflictSummary,
          result.conflictFingerprint,
        );
      }
      await refreshGitMergeStatus();
    } catch (rebaseError) {
      if (params.runId === runId) {
        setGitActionError(
          getErrorMessage(rebaseError) || "Failed to rebase worktree branch.",
        );
      }
    } finally {
      if (params.runId === runId) {
        setIsGitRebasePending(false);
      }
    }
  };

  const mergeWorktreeIntoSource = async (): Promise<void> => {
    const runId = params.runId?.trim() ?? "";
    if (!runId || isGitMergePending()) {
      return;
    }

    setIsGitMergePending(true);
    setGitActionError("");
    setGitLastActionMessage("");
    try {
      const result = await mergeRunWorktreeIntoSource(runId);
      if (params.runId !== runId) {
        return;
      }

      if (result.status === "failed") {
        const failedMessage = result.message?.trim() || "";
        if (isInformationalGitStateMessage(failedMessage)) {
          setGitLastActionMessage(failedMessage);
        } else {
          setGitActionError(failedMessage || "Merge failed.");
        }
      } else if (result.message?.trim()) {
        setGitLastActionMessage(result.message.trim());
      }
      if (result.status === "conflict") {
        setGitActionError(result.message?.trim() || "Merge has conflicts.");
        await sendGitConflictToChatOnce(
          result.conflictSummary,
          result.conflictFingerprint,
        );
      }

      await refreshGitMergeStatus();
      if (result.status === "merged" || result.status === "completing") {
        await refreshRunDetails(runId);
        if (run()?.status === "completed" && task()?.status === "done") {
          setPostMergeCompletionMessage(
            "Merge completed. Returning to board...",
          );
          clearPostMergeRedirectTimer();
          postMergeRedirectTimer = setTimeout(() => {
            if (params.runId !== runId) {
              return;
            }
            navigate(boardHref(), { replace: true });
          }, 1200);
        }
      }
    } catch (mergeError) {
      if (params.runId === runId) {
        setGitActionError(
          getErrorMessage(mergeError) || "Failed to merge worktree branch.",
        );
      }
    } finally {
      if (params.runId === runId) {
        setIsGitMergePending(false);
      }
    }
  };

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
        await refreshRunDetails(runId);
        if (
          requestVersion !== activeRunRequestVersion ||
          params.runId !== runId
        ) {
          return;
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

  createEffect(() => {
    params.runId;
    setReviewDraftComments([]);
  });

  createEffect(() => {
    const runId = params.runId?.trim() ?? "";
    if (!runId) {
      setRunSelectionOptionsError("");
      setRunAgentOptions([]);
      setRunProviderOptions([]);
      setRunModelOptions([]);
      return;
    }
    void refreshRunSelectionOptions();
  });

  createEffect(() => {
    const runId = params.runId?.trim() ?? "";
    const setupState = run()?.setupState?.trim().toLowerCase() ?? "pending";
    if (!runId || setupState !== "running") {
      return;
    }

    let disposed = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let isRefreshInFlight = false;

    const pollRunUntilSetupTerminal = async (): Promise<void> => {
      if (disposed || params.runId !== runId || isRefreshInFlight) {
        return;
      }

      isRefreshInFlight = true;
      try {
        await refreshRunDetails(runId);
      } catch {
        // Ignore transient polling failures and retry while setup is running.
      } finally {
        isRefreshInFlight = false;
      }

      if (disposed || params.runId !== runId) {
        return;
      }

      const latestSetupState =
        run()?.setupState?.trim().toLowerCase() ?? "pending";
      if (latestSetupState !== "running") {
        return;
      }

      pollTimer = setTimeout(() => {
        void pollRunUntilSetupTerminal();
      }, 1000);
    };

    void pollRunUntilSetupTerminal();

    onCleanup(() => {
      disposed = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    });
  });

  createEffect(() => {
    const runId = params.runId;
    sentGitConflictFingerprints.clear();
    setGitStatus(null);
    setGitStatusError("");
    setGitActionError("");
    setGitLastActionMessage("");
    setIsGitRebasePending(false);
    setIsGitMergePending(false);

    if (!runId) {
      return;
    }

    void refreshGitMergeStatus();
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
    setAgentReadinessPhase("warming_backend");
    setAgentError("");

    try {
      const result = await bootstrapRunOpenCode(normalizedRunId);
      if (
        requestVersion !== activeAgentRequestVersion ||
        params.runId !== normalizedRunId
      ) {
        return;
      }

      const nextChatMode = resolveChatMode(result);
      const nextState: RunOpenCodeAgentState =
        nextChatMode !== "unavailable" && result.state === "unsupported"
          ? "running"
          : result.state;
      setAgentState(nextState);
      setAgentChatMode(nextChatMode);
      setAgentReadinessPhase(normalizeReadinessPhase(result));

      if (nextState === "error") {
        setAgentError(
          result.reason?.trim() || "Failed to initialize agent stream.",
        );
        return;
      }

      if (nextChatMode === "unavailable") {
        setAgentError("");
        setAgentState("unsupported");
        return;
      }

      const replaySource = result.bufferedEvents;
      setAgentEvents((current) => appendCappedHistory(current, replaySource));

      const sessionId =
        result.sessionId?.trim() ||
        extractSessionIdFromMessages(result.messages) ||
        extractSessionIdFromTodos(result.todos) ||
        extractSessionIdFromEvents(replaySource) ||
        agentStore().sessionId;

      setAgentStore((current) => {
        const hydrated = hydrateAgentStore({
          sessionId,
          messages: result.messages,
          todos: result.todos,
        });

        const replayEvents: OpenCodeBusEvent[] =
          replaySource.length > 0
            ? replaySource.map(toOpenCodeBusEvent)
            : current.rawEvents;

        return replayEvents.reduce((nextStateValue, item) => {
          return reduceOpenCodeEvent(nextStateValue, item);
        }, hydrated);
      });

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
        setAgentChatMode("unavailable");
        setAgentState("unsupported");
        setAgentReadinessPhase(null);
        setAgentError("");
        return;
      }

      setAgentState("error");
      setAgentReadinessPhase("warming_backend");
      const backendError = getErrorMessage(ensureError);
      setAgentError(backendError || "Failed to initialize agent stream.");
    }
  };

  const clearPendingAgentEventFlush = (): void => {
    pendingAgentEvents = [];
    if (
      agentFlushFrameId !== null &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(agentFlushFrameId);
      agentFlushFrameId = null;
    }
    agentFlushFrameId = null;
    if (agentFlushTimer) {
      clearTimeout(agentFlushTimer);
      agentFlushTimer = null;
    }
  };

  const flushPendingAgentEvents = (
    runId: string,
    requestVersion: number,
    subscriptionVersion: number,
  ): void => {
    agentFlushFrameId = null;
    agentFlushTimer = null;
    if (pendingAgentEvents.length === 0) {
      return;
    }

    if (
      requestVersion !== activeAgentRequestVersion ||
      subscriptionVersion !== activeAgentSubscriptionVersion ||
      !isAgentUiSubscribed ||
      params.runId !== runId
    ) {
      pendingAgentEvents = [];
      return;
    }

    const batch = pendingAgentEvents;
    pendingAgentEvents = [];
    let shouldHydrateSnapshot = false;
    let shouldResubscribe = false;
    let shouldRefreshRunForSessionIdle = false;

    setAgentEvents((current) => appendCappedHistory(current, batch));
    setAgentStore((current) => {
      return batch.reduce((nextState, event) => {
        const busEvent = toOpenCodeBusEvent(event);
        if (
          busEvent.type === "server.connected" ||
          busEvent.type === "stream.resync_needed"
        ) {
          shouldHydrateSnapshot = true;
        }
        if (busEvent.type === "stream.resync_needed") {
          shouldResubscribe = true;
        }
        if (busEvent.type === "session.idle") {
          const eventSessionId = extractSessionIdFromBusProperties(
            busEvent.properties,
          );
          const activeSessionId = nextState.sessionId?.trim() || "";
          if (
            !eventSessionId ||
            !activeSessionId ||
            eventSessionId === activeSessionId
          ) {
            shouldRefreshRunForSessionIdle = true;
          }
        }
        return reduceOpenCodeEvent(nextState, busEvent);
      }, current);
    });

    if (shouldRefreshRunForSessionIdle) {
      void refreshRunDetails(runId);
      clearCleanupRefreshFollowUpTimer();
      let followUpAttempt = 0;
      const maxFollowUpAttempts = 2;
      const runFollowUpRefresh = (): void => {
        if (
          requestVersion !== activeAgentRequestVersion ||
          subscriptionVersion !== activeAgentSubscriptionVersion ||
          !isAgentUiSubscribed ||
          params.runId !== runId
        ) {
          clearCleanupRefreshFollowUpTimer();
          return;
        }

        followUpAttempt += 1;
        void refreshRunDetails(runId);

        if (followUpAttempt >= maxFollowUpAttempts) {
          clearCleanupRefreshFollowUpTimer();
          return;
        }

        cleanupRefreshFollowUpTimer = setTimeout(runFollowUpRefresh, 700);
      };

      cleanupRefreshFollowUpTimer = setTimeout(runFollowUpRefresh, 250);
    }

    if (shouldHydrateSnapshot) {
      requestAgentSnapshotHydrate(
        runId,
        requestVersion,
        subscriptionVersion,
        batch,
      );
    }

    if (shouldResubscribe) {
      requestAgentResubscribe(runId, requestVersion, subscriptionVersion);
    }
  };

  const schedulePendingAgentEventFlush = (
    runId: string,
    requestVersion: number,
    subscriptionVersion: number,
  ): void => {
    if (agentFlushFrameId !== null || agentFlushTimer) {
      return;
    }

    if (typeof requestAnimationFrame === "function") {
      agentFlushFrameId = requestAnimationFrame(() => {
        flushPendingAgentEvents(runId, requestVersion, subscriptionVersion);
      });
      return;
    }

    agentFlushTimer = setTimeout(() => {
      flushPendingAgentEvents(runId, requestVersion, subscriptionVersion);
    }, 16);
  };

  const unsubscribeAgentEvents = (runId?: string): void => {
    isAgentUiSubscribed = false;
    activeAgentSubscriptionVersion += 1;
    clearPendingAgentEventFlush();
    clearPendingAgentSnapshotHydrate();
    clearPendingAgentResubscribe();
    clearCleanupRefreshFollowUpTimer();
    if (removeAgentEventForwarder) {
      removeAgentEventForwarder();
      removeAgentEventForwarder = null;
    }

    const normalizedRunId = runId?.trim();
    const subscriberId = activeAgentSubscriberId?.trim();
    const subscriberRunId = activeAgentSubscriberRunId?.trim();
    activeAgentSubscriberId = null;
    activeAgentSubscriberRunId = null;
    const unsubscribeRunId = subscriberRunId || normalizedRunId;
    if (!unsubscribeRunId) {
      return;
    }

    if (!subscriberId) {
      return;
    }

    void unsubscribeRunOpenCodeEvents(unsubscribeRunId, subscriberId).catch(
      () => {
        // Ignore unsubscribe failures to preserve prior cleanup behavior.
      },
    );
  };

  const subscribeAgentEvents = async (runId: string): Promise<void> => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return;
    }

    if (agentState() === "unsupported" || agentState() === "error") {
      return;
    }

    if (agentChatMode() !== "interactive") {
      return;
    }

    const requestVersion = activeAgentRequestVersion;
    const subscriptionVersion = ++activeAgentSubscriptionVersion;
    clearPendingAgentEventFlush();
    clearPendingAgentSnapshotHydrate();
    clearPendingAgentResubscribe();
    pendingAgentEvents = [];
    const previousSubscriberId = activeAgentSubscriberId?.trim();
    const previousSubscriberRunId = activeAgentSubscriberRunId?.trim();
    activeAgentSubscriberId = null;
    activeAgentSubscriberRunId = null;
    if (removeAgentEventForwarder) {
      removeAgentEventForwarder();
      removeAgentEventForwarder = null;
      if (previousSubscriberId && previousSubscriberRunId) {
        void unsubscribeRunOpenCodeEvents(
          previousSubscriberRunId,
          previousSubscriberId,
        ).catch(() => {
          // Ignore unsubscribe failures during re-subscribe.
        });
      }
    }
    setAgentState("running");
    setAgentReadinessPhase("reconnecting");
    setAgentError("");

    const subscriberId = `run-detail:${normalizedRunId}:${crypto.randomUUID()}`;

    try {
      const removeForwarder = await subscribeRunOpenCodeEvents({
        runId: normalizedRunId,
        subscriberId,
        onOutputChannel: (event) => {
          if (
            requestVersion !== activeAgentRequestVersion ||
            subscriptionVersion !== activeAgentSubscriptionVersion ||
            !isAgentUiSubscribed ||
            params.runId !== normalizedRunId
          ) {
            return;
          }

          pendingAgentEvents.push(event);
          schedulePendingAgentEventFlush(
            normalizedRunId,
            requestVersion,
            subscriptionVersion,
          );
        },
      });

      if (
        requestVersion !== activeAgentRequestVersion ||
        subscriptionVersion !== activeAgentSubscriptionVersion ||
        !isAgentUiSubscribed ||
        params.runId !== normalizedRunId
      ) {
        clearPendingAgentEventFlush();
        clearPendingAgentSnapshotHydrate();
        removeForwarder();
        void unsubscribeRunOpenCodeEvents(normalizedRunId, subscriberId).catch(
          () => {
            // Ignore unsubscribe failures for stale subscriptions.
          },
        );
        return;
      }

      activeAgentSubscriberId = subscriberId;
      activeAgentSubscriberRunId = normalizedRunId;
      removeAgentEventForwarder = removeForwarder;
      setAgentState("running");
      setAgentReadinessPhase("ready");
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

  const submitPrompt = async (
    text: string,
    options?: {
      clientRequestId?: string;
      markCommitPending?: boolean;
      agentId?: string;
      providerId?: string;
      modelId?: string;
    },
  ): Promise<boolean> => {
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
    if (options?.markCommitPending) {
      setRunCommitPending(runId, true);
    }

    try {
      const response = await submitRunOpenCodePrompt({
        runId,
        prompt,
        clientRequestId: options?.clientRequestId,
        agentId: options?.agentId,
        providerId: options?.providerId,
        modelId: options?.modelId,
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
        if (agentState() !== "unsupported" && agentState() !== "error") {
          setAgentReadinessPhase("ready");
        }
        return true;
      }

      setAgentReadinessPhase("submit_failed");
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

      setAgentReadinessPhase("submit_failed");
      setSubmitError(
        getErrorMessage(submitError) || "Failed to submit prompt.",
      );
      return false;
    } finally {
      if (options?.markCommitPending) {
        setRunCommitPending(runId, false);
      }
      if (
        requestVersion === activeAgentRequestVersion &&
        submitVersion === activePromptSubmitVersion &&
        params.runId === runId
      ) {
        setIsSubmittingPrompt(false);
      }
    }
  };

  const replyPermission = async (
    requestId: string,
    decision: "allow" | "deny",
  ): Promise<boolean> => {
    const normalizedRequestId = requestId.trim();
    if (!normalizedRequestId) {
      setPermissionReplyError("Missing permission request.");
      return false;
    }

    const runId = params.runId?.trim() ?? "";
    if (!runId) {
      setPermissionReplyError("Missing run.");
      return false;
    }

    const requestVersion = activeAgentRequestVersion;
    const store = agentStore();
    const pending = store.pendingPermissionsById[normalizedRequestId];
    const sessionId = store.sessionId?.trim() ?? "";
    if (!pending || !sessionId || pending.sessionId !== sessionId) {
      setPermissionReplyError(
        "Permission request is stale. Please wait for refresh.",
      );
      return false;
    }

    setIsReplyingPermission(true);

    try {
      const response = await replyRunOpenCodePermission({
        runId,
        sessionId,
        requestId: normalizedRequestId,
        decision,
        remember: false,
      });

      if (
        requestVersion !== activeAgentRequestVersion ||
        params.runId !== runId
      ) {
        return false;
      }

      if (response.status === "accepted") {
        setPermissionReplyError("");
        return true;
      }

      setPermissionReplyError(
        response.reason?.trim() ||
          "Permission reply is not supported for this run.",
      );
      return false;
    } catch (replyError) {
      if (
        requestVersion !== activeAgentRequestVersion ||
        params.runId !== runId
      ) {
        return false;
      }
      setPermissionReplyError(
        getErrorMessage(replyError) || "Failed to reply to permission request.",
      );
      return false;
    } finally {
      if (
        requestVersion === activeAgentRequestVersion &&
        params.runId === runId
      ) {
        setIsReplyingPermission(false);
      }
    }
  };

  createEffect(() => {
    const runId = params.runId;
    const requestVersion = ++activeAgentRequestVersion;
    clearPendingAgentEventFlush();
    clearPendingAgentSnapshotHydrate();
    setAgentEvents([]);
    setAgentStore(createEmptyAgentStore(null));
    setAgentError("");
    setAgentReadinessPhase(null);
    setAgentChatMode("unavailable");
    activePromptSubmitVersion += 1;
    setIsSubmittingPrompt(false);
    setSubmitError("");
    setIsReplyingPermission(false);
    setPermissionReplyError("");
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

      if (agentChatMode() !== "interactive") {
        return;
      }

      await subscribeAgentEvents(runId);
    })();

    onCleanup(() => {
      unsubscribeAgentEvents(runId);
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
    terminalAppliedSize = null;
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

    const initialTerminalSize = terminalRequestedSize ?? {
      cols: 120,
      rows: 32,
    };

    try {
      const session = await openRunTerminal({
        runId: normalizedRunId,
        routeInstanceId: terminalRouteInstanceId,
        cols: initialTerminalSize.cols,
        rows: initialTerminalSize.rows,
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
      terminalAppliedSize = {
        cols: initialTerminalSize.cols,
        rows: initialTerminalSize.rows,
      };
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
    if (isTerminalInputBlocked()) {
      setTerminalError("Run already completed. Terminal input is disabled.");
      return;
    }

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
    const normalizedCols = Math.max(1, Math.floor(cols));
    const normalizedRows = Math.max(1, Math.floor(rows));

    terminalRequestedSize = {
      cols: normalizedCols,
      rows: normalizedRows,
    };

    const sessionId = terminalSessionId();
    const generation = terminalGeneration();
    if (!sessionId || generation === null) {
      return;
    }

    if (
      terminalAppliedSize &&
      terminalAppliedSize.cols === normalizedCols &&
      terminalAppliedSize.rows === normalizedRows
    ) {
      return;
    }

    try {
      await resizeRunTerminal({
        sessionId,
        generation,
        cols: normalizedCols,
        rows: normalizedRows,
      });
      terminalAppliedSize = {
        cols: normalizedCols,
        rows: normalizedRows,
      };
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

  onCleanup(() => {
    clearPostMergeRedirectTimer();
    clearCleanupRefreshFollowUpTimer();
  });

  const refreshDiffFiles = async (): Promise<void> => {
    const runId = params.runId;
    if (!runId) return;
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

      markDraftAnchorTrustByDiffInvalidation(invalidatedPaths, presentPaths);

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
    refreshDiffFiles,
    review: {
      draftComments: reviewDraftComments,
      getDraftCommentsForFile,
      getDraftCommentsNeedingAttention,
      getDraftReviewSubmissionPlan,
      upsertDraftComment,
      removeDraftComment,
      removeDraftComments,
      validateDraftAnchorsForFile,
    },
    git: {
      status: gitStatus,
      isLoading: isGitStatusLoading,
      statusError: gitStatusError,
      actionError: gitActionError,
      lastActionMessage: gitLastActionMessage,
      isRebasePending: isGitRebasePending,
      isMergePending: isGitMergePending,
      refreshStatus: refreshGitMergeStatus,
      rebaseWorktreeOntoSource,
      mergeWorktreeIntoSource,
    },
    isRunCompleted,
    postMergeCompletionMessage,
    terminal: {
      sessionId: terminalSessionId,
      generation: terminalGeneration,
      isStarting: isTerminalStarting,
      isReady: isTerminalReady,
      isInputEnabled: isTerminalInputEnabled,
      error: terminalError,
      initTerminalForRun,
      writeTerminal,
      resizeTerminal,
      disposeTerminal,
      setTerminalFrameHandler,
    },
    agent: {
      state: agentState,
      chatMode: agentChatMode,
      readinessPhase: agentReadinessPhase,
      events: agentEvents,
      store: agentStore,
      error: agentError,
      isSubmittingPrompt,
      submitError,
      runAgentOptions,
      runProviderOptions,
      runModelOptions,
      visibleRunModelOptions,
      runSelectionOptionsError,
      isReplyingPermission,
      permissionReplyError,
      submitPrompt,
      replyPermission,
      ensureAgentForRun,
      subscribeAgentEvents,
      unsubscribeAgentEvents,
    },
  };
};
