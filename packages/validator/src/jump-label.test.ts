import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/**
 * Build a single-routine project whose Main routine contains the given ladder
 * rungs, so JMP/LBL resolution can be exercised in isolation.
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

describe("unresolved-jump-label", () => {
  it("flags a JMP whose label has no matching LBL in the routine", () => {
    const project = projectWithRungs(
      createRung("r0", 0, [createNode("JMP", [tagOperand("label", "Missing")])]),
      createRung("r1", 1, [createNode("LBL", [tagOperand("label", "Loop1")])]),
    );
    const findings = createDefaultEngine().run(project);
    const jump = findings.filter((f) => f.ruleId === "unresolved-jump-label");
    expect(jump).toHaveLength(1);
    expect(jump[0].message).toContain('"Missing"');
    expect(jump[0].severity).toBe("warning");
    expect(jump[0].target).toBe("FlowCtl/MainProgram/Main");
  });

  it("does not flag a JMP that resolves to an LBL in the same routine", () => {
    const project = projectWithRungs(
      createRung("r0", 0, [createNode("JMP", [tagOperand("label", "Loop1")])]),
      createRung("r1", 1, [createNode("LBL", [tagOperand("label", "Loop1")])]),
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "unresolved-jump-label")).toBe(false);
  });

  it("resolves a backward jump (LBL declared before the JMP)", () => {
    const project = projectWithRungs(
      createRung("r0", 0, [createNode("LBL", [tagOperand("label", "Top")])]),
      createRung("r1", 1, [createNode("JMP", [tagOperand("label", "Top")])]),
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "unresolved-jump-label")).toBe(false);
  });
});
