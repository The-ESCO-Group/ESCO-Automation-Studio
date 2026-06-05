import { invokeDesktopCommand, isDesktopRuntime } from "./desktop-runtime";

/** Result of asking the desktop shell to open a Git terminal. */
export interface OpenGitTerminalResult {
  ok: boolean;
  error?: string;
}

/**
 * Open a PowerShell terminal (in the desktop app) where the engineer can run Git
 * directly — commit, push, pull, clone, etc. `path` is the folder to open in,
 * typically the current project's folder; omit it to open in the user's home.
 *
 * In the browser build there is no terminal to open, so this reports that the
 * action lives in the desktop app rather than failing silently.
 */
export async function openGitTerminal(path?: string): Promise<OpenGitTerminalResult> {
  if (!isDesktopRuntime()) {
    return { ok: false, error: "The Git terminal opens in the ESCO Automation Studio desktop app." };
  }
  try {
    const bridgeReady = await invokeDesktopCommand<unknown>("desktop_capabilities");
    if (bridgeReady === undefined) {
      return {
        ok: false,
        error: "The Git terminal command is not available. Restart the ESCO Automation Studio desktop app and try again.",
      };
    }
    await invokeDesktopCommand<void>("open_git_terminal", { path });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
