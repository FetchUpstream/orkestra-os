export type RunReviewAnchorTrust = "trusted" | "needs_validation" | "untrusted";

export type RunReviewAnchorTrustReason =
  | "created"
  | "diff_changed"
  | "file_removed"
  | "line_out_of_range"
  | "line_not_commentable"
  | "snippet_mismatch"
  | "side_not_supported";

export type ReviewAnchorValidationInput = {
  side: "original" | "modified";
  line: number;
  anchorLineSnippet?: string;
  modifiedLineCount: number;
  commentableModifiedLines: ReadonlySet<number>;
  modifiedLineTextByLine: ReadonlyMap<number, string>;
};

export type ReviewAnchorValidationResult = {
  trust: RunReviewAnchorTrust;
  reason?: RunReviewAnchorTrustReason;
};

const normalizeLineSnippet = (value: string | undefined): string => {
  return (value ?? "").trim();
};

export const validateReviewAnchor = (
  input: ReviewAnchorValidationInput,
): ReviewAnchorValidationResult => {
  if (input.side !== "modified") {
    return {
      trust: "untrusted",
      reason: "side_not_supported",
    };
  }

  const normalizedLine = Number.isFinite(input.line)
    ? Math.max(1, Math.floor(input.line))
    : NaN;

  if (
    !Number.isFinite(normalizedLine) ||
    normalizedLine > input.modifiedLineCount
  ) {
    return {
      trust: "untrusted",
      reason: "line_out_of_range",
    };
  }

  if (!input.commentableModifiedLines.has(normalizedLine)) {
    return {
      trust: "untrusted",
      reason: "line_not_commentable",
    };
  }

  const expectedSnippet = normalizeLineSnippet(input.anchorLineSnippet);
  if (expectedSnippet.length > 0) {
    const currentSnippet = normalizeLineSnippet(
      input.modifiedLineTextByLine.get(normalizedLine),
    );
    if (currentSnippet !== expectedSnippet) {
      return {
        trust: "untrusted",
        reason: "snippet_mismatch",
      };
    }
  }

  return {
    trust: "trusted",
  };
};
