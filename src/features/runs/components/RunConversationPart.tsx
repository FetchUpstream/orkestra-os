import { createMemo } from "solid-js";
import MarkdownContent from "../../../components/ui/MarkdownContent";
import type { UiPart } from "../model/agentTypes";
import RunToolPart from "./RunToolPart";

type RunConversationPartProps = {
  part: UiPart;
  formatPayload: (payload: unknown) => string;
};

const getPartTypeLabel = (part: UiPart): string => {
  if (part.kind === "unknown") {
    return part.rawType || "unknown";
  }
  return part.type || part.kind;
};

const getPartSnippet = (
  part: UiPart,
  formatPayload: (payload: unknown) => string,
): string => {
  const formatSnippet = (payload: unknown): string => {
    const serialized = formatPayload(payload);
    if (serialized.length <= 280) {
      return serialized;
    }
    return `${serialized.slice(0, 280)}...`;
  };

  if (part.kind === "file") {
    return formatSnippet({
      filename: part.filename,
      mime: part.mime,
      url: part.url,
    });
  }

  if (part.kind === "patch") {
    return formatSnippet({
      hash: part.hash,
      files: Array.isArray(part.files) ? part.files.length : 0,
    });
  }

  if (part.kind === "step-start") {
    return formatSnippet({ snapshot: part.snapshot });
  }

  if (part.kind === "step-finish") {
    return formatSnippet({
      reason: part.reason,
      tokens: part.tokens,
      cost: part.cost,
    });
  }

  if (part.kind === "unknown") {
    return formatSnippet(part.raw ?? { type: part.rawType });
  }

  return formatSnippet(part);
};

const RunConversationPart = (props: RunConversationPartProps) => {
  const partTextContent = createMemo(() => {
    const part = props.part;
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
  });

  if (props.part.kind === "patch") {
    return null;
  }

  if (props.part.kind === "text") {
    return (
      <MarkdownContent
        content={partTextContent()}
        class="run-detail-part run-detail-part--text"
        isStreaming={props.part.streaming}
        renderMode={props.part.streaming ? "plain" : "markdown"}
      />
    );
  }

  if (props.part.kind === "reasoning") {
    return (
      <details class="run-detail-part run-detail-part--reasoning" open>
        <summary>Reasoning</summary>
        <MarkdownContent
          content={partTextContent()}
          isStreaming={props.part.streaming}
          renderMode={props.part.streaming ? "plain" : "markdown"}
        />
      </details>
    );
  }

  if (props.part.kind === "tool") {
    return (
      <RunToolPart part={props.part} formatPayload={props.formatPayload} />
    );
  }

  if (props.part.kind === "file" || props.part.kind === "unknown") {
    return (
      <div class="run-detail-part run-detail-part--fallback">
        <p class="run-detail-part-fallback-label">
          {getPartTypeLabel(props.part)}
        </p>
        <pre>{getPartSnippet(props.part, props.formatPayload)}</pre>
      </div>
    );
  }

  return null;
};

export default RunConversationPart;
