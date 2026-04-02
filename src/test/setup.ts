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

import { cleanup } from "@solidjs/testing-library";
import { afterEach } from "vitest";

if (typeof HTMLCanvasElement !== "undefined") {
  const canvas2DContextStub = {
    canvas: null as HTMLCanvasElement | null,
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({
      data: new Uint8ClampedArray(0),
      width: 0,
      height: 0,
      colorSpace: "srgb",
    }),
    putImageData: () => {},
    createImageData: () => ({
      data: new Uint8ClampedArray(0),
      width: 0,
      height: 0,
      colorSpace: "srgb",
    }),
    setTransform: () => {},
    resetTransform: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    scale: () => {},
    rotate: () => {},
    translate: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    rect: () => {},
    clip: () => {},
    measureText: () => ({ width: 0 }),
    fillText: () => {},
    strokeText: () => {},
    setLineDash: () => {},
    getLineDash: () => [],
    isPointInPath: () => false,
    isPointInStroke: () => false,
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => null,
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: function (contextId: string) {
      if (contextId === "2d") {
        return { ...canvas2DContextStub, canvas: this };
      }

      return null;
    },
    writable: true,
    configurable: true,
  });
}

Object.defineProperty(window, "scrollTo", {
  value: () => {},
  writable: true,
});

if (!("queryCommandSupported" in document)) {
  Object.defineProperty(document, "queryCommandSupported", {
    value: () => false,
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
});
