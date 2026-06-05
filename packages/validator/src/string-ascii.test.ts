import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/** A routine of string/ASCII ops whose operands are strings/buffers/channels, not plain numeric tags. */
function projectWithStringOps() {
  const project = createProject("Str");
  const controller = createController(project.id, "Str");
  controller.controllerTags.push(
    createTag(controller.id, "StrA", "STRING", { value: "" }),
    createTag(controller.id, "StrB", "STRING", { value: "" }),
    createTag(controller.id, "Dest", "STRING", { value: "" }),
    createTag(controller.id, "Channel0", "STRING", { value: "" }),
    createTag(controller.id, "Buf", "STRING", { value: "" }),
  );
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
  ladder.rungs.push(
    createRung(ladder.id, 2, [createNode("AHL", [tagOperand("op0", "Channel0")])]),
  );
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

function addCustomStringType(controller: ReturnType<typeof createController>) {
  controller.dataTypes.push({
    id: "udt-string-20",
    name: "STRING_20",
    family: "StringFamily",
    members: [
      { name: "LEN", dataType: "DINT" },
      { name: "DATA", dataType: "SINT", dimensions: [20] },
    ],
  });
}

function addCustomStringTags(controller: ReturnType<typeof createController>) {
  addCustomStringType(controller);
  controller.controllerTags.push(
    createTag(controller.id, "StrA", "STRING_20", { value: "" }),
    createTag(controller.id, "StrB", "STRING_20", { value: "" }),
    createTag(controller.id, "Dest", "STRING_20", { value: "" }),
    createTag(controller.id, "Channel0", "STRING_20", { value: "" }),
    createTag(controller.id, "Buf", "STRING_20", { value: "" }),
    createTag(controller.id, "Count", "DINT", { value: 0 }),
    createTag(controller.id, "BadNumber", "DINT", { value: 0 }),
  );
}

function projectWithCustomStringLadder(badOperand = false) {
  const project = createProject("CustomStr");
  const controller = createController(project.id, "CustomStr");
  addCustomStringTags(controller);
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [
      createNode("CONCAT", [
        tagOperand("op0", badOperand ? "BadNumber" : "StrA"),
        tagOperand("op1", "StrB"),
        tagOperand("op2", "Dest"),
      ]),
    ]),
  );
  ladder.rungs.push(
    createRung(ladder.id, 1, [createNode("LEN", [tagOperand("op0", "StrA"), tagOperand("op1", "Count")])]),
  );
  ladder.rungs.push(
    createRung(ladder.id, 2, [createNode("ARD", [tagOperand("op0", "Channel0"), tagOperand("op1", "Buf")])]),
  );
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

function projectWithCustomStringStructuredText(source: string) {
  const project = createProject("CustomStrST");
  const controller = createController(project.id, "CustomStrST");
  addCustomStringTags(controller);
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainST", "structured-text");
  routine.structuredText = source;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

describe("string/ASCII instructions validate executable string/buffer ops and model-only hardware ops", () => {
  const findings = createDefaultEngine().run(projectWithStringOps());

  it("emits model-only-instruction info for hardware AHL but not executable CONCAT/ARD", () => {
    const modelOnly = findings.filter((f) => f.ruleId === "model-only-instruction");
    expect(modelOnly.some((f) => f.message.includes('"AHL"'))).toBe(true);
    expect(modelOnly.some((f) => f.message.includes('"CONCAT"'))).toBe(false);
    expect(modelOnly.some((f) => f.message.includes('"ARD"'))).toBe(false);
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

  it("accepts custom StringFamily tags wherever STRING operands are allowed", () => {
    const customFindings = createDefaultEngine().run(projectWithCustomStringLadder());
    expect(customFindings.some((f) => f.ruleId === "operand-type-mismatch")).toBe(false);
    expect(customFindings.some((f) => f.severity === "error")).toBe(false);
  });

  it("still rejects numeric tags used as string operands", () => {
    const badFindings = createDefaultEngine().run(projectWithCustomStringLadder(true));
    expect(
      badFindings.some(
        (finding) =>
          finding.ruleId === "operand-type-mismatch" &&
          finding.message.includes("CONCAT") &&
          finding.message.includes("BadNumber") &&
          finding.message.includes("DINT"),
      ),
    ).toBe(true);
  });

  it("accepts custom StringFamily tags for Structured Text string calls", () => {
    const project = projectWithCustomStringStructuredText(`
      CONCAT(StrA, StrB, Dest);
      LEN(StrA, Count);
      ARD(Channel0, Buf);
    `);
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "operand-type-mismatch")).toBe(false);
    expect(findings.some((f) => f.severity === "error")).toBe(false);
  });
});
