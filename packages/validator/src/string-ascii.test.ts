import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/** A routine of string/ASCII ops whose operands are strings/buffers/channels, not plain numeric tags. */
function projectWithStringOps() {
  const project = createProject("Str");
  const controller = createController(project.id, "Str");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [
      createNode("CONCAT", [tagOperand("op0", "StrA"), tagOperand("op1", "StrB"), tagOperand("op2", "Dest")]),
    ]),
  );
  ladder.rungs.push(
    createRung(ladder.id, 1, [createNode("ARD", [tagOperand("op0", "Channel0"), tagOperand("op1", "Buf")])]),
  );
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

describe("string/ASCII instructions validate as info, never error", () => {
  const findings = createDefaultEngine().run(projectWithStringOps());

  it("emits model-only-instruction info for CONCAT/ARD", () => {
    expect(findings.filter((f) => f.ruleId === "model-only-instruction").length).toBeGreaterThanOrEqual(2);
  });

  it("does not flag string/buffer/channel operands as undefined tags", () => {
    expect(findings.some((f) => f.ruleId === "undefined-tag")).toBe(false);
  });

  it("does not flag them as unsupported instructions", () => {
    expect(findings.some((f) => f.ruleId === "unsupported-instruction")).toBe(false);
  });

  it("produces no error-severity findings", () => {
    expect(findings.some((f) => f.severity === "error")).toBe(false);
  });
});
