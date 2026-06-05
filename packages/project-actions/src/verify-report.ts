import { nowIso } from "@esco/shared";
import type { PlcProject } from "@esco/core";
import type { ValidationFinding, ValidationSeverity } from "@esco/validator";
import { validate } from "./helpers";
import { createDiagnosticRows, type DiagnosticRow } from "./diagnostics";

/**
 * Offline "Verify Controller" build report.
 *
 * Studio 5000's Verify walks the controller hierarchy and writes a build log to
 * the Output window: it announces each controller / program / routine it
 * verifies, lists every error and warning against the component that owns it,
 * and finishes with a `Complete - N error(s), M warning(s)` summary line.
 *
 * This module reproduces that behaviour offline. It is pure (the timestamp is
 * injected) so it is fully unit-testable, and it never touches a controller —
 * it only re-shapes the validation findings the engine already produces into a
 * hierarchy-aware build report. The finding targets are slash-delimited paths
 * (`Controller/Program/Routine`, `Controller/Tag`, …), so each finding is
 * attached to the most specific node whose path is a prefix of the target.
 */

export type BuildStepKind = "project" | "controller" | "program" | "routine";

/** A node's verify outcome. Warnings alone do not fail a verify (Studio 5000 parity). */
export type BuildStepStatus = "passed" | "warnings" | "failed";

export interface BuildStep {
  kind: BuildStepKind;
  /** Hierarchy path used to match finding targets (the project step uses ""). */
  path: string;
  /** The node's own display name. */
  label: string;
  status: BuildStepStatus;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** Findings attached directly to this node (not its descendants). */
  findings: ValidationFinding[];
}

export interface BuildLogLine {
  severity: ValidationSeverity;
  at: string;
  kind: "start" | "step" | "finding" | "summary";
  text: string;
  row?: DiagnosticRow;
  counts?: {
    errors: number;
    warnings: number;
    messages: number;
  };
}

export interface BuildReport {
  /** Project name being verified. */
  project: string;
  /** ISO timestamp the verify ran (injected for testability). */
  startedAt: string;
  /** True when there are no errors. Warnings do not fail a verify. */
  succeeded: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** Hierarchy walk in display order: project → controllers → programs → routines. */
  steps: BuildStep[];
  /** Categorized, actionable finding rows used by the build log and diagnostics grid. */
  findings: DiagnosticRow[];
  /** Studio 5000-style Output-window log lines. */
  log: BuildLogLine[];
  /** Final summary line, e.g. `Complete - 0 error(s), 0 warning(s)`. */
  summary: string;
}

export interface VerifyReportOptions {
  /** Override the verify timestamp (defaults to now). */
  at?: string;
  /** Include ESCO industrial project checks for tasks, aliases, I/O, network metadata, and RPI. */
  includeIndustrialValidation?: boolean;
}

function statusFor(errorCount: number, warningCount: number): BuildStepStatus {
  if (errorCount > 0) return "failed";
  if (warningCount > 0) return "warnings";
  return "passed";
}

