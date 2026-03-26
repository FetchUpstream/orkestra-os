import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import type { useRunDetailModel } from "../model/useRunDetailModel";
import RunDiffDrawerPanel from "./RunDiffDrawerPanel";

vi.mock("../../../components/MonacoDiffEditor", () => ({
  default: (props: {
    renderSideBySide?: boolean;
    reviewComments?: Array<{ id: string; body: string }>;
    activeReviewComposer?: { body: string } | null;
    onOpenReviewComposer?: (anchor: {
      side: "original" | "modified";
      lineNumber: number;
    }) => void;
    onUpdateReviewComposerBody?: (body: string) => void;
    onCloseReviewComposer?: () => void;
    onSaveReviewComposer?: () => void;
    onDeleteReviewComment?: (commentId: string) => void;
  }) => (
    <div>
      <div data-testid="monaco-review-props">
        {JSON.stringify({
          renderSideBySide: props.renderSideBySide,
          reviewCount: props.reviewComments?.length ?? 0,
          activeBody: props.activeReviewComposer?.body ?? null,
        })}
      </div>
      <button
        type="button"
        onClick={() =>
          props.onOpenReviewComposer?.({ side: "modified", lineNumber: 4 })
        }
      >
        open composer
      </button>
      <button
        type="button"
        onClick={() => props.onUpdateReviewComposerBody?.("hello")}
      >
        update composer
      </button>
      <button type="button" onClick={() => props.onSaveReviewComposer?.()}>
        save composer
      </button>
      <button type="button" onClick={() => props.onCloseReviewComposer?.()}>
        close composer
      </button>
      <button
        type="button"
        onClick={() => props.onDeleteReviewComment?.("comment-1")}
      >
        delete comment
      </button>
    </div>
  ),
}));

const createModelStub = () => {
  const [diffFiles] = createSignal([
    {
      path: "src/demo.ts",
      additions: 3,
      deletions: 1,
      status: "modified",
    },
  ]);
  const [diffFilePayloads] = createSignal({
    "src/demo.ts": {
      path: "src/demo.ts",
      additions: 3,
      deletions: 1,
      original: "const before = 1;",
      modified: "const after = 2;",
      language: "typescript",
      status: "modified",
      isBinary: false,
      truncated: false,
    },
  });

  const openComposerForFile = vi.fn();
  const updateComposerBodyForFile = vi.fn();
  const closeComposerForFile = vi.fn();
  const saveComposerForFile = vi.fn();
  const removeCommentForFile = vi.fn();

  const model = {
    diffFiles,
    isDiffFilesLoading: () => false,
    diffFilesError: () => "",
    diffFilePayloads,
    diffFileLoadingPaths: () => ({}),
    loadDiffFile: vi.fn(async () => undefined),
    reviewComments: {
      listCommentsForFile: () => [
        {
          id: "comment-1",
          side: "modified",
          lineNumber: 4,
          body: "Looks good",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      getActiveComposerForFile: () => ({
        side: "modified" as const,
        lineNumber: 4,
        body: "Draft",
      }),
      openComposerForFile,
      updateComposerBodyForFile,
      closeComposerForFile,
      saveComposerForFile,
      removeCommentForFile,
    },
  };

  return {
    model: model as unknown as ReturnType<typeof useRunDetailModel>,
    spies: {
      openComposerForFile,
      updateComposerBodyForFile,
      closeComposerForFile,
      saveComposerForFile,
      removeCommentForFile,
    },
  };
};

describe("RunDiffDrawerPanel review comments", () => {
  it("shows unified-mode guidance and forwards comment props", async () => {
    const { model } = createModelStub();
    render(() => (
      <RunDiffDrawerPanel model={model} isActive={true} isSideBySide={false} />
    ));

    expect(
      screen.getByText(
        "Inline comments are available only in side-by-side layout.",
      ),
    ).toBeTruthy();

    await waitFor(() => {
      const payload = JSON.parse(
        screen.getByTestId("monaco-review-props").textContent || "{}",
      ) as {
        renderSideBySide?: boolean;
        reviewCount?: number;
        activeBody?: string | null;
      };
      expect(payload.renderSideBySide).toBe(false);
      expect(payload.reviewCount).toBe(1);
      expect(payload.activeBody).toBe("Draft");
    });
  });

  it("routes Monaco callbacks through model review comment helpers", async () => {
    const { model, spies } = createModelStub();
    render(() => (
      <RunDiffDrawerPanel model={model} isActive={true} isSideBySide={true} />
    ));

    fireEvent.click(
      await screen.findByRole("button", { name: "open composer" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "update composer" }));
    fireEvent.click(screen.getByRole("button", { name: "save composer" }));
    fireEvent.click(screen.getByRole("button", { name: "close composer" }));
    fireEvent.click(screen.getByRole("button", { name: "delete comment" }));

    expect(spies.openComposerForFile).toHaveBeenCalledWith("src/demo.ts", {
      side: "modified",
      lineNumber: 4,
    });
    expect(spies.updateComposerBodyForFile).toHaveBeenCalledWith(
      "src/demo.ts",
      "hello",
    );
    expect(spies.saveComposerForFile).toHaveBeenCalledWith("src/demo.ts");
    expect(spies.closeComposerForFile).toHaveBeenCalledWith("src/demo.ts");
    expect(spies.removeCommentForFile).toHaveBeenCalledWith(
      "src/demo.ts",
      "comment-1",
    );
  });
});
