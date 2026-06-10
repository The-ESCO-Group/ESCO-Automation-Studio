import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
} from "@esco/core";
import type { ValidationFinding } from "@esco/validator";
import {
  classifyDiagnosticArea,
  compareDiagnosticSeverity,
  createBuildDiagnostics,
  createDiagnosticRows,
  resolveValidationFindingTarget,
  summarizeValidationFindings,
} from "./diagnostics";

describe("compareDiagnosticSeverity", () => {
  it("orders errors before warnings before info, stable within a severity", () => {
    const severities = ["info", "warning", "error", "warning", "error"] as const;
    const sorted = severities
      .map((severity, index) => ({ severity, index }))
      .sort((a, b) => compareDiagnosticSeverity(a.severity, b.severity));
    expect(sorted.map((entry) => entry.severity)).toEqual(["error", "error", "warning", "warning", "info"]);
    // Stable: the two errors keep their original relative order (indices 2 then 4).
    expect(sorted.filter((entry) => entry.severity === "error").map((entry) => entry.index)).toEqual([2, 4]);
  });
});

function demoProject(): PlcProject {
  const project = createProject("DiagProject");
  const controller = createController(project.id, "Ctl");
  const program = createProgram(controller.id, "MainProgram");
  const main = createRoutine(program.id, "MainRoutine", "ladder");
  const calc = createRoutine(program.id, "CalcST", "structured-text");
  program.mainRoutineId = main.id;
  program.routines.push(main, calc);
  program.programTags.push(createTag(controller.id, "LocalFlag", "BOOL", { scope: "program", programId: program.id }));
  controller.controllerTags.push(createTag(controller.id, "StartPB", "BOOL"));
  controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
  controller.programs.push(program);
  controller.ioConfiguration.modules.push({ id: "mod_if8", name: "IF8_01", slot: 1, parentModule: "Backplane" });
  project.controllers.push(controller);
  return project;
}

