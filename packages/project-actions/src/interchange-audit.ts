import type { ExportInterchangeEvidence, ImportSummary } from "@esco/parser-l5x";

/**
 * Structured kept / dropped / changed audit report for legacy L5X interchange.
 *
 * L5X stays a *legacy review/import/export* path — never the native ESCO
 * format. These reports make the consequences of a round-trip explicit for an
 * engineer: what carried over faithfully (kept), what could not be represented
 * with full fidelity and was preserved verbatim instead of executed (dropped),
 * and what was translated with caveats (changed). They also reassert the
 * boundary: ESCO interchange is offline and touches no proprietary binary.
 */

export type InterchangeDirection = "import" | "export";

export interface AuditLine {
  label: string;
  detail: string;
}

export interface InterchangeAuditReport {
  direction: InterchangeDirection;
  format: "L5X";
  title: string;
  /** ESCO interchange is always offline / vendor-neutral. */
  offlineOnly: boolean;
  /** Must always be false — surfaced so a reviewer can confirm the boundary held. */
  proprietaryBinaryTouched: boolean;
  /** Content that carried over faithfully. */
  kept: AuditLine[];
  /** Content that lost fidelity — preserved verbatim (not executable), not silently discarded. */
  dropped: AuditLine[];
  /** Content translated with caveats. */
  changed: AuditLine[];
  /** Notes/warnings the underlying import/export attached. */
  notes: string[];
}

function pluralCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** Build an audit report from an L5X import summary. */
export function buildImportAuditReport(summary: ImportSummary): InterchangeAuditReport {
  const evidence = summary.evidence;
  const kept: AuditLine[] = [
    { label: "Programs", detail: pluralCount(summary.programs, "program") },
    { label: "Routines", detail: pluralCount(summary.routines, "routine") },
    { label: "Rungs", detail: pluralCount(summary.rungs, "rung") },
    { label: "Tags", detail: pluralCount(summary.tags, "tag") },
  ];
  if (evidence.targetName) kept.push({ label: "Source controller", detail: evidence.targetName });
  if (evidence.contentType) kept.push({ label: "Content type", detail: evidence.contentType });
  if (evidence.softwareRevision) {
    kept.push({ label: "Origin software revision", detail: evidence.softwareRevision });
  }

  // Unsupported instructions are recognised and preserved verbatim on the rung,
  // but are not executed by the offline simulator — a fidelity loss, surfaced.
  const dropped: AuditLine[] = summary.unsupportedInstructions.map((type) => ({
    label: `Instruction ${type}`,
    detail: "preserved verbatim on the rung; not executed by the offline simulator",
  }));

  // Warnings are caveats on otherwise-translated content.
  const changed: AuditLine[] = summary.warnings.map((warning) => ({ label: "Caveat", detail: warning }));

  return {
    direction: "import",
    format: "L5X",
    title: `L5X import audit${evidence.targetName ? ` — ${evidence.targetName}` : ""}`,
    offlineOnly: summary.offlineOnly,
    proprietaryBinaryTouched: summary.proprietaryBinarySupported,
    kept,
    dropped,
    changed,
    notes: [...summary.warnings],
  };
}

/** Build an audit report from an L5X export's interchange evidence + warnings. */
export function buildExportAuditReport(
  evidence: ExportInterchangeEvidence,
  warnings: string[] = [],
): InterchangeAuditReport {
  const kept: AuditLine[] = [
    { label: "Target", detail: evidence.targetName },
    { label: "Content type", detail: evidence.contentType },
    { label: "Root element", detail: evidence.rootElement },
    { label: "Exported by", detail: evidence.exportName },
    { label: "Exported at", detail: evidence.exportDate },
  ];
  const changed: AuditLine[] = warnings.map((warning) => ({ label: "Caveat", detail: warning }));
  return {
    direction: "export",
    format: "L5X",
    title: `L5X export audit — ${evidence.targetName}`,
    offlineOnly: evidence.generatedOffline,
    proprietaryBinaryTouched: evidence.proprietaryBinaryTouched,
    kept,
    dropped: [],
    changed,
    notes: warnings,
  };
}

/** Render an audit report as a readable plain-text receipt. */
export function formatInterchangeAuditReport(report: InterchangeAuditReport): string {
  const lines: string[] = [];
  lines.push(report.title);
  lines.push(
    `Format: ${report.format} · Offline: ${report.offlineOnly ? "yes" : "NO"} · Proprietary binary touched: ${
      report.proprietaryBinaryTouched ? "YES" : "no"
    }`,
  );
  const section = (heading: string, entries: AuditLine[]) => {
    lines.push("");
    lines.push(`${heading} (${entries.length})`);
    if (entries.length === 0) {
      lines.push("  (none)");
      return;
    }
    for (const entry of entries) lines.push(`  - ${entry.label}: ${entry.detail}`);
  };
  section("Kept", report.kept);
  section("Dropped (preserved, not executed)", report.dropped);
  section("Changed", report.changed);
  return lines.join("\n");
}
