/** Browser + desktop helpers for project file I/O. */

interface DesktopInvoke {
  invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
}

interface DesktopGlobal {
  core?: DesktopInvoke;
}

interface DesktopWindow extends Window {
  __TAURI_INTERNALS__?: DesktopInvoke;
  __TAURI__?: DesktopGlobal;
}

export interface DesktopTextFile {
  text: string;
  fileName: string;
  path: string;
}

export interface DesktopSavedFile {
  fileName: string;
  path: string;
}

function invokeDesktopCommand<T>(command: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (typeof window === "undefined") return Promise.resolve(undefined);
  const desktopWindow = window as DesktopWindow;
  const invoke = desktopWindow.__TAURI__?.core?.invoke ?? desktopWindow.__TAURI_INTERNALS__?.invoke;
  if (!invoke) return Promise.resolve(undefined);
  return invoke<T>(command, args);
}

export async function openDesktopProjectFile(): Promise<DesktopTextFile | null | undefined> {
  return invokeDesktopCommand<DesktopTextFile | null>("open_project_file");
}

export async function readDesktopProjectFile(path: string): Promise<DesktopTextFile | null | undefined> {
  return invokeDesktopCommand<DesktopTextFile>("read_project_file", { path });
}

export async function saveDesktopProjectFile(input: {
  path?: string;
  suggestedName: string;
  text: string;
}): Promise<DesktopSavedFile | null | undefined> {
  return invokeDesktopCommand<DesktopSavedFile | null>("save_project_file", input);
}

/** Trigger a browser download of `text` as `filename`. */
export function downloadTextFile(
  filename: string,
  text: string,
  mime = "application/json",
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Read a picked file as UTF-8 text. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsText(file);
  });
}

/** Filesystem-safe slug for a project name, used to suggest a download filename. */
export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}