describe("diagnostics target projection", () => {
  it("resolves verify targets into openable project items", () => {
    const project = demoProject();
    expect(resolveValidationFindingTarget(project, {
      ruleId: "structured-text-syntax",
      severity: "error",
      message: "END_IF expected",
      target: "Ctl/MainProgram/CalcST",
    })).toMatchObject({ kind: "routine", label: "CalcST", openable: true });

    expect(resolveValidationFindingTarget(project, {
      ruleId: "duplicate-controller-tag",
      severity: "error",
      message: "Duplicate tag",
      target: "Ctl/StartPB",
    })).toMatchObject({ kind: "tag", label: "StartPB", tagName: "StartPB", openable: true });

    expect(resolveValidationFindingTarget(project, {
      ruleId: "module-slot-conflict",
      severity: "error",
      message: "Slot conflict",
      target: "Ctl/IF8_01",
    })).toMatchObject({ kind: "io-module", moduleId: "mod_if8", openable: true });

    expect(resolveValidationFindingTarget(project, {
      ruleId: "task-watchdog",
      severity: "warning",
      message: "Watchdog review",
      target: "Ctl/MainTask",
    })).toMatchObject({ kind: "task", label: "MainTask", openable: true });
  });

  it("summarizes and classifies diagnostics for build output", () => {
    const project = demoProject();
    const findings: ValidationFinding[] = [
      {
        ruleId: "structured-text-syntax",
        severity: "error",
        message: "Structured Text routine \"CalcST\" line 3: expected END_IF.",
        target: "Ctl/MainProgram/CalcST",
      },
      {
        ruleId: "module-slot-conflict",
        severity: "error",
        message: "I/O module slot conflict.",
        target: "Ctl/IF8_01",
      },
      {
        ruleId: "task-watchdog",
        severity: "warning",
        message: "Task watchdog is high.",
        target: "Ctl/MainTask",
      },
    ];

    expect(summarizeValidationFindings(findings)).toMatchObject({ errors: 2, warnings: 1, messages: 0, status: "Failed" });
    expect(classifyDiagnosticArea(findings[0]!, resolveValidationFindingTarget(project, findings[0]!))).toBe("Structured Text");
    expect(classifyDiagnosticArea(findings[1]!, resolveValidationFindingTarget(project, findings[1]!))).toBe("I/O Hardware");

    const steps = createBuildDiagnostics(project, findings);
    expect(steps.find((step) => step.step === "Project")?.description).toContain("1 I/O module");
    expect(steps.find((step) => step.area === "I/O Hardware")?.status).toBe("Failed");
    expect(steps.find((step) => step.area === "Tasks/Schedule")?.status).toBe("Warnings");
    expect(steps.some((step) =>
      step.finding?.ruleId === "structured-text-syntax" &&
      step.target === "Ctl/MainProgram/CalcST" &&
      step.scope === "Routine" &&
      step.source === "Structured Text compiler" &&
      /Open the routine/.test(step.recommendation)
    )).toBe(true);
    expect(steps.at(-1)?.step).toBe("Warning");
  });

  it("creates actionable diagnostic rows with target labels and next steps", () => {
    const project = demoProject();
    const rows = createDiagnosticRows(project, [
      {
        ruleId: "structured-text-syntax",
        severity: "error",
        message: "Structured Text routine \"CalcST\" line 3: expected END_IF.",
        target: "Ctl/MainProgram/CalcST",
      },
      {
        ruleId: "undefined-alias",
        severity: "warning",
        message: "Alias target \"Ghost\" is not defined.",
        target: "Ctl/StartPB",
      },
    ]);

    expect(rows[0]).toMatchObject({
      scope: "Routine",
      source: "Structured Text compiler",
      targetLabel: "Routine: CalcST",
      actionLabel: "Open",
      recommendation: expect.stringContaining("Structured Text"),
    });
    expect(rows[1]).toMatchObject({
      scope: "Tag",
      source: "Tag database",
      targetLabel: "Tag: StartPB",
      actionLabel: "XRef",
      recommendation: expect.stringContaining("cross-reference"),
    });
  });

  it("promotes model-only and unsupported instruction messages to verify warnings", () => {
    const project = demoProject();
    const rows = createDiagnosticRows(project, [
      {
        ruleId: "model-only-instruction",
        severity: "info",
        message: "Instruction \"PID\" is recognized but model-only.",
        target: "Ctl/MainProgram/MainRoutine",
      },
      {
        ruleId: "unsupported-instruction",
        severity: "info",
        message: "Instruction \"XUNKNOWN\" is unsupported.",
        target: "Ctl/MainProgram/MainRoutine",
      },
    ]);

    expect(rows.map((row) => row.finding.severity)).toEqual(["warning", "warning"]);
    expect(rows.every((row) => row.source === "Instruction catalog")).toBe(true);
    expect(rows.every((row) => /offline-review/.test(row.recommendation))).toBe(true);
  });

  it("can include richer industrial diagnostics for structure, task, and I/O review", () => {
    const project = demoProject();
    const controller = project.controllers[0]!;
    controller.tasks[0]!.scheduledProgramIds = ["missing-program"];
    controller.ioConfiguration.modules.push({ id: "mod_if8_dup", name: "IF8_DUP", slot: 1, parentModule: "Backplane" });

    const rows = createDiagnosticRows(project, [], { includeIndustrialValidation: true });

    expect(rows.some((row) => row.finding.ruleId === "industrial-missing-task-schedule" || /missing scheduled program/.test(row.message))).toBe(true);
    const ioRow = rows.find((row) => row.finding.ruleId === "industrial-duplicate-module-slot");
    expect(ioRow).toMatchObject({
      area: "I/O Hardware",
      source: "Offline I/O profile",
      recommendation: expect.stringContaining("I/O module profile"),
    });

    const buildRows = createBuildDiagnostics(project, [], { includeIndustrialValidation: true });
    expect(buildRows.some((step) => step.finding?.ruleId === "industrial-duplicate-module-slot" && step.source === "Offline I/O profile")).toBe(true);
  });
});
