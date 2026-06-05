import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, type PlcProject, type Routine } from "@esco/core";
import {
  createRoutine,
  exportProjectL5X,
  importL5XFile,
  setStructuredTextSource,
} from "./index";

function projectWithProgram() {
  const project = createProject("Source Edit Test");
  const controller = createController(project.id, "Controller_1");
  const program = createProgram(controller.id, "MainProgram");
  controller.programs.push(program);
  project.controllers.push(controller);
  return { project, programId: program.id };
}

function firstRoutine(project: PlcProject): Routine {
  return project.controllers[0]!.programs[0]!.routines[0]!;
}

describe("project-actions: Structured Text source editing", () => {
  it("creates an editable Structured Text routine without ladder AST", () => {
    const { project, programId } = projectWithProgram();

    const created = createRoutine(project, { programId, name: "ScaleST", language: "structured-text" });

    expect(created.ok).toBe(true);
    const routine = created.project.controllers[0]!.programs[0]!.routines[0]!;
    expect(routine.language).toBe("structured-text");
    expect(routine.structuredText).toBe("");
    expect(routine.ladder).toBeUndefined();
  });

  it("updates ST source through the controlled action layer and round-trips through L5X", () => {
    const { project, programId } = projectWithProgram();
    const created = createRoutine(project, { programId, name: "ScaleST", language: "structured-text" });
    const routineId = created.data!.routineId;
    const source = "Result := Input * 2;\nDone := Result > 10;";
    const contaminated: PlcProject = {
      ...created.project,
      controllers: created.project.controllers.map((controller) => ({
        ...controller,
        programs: controller.programs.map((program) => ({
          ...program,
          routines: program.routines.map((routine) =>
            routine.id === routineId
              ? { ...routine, ladder: { id: "legacy-ladder", rungs: [] }, sourceText: "legacy source" }
              : routine,
          ),
        })),
      })),
    };

    const updated = setStructuredTextSource(contaminated, { routineId, source });
    expect(updated.ok).toBe(true);
    expect(updated.project).not.toBe(contaminated);
    expect(firstRoutine(contaminated).structuredText).toBe("");
    expect(firstRoutine(contaminated).sourceText).toBe("legacy source");
    expect(firstRoutine(updated.project).structuredText).toBe(source);
    expect(firstRoutine(updated.project).sourceText).toBeUndefined();
    expect(firstRoutine(updated.project).ladder).toBeUndefined();
    expect(updated.warnings).toContain(
      "Structured Text is preserved/exported and executes only a conservative Offline Simulation subset.",
    );

    const exported = exportProjectL5X(updated.project);
    expect(exported.ok).toBe(true);
    expect(exported.data!.text).toContain("<STContent>");
    expect(exported.data!.text).toContain("Result := Input * 2;");

    const reimported = importL5XFile(exported.data!.text);
    expect(reimported.ok).toBe(true);
    const routine = reimported.project.controllers[0]!.programs[0]!.routines[0]!;
    expect(routine.language).toBe("structured-text");
    expect(routine.structuredText).toContain("Done := Result > 10;");
  });

  it("rejects ST source edits against ladder routines", () => {
    const { project, programId } = projectWithProgram();
    const created = createRoutine(project, { programId, name: "MainRoutine", language: "ladder" });

    const updated = setStructuredTextSource(created.project, {
      routineId: created.data!.routineId,
      source: "ThisShouldNotApply := 1;",
    });

    expect(updated.ok).toBe(false);
    expect(updated.project).toBe(created.project);
    expect(updated.error).toContain("not Structured Text");
  });

  it("rejects non-string ST source payloads", () => {
    const { project, programId } = projectWithProgram();
    const created = createRoutine(project, { programId, name: "ScaleST", language: "structured-text" });

    const updated = setStructuredTextSource(created.project, {
      routineId: created.data!.routineId,
      source: 42,
    } as unknown as Parameters<typeof setStructuredTextSource>[1]);

    expect(updated.ok).toBe(false);
    expect(updated.project).toBe(created.project);
    expect(firstRoutine(updated.project).structuredText).toBe("");
    expect(updated.error).toContain("must be a string");
  });
});
