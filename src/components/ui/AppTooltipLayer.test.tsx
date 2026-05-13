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
import { describe, expect, it } from "vitest";
import AppTooltipLayer from "./AppTooltipLayer";

const renderTooltipFixture = () =>
  render(() => (
    <>
      <AppTooltipLayer />
      <span id="first-help">Existing description</span>
      <button title="First tooltip" aria-describedby="first-help">
        First control
      </button>
      <button title="Second tooltip">Second control</button>
      <button>Elsewhere</button>
    </>
  ));

describe("AppTooltipLayer", () => {
  it("shows title tooltips on hover and restores native title after dismissal", async () => {
    renderTooltipFixture();

    const firstControl = screen.getByRole("button", { name: "First control" });
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });

    await fireEvent.pointerOver(firstControl);

    expect(screen.getByRole("tooltip").textContent).toBe("First tooltip");
    expect(firstControl.hasAttribute("title")).toBe(false);
    expect(firstControl.getAttribute("aria-describedby")).toBe(
      "first-help app-tooltip-layer-tooltip",
    );

    await fireEvent.click(elsewhere);

    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
    expect(firstControl.getAttribute("title")).toBe("First tooltip");
    expect(firstControl.getAttribute("aria-describedby")).toBe("first-help");
  });

  it("shows title tooltips on focus and closes when focus moves elsewhere", async () => {
    renderTooltipFixture();

    const firstControl = screen.getByRole("button", { name: "First control" });
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });

    await fireEvent.focusIn(firstControl);

    expect(screen.getByRole("tooltip").textContent).toBe("First tooltip");
    expect(firstControl.hasAttribute("title")).toBe(false);

    await fireEvent.focusIn(elsewhere);

    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
    expect(firstControl.getAttribute("title")).toBe("First tooltip");
  });

  it("replaces the active tooltip when another title-bearing control opens", async () => {
    renderTooltipFixture();

    const firstControl = screen.getByRole("button", { name: "First control" });
    const secondControl = screen.getByRole("button", { name: "Second control" });

    await fireEvent.pointerOver(firstControl);
    expect(screen.getByRole("tooltip").textContent).toBe("First tooltip");

    await fireEvent.pointerOver(secondControl);

    const tooltips = screen.getAllByRole("tooltip");
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0]?.textContent).toBe("Second tooltip");
    expect(firstControl.getAttribute("title")).toBe("First tooltip");
    expect(secondControl.hasAttribute("title")).toBe(false);
  });

  it("keeps the custom tooltip in sync when the source title changes", async () => {
    renderTooltipFixture();

    const firstControl = screen.getByRole("button", { name: "First control" });
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });

    await fireEvent.pointerOver(firstControl);
    firstControl.setAttribute("title", "Updated tooltip");

    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toBe("Updated tooltip");
    });
    expect(firstControl.hasAttribute("title")).toBe(false);

    await fireEvent.click(elsewhere);

    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
    expect(firstControl.getAttribute("title")).toBe("Updated tooltip");
  });
});
