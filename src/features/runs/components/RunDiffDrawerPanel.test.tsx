import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import type { useRunDetailModel } from "../model/useRunDetailModel";
import RunDiffDrawerPanel from "./RunDiffDrawerPanel";

vi.mock("../../../components/CodeMirrorDiffEditor", () => ({
  default: (props: {
    renderSideBySide?: boolean;
    filePath?: string;
    canCreateDraftComments?: boolean;
    draftComments?: { id: string }[];
  }) => (
    <div data-testid="diff-props">
      {String(props.renderSideBySide)}|{props.filePath}|
      {String(props.canCreateDraftComments)}|{props.draftComments?.length ?? 0}
    </div>
  ),
}));

const createModelStub = (options?: { withPayloads?: boolean }) => {
  const [diffFiles] = createSignal([
    {
      path: "src/demo.ts",
      additions: 3,
      deletions: 1,
      status: "modified",
    },
    {
      path: "src/other.ts",
      additions: 7,
      deletions: 2,
      status: "modified",
    },
  ]);
  const [diffFilePayloads] = createSignal(
    options?.withPayloads === false
      ? {}
      : {
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
          "src/other.ts": {
            path: "src/other.ts",
            additions: 7,
            deletions: 2,
            original: "export const oldValue = 1;",
            modified: "export const newValue = 2;",
            language: "typescript",
            status: "modified",
            isBinary: false,
            truncated: false,
          },
        },
  );

  const model = {
    diffFiles,
    isDiffFilesLoading: () => false,
    diffFilesError: () => "",
    diffFilePayloads,
    diffFileLoadingPaths: () => ({}),
    loadDiffFile: vi.fn(async () => undefined),
    review: {
      getDraftCommentsForFile: vi.fn((path: string) =>
        path === "src/demo.ts"
          ? [
              {
                id: "draft-1",
                filePath: "src/demo.ts",
                side: "modified",
                line: 1,
                body: "Looks good.",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                anchorTrust: "trusted",
                anchorTrustReason: "created",
              },
            ]
          : [],
      ),
      getDraftCommentsNeedingAttention: vi.fn(() => []),
      upsertDraftComment: vi.fn(),
      removeDraftComment: vi.fn(),
      validateDraftAnchorsForFile: vi.fn(),
    },
  };

  return {
    model: model as unknown as ReturnType<typeof useRunDetailModel>,
    spies: {
      loadDiffFile: model.loadDiffFile,
    },
  };
};

describe("RunDiffDrawerPanel", () => {
  it("loads expanded diff files when active", async () => {
    const { model, spies } = createModelStub({ withPayloads: false });
    render(() => (
      <RunDiffDrawerPanel model={model} isActive={true} isSideBySide={true} />
    ));

    await waitFor(() => {
      expect(spies.loadDiffFile).toHaveBeenCalledWith("src/demo.ts");
    });
    expect(spies.loadDiffFile).toHaveBeenCalledTimes(1);
  });

  it("forwards layout mode to CodeMirror diff editor", async () => {
    const { model } = createModelStub();
    render(() => (
      <RunDiffDrawerPanel model={model} isActive={true} isSideBySide={false} />
    ));

    const diffProps = await screen.findByTestId("diff-props");
    expect(diffProps.textContent).toBe("false|src/demo.ts|false|1");
    expect(
      screen.getByText(/Inline review comments are available only in/i),
    ).toBeTruthy();
  });

  it("keeps only one file expanded and mounts one editor", async () => {
    const { model } = createModelStub();
    render(() => (
      <RunDiffDrawerPanel model={model} isActive={true} isSideBySide={true} />
    ));

    await waitFor(() => {
      expect(screen.getAllByTestId("diff-props")).toHaveLength(1);
      expect(screen.getByText("true|src/demo.ts|true|1")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /src\/other\.ts/i }));

    await waitFor(() => {
      expect(screen.getAllByTestId("diff-props")).toHaveLength(1);
      expect(screen.queryByText("true|src/demo.ts|true|1")).toBeNull();
      expect(screen.getByText("true|src/other.ts|true|0")).toBeTruthy();
    });
  });

  it("surfaces untrusted draft anchors in fallback list", async () => {
    const { model } = createModelStub();
    model.review.getDraftCommentsNeedingAttention = vi.fn(() => [
      {
        id: "draft-untrusted",
        filePath: "src/demo.ts",
        side: "modified" as const,
        line: 4,
        body: "Keep this note.",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        anchorTrust: "untrusted" as const,
        anchorTrustReason: "line_not_commentable" as const,
      },
    ]);

    render(() => (
      <RunDiffDrawerPanel model={model} isActive={true} isSideBySide={true} />
    ));

    expect(screen.getByText("Needs review")).toBeTruthy();
    expect(screen.getByText(/src\/demo\.ts: line 4/i)).toBeTruthy();
    expect(
      screen.getByText(/Anchored line is not in a changed hunk anymore\./i),
    ).toBeTruthy();
    expect(screen.getByText("Keep this note.")).toBeTruthy();
  });
});
