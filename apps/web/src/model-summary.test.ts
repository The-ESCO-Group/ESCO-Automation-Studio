import { describe, expect, it } from "vitest";
import { createDefaultEngine } from "@esco/validator";
import { appendRungWithRoot, createBranch, createNode } from "@esco/ladder";
import type { LadderRoutine } from "@esco/ladder";
import { buildModelSummary } from "./model-summary";
import { createBlankRoutineProject, createInitialProject } from "./project-edit";

const UNKNOWN_SENTINEL = "UNSUPPORTED_VENDOR_BLOCK";

describe("buildModelSummary", () => {
  it("aggregates counts for a blank routine project", () => {
    const project = createBlankRoutineProject();
    const summary = buildModelSummary(project, createDefaultEngine().run(project));

    expect(summary.projectName).toBe(project.name);
    expect(summary.controllerName).toBe(project.controllers[0]?.name);
    expect(summary.counts.controllers).toBe(1);
    expect(summary.counts.programs).toBeGreaterThanOrEqual(1);
    expect(summary.counts.routines).toBeGreaterThanOrEqual(1);
    expect(summary.counts.rungs).toBe(0);
    expect(summary.counts.tags).toBe(summary.counts.controllerTags + summary.counts.programTags);
  });

  it("reports no unsupported instructions for an empty workspace", () => {
    const project = createInitialProject();
    const summary = buildModelSummary(project);
    expect(summary.unsupportedTotal).toBe(0);
    expect(summary.unsupportedInstructions).toEqual([]);
    expect(summary.modelOnlyTotal).toBe(0);
    expect(summary.modelOnlyInstructions).toEqual([]);
  });

  it("counts unsupported instruction types found in ladders", () => {
    const project = createBlankRoutineProject();
    // Inject two occurrences of an unknown instruction type into the main routine ladder.
    const controller = project.controllers[0]!;
    const program = controller.programs[0]!;
    const main = program.routines.find((r) => r.id === program.mainRoutineId) ?? program.routines[0]!;
    let ladder = main.ladder as LadderRoutine;
    ladder = appendRungWithRoot(ladder, createBranch([createNode(UNKNOWN_SENTINEL, []), createNode("XIC", [])]));
    ladder = appendRungWithRoot(ladder, createBranch([createNode(UNKNOWN_SENTINEL, [])]));
    main.ladder = ladder;

    const summary = buildModelSummary(project);
    const unknown = summary.unsupportedInstructions.find((u) => u.type === UNKNOWN_SENTINEL);
    expect(unknown?.count).toBe(2);
    expect(summary.unsupportedTotal).toBe(2);
    expect(summary.modelOnlyTotal).toBe(0);
  });

  it("counts registered model-only instructions separately from unknown unsupported instructions", () => {
    const project = createBlankRoutineProject();
    const controller = project.controllers[0]!;
    const program = controller.programs[0]!;
    const main = program.routines.find((r) => r.id === program.mainRoutineId) ?? program.routines[0]!;
    let ladder = main.ladder as LadderRoutine;
    ladder = appendRungWithRoot(ladder, createBranch([createNode("SQO", []), createNode(UNKNOWN_SENTINEL, [])]));
    main.ladder = ladder;

    const summary = buildModelSummary(project);
    expect(summary.modelOnlyInstructions.find((u) => u.type === "SQO")?.count).toBe(1);
    expect(summary.modelOnlyTotal).toBe(1);
    expect(summary.unsupportedInstructions.find((u) => u.type === UNKNOWN_SENTINEL)?.count).toBe(1);
    expect(summary.unsupportedTotal).toBe(1);
  });

  it("tallies validator error and warning findings", () => {
    const project = createInitialProject();
    const findings = [
      { ruleId: "x", severity: "error", message: "e" } as const,
      { ruleId: "y", severity: "warning", message: "w" } as const,
      { ruleId: "z", severity: "warning", message: "w2" } as const,
    ];
    const summary = buildModelSummary(project, findings as never);
    expect(summary.errorCount).toBe(1);
    expect(summary.warningCount).toBe(2);
  });
});
