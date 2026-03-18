import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import * as runChatMarkdownModule from "../../lib/runChatMarkdown";
import RunChatMarkdown from "../chat/RunChatMarkdown";

describe("RunConversationPart markdown transitions", () => {
  it("defaults to markdown when renderMode is omitted", () => {
    const content = "Visit [Docs](https://example.com) and **ship**";
    const { container } = render(() => <RunChatMarkdown content={content} />);

    const markdownRegion = container.querySelector(
      ".run-chat-markdown",
    ) as HTMLElement;

    const docsLink = within(markdownRegion).getByRole("link", { name: "Docs" });
    expect(docsLink.getAttribute("href")).toBe("https://example.com");
    expect(
      within(markdownRegion).getByText("ship", { selector: "strong" }),
    ).toBeTruthy();
    expect(within(markdownRegion).queryByText(content)).toBeNull();
  });

  it("switches plain -> markdown -> plain at runtime", async () => {
    const content = "Visit [Docs](https://example.com) and **ship**";

    const { container } = render(() => {
      const [renderMode, setRenderMode] = createSignal<"plain" | "markdown">(
        "plain",
      );

      return (
        <div>
          <button type="button" onClick={() => setRenderMode("markdown")}>
            switch to markdown
          </button>
          <button type="button" onClick={() => setRenderMode("plain")}>
            switch to plain
          </button>
          <RunChatMarkdown content={content} renderMode={renderMode()} />
        </div>
      );
    });

    const getMarkdownRegion = () =>
      container.querySelector(".run-chat-markdown") as HTMLElement;

    expect(within(getMarkdownRegion()).getByText(content)).toBeTruthy();
    expect(
      within(getMarkdownRegion()).queryByRole("link", { name: "Docs" }),
    ).toBeNull();
    expect(
      within(getMarkdownRegion()).queryByText("ship", { selector: "strong" }),
    ).toBeNull();

    await fireEvent.click(
      screen.getByRole("button", { name: "switch to markdown" }),
    );

    expect(within(getMarkdownRegion()).queryByText(content)).toBeNull();
    const docsLink = within(getMarkdownRegion()).getByRole("link", {
      name: "Docs",
    });
    expect(docsLink.getAttribute("href")).toBe("https://example.com");
    expect(
      within(getMarkdownRegion()).getByText("ship", { selector: "strong" }),
    ).toBeTruthy();

    await fireEvent.click(
      screen.getByRole("button", { name: "switch to plain" }),
    );

    expect(within(getMarkdownRegion()).getByText(content)).toBeTruthy();
    expect(
      within(getMarkdownRegion()).queryByRole("link", { name: "Docs" }),
    ).toBeNull();
    expect(
      within(getMarkdownRegion()).queryByText("ship", { selector: "strong" }),
    ).toBeNull();
  });

  it("gates markdown parsing by render mode transitions", async () => {
    const content = "Visit [Docs](https://example.com) and **ship**";
    const parseSpy = vi
      .spyOn(runChatMarkdownModule, "renderRunChatMarkdown")
      .mockReturnValue("<p>parsed</p>");

    render(() => {
      const [renderMode, setRenderMode] = createSignal<"plain" | "markdown">(
        "plain",
      );

      return (
        <div>
          <button type="button" onClick={() => setRenderMode("markdown")}>
            switch to markdown
          </button>
          <button type="button" onClick={() => setRenderMode("plain")}>
            switch to plain
          </button>
          <RunChatMarkdown content={content} renderMode={renderMode()} />
        </div>
      );
    });

    expect(parseSpy).not.toHaveBeenCalled();

    await fireEvent.click(
      screen.getByRole("button", { name: "switch to markdown" }),
    );
    expect(parseSpy).toHaveBeenCalledTimes(1);

    await fireEvent.click(
      screen.getByRole("button", { name: "switch to plain" }),
    );
    expect(parseSpy).toHaveBeenCalledTimes(1);

    parseSpy.mockRestore();
  });
});
