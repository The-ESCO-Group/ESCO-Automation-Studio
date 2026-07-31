import type { PlcProject } from "@esco/core";
import { validate } from "@esco/project-actions";

export interface Studio5000HandoffReadiness {
  ready: boolean;
  status: "ready" | "needs-attention";
  counts: {
    controllers: number;
    tasks: number;
    programs: number;
    routines: number;
    tags: number;
  };
  validation: {
    errors: number;
    warnings: number;
    info: number;
  };
  warnings: string[];
  nextSteps: string[];
  boundary: string;
}

function projectCounts(project: PlcProject): Studio5000HandoffReadiness["counts"] {
  const controllers = project.controllers.length;
  let tasks = 0;
  let programs = 0;
  let routines = 0;
  let tags = 0;
  for (const controller of project.controllers) {
    tasks += controller.tasks.length;
    programs += controller.programs.length;
    tags += controller.controllerTags.length;
    for (const program of controller.programs) {
      routines += program.routines.length;
      tags += program.programTags.length;
    }
  }
  return { controllers, tasks, programs, routines, tags };
}

export function buildStudio5000HandoffReadiness(project: PlcProject): Studio5000HandoffReadiness {
  const counts = projectCounts(project);
  const findings = validate(project);
  const validation = {
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    info: findings.filter((finding) => finding.severity === "info").length,
  };
  const warnings: string[] = [];
  if (counts.controllers === 0) warnings.push("No controller is present.");
  if (counts.programs === 0) warnings.push("No programs are present.");
  if (counts.routines === 0) warnings.push("No routines are present.");
  if (validation.errors > 0) warnings.push(`${validation.errors} validation error(s) must be resolved before handoff.`);
  if (validation.warnings > 0) warnings.push(`${validation.warnings} validation warning(s) should be reviewed before handoff.`);

  const ready = counts.controllers > 0 && counts.programs > 0 && counts.routines > 0 && validation.errors === 0;
  return {
    ready,
    status: ready ? "ready" : "needs-attention",
    counts,
    validation,
    warnings,
    nextSteps: [
      "Run Verify Controller and resolve validation errors.",
      "Export L5X (Review Only) from File / Import / Export.",
      "Review the L5X Handoff receipt for kept, preserved, and changed content.",
      "Open/import the L5X in Studio 5000 and run vendor verification in a sandbox project.",
      "Use Studio 5000 or approved Rockwell tooling for any physical PLC upload/download.",
    ],
    boundary:
      "ESCO prepares offline review artifacts only; it does not write .ACD files, go online to Rockwell hardware, or perform physical controller upload/download.",
  };
}

export function formatStudio5000HandoffReadiness(report: Studio5000HandoffReadiness): string {
  return [
    `Studio 5000 handoff readiness: ${report.ready ? "Ready to export for review" : "Needs attention"}.`,
    `Project: ${report.counts.controllers} controller(s), ${report.counts.tasks} task(s), ${report.counts.programs} program(s), ${report.counts.routines} routine(s), ${report.counts.tags} tag(s).`,
    `Validation: ${report.validation.errors} error(s), ${report.validation.warnings} warning(s), ${report.validation.info} info message(s).`,
    report.warnings.length ? `Notes: ${report.warnings.join(" ")}` : "Notes: no blocking handoff issues detected by ESCO validation.",
    `Next: ${report.nextSteps.join(" ")}`,
    `Boundary: ${report.boundary}`,
  ].join("\n");
}
