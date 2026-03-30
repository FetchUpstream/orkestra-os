import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORT_LINKS } from "../../app/config/supportLinks";
import AboutModal from "./AboutModal";

const {
  getNameMock,
  getVersionMock,
  getTauriVersionMock,
  openUrlMock,
  openMock,
} = vi.hoisted(() => ({
  getNameMock: vi.fn<() => Promise<string>>(),
  getVersionMock: vi.fn<() => Promise<string>>(),
  getTauriVersionMock: vi.fn<() => Promise<string>>(),
  openUrlMock: vi.fn<(url: string) => Promise<void>>(),
  openMock: vi.fn<(url: string) => Promise<void>>(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getName: getNameMock,
  getVersion: getVersionMock,
  getTauriVersion: getTauriVersionMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
  open: openMock,
}));

describe("AboutModal", () => {
  beforeEach(() => {
    getNameMock.mockReset();
    getVersionMock.mockReset();
    getTauriVersionMock.mockReset();
    openUrlMock.mockReset();
    openMock.mockReset();

    getNameMock.mockResolvedValue("OrkestraOS");
    getVersionMock.mockResolvedValue("0.1.0");
    getTauriVersionMock.mockResolvedValue("2.0.0");
    openUrlMock.mockResolvedValue();
    openMock.mockResolvedValue();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  const renderOpenModal = () => {
    const [isOpen, setIsOpen] = createSignal(true);
    render(() => (
      <AboutModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    ));
    return { setIsOpen };
  };

  it("renders support info and opens external links", async () => {
    renderOpenModal();

    expect(await screen.findByRole("dialog", { name: "About" })).toBeTruthy();
    expect(screen.getByText("OrkestraOS")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Version 0.1.0")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "GitHub repository" }));
    expect(openUrlMock).toHaveBeenCalledWith(SUPPORT_LINKS.githubRepository);

    fireEvent.click(screen.getByRole("button", { name: "Report bug" }));
    expect(openUrlMock).toHaveBeenCalledWith(SUPPORT_LINKS.issueReporting);
  });

  it("copies debug info to clipboard", async () => {
    renderOpenModal();

    await waitFor(() => {
      expect(screen.getByText("Version 0.1.0")).toBeTruthy();
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Copy debug info" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Debug info copied.")).toBeTruthy();
    });

    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("App: OrkestraOS");
    expect(writeText.mock.calls[0]?.[0]).toContain("Version: 0.1.0");
    expect(writeText.mock.calls[0]?.[0]).toContain("Build:");
  });
});
