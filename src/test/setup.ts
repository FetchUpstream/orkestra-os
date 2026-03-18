import { cleanup } from "@solidjs/testing-library";
import { afterEach } from "vitest";

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
