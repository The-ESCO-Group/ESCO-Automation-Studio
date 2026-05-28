import { createId, nowIso } from "@esco/shared";
import type { ValidationFinding } from "@esco/validator";

/**
 * Audit-log event shapes and factories. Pure and UI-free: this defines the event
 * contract and builds timestamped events for the things worth tracking
 * (validation runs, imports/exports, and AI-applied edits). It does not persist
 * anything — the UI/host owns where the log lives.
 */

export type AuditEventType = "validation-run" | "import" | "export" | "ai-apply" | "edit";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  /** ISO-8601 timestamp. */
  at: string;
  /** One-line human-readable summary. */
  summary: string;
  /** Optional structured detail (counts, names, etc.). */
  details?: Record<string, unknown>;
}

function event(type: AuditEventType, summary: string, details?: Record<string, unknown>): AuditEvent {
  return { id: createId("audit"), type, at: nowIso(), summary, ...(details ? { details } : {}) };
}

/** Record a validation run with its error/warning/info counts. */
export function auditValidationRun(findings: ValidationFinding[]): AuditEvent {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;
  return event(
    "validation-run",
    `Validated: ${errors} error(s), ${warnings} warning(s), ${info} info.`,
    { errors, warnings, info, total: findings.length },
  );
}

/** Record an import (e.g. an L5X or .plcproj.json load). */
export function auditImport(source: string, details?: Record<string, unknown>): AuditEvent {
  return event("import", `Imported ${source}.`, { source, ...details });
}

/** Record an export (e.g. a generated L5X, .plcproj.json, or CSV). */
export function auditExport(format: string, name: string): AuditEvent {
  return event("export", `Exported ${name} as ${format}.`, { format, name });
}

/** Record an AI-applied edit (the labels of the actions applied in one run). */
export function auditAiApply(actionLabels: string[]): AuditEvent {
  return event("ai-apply", `AI applied ${actionLabels.length} action(s).`, { actions: actionLabels });
}

/** Record a generic project edit. */
export function auditEdit(summary: string, details?: Record<string, unknown>): AuditEvent {
  return event("edit", summary, details);
}
