import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/** A routine using model-only instructions whose operands are keywords/structures, not plain tags. */
function projectWithModelOnly() {
  const project = createProject("Adv");
  const controller = createController(project.id, "Adv");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(ladder.id, 0, [createNode("MSG", [tagOperand("op0", "MsgCtl")])]));
  ladder.rungs.push(
    createRung(ladder.id, 1, [
      createNode("GSV", [
        tagOperand("op0", "WALLCLOCKTIME"),
        tagOperand("op1", "0"),
        tagOperand("op2", "DateTime"),
        tagOperand("op3", "Dest"),
      ]),
    ]),
  );
  ladder.rungs.push(createRung(ladder.id, 2, [createNode("MSO", [tagOperand("op0", "Axis1")])]));
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

describe("model-only advanced instructions validate as info, never error", () => {
  const findings = createDefaultEngine().run(projectWithModelOnly());

  it("reports model-only-instruction info for MSG/GSV/MSO", () => {
    expect(findings.filter((f) => f.ruleId === "model-only-instruction").length).toBeGreaterThanOrEqual(3);
  });

  it("does not flag keyword/structure operands (WALLCLOCKTIME, MsgCtl, Axis1) as undefined tags", () => {
    expect(findings.some((f) => f.ruleId === "undefined-tag")).toBe(false);
  });

  it("does not flag them as unsupported instructions", () => {
    expect(findings.some((f) => f.ruleId === "unsupported-instruction")).toBe(false);
  });

  it("produces no error-severity findings", () => {
    expect(findings.some((f) => f.severity === "error")).toBe(false);
  });
});
