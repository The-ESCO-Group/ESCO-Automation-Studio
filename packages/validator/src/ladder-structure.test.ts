import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  type PlcProject,
} from "@esco/core";
import { createBranch, createLadderRoutine, createNode, tagOperand, type LadderBranch } from "@esco/ladder";
import { createDefaultEngine } from "./index";
import { ladderStructure } from "./ladder-structure";

/** A one-rung ladder routine whose rung uses the supplied branch root. */
function projectWithRoot(root: LadderBranch): PlcProject {
  const project = createProject("Struct");
  const controller = createController(project.id, "DemoController");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  ladder.rungs.push({ id: "rung-0", routineId: ladder.id, number: 0, root });
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

const structFindings = (project: PlcProject) =>
  ladderStructure.run({ project }).filter((finding) => finding.ruleId === "ladder-structure");

describe("ladder-structure rule", () => {
  it("flags a contact placed after an output coil in the same series", () => {
    const root = createBranch([
      createNode("OTE", [tagOperand("tag", "Run")]),
      createNode("XIC", [tagOperand("tag", "Late")]),
    ]);
    const warnings = structFindings(projectWithRoot(root)).filter((f) => f.severity === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toMatch(/after action instruction/i);
    expect(warnings[0]!.message).toContain("Late");
    expect(warnings[0]!.target).toBe("DemoController/MainProgram/MainRoutine");
  });

  it("is silent on a correctly ordered rung (conditions then output)", () => {
    const root = createBranch([
      createNode("XIC", [tagOperand("tag", "Start")]),
      createNode("XIO", [tagOperand("tag", "Stop")]),
      createNode("OTE", [tagOperand("tag", "Run")]),
    ]);
    expect(structFindings(projectWithRoot(root))).toHaveLength(0);
  });

  it("flags a condition placed after a timer action", () => {
    const root = createBranch([
      createNode("TON", [tagOperand("timer", "T1"), tagOperand("preset", "1000"), tagOperand("accum", "0")]),
      createNode("XIC", [tagOperand("tag", "T1.DN")]),
      createNode("OTE", [tagOperand("tag", "Run")]),
    ]);
    expect(structFindings(projectWithRoot(root)).some((finding) => /condition instruction "XIC".*after action/i.test(finding.message))).toBe(true);
  });

  it("flags ordering problems across a branch continuation", () => {
    const root = createBranch(
      [createNode("OTE", [tagOperand("tag", "Run")])],
      {
        parallelBranches: [createBranch([createNode("OTE", [tagOperand("tag", "Alternate")])])],
        next: createBranch([createNode("XIC", [tagOperand("tag", "Late")])]),
      },
    );
    expect(structFindings(projectWithRoot(root)).some((finding) => finding.message.includes('"Late"'))).toBe(true);
  });

  it("flags multiple actions chained on one execution path", () => {
    const root = createBranch([
      createNode("XIC", [tagOperand("tag", "Run")]),
      createNode("OTE", [tagOperand("tag", "Lamp")]),
      createNode("RTO", [tagOperand("timer", "Runtime"), tagOperand("preset", "1000")]),
    ]);
    expect(structFindings(projectWithRoot(root)).some((finding) => /action instruction "RTO" follows action instruction "OTE"/i.test(finding.message))).toBe(true);
  });

  it("flags an empty parallel branch leg as info", () => {
    const root = createBranch([createNode("XIC", [tagOperand("tag", "Main")])], {
      parallelBranches: [createBranch([])],
      next: createBranch([]),
    });
    const info = structFindings(projectWithRoot(root)).filter((f) => f.severity === "info");
    expect(info).toHaveLength(1);
    expect(info[0]!.message).toMatch(/empty parallel branch leg/i);
  });

  it("flags an empty primary leg that bypasses populated parallel legs", () => {
    const root = createBranch([], {
      parallelBranches: [createBranch([createNode("XIC", [tagOperand("tag", "Alt")])])],
      next: createBranch([createNode("OTE", [tagOperand("tag", "Run")])]),
    });
    const info = structFindings(projectWithRoot(root)).filter((finding) => finding.severity === "info");
    expect(info.some((finding) => /empty primary branch leg/i.test(finding.message))).toBe(true);
  });

  it("does not flag a parallel group whose legs are populated", () => {
    const root = createBranch([createNode("XIC", [tagOperand("tag", "Main")])], {
      parallelBranches: [createBranch([createNode("XIC", [tagOperand("tag", "Alt")])])],
      next: createBranch([]),
    });
    expect(structFindings(projectWithRoot(root)).filter((f) => f.severity === "info")).toHaveLength(0);
  });

  it("is registered in the default engine", () => {
    const root = createBranch([
      createNode("OTE", [tagOperand("tag", "Run")]),
      createNode("XIC", [tagOperand("tag", "Late")]),
    ]);
    const findings = createDefaultEngine()
      .run(projectWithRoot(root))
      .filter((f) => f.ruleId === "ladder-structure");
    expect(findings.length).toBeGreaterThan(0);
  });
});
