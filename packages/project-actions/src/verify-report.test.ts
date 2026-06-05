import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  type PlcProject,
} from "@esco/core";
import type { ValidationFinding } from "@esco/validator";
import { buildSummaryLine, findBuildStep, formatBuildReport, verifyProjectReport } from "./verify-report";

const AT = "2026-06-01T12:00:00.000Z";

/** A controller "Ctl" with one program "MainProgram" holding MainRoutine + Fault. */
function demoProject(): PlcProject {
  const project = createProject("Demo");
  const controller = createController(project.id, "Ctl");
  const program = createProgram(controller.id, "MainProgram");
  const main = createRoutine(program.id, "MainRoutine", "ladder");
  const fault = createRoutine(program.id, "Fault", "ladder");
  program.mainRoutineId = main.id;
  program.routines.push(main, fault);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

function report(findings: ValidationFinding[], project = demoProject()) {
  return verifyProjectReport(project, findings, { at: AT });
}

describe("verifyProjectReport — hierarchy walk", () => {
  it("emits an ordered project → controller → program → routine step walk", () => {
    const { steps } = report([]);
    expect(steps.map((step) => `${step.kind}:${step.label}`)).toEqual([
      "project:Demo",
      "controller:Ctl",
      "program:MainProgram",
      "routine:MainRoutine",
      "routine:Fault",
    ]);
    // Paths are slash-delimited so finding targets can prefix-match them.
    expect(steps[3].path).toBe("Ctl/MainProgram/MainRoutine");
  });

  it("passes cleanly with no findings", () => {
    const result = report([]);
    expect(result.succeeded).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(result.summary).toBe("Complete - 0 errors, 0 warnings");
    expect(result.steps.every((step) => step.status === "passed")).toBe(true);
    // Clean routines are not announced in the log; only the structural milestones are.
    expect(result.log.map((line) => line.text)).toEqual([
      "[12:00:00] Build started - verifying project 'Demo'...",
      "[12:00:00] Verifying project 'Demo'...",
      "[12:00:00] Verifying controller 'Ctl'...",
      "[12:00:00] Verifying program 'MainProgram'...",
      "[12:00:00] Complete - 0 errors, 0 warnings, 0 messages. Result: Passed.",
    ]);
    expect(result.startedAt).toBe(AT);
  });
});

describe("verifyProjectReport — finding attachment", () => {
  it("attaches a finding to the most specific matching node", () => {
    const result = report([
      { ruleId: "rung-bad", severity: "error", message: "Bad rung", target: "Ctl/MainProgram/MainRoutine" },
    ]);
    const routine = result.steps.find((step) => step.path === "Ctl/MainProgram/MainRoutine")!;
    expect(routine.errorCount).toBe(1);
    expect(routine.status).toBe("failed");
    // Ancestors are not double-counted — the finding lands only on the leaf.
    const program = result.steps.find((step) => step.path === "Ctl/MainProgram")!;
    expect(program.errorCount).toBe(0);
    expect(program.status).toBe("passed");
  });

  it("attaches program- and controller-scope findings to the right node", () => {
    const result = report([
      { ruleId: "prog", severity: "warning", message: "Program issue", target: "Ctl/MainProgram" },
      { ruleId: "ctl-tag", severity: "warning", message: "Tag issue", target: "Ctl/SomeTag" },
    ]);
    expect(result.steps.find((step) => step.path === "Ctl/MainProgram")!.warningCount).toBe(1);
    // A controller-scope tag has no program/routine step, so it rolls up to the controller.
    expect(result.steps.find((step) => step.path === "Ctl")!.warningCount).toBe(1);
  });

  it("matches only on segment boundaries (no false prefix match)", () => {
    const project = demoProject();
    const controller = createController(project.id, "Ctl");
    const program = createProgram(controller.id, "MainProgrammer");
    program.routines.push(createRoutine(program.id, "R", "ladder"));
    controller.programs.push(program);
    project.controllers.push(controller);
    // Target belongs to "MainProgram", must NOT be absorbed by "MainProgrammer".
    const result = report(
      [{ ruleId: "x", severity: "error", message: "m", target: "Ctl/MainProgram" }],
      project,
    );
    expect(result.steps.find((step) => step.path === "Ctl/MainProgram")!.errorCount).toBe(1);
    expect(result.steps.find((step) => step.path === "Ctl/MainProgrammer")!.errorCount).toBe(0);
  });

  it("routes targetless and unmatched findings to the project step", () => {
    const result = report([
      { ruleId: "global", severity: "error", message: "No target" },
      { ruleId: "orphan", severity: "warning", message: "Unknown controller", target: "Ghost/Program" },
    ]);
    const projectStep = result.steps[0];
    expect(projectStep.kind).toBe("project");
    expect(projectStep.errorCount).toBe(1);
    expect(projectStep.warningCount).toBe(1);
  });
});

describe("verifyProjectReport — summary and log", () => {
  it("fails on errors and reports Studio-style counts", () => {
    const result = report([
      { ruleId: "e1", severity: "error", message: "E1", target: "Ctl/MainProgram/MainRoutine" },
      { ruleId: "w1", severity: "warning", message: "W1", target: "Ctl/MainProgram/MainRoutine" },
      { ruleId: "i1", severity: "info", message: "I1", target: "Ctl/MainProgram/MainRoutine" },
    ]);
    expect(result.succeeded).toBe(false);
    expect(result.summary).toBe("Complete - 1 error, 1 warning");
    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.infoCount).toBe(1);
    expect(result.log.at(-1)).toMatchObject({
      at: AT,
      kind: "summary",
      severity: "error",
      counts: { errors: 1, warnings: 1, messages: 1 },
      text: "[12:00:00] Complete - 1 error, 1 warning, 1 message. Result: Failed.",
    });
  });

  it("succeeds with warnings only (warnings do not fail a verify)", () => {
    const result = report([
      { ruleId: "w", severity: "warning", message: "W", target: "Ctl/MainProgram" },
    ]);
    expect(result.succeeded).toBe(true);
    expect(result.summary).toBe("Complete - 0 errors, 1 warning");
    expect(result.log.at(-1)!.severity).toBe("warning");
    expect(result.log.at(-1)!.text).toContain("0 messages");
  });

  it("counts model-only and unsupported instruction messages as verify warnings", () => {
    const result = report([
      {
        ruleId: "model-only-instruction",
        severity: "info",
        message: "Instruction \"PID\" is recognized but model-only (fidelity: Model-only; preserved and displayed, not simulated).",
        target: "Ctl/MainProgram/MainRoutine",
      },
      {
        ruleId: "unsupported-instruction",
        severity: "info",
        message: "Instruction \"XUNKNOWN\" is unsupported (fidelity: Unsupported) and will not be simulated.",
        target: "Ctl/MainProgram/MainRoutine",
      },
    ]);

    expect(result.succeeded).toBe(true);
    expect(result.warningCount).toBe(2);
    expect(result.infoCount).toBe(0);
    expect(result.summary).toBe("Complete - 0 errors, 2 warnings");
    expect(result.log.at(-1)!.text).toContain("2 warnings, 0 messages");
  });

  it("announces a routine only when it carries a finding, and lists the finding under it", () => {
    const result = report([
      { ruleId: "e", severity: "error", message: "Boom", target: "Ctl/MainProgram/Fault" },
    ]);
    const text = result.log.map((line) => line.text);
    expect(text).toContain("[12:00:00] Verifying routine 'Fault'...");
    expect(text).not.toContain("[12:00:00] Verifying routine 'MainRoutine'...");
    expect(text.join("\n")).toMatch(/Error: Routine: Fault \(e\) - Boom Recommendation:/);
    expect(result.findings[0]).toMatchObject({
      scope: "Routine",
      source: "Controller organizer",
      targetLabel: "Routine: Fault",
      recommendation: expect.stringContaining("Open"),
    });
    // formatBuildReport renders the same lines as plain text.
    expect(formatBuildReport(result)).toBe(text.join("\n"));
  });
});

