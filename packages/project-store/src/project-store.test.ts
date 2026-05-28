import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
} from "@esco/core";
import {
  addRung,
  appendInstruction,
  appendNode,
  createLadderRoutine,
  createNode,
  routineNodes,
  routineTagReferences,
  tagOperand,
  type LadderRoutine,
} from "@esco/ladder";
import { deserializeProject, serializeProject } from "./index";

/** A project carrying a real ladder AST + BOOL tags, like the editor produces. */
function demoProject(): PlcProject {
  const project = createProject("Round Trip");
  const controller = createController(project.id, "DemoController");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = routine.id;

  let ladder = addRung(createLadderRoutine());
  const rungId = ladder.rungs[0]!.id;
  ladder = appendInstruction(ladder, rungId, "XIC", "StartPB");
  ladder = appendInstruction(ladder, rungId, "XIO", "StopPB");
  ladder = appendInstruction(ladder, rungId, "OTE", "MotorRun");
  routine.ladder = ladder;

  program.routines.push(routine);
  controller.programs.push(program);
  for (const name of ["StartPB", "StopPB", "MotorRun"]) {
    controller.controllerTags.push(createTag(controller.id, name, "BOOL", { value: false }));
  }
  project.controllers.push(controller);
  return project;
}

describe("project-store serialize/deserialize", () => {
  it("round-trips a project with ladder AST and tags", () => {
    const project = demoProject();
    const restored = deserializeProject(serializeProject(project));
    expect(restored).toEqual(project);
  });

  it("preserves the ladder operand tags through a round trip", () => {
    const project = demoProject();
    const restored = deserializeProject(serializeProject(project));
    const ladder = restored.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    expect(routineTagReferences(ladder)).toEqual(["StartPB", "StopPB", "MotorRun"]);
  });

  it("rejects invalid JSON", () => {
    expect(() => deserializeProject("{ not json")).toThrow();
  });

  it("rejects a wrong-shaped file", () => {
    const bad = JSON.stringify({ formatVersion: 1, project: { id: "x" } });
    expect(() => deserializeProject(bad)).toThrow();
  });

  it("rejects an unsupported format version", () => {
    const project = demoProject();
    const file = JSON.parse(serializeProject(project));
    file.formatVersion = 999;
    expect(() => deserializeProject(JSON.stringify(file))).toThrow(/format version/i);
  });

  it("round-trips the new core instructions (ONS, RTO, RES, CTD, NOP, AFI)", () => {
    const project = demoProject();
    const routine = project.controllers[0]!.programs[0]!.routines[0]!;
    let ladder = routine.ladder as LadderRoutine;
    ladder = addRung(ladder);
    const rungId = ladder.rungs[ladder.rungs.length - 1]!.id;
    ladder = appendNode(ladder, rungId, createNode("ONS", [tagOperand("storage", "OneShot")]));
    ladder = appendNode(ladder, rungId, createNode("RTO", [tagOperand("timer", "Dwell"), tagOperand("preset", "5000")]));
    ladder = appendNode(ladder, rungId, createNode("RES", [tagOperand("structure", "Dwell")]));
    ladder = appendNode(ladder, rungId, createNode("CTD", [tagOperand("counter", "Down"), tagOperand("preset", "0")]));
    ladder = appendNode(ladder, rungId, createNode("NOP", []));
    ladder = appendNode(ladder, rungId, createNode("AFI", []));
    routine.ladder = ladder;

    const restored = deserializeProject(serializeProject(project));
    expect(restored).toEqual(project);
    const restoredLadder = restored.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    const newRung = restoredLadder.rungs[restoredLadder.rungs.length - 1]!;
    expect(newRung.root.nodes.map((n) => n.instructionType)).toEqual([
      "ONS", "RTO", "RES", "CTD", "NOP", "AFI",
    ]);
    const rto = newRung.root.nodes.find((n) => n.instructionType === "RTO");
    expect(rto?.operands.map((o) => o.value)).toEqual(["Dwell", "5000"]);
  });

  it("round-trips a multi-operand instruction (TON) with all its operands", () => {
    const project = demoProject();
    const routine = project.controllers[0]!.programs[0]!.routines[0]!;
    let ladder = routine.ladder as LadderRoutine;
    ladder = addRung(ladder);
    const rungId = ladder.rungs[ladder.rungs.length - 1]!.id;
    ladder = appendNode(
      ladder,
      rungId,
      createNode("TON", [tagOperand("timer", "Timer1"), tagOperand("preset", "3000")]),
    );
    routine.ladder = ladder;

    const restored = deserializeProject(serializeProject(project));
    const restoredLadder = restored.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    const ton = routineNodes(restoredLadder).find((n) => n.instructionType === "TON");
    expect(ton?.operands.map((o) => o.value)).toEqual(["Timer1", "3000"]);
  });
});
