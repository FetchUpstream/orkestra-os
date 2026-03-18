import { cleanup } from "@solidjs/testing-library";
import { afterEach } from "vitest";

Object.defineProperty(window, "scrollTo", {
  value: () => {},
  writable: true,
});

Object.defineProperty(document, "queryCommandSupported", {
  value: () => false,
  writable: true,
});

afterEach(() => {
  cleanup();
});
