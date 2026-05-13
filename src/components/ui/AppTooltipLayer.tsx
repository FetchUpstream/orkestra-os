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

import {
  Show,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";

type TooltipPlacement = "top" | "bottom";

type TooltipState = {
  target: HTMLElement;
  text: string;
  x: number;
  y: number;
  placement: TooltipPlacement;
};

type RestoredTooltipAttributes = {
  title: string;
  describedBy: string | null;
};

const TOOLTIP_ID = "app-tooltip-layer-tooltip";
const TOOLTIP_GAP_PX = 8;
const TOOLTIP_MARGIN_PX = 8;
const TOOLTIP_MAX_WIDTH_PX = 280;
const MIN_TOP_PLACEMENT_SPACE_PX = 48;

const originalAttributesByElement = new WeakMap<
  HTMLElement,
  RestoredTooltipAttributes
>();

const getViewportWidth = () =>
  window.innerWidth || document.documentElement.clientWidth || 1024;

const getTooltipTarget = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof Element)) return null;

  const element = target.closest<HTMLElement>("[title]");
  const text = element?.getAttribute("title")?.trim();
  return element && text ? element : null;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getTooltipPosition = (
  target: HTMLElement,
): Pick<TooltipState, "x" | "y" | "placement"> => {
  const rect = target.getBoundingClientRect();
  const viewportWidth = getViewportWidth();
  const tooltipWidth = Math.min(
    TOOLTIP_MAX_WIDTH_PX,
    Math.max(0, viewportWidth - TOOLTIP_MARGIN_PX * 2),
  );
  const halfTooltipWidth = tooltipWidth / 2;
  const minX = TOOLTIP_MARGIN_PX + halfTooltipWidth;
  const maxX = Math.max(
    minX,
    viewportWidth - TOOLTIP_MARGIN_PX - halfTooltipWidth,
  );
  const x = clamp(rect.left + rect.width / 2, minX, maxX);
  const placement =
    rect.top >= MIN_TOP_PLACEMENT_SPACE_PX ? "top" : "bottom";

  return {
    x,
    y:
      placement === "top"
        ? rect.top - TOOLTIP_GAP_PX
        : rect.bottom + TOOLTIP_GAP_PX,
    placement,
  };
};

const appendDescribedBy = (value: string | null, id: string) => {
  const ids = value?.split(/\s+/).filter(Boolean) ?? [];
  return ids.includes(id) ? ids.join(" ") : [...ids, id].join(" ");
};

const hideNativeTitle = (target: HTMLElement, title: string) => {
  const restoredAttributes = originalAttributesByElement.get(target);
  if (restoredAttributes) {
    restoredAttributes.title = title;
  } else {
    originalAttributesByElement.set(target, {
      title,
      describedBy: target.getAttribute("aria-describedby"),
    });
  }

  target.removeAttribute("title");
  target.setAttribute(
    "aria-describedby",
    appendDescribedBy(target.getAttribute("aria-describedby"), TOOLTIP_ID),
  );
  target.setAttribute("data-app-tooltip-active", "true");
};

const restoreNativeTitle = (target: HTMLElement) => {
  const restoredAttributes = originalAttributesByElement.get(target);
  if (!restoredAttributes) {
    target.removeAttribute("data-app-tooltip-active");
    return;
  }

  if (!target.hasAttribute("title")) {
    target.setAttribute("title", restoredAttributes.title);
  }
  if (restoredAttributes.describedBy) {
    target.setAttribute("aria-describedby", restoredAttributes.describedBy);
  } else {
    target.removeAttribute("aria-describedby");
  }

  target.removeAttribute("data-app-tooltip-active");
  originalAttributesByElement.delete(target);
};

const AppTooltipLayer: Component = () => {
  const [tooltip, setTooltip] = createSignal<TooltipState | null>(null);
  let titleObserver: MutationObserver | undefined;

  const stopObservingTitle = () => {
    titleObserver?.disconnect();
    titleObserver = undefined;
  };

  const observeTitle = (target: HTMLElement) => {
    stopObservingTitle();
    titleObserver = new MutationObserver(() => {
      const current = tooltip();
      if (!current || current.target !== target) return;

      const nextText = target.getAttribute("title")?.trim();
      if (!nextText) return;

      hideNativeTitle(target, nextText);
      setTooltip({
        target,
        text: nextText,
        ...getTooltipPosition(target),
      });
    });
    titleObserver.observe(target, {
      attributes: true,
      attributeFilter: ["title"],
    });
  };

  const closeTooltip = () => {
    const current = tooltip();
    if (!current) return;
    stopObservingTitle();
    restoreNativeTitle(current.target);
    setTooltip(null);
  };

  const openTooltip = (target: HTMLElement) => {
    const text = target.getAttribute("title")?.trim();
    if (!text) return;

    const current = tooltip();
    if (current?.target !== target) {
      closeTooltip();
    }

    hideNativeTitle(target, text);
    setTooltip({
      target,
      text,
      ...getTooltipPosition(target),
    });
    observeTitle(target);
  };

  onMount(() => {
    const handlePointerOver = (event: PointerEvent) => {
      const current = tooltip();
      if (
        current &&
        event.target instanceof Node &&
        current.target.contains(event.target)
      ) {
        return;
      }

      const target = getTooltipTarget(event.target);
      if (target) {
        openTooltip(target);
      }
    };

    const handlePointerOut = (event: PointerEvent) => {
      const current = tooltip();
      if (!current || !(event.target instanceof Node)) return;
      if (!current.target.contains(event.target)) return;
      if (
        event.relatedTarget instanceof Node &&
        current.target.contains(event.relatedTarget)
      ) {
        return;
      }

      closeTooltip();
      stopObservingTitle();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = getTooltipTarget(event.target);
      if (target) {
        openTooltip(target);
        return;
      }

      const current = tooltip();
      if (
        current &&
        event.target instanceof Node &&
        !current.target.contains(event.target)
      ) {
        closeTooltip();
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      const current = tooltip();
      if (!current) return;
      if (
        event.relatedTarget instanceof Node &&
        current.target.contains(event.relatedTarget)
      ) {
        return;
      }

      closeTooltip();
    };

    const handlePointerDown = (event: PointerEvent) => {
      const current = tooltip();
      if (!current) return;
      if (
        event.target instanceof Node &&
        current.target.contains(event.target)
      ) {
        return;
      }

      closeTooltip();
    };

    const handleClick = () => closeTooltip();
    const handleScrollOrResize = () => closeTooltip();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTooltip();
      }
    };

    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("pointerout", handlePointerOut);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, true);

    onCleanup(() => {
      closeTooltip();
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, true);
    });
  });

  return (
    <Show when={tooltip()}>
      {(current) => (
        <div
          id={TOOLTIP_ID}
          class="app-tooltip-surface"
          role="tooltip"
          data-placement={current().placement}
          style={{
            left: `${current().x}px`,
            top: `${current().y}px`,
            transform:
              current().placement === "top"
                ? "translate(-50%, -100%)"
                : "translate(-50%, 0)",
          }}
        >
          {current().text}
        </div>
      )}
    </Show>
  );
};

export default AppTooltipLayer;
