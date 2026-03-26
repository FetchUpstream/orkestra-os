import { render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import type { useRunDetailModel } from "../model/useRunDetailModel";
import RunDiffDrawerPanel from "./RunDiffDrawerPanel";

vi.mock("../../../components/MonacoDiffEditor", () => ({
  default: (props: { renderSideBySide?: boolean }) => (
    <div data-testid="monaco-props">{String(props.renderSideBySide)}</div>
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

  const model = {
    diffFiles,
    isDiffFilesLoading: () => false,
    diffFilesError: () => "",
    diffFilePayloads,
    diffFileLoadingPaths: () => ({}),
    loadDiffFile: vi.fn(async () => undefined),
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
    const { model, spies } = createModelStub();
    render(() => (
      <RunDiffDrawerPanel model={model} isActive={true} isSideBySide={true} />
    ));

    await waitFor(() => {
      expect(spies.loadDiffFile).toHaveBeenCalledWith("src/demo.ts");
    });
  });

  it("forwards layout mode to Monaco diff editor", async () => {
    const { model } = createModelStub();
    render(() => (
      <RunDiffDrawerPanel model={model} isActive={true} isSideBySide={false} />
    ));

    const monacoProps = await screen.findByTestId("monaco-props");
    expect(monacoProps.textContent).toBe("false");
  });
});
