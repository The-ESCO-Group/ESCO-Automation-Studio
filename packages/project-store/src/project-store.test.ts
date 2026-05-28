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
  createLadderRoutine,
  routineTagReferences,
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
});
