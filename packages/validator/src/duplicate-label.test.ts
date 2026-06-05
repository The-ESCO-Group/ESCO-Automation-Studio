import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/**
 * Build a single-routine project whose Main routine contains the given ladder
 * rungs, so LBL uniqueness can be exercised in isolation.
 */
function projectWithRungs(...rungs: ReturnType<typeof createRung>[]) {
  const project = createProject("FlowCtl");
  const controller = createController(project.id, "FlowCtl");
  controller.controllerTags.push(createTag(controller.id, "Enable", "BOOL", { value: false }));
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  ladder.rungs.push(...rungs);
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

describe("duplicate-jump-label", () => {
  it("flags a label defined by two LBL instructions in the same routine", () => {
    const project = projectWithRungs(
      createRung("r0", 0, [createNode("LBL", [tagOperand("label", "Loop1")])]),
      createRung("r1", 1, [createNode("LBL", [tagOperand("label", "Loop1")])]),
    );
    const findings = createDefaultEngine().run(project);
    const dup = findings.filter((f) => f.ruleId === "duplicate-jump-label");
    expect(dup).toHaveLength(1);
    expect(dup[0].message).toContain('"Loop1"');
    expect(dup[0].message).toContain("2 LBL");
    expect(dup[0].severity).toBe("error");
    expect(dup[0].target).toBe("FlowCtl/MainProgram/Main");
  });

  it("does not flag distinct labels in the same routine", () => {
    const project = projectWithRungs(
      createRung("r0", 0, [createNode("LBL", [tagOperand("label", "Top")])]),
      createRung("r1", 1, [createNode("LBL", [tagOperand("label", "Bottom")])]),
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "duplicate-jump-label")).toBe(false);
  });

  it("reports each duplicated label name once regardless of how many LBLs share it", () => {
    const project = projectWithRungs(
      createRung("r0", 0, [createNode("LBL", [tagOperand("label", "Loop1")])]),
      createRung("r1", 1, [createNode("LBL", [tagOperand("label", "Loop1")])]),
      createRung("r2", 2, [createNode("LBL", [tagOperand("label", "Loop1")])]),
    );
    const findings = createDefaultEngine().run(project);
    const dup = findings.filter((f) => f.ruleId === "duplicate-jump-label");
    expect(dup).toHaveLength(1);
    expect(dup[0].message).toContain("3 LBL");
  });
});
