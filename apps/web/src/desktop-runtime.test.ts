import { afterEach, describe, expect, it, vi } from "vitest";
import { isDesktopRuntime, isDesktopStartupRequested } from "./desktop-runtime";

describe("desktop runtime detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not enable the desktop startup in plain browser/node contexts", () => {
    expect(isDesktopRuntime()).toBe(false);
    expect(isDesktopStartupRequested()).toBe(false);
  });

  it("enables the startup when the desktop query flag is present", () => {
    vi.stubGlobal("window", { location: { search: "?desktop-startup=1" } });
    expect(isDesktopRuntime()).toBe(false);
    expect(isDesktopStartupRequested()).toBe(true);
  });

  it("enables the startup inside Tauri", () => {
    vi.stubGlobal("window", { location: { search: "" }, __TAURI_INTERNALS__: {} });
    expect(isDesktopRuntime()).toBe(true);
    expect(isDesktopStartupRequested()).toBe(true);
  });
});
