import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invokeDesktopCommand,
  isDesktopRuntime,
  isDesktopStartupRequested,
  promoteDesktopWindowToIde,
} from "./desktop-runtime";

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

  it("does not try to resize the window outside desktop runtime", async () => {
    await expect(promoteDesktopWindowToIde()).resolves.toEqual({ ok: false, reason: "not-desktop" });
  });

  it("promotes the startup window to the full IDE through the Tauri command bridge", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { location: { search: "" }, __TAURI_INTERNALS__: { invoke } });

    await expect(promoteDesktopWindowToIde()).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("promote_desktop_window_to_ide");
  });

  it("supports the Tauri v2 global shape when promoting the IDE window", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { location: { search: "" }, __TAURI__: { core: { invoke } } });

    await expect(promoteDesktopWindowToIde()).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("promote_desktop_window_to_ide");
  });

  it("exposes a browser-safe desktop command bridge for future file-backed flows", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("window", { location: { search: "" }, __TAURI__: { core: { invoke } } });

    await expect(invokeDesktopCommand("desktop_capabilities")).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("desktop_capabilities", undefined);
  });
});
