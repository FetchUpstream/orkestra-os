import { For, Show, createMemo, type Component } from "solid-js";
import type { UiMessage, UiPart } from "../model/agentTypes";
import RunConversationPart from "./RunConversationPart";

type StepMeta = {
  snapshotHash?: string;
  reason?: string;
  tokens?: string;
  cost?: string;
};

type RunConversationMessageProps = {
  message: UiMessage;
  formatTimestamp: (value: string | number | null) => string;
  formatPayload: (payload: unknown) => string;
};

const INTERNAL_ID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const getMessageActorLabel = (role: string): string => {
  if (role === "assistant") return "Agent";
  if (role === "user") return "You";
  if (role === "system") return "System";
  return "Message";
};

const extractSnapshotHash = (snapshot: unknown): string | null => {
  if (typeof snapshot === "string") {
    return (
      snapshot.replace(INTERNAL_ID_PATTERN, "[internal-id]").trim() || null
    );
  }

  if (snapshot && typeof snapshot === "object") {
    const record = snapshot as Record<string, unknown>;
    const directHash =
      typeof record.hash === "string"
        ? record.hash.replace(INTERNAL_ID_PATTERN, "[internal-id]").trim()
        : null;
    if (directHash) {
      return directHash;
    }

    const nestedSnapshot = record.snapshot;
    if (nestedSnapshot && typeof nestedSnapshot === "object") {
      const nestedRecord = nestedSnapshot as Record<string, unknown>;
      const nestedHash =
        typeof nestedRecord.hash === "string"
          ? nestedRecord.hash
              .replace(INTERNAL_ID_PATTERN, "[internal-id]")
              .trim()
          : null;
      if (nestedHash) {
        return nestedHash;
      }
    }
  }

  return null;
};

const formatStructuredTokenMeta = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const tokenMap = new Map<string, number>();

  const normalizeKey = (key: string): string =>
    key.toLowerCase().replace(/[^a-z0-9]/g, "");

  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || Array.isArray(node) || depth > 3) {
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

const RunConversationMessage: Component<RunConversationMessageProps> = (
  props,
) => {
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

    const serialized = props.formatPayload(value);
    const snippet =
      serialized.length <= 280 ? serialized : `${serialized.slice(0, 280)}...`;
    const normalized = snippet.trim();
    return normalized.length > 0 ? normalized : null;
  };

  const formatStepTokenValue = (value: unknown): string | null => {
    const structured = formatStructuredTokenMeta(value);
    if (structured) {
      return structured;
    }
    return formatStepMetaValue(value);
  };

  const stepMeta = createMemo<StepMeta | null>(() => {
    let snapshotHash: string | null = null;
    let finishReason: string | null = null;
    let finishTokens: string | null = null;
    let finishCost: string | null = null;

    for (const partId of props.message.partOrder) {
      const part = props.message.partsById[partId];
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
      }
    }

    if (!snapshotHash && !finishReason && !finishTokens && !finishCost) {
      return null;
    }

    return {
      snapshotHash: snapshotHash || undefined,
      reason: finishReason || undefined,
      tokens: finishTokens || undefined,
      cost: finishCost || undefined,
    };
  });

  const messagePartIds = createMemo(() => {
    const ids: string[] = [];
    for (const partId of props.message.partOrder) {
      const part = props.message.partsById[partId];
      if (!part) {
        continue;
      }
      if (part.kind === "step-start" || part.kind === "step-finish") {
        continue;
      }
      ids.push(partId);
    }
    return ids;
  });

  const messageTime = createMemo(
    () => props.message.updatedAt ?? props.message.createdAt ?? null,
  );

  return (
    <article class="run-detail-message">
      <header>
        <strong>{getMessageActorLabel(props.message.role)}</strong>
        <span>{props.formatTimestamp(messageTime())}</span>
      </header>

      <Show when={stepMeta()}>
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
        when={messagePartIds().length > 0}
        fallback={<p class="project-placeholder-text">No message parts yet.</p>}
      >
        <div class="run-detail-message-parts">
          <For each={messagePartIds()}>
            {(partId) => {
              const part = createMemo<UiPart | null>(
                () => props.message.partsById[partId] ?? null,
              );

              return (
                <Show when={part()}>
                  {(partValue) => (
                    <RunConversationPart
                      part={partValue()}
                      formatPayload={props.formatPayload}
                    />
                  )}
                </Show>
              );
            }}
          </For>
        </div>
      </Show>
    </article>
  );
};

export default RunConversationMessage;
