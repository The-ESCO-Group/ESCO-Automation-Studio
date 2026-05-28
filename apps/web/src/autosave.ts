import type { PlcProject } from "@esco/core";
import { deserializeProject, serializeProject } from "@esco/project-store";

/**
 * Best-effort autosave to the browser's localStorage. This is a crash-recovery
 * safety net only — never the primary project format (that is the exported
 * `.plcproj.json` file). Autosave is present only while there are unsaved edits;
 * it is cleared once the work is exported, loaded over, or reverted to clean.
 */
const AUTOSAVE_KEY = "esco:autosave:v1";

export interface AutosaveEntry {
  project: PlcProject;
  savedAt: string;
}

interface StoredAutosave {
  savedAt: string;
  text: string;
}

/** Persist the project as autosave (best-effort; storage errors are ignored). */
export function saveAutosave(project: PlcProject): void {
  try {
    const payload: StoredAutosave = { savedAt: new Date().toISOString(), text: serializeProject(project) };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable / quota exceeded — autosave is best-effort.
  }
}

/** Read the autosaved project, or null when none / unreadable. */
export function loadAutosave(): AutosaveEntry | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredAutosave>;
    if (!stored.text) return null;
    return { project: deserializeProject(stored.text), savedAt: stored.savedAt ?? "" };
  } catch {
    return null;
  }
}

/** Remove any autosaved project. */
export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // ignore
  }
}
