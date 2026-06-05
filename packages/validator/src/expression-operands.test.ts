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
  controller.controllerTags.push(createTag(controller.id, "StrA", "STRING", { value: "" }));
  controller.controllerTags.push(createTag(controller.id, "StrB", "STRING", { value: "" }));
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

function projectWithProgramQualifiedExpression(expression: string) {
  const project = createProject("ExprCtl");
  const controller = createController(project.id, "ExprCtl");
  controller.controllerTags.push(createTag(controller.id, "Dest", "DINT", { value: 0 }));

  const progA = createProgram(controller.id, "ProgA");
  const mainA = createRoutine(progA.id, "Main", "ladder");
  progA.mainRoutineId = mainA.id;
  const ladderA = createLadderRoutine();
  ladderA.rungs.push(createRung(ladderA.id, 0, [cpt("Dest", expression)]));
  mainA.ladder = ladderA;
  progA.routines.push(mainA);

  const progB = createProgram(controller.id, "ProgB");
  progB.programTags.push(createTag(progB.id, "Remote", "DINT", { value: 0 }));
  controller.programs.push(progA, progB);
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

  it("accepts the Logix ampersand AND operator in comparison expressions", () => {
    expect(undefinedTags(projectWithNodes(cmp("Level >= 100 & Pump")))).toEqual([]);
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

  it("surfaces instruction-level validation for malformed expressions", () => {
    const findings = createDefaultEngine().run(projectWithNodes(cmp("Level > "), cpt("Dest", "Math.max(Level, 1)")));
    const instructionFindings = findings.filter((f) => f.ruleId === "instruction-validation");
    expect(instructionFindings.some((f) => f.message.includes("CMP") && f.message.includes("safe comparison"))).toBe(true);
    expect(instructionFindings.some((f) => f.message.includes("CPT") && f.message.includes("safe numeric"))).toBe(true);
  });

  it("does not duplicate missing-operand findings through instruction-level validation", () => {
    const findings = createDefaultEngine().run(projectWithNodes(createNode("CPT", [])));
    expect(findings.filter((f) => f.ruleId === "missing-operand")).toHaveLength(2);
    expect(findings.filter((f) => f.ruleId === "instruction-validation")).toHaveLength(0);
  });

  it("accepts program-qualified tags inside CPT/CMP expressions", () => {
    expect(undefinedTags(projectWithProgramQualifiedExpression("Program:ProgB.Remote + 1"))).toEqual([]);
  });

  it("flags missing program-qualified tags inside CPT/CMP expressions", () => {
    const messages = undefinedTags(projectWithProgramQualifiedExpression("Program:ProgB.Missing + 1"));
    expect(messages.some((m) => m.includes('"Program:ProgB.Missing"'))).toBe(true);
  });

  it("validates CMP string-tag comparisons without falling into numeric expression checks", () => {
    const ok = createDefaultEngine().run(projectWithNodes(cmp("StrA = StrB")));
    expect(ok.some((f) => f.ruleId === "undefined-tag")).toBe(false);
    expect(ok.some((f) => f.ruleId === "instruction-validation" && f.message.includes("STRING"))).toBe(false);
    expect(ok.some((f) => f.ruleId === "operand-type-mismatch" && f.message.includes("CMP"))).toBe(false);

    const mixed = createDefaultEngine().run(projectWithNodes(cmp("StrA = Level")));
    expect(mixed.some((f) =>
      f.ruleId === "operand-type-mismatch" &&
      f.message.includes("CMP") &&
      f.message.includes('"Level" is DINT'),
    )).toBe(true);

    const arithmetic = createDefaultEngine().run(projectWithNodes(cmp("StrA + Level")));
    expect(arithmetic.some((f) =>
      f.ruleId === "instruction-validation" &&
      f.message.includes("STRING tags in expression operands must be compared directly"),
    )).toBe(true);
  });
});
