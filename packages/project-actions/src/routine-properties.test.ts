import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  type PlcProject,
} from "@esco/core";
import { createLadderRoutine, routineNodes, type LadderNode, type LadderRoutine } from "@esco/ladder";
import { addRungFromText, createRoutine as createRoutineAction, setRoutineProperties } from "./index";

interface Fixture {
  project: PlcProject;
  mainId: string;
  subId: string;
  programId: string;
}

/** A program with a Main routine whose JSR(Sub) calls a Sub routine. */
function fixture(): Fixture {
  const project = createProject("Test");
  const controller = createController(project.id, "DemoController");
  const program = createProgram(controller.id, "MainProgram");
  const main = createRoutine(program.id, "MainRoutine", "ladder");
  main.ladder = createLadderRoutine();
  program.mainRoutineId = main.id;
  program.routines.push(main);
  controller.programs.push(program);
  project.controllers.push(controller);

  let p = project;
  const sub = createRoutineAction(p, { programId: program.id, name: "Sub" });
  p = sub.project;
  const subId = sub.data!.routineId;
  // JSR with an input-count + parameter operand, so we can prove only the
  // routine-reference operand is remapped (not the parameters).
  p = addRungFromText(p, { routineId: main.id, text: "XIC(Run)JSR(Sub,0)" }).project;

  return { project: p, mainId: main.id, subId, programId: program.id };
}

function ladderOf(project: PlcProject, routineId: string): LadderRoutine {
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      const routine = program.routines.find((r) => r.id === routineId);
      if (routine?.ladder) return routine.ladder as LadderRoutine;
    }
  }
  throw new Error(`routine ${routineId} has no ladder`);
}

function jsrNode(project: PlcProject, routineId: string): LadderNode {
  const node = [...routineNodes(ladderOf(project, routineId))].find(
    (n) => n.instructionType === "JSR",
  );
  if (!node) throw new Error("no JSR node");
  return node;
}

function routineName(project: PlcProject, routineId: string): string {
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      const routine = program.routines.find((r) => r.id === routineId);
      if (routine) return routine.name;
    }
  }
  throw new Error("routine not found");
}

describe("setRoutineProperties", () => {
  it("renames a routine and remaps JSR references within the program", () => {
    const f = fixture();
    const result = setRoutineProperties(f.project, { routineId: f.subId, name: "Subroutine" });
    expect(result.ok).toBe(true);
    expect(routineName(result.project, f.subId)).toBe("Subroutine");

    const node = jsrNode(result.project, f.mainId);
    expect(node.operands[0]!.value).toBe("Subroutine");
    // The JSR input-count parameter operand is left untouched.
    expect(node.operands[1]!.value).toBe("0");
    // No "unknown-routine" warning remains after the remap.
    expect(result.findings?.some((finding) => finding.ruleId === "unknown-routine")).toBe(false);
  });

  it("edits the description without touching the name or references", () => {
    const f = fixture();
    const result = setRoutineProperties(f.project, {
      routineId: f.subId,
      description: "Handles the seal-in",
    });
    expect(result.ok).toBe(true);
    expect(routineName(result.project, f.subId)).toBe("Sub");
    expect(jsrNode(result.project, f.mainId).operands[0]!.value).toBe("Sub");
  });

  it("can rename and re-describe in one action", () => {
    const f = fixture();
    const result = setRoutineProperties(f.project, {
      routineId: f.subId,
      name: "Helper",
      description: "doc",
    });
    expect(result.ok).toBe(true);
    expect(routineName(result.project, f.subId)).toBe("Helper");
    expect(jsrNode(result.project, f.mainId).operands[0]!.value).toBe("Helper");
  });

  it("rejects a duplicate name within the same program", () => {
    const f = fixture();
    const result = setRoutineProperties(f.project, { routineId: f.subId, name: "MainRoutine" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already exists/);
    expect(routineName(result.project, f.subId)).toBe("Sub");
  });

  it("rejects an invalid routine name and an unknown routine id", () => {
    const f = fixture();
    expect(setRoutineProperties(f.project, { routineId: f.subId, name: "1bad" }).ok).toBe(false);
    expect(setRoutineProperties(f.project, { routineId: f.subId, name: "Bad__Name" }).error).toMatch(
      /consecutive underscores/,
    );
    expect(setRoutineProperties(f.project, { routineId: f.subId, name: "Bad_" }).error).toMatch(
      /must not end with an underscore/,
    );
    expect(setRoutineProperties(f.project, { routineId: f.subId, name: "R".repeat(41) }).error).toMatch(
      /limit is 40/,
    );
    expect(setRoutineProperties(f.project, { routineId: "nope", name: "X" }).ok).toBe(false);
  });

  it("treats renaming to the same name as a no-op success", () => {
    const f = fixture();
    const result = setRoutineProperties(f.project, { routineId: f.subId, name: "Sub" });
    expect(result.ok).toBe(true);
    expect(routineName(result.project, f.subId)).toBe("Sub");
  });
});
