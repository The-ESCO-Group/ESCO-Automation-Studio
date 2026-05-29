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

/** Max reviewed-action labels listed inline before the rest are summarized. */
const AI_AUDIT_LABEL_LIMIT = 5;

export interface AiApplyOutcome {
  ok: boolean;
  appliedCount: number;
  /** Labels of the reviewed project-actions the AI proposed (in plan order). */
  actionLabels: string[];
  error?: string;
}

/**
 * Build the audit-trail message for an applied (or blocked) AI plan. A blocked
 * apply is recorded too, so the History tab is an honest record of what the AI
 * changed — and of anything the reviewed action layer refused.
 */
export function aiApplyActivityMessage(planTitle: string, outcome: AiApplyOutcome): string {
  if (!outcome.ok) {
    return `AI apply blocked: ${outcome.error ?? "rejected by the reviewed action layer"}.`;
  }
  const shown = outcome.actionLabels.slice(0, AI_AUDIT_LABEL_LIMIT).join("; ");
  const remaining = outcome.actionLabels.length - AI_AUDIT_LABEL_LIMIT;
  const extra = remaining > 0 ? ` (+${remaining} more)` : "";
  const detail = outcome.actionLabels.length ? `: ${shown}${extra}` : "";
  return `Applied "${planTitle}" — ${outcome.appliedCount} action(s)${detail}.`;
}