describe("verifyProjectReport — engine integration", () => {
  it("runs the default validation engine when findings are not supplied", () => {
    const project = demoProject();
    // Should not throw and should produce a coherent report off the real engine.
    const result = verifyProjectReport(project, undefined, { at: AT });
    expect(result.project).toBe("Demo");
    expect(result.errorCount + result.warningCount + result.infoCount).toBe(
      result.steps.reduce((sum, step) => sum + step.findings.length, 0),
    );
    expect(result.summary.startsWith("Complete - ")).toBe(true);
  });

  it("can include ESCO industrial validation in the full build log", () => {
    const project = demoProject();
    const controller = project.controllers[0]!;
    controller.tasks.push({
      id: "task-1",
      controllerId: controller.id,
      name: "MainTask",
      type: "continuous",
      scheduledProgramIds: [],
    });
    controller.ioConfiguration.modules.push(
      { id: "mod-1", name: "Input_A", slot: 1 },
      { id: "mod-2", name: "Input_B", slot: 1 },
    );

    const result = verifyProjectReport(project, [], { at: AT, includeIndustrialValidation: true });

    expect(result.warningCount).toBeGreaterThanOrEqual(1);
    expect(result.errorCount).toBeGreaterThanOrEqual(1);
    expect(result.log.map((line) => line.text).join("\n")).toMatch(/share slot 1|no scheduled programs/);
  });
});

describe("findBuildStep — routine scoping", () => {
  it("returns the step for an exact hierarchy path", () => {
    const result = report([
      { ruleId: "e", severity: "error", message: "Boom", target: "Ctl/MainProgram/Fault" },
    ]);
    const step = findBuildStep(result, "Ctl/MainProgram/Fault");
    expect(step?.kind).toBe("routine");
    expect(step?.label).toBe("Fault");
    expect(step?.errorCount).toBe(1);
    expect(step?.status).toBe("failed");
  });

  it("returns undefined for an unknown path", () => {
    expect(findBuildStep(report([]), "Ctl/Nope/Nope")).toBeUndefined();
  });
});

describe("buildSummaryLine", () => {
  it("formats Studio-style counts with correct pluralisation", () => {
    expect(buildSummaryLine(0, 0)).toBe("Complete - 0 errors, 0 warnings");
    expect(buildSummaryLine(1, 0)).toBe("Complete - 1 error, 0 warnings");
    expect(buildSummaryLine(2, 3)).toBe("Complete - 2 errors, 3 warnings");
  });
});
