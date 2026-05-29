import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/** A project with a JMP/LBL pair and a FOR referencing a routine. */
function projectWithFlow() {
  const project = createProject("FlowCtl");
  const controller = createController(project.id, "FlowCtl");
  controller.controllerTags.push(createTag(controller.id, "Enable", "BOOL", { value: false }));
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(ladder.id, 0, [createNode("JMP", [tagOperand("label", "Loop1")])]));
  ladder.rungs.push(createRung(ladder.id, 1, [createNode("LBL", [tagOperand("label", "Loop1")])]));
  ladder.rungs.push(
    createRung(ladder.id, 2, [
      createNode("XIC", [tagOperand("operand", "Enable")]),
      createNode("MCR", []),
    ]),
  );
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

describe("label/keyword operands are not validated as tags", () => {
  const findings = createDefaultEngine().run(projectWithFlow());

  it("does not flag a JMP/LBL label as an undefined tag", () => {
    expect(findings.some((f) => f.ruleId === "undefined-tag" && f.message.includes("Loop1"))).toBe(false);
  });

  it("does not flag JMP/LBL/MCR as unsupported instructions", () => {
    const unsupported = findings.filter((f) => f.ruleId === "unsupported-instruction");
    expect(unsupported.some((f) => /JMP|LBL|MCR/.test(f.message))).toBe(false);
  });

  it("reports registered flow controls as model-only instead of executable", () => {
    const modelOnly = findings.filter((f) => f.ruleId === "model-only-instruction");
    expect(modelOnly.some((f) => f.message.includes('"JMP"'))).toBe(true);
    expect(modelOnly.some((f) => f.message.includes('"LBL"'))).toBe(true);
    expect(modelOnly.some((f) => f.message.includes('"MCR"'))).toBe(true);
  });

  it("still validates real tag operands (Enable is defined → no undefined-tag)", () => {
    expect(findings.some((f) => f.ruleId === "undefined-tag")).toBe(false);
  });
});
