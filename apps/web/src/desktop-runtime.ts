interface TauriInternals {
  invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
}

interface TauriGlobal {
  core?: TauriInternals;
}

interface DesktopWindow extends Window {
  __TAURI_INTERNALS__?: TauriInternals;
  __TAURI__?: TauriGlobal;
}

export type DesktopWindowPromotionResult =
  | { ok: true }
  | { ok: false; reason: "not-desktop" | "invoke-unavailable" | "invoke-failed" };

export type DesktopWindowAction = "minimize" | "toggle-maximize" | "close";

export function isDesktopRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

export function isDesktopStartupRequested(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return isDesktopRuntime() || params.has("desktop-startup");
}

function getTauriInvoke(): TauriInternals["invoke"] | null {
  if (typeof window === "undefined") return null;
  const desktopWindow = window as DesktopWindow;
  return desktopWindow.__TAURI__?.core?.invoke ?? desktopWindow.__TAURI_INTERNALS__?.invoke ?? null;
}

export async function promoteDesktopWindowToIde(): Promise<DesktopWindowPromotionResult> {
  if (!isDesktopRuntime()) return { ok: false, reason: "not-desktop" };
  const invoke = getTauriInvoke();
  if (!invoke) return { ok: false, reason: "invoke-unavailable" };
  try {
    await invoke("promote_desktop_window_to_ide");
    return { ok: true };
  } catch {
    return { ok: false, reason: "invoke-failed" };
  }
}

export async function invokeDesktopCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  if (!isDesktopRuntime()) return undefined;
  const invoke = getTauriInvoke();
  if (!invoke) return undefined;
  return invoke<T>(command, args);
}

export async function controlDesktopWindow(action: DesktopWindowAction): Promise<void> {
  if (isDesktopRuntime()) {
    await invokeDesktopCommand<void>("desktop_window_action", { action });
    return;
  }

  if (action === "close" && typeof window !== "undefined") {
    window.close();
  }
}
