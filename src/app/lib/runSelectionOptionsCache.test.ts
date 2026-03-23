import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRunSelectionOptionsWithCache,
  primeRunSelectionOptionsCache,
  readRunSelectionOptionsCache,
  resetRunSelectionOptionsCacheForTests,
} from "./runSelectionOptionsCache";

const { getRunSelectionOptionsMock } = vi.hoisted(() => ({
  getRunSelectionOptionsMock: vi.fn(),
}));

vi.mock("./runs", () => ({
  getRunSelectionOptions: getRunSelectionOptionsMock,
}));

describe("runSelectionOptionsCache", () => {
  beforeEach(() => {
    resetRunSelectionOptionsCacheForTests();
    getRunSelectionOptionsMock.mockReset();
  });

  it("loads once and serves cached values", async () => {
    getRunSelectionOptionsMock.mockResolvedValue({
      agents: [{ id: "agent-1", label: "Agent" }],
      providers: [{ id: "provider-1", label: "Provider" }],
      models: [{ id: "model-1", label: "Model", providerId: "provider-1" }],
    });

    const first = await getRunSelectionOptionsWithCache();
    const second = await getRunSelectionOptionsWithCache();

    expect(first.providers).toEqual([{ id: "provider-1", label: "Provider" }]);
    expect(second.providers).toEqual([{ id: "provider-1", label: "Provider" }]);
    expect(getRunSelectionOptionsMock).toHaveBeenCalledTimes(1);
  });

  it("supports startup warmup and cache read", async () => {
    getRunSelectionOptionsMock.mockResolvedValue({
      agents: [],
      providers: [{ id: "provider-1", label: "Provider" }],
      models: [],
    });

    primeRunSelectionOptionsCache();
    await Promise.resolve();
    await Promise.resolve();

    expect(readRunSelectionOptionsCache()).toEqual({
      agents: [],
      providers: [{ id: "provider-1", label: "Provider" }],
      models: [],
    });
  });
});
