/**
 * Lightweight, in-session activity log surfaced in the inspector's History tab.
 * It records coarse project-level events (imports, exports, AI applies, file
 * opens) — not individual ladder edits, which are covered by undo/redo. The log
 * is intentionally ephemeral: it lives in React state and is not persisted.
 */
export type ActivityKind = "import" | "export" | "open" | "ai" | "compare" | "info";

export interface ActivityEntry {
  id: number;
  at: string;
  kind: ActivityKind;
  message: string;
}

const ACTIVITY_LIMIT = 50;

let nextId = 1;

/** Prepend a new entry (most-recent-first) and cap the log length. */
export function recordActivity(
  log: ActivityEntry[],
  kind: ActivityKind,
  message: string,
): ActivityEntry[] {
  const entry: ActivityEntry = { id: nextId++, at: new Date().toISOString(), kind, message };
  return [entry, ...log].slice(0, ACTIVITY_LIMIT);
}
