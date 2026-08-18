import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearStaleChunkMarker,
  isStaleChunkError,
  recoverFromStaleChunk
} from "@/router/stale-chunk";

const assign = vi.fn();

beforeEach(() => {
  assign.mockClear();
  window.sessionStorage.clear();
  // jsdom refuses real navigation, so the call is observed rather than performed.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stale chunk detection", () => {
  // Each engine words this differently, and matching only Chrome's phrasing
  // would leave Firefox and Safari users stuck on a dead page.
  it.each([
    "Failed to fetch dynamically imported module: https://x/assets/AdminLayout-D_YmfkUs.js",
    "error loading dynamically imported module",
    "Importing a module script failed."
  ])("recognises %s", (message) => {
    expect(isStaleChunkError(new Error(message))).toBe(true);
  });

  it("ignores unrelated navigation failures", () => {
    expect(isStaleChunkError(new Error("Navigation aborted"))).toBe(false);
    expect(isStaleChunkError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

describe("recovery", () => {
  const staleError = new Error("Failed to fetch dynamically imported module: /assets/x.js");

  it("reloads the target path once", () => {
    expect(recoverFromStaleChunk(staleError, "/admin/dashboard")).toBe(true);
    expect(assign).toHaveBeenCalledWith("/admin/dashboard");
  });

  it("refuses a second reload for the same path, so an offline client cannot loop", () => {
    expect(recoverFromStaleChunk(staleError, "/admin/dashboard")).toBe(true);
    expect(recoverFromStaleChunk(staleError, "/admin/dashboard")).toBe(false);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("does not reload for an error that is not a stale chunk", () => {
    expect(recoverFromStaleChunk(new Error("Navigation aborted"), "/admin/x")).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("releases the budget once a navigation succeeds", () => {
    recoverFromStaleChunk(staleError, "/admin/dashboard");
    clearStaleChunkMarker();
    expect(recoverFromStaleChunk(staleError, "/admin/dashboard")).toBe(true);
    expect(assign).toHaveBeenCalledTimes(2);
  });

  it("refuses to reload when sessionStorage is unavailable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied");
    });
    expect(recoverFromStaleChunk(staleError, "/admin/dashboard")).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    getItem.mockRestore();
  });
});
