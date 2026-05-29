import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/** A project whose Main routine runs the given nodes, with Level/Pump/Dest defined. */
function projectWithNodes(...nodes: ReturnType<typeof createNode>[]) {
  const project = createProject("ExprCtl");
  const controller = createController(project.id, "ExprCtl");
  controller.controllerTags.push(createTag(controller.id, "Level", "DINT", { value: 0 }));
  controller.controllerTags.push(createTag(controller.id, "Pump", "BOOL", { value: false }));
  controller.controllerTags.push(createTag(controller.id, "Dest", "DINT", { value: 0 }));
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  nodes.forEach((node, i) => ladder.rungs.push(createRung(ladder.id, i, [node])));
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

const undefinedTags = (project: ReturnType<typeof projectWithNodes>): string[] =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "undefined-tag")
    .map((f) => f.message);

const cmp = (expression: string) => createNode("CMP", [tagOperand("expression", expression)]);
const cpt = (dest: string, expression: string) =>
  createNode("CPT", [tagOperand("dest", dest), tagOperand("expression", expression)]);

describe("CPT/CMP expression operands validate every referenced tag", () => {
  it("passes when all tags in a comparison expression are defined", () => {
    expect(undefinedTags(projectWithNodes(cmp("Level >= 100 AND Pump")))).toEqual([]);
  });

  it("flags an undefined tag inside the expression but not the defined ones", () => {
    const messages = undefinedTags(projectWithNodes(cmp("Level >= 100 AND Temp")));
    expect(messages.some((m) => m.includes('"Temp"'))).toBe(true);
    expect(messages.some((m) => m.includes('"Level"'))).toBe(false);
  });

  it("checks tags on both sides of a CPT expression, skipping literals and functions", () => {
    // ABS is a function (not a tag); 2 and 100 are literals; Speed is undefined.
    const messages = undefinedTags(projectWithNodes(cpt("Dest", "ABS(Level) * 2 + Speed - 100")));
    expect(messages.some((m) => m.includes('"Speed"'))).toBe(true);
    expect(messages.some((m) => m.includes('"Level"'))).toBe(false);
    expect(messages.some((m) => m.includes('"ABS"'))).toBe(false);
  });

  it("does not flag a literal-only expression", () => {
    expect(undefinedTags(projectWithNodes(cpt("Dest", "16#FF + 2 * (3 - 1)")))).toEqual([]);
  });

  it("does not report CPT/CMP as model-only or unsupported (they are executable)", () => {
    const findings = createDefaultEngine().run(projectWithNodes(cmp("Level > 0"), cpt("Dest", "Level + 1")));
    expect(findings.some((f) => f.ruleId === "model-only-instruction" && /CPT|CMP/.test(f.message))).toBe(false);
    expect(findings.some((f) => f.ruleId === "unsupported-instruction" && /CPT|CMP/.test(f.message))).toBe(false);
  });
});