function pluralCount(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

/**
 * Pick the most specific step whose path is a prefix of `target`, matching only
 * on segment boundaries so `MainProgram` never absorbs `MainProgrammer`'s
 * findings. The project sentinel (path "") never prefix-matches; targetless or
 * unmatched findings fall back to it.
 */
function stepForTarget(target: string | undefined, steps: BuildStep[]): BuildStep {
  const projectStep = steps[0];
  if (!target) return projectStep;
  let best = projectStep;
  let bestLength = -1;
  for (const step of steps) {
    if (step.path === "") continue;
    const matches = target === step.path || target.startsWith(`${step.path}/`);
    if (matches && step.path.length > bestLength) {
      best = step;
      bestLength = step.path.length;
    }
  }
  return best;
}

function finalize(step: BuildStep): void {
  step.errorCount = step.findings.filter((finding) => finding.severity === "error").length;
  step.warningCount = step.findings.filter((finding) => finding.severity === "warning").length;
  step.infoCount = step.findings.filter((finding) => finding.severity === "info").length;
  step.status = statusFor(step.errorCount, step.warningCount);
}

function severityLabel(severity: ValidationSeverity): string {
  return severity === "error" ? "Error" : severity === "warning" ? "Warning" : "Info";
}

function timeLabel(iso: string): string {
  return iso.includes("T") ? iso.slice(11, 19) : iso;
}

function logLine(startedAt: string, kind: BuildLogLine["kind"], severity: ValidationSeverity, text: string): BuildLogLine {
  return { at: startedAt, kind, severity, text: `[${timeLabel(startedAt)}] ${text}` };
}

function findingLine(startedAt: string, row: DiagnosticRow): BuildLogLine {
  const finding = row.finding;
  const code = finding.ruleId ? ` (${finding.ruleId})` : "";
  return {
    at: startedAt,
    kind: "finding",
    severity: finding.severity,
    row,
    text: `[${timeLabel(startedAt)}] ${severityLabel(finding.severity)}: ${row.targetLabel}${code} - ${row.message} Recommendation: ${row.recommendation}`,
  };
}

/**
 * Verify a project offline and produce a build report. When `findings` is
 * omitted the default validation engine is run; pass the already-computed
 * findings (as the UI does) to avoid validating twice.
 */
export function verifyProjectReport(
  project: PlcProject,
  findings: ValidationFinding[] = validate(project),
  options: VerifyReportOptions = {},
): BuildReport {
  const startedAt = options.at ?? nowIso();
  const reportRows = createDiagnosticRows(project, findings, {
    includeIndustrialValidation: options.includeIndustrialValidation,
  });
  const reportFindings = reportRows.map((row) => row.finding);

  const projectStep: BuildStep = {
    kind: "project",
    path: "",
    label: project.name,
    status: "passed",
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
    findings: [],
  };
  const steps: BuildStep[] = [projectStep];

  for (const controller of project.controllers) {
    steps.push({
      kind: "controller",
      path: controller.name,
      label: controller.name,
      status: "passed",
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      findings: [],
    });
    for (const program of controller.programs) {
      const programPath = `${controller.name}/${program.name}`;
      steps.push({
        kind: "program",
        path: programPath,
        label: program.name,
        status: "passed",
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        findings: [],
      });
      for (const routine of program.routines) {
        steps.push({
          kind: "routine",
          path: `${programPath}/${routine.name}`,
          label: routine.name,
          status: "passed",
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          findings: [],
        });
      }
    }
  }

  for (const finding of reportFindings) {
    stepForTarget(finding.target, steps).findings.push(finding);
  }
  steps.forEach(finalize);

  const errorCount = reportFindings.filter((finding) => finding.severity === "error").length;
  const warningCount = reportFindings.filter((finding) => finding.severity === "warning").length;
  const infoCount = reportFindings.filter((finding) => finding.severity === "info").length;

  const log: BuildLogLine[] = [];
  log.push(logLine(startedAt, "start", "info", `Build started - verifying project '${project.name}'...`));
  log.push(logLine(startedAt, "step", "info", `Verifying project '${project.name}'...`));
  for (const step of steps) {
    if (step.kind === "project") {
      for (const finding of step.findings) {
        const row = reportRows.find((candidate) => candidate.finding === finding);
        log.push(row ? findingLine(startedAt, row) : logLine(startedAt, "finding", finding.severity, `${severityLabel(finding.severity)}: ${finding.message}`));
      }
      continue;
    }
    // Controllers and programs are always announced; routines only when they
    // carry a finding, so the log stays O(findings) on a clean project.
    if (step.kind !== "routine" || step.findings.length > 0) {
      log.push(logLine(startedAt, "step", "info", `Verifying ${step.kind} '${step.label}'...`));
    }
    for (const finding of step.findings) {
      const row = reportRows.find((candidate) => candidate.finding === finding);
      log.push(row ? findingLine(startedAt, row) : logLine(startedAt, "finding", finding.severity, `${severityLabel(finding.severity)}: ${finding.message}`));
    }
  }

  const summary = `Complete - ${pluralCount(errorCount, "error")}, ${pluralCount(warningCount, "warning")}`;
  log.push({
    at: startedAt,
    kind: "summary",
    severity: errorCount ? "error" : warningCount ? "warning" : "info",
    text: `[${timeLabel(startedAt)}] ${summary}, ${pluralCount(infoCount, "message")}. Result: ${errorCount ? "Failed" : warningCount ? "Warnings" : "Passed"}.`,
    counts: { errors: errorCount, warnings: warningCount, messages: infoCount },
  });

  return {
    project: project.name,
    startedAt,
    succeeded: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    steps,
    findings: reportRows,
    log,
    summary,
  };
}

/** Render a build report's log as plain text (one line per entry). */
export function formatBuildReport(report: BuildReport): string {
  return report.log.map((line) => line.text).join("\n");
}

/**
 * Find a single step in a build report by its hierarchy path (e.g.
 * `Controller/Program/Routine`). Lets callers scope a verify to one component —
 * the routine-scoped "Verify Routine" command uses this to report just that
 * routine's status instead of the whole project's.
 */
export function findBuildStep(report: BuildReport, path: string): BuildStep | undefined {
  return report.steps.find((step) => step.path === path);
}

/** Studio 5000-style summary line for an arbitrary error/warning pair. */
export function buildSummaryLine(errorCount: number, warningCount: number): string {
  return `Complete - ${pluralCount(errorCount, "error")}, ${pluralCount(warningCount, "warning")}`;
}
