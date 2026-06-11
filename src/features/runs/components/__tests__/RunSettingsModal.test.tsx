// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type {
  RunAgentOption,
  RunModelOption,
  RunSelectionOption,
  RunSourceBranchOption,
} from "../../../../app/lib/runs";
import RunSettingsModal from "../RunSettingsModal";

vi.mock("../../../../app/contexts/OpenCodeDependencyContext", () => ({
  useOpenCodeDependency: () => ({
    showRequiredModal: vi.fn(),
  }),
}));

const sourceBranchOptions: RunSourceBranchOption[] = [
  { name: "main", isCheckedOut: true },
  { name: "develop", isCheckedOut: false },
  { name: "feature/existing", isCheckedOut: false },
];

const agentOptions: RunAgentOption[] = [
  {
    id: "agent-1",
    label: "Default agent",
    scope: "project",
    mode: "primary",
    selectable: true,
  },
];

const providerOptions: RunSelectionOption[] = [
  { id: "provider-1", label: "Provider", selectable: true },
];

const modelOptions: RunModelOption[] = [
  {
    id: "model-1",
    providerId: "provider-1",
    label: "Model",
    selectable: true,
  },
];

const renderModal = () => {
  const [selectedSourceBranch, setSelectedSourceBranch] = createSignal("main");
  const [sourceBranchMode, setSourceBranchMode] = createSignal<
    "existing" | "create"
  >("existing");
  const [newSourceBranchName, setNewSourceBranchName] = createSignal("");
  const [newSourceBranchBaseBranch, setNewSourceBranchBaseBranch] =
    createSignal("main");
  const onConfirm = vi.fn(async () => undefined);

  render(() => (
    <RunSettingsModal
      isOpen={() => true}
      isSubmitting={() => false}
      actionError={() => ""}
      hasRunSelectionOptions={() => true}
      isLoadingRunSelectionOptions={() => false}
      isLoadingRunSourceBranches={() => false}
      runSelectionOptionsError={() => ""}
      runSourceBranchError={() => ""}
      runAgentOptions={() => agentOptions}
      runProviderOptions={() => providerOptions}
      runSourceBranchOptions={() => sourceBranchOptions}
      visibleRunModelOptions={() => modelOptions}
      selectedRunAgentId={() => "agent-1"}
      selectedRunProviderId={() => "provider-1"}
      selectedRunModelId={() => "model-1"}
      selectedRunSourceBranch={selectedSourceBranch}
      sourceBranchMode={sourceBranchMode}
      newSourceBranchName={newSourceBranchName}
      newSourceBranchBaseBranch={newSourceBranchBaseBranch}
      setSelectedRunAgentId={vi.fn()}
      setSelectedRunProviderId={vi.fn()}
      setSelectedRunModelId={vi.fn()}
      setSelectedRunSourceBranch={setSelectedSourceBranch}
      setSourceBranchMode={setSourceBranchMode}
      setNewSourceBranchName={setNewSourceBranchName}
      setNewSourceBranchBaseBranch={setNewSourceBranchBaseBranch}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />
  ));

  return {
    selectedSourceBranch,
    sourceBranchMode,
    newSourceBranchName,
    newSourceBranchBaseBranch,
    onConfirm,
  };
};

describe("RunSettingsModal source branch dropdown", () => {
  it("keeps the dropdown open when the branch search input is clicked and typed into", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /mainbranch/i }));
    const searchInput = screen.getByRole("searchbox", {
      name: /search branches/i,
    });

    fireEvent.pointerDown(searchInput);
    fireEvent.click(searchInput);
    fireEvent.input(searchInput, { target: { value: "dev" } });

    expect(
      screen.getByRole("searchbox", { name: /search branches/i }),
    ).not.toBeNull();
    expect(screen.getByRole("option", { name: /develop/i })).not.toBeNull();
    expect(screen.queryByRole("option", { name: /main/i })).toBeNull();
  });

  it("selects an existing branch and closes the dropdown after selection", async () => {
    const modal = renderModal();

    fireEvent.click(screen.getByRole("button", { name: /mainbranch/i }));
    fireEvent.input(screen.getByRole("searchbox", { name: /search branches/i }), {
      target: { value: "develop" },
    });
    fireEvent.click(screen.getByRole("option", { name: /develop/i }));

    expect(modal.selectedSourceBranch()).toBe("develop");
    await waitFor(() =>
      expect(
        screen.queryByRole("searchbox", { name: /search branches/i }),
      ).toBeNull(),
    );
    expect(screen.getByRole("button", { name: /developbranch/i })).not.toBeNull();
  });

  it("shows create-new-branch action for unmatched searches and enters create mode without losing the branch name", () => {
    const modal = renderModal();

    fireEvent.click(screen.getByRole("button", { name: /mainbranch/i }));
    fireEvent.input(screen.getByRole("searchbox", { name: /search branches/i }), {
      target: { value: "feature/new-work" },
    });

    const createAction = screen.getByRole("button", {
      name: /create branch "feature\/new-work"/i,
    });
    expect(createAction).not.toBeNull();

    fireEvent.pointerDown(createAction);
    fireEvent.click(createAction);

    expect(modal.sourceBranchMode()).toBe("create");
    expect(modal.newSourceBranchName()).toBe("feature/new-work");
    expect(modal.newSourceBranchBaseBranch()).toBe("main");
    expect(
      (screen.getByLabelText(/new branch name/i) as HTMLInputElement).value,
    ).toBe("feature/new-work");
    expect(
      (
        screen.getByLabelText(
          /new source branch base branch/i,
        ) as HTMLSelectElement
      ).value,
    ).toBe("main");
  });

  it("closes the dropdown on Escape and outside click", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /mainbranch/i }));
    fireEvent.keyDown(screen.getByRole("searchbox", { name: /search branches/i }), {
      key: "Escape",
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("searchbox", { name: /search branches/i }),
      ).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: /mainbranch/i }));
    expect(
      screen.getByRole("searchbox", { name: /search branches/i }),
    ).not.toBeNull();

    fireEvent.pointerDown(document.body);

    await waitFor(() =>
      expect(
        screen.queryByRole("searchbox", { name: /search branches/i }),
      ).toBeNull(),
    );
  });
});
