import type { PlcProject, Routine, Tag } from "@esco/core";
import { createLadderRoutine, type LadderRoutine } from "@esco/ladder";
import { createDefaultEngine, type ValidationFinding } from "@esco/validator";
import type { ProjectActionReceipt, ProjectActionResult } from "./types";

/** Run the default validation engine over a project. */
export function validate(project: PlcProject): ValidationFinding[] {
  return createDefaultEngine().run(project);
}

/** Build a successful result, attaching fresh validation findings. */
export function ok<T>(
  project: PlcProject,
  data?: T,
  warnings?: string[],
  receipt?: ProjectActionReceipt,
): ProjectActionResult<T> {
  return { ok: true, project, data, findings: validate(project), warnings, receipt };
}

/** Build a failure result; the project is returned unchanged. */
export function fail<T = unknown>(project: PlcProject, error: string): ProjectActionResult<T> {
  return { ok: false, project, error, findings: validate(project) };
}

export function findRoutine(project: PlcProject, routineId: string): Routine | undefined {
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      const routine = program.routines.find((r) => r.id === routineId);
      if (routine) return routine;
    }
  }
  return undefined;
}

/** The id of the first program's main routine — the default scan/edit target. */
export function defaultRoutineId(project: PlcProject): string | undefined {
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      const main = program.mainRoutineId
        ? program.routines.find((r) => r.id === program.mainRoutineId)
        : program.routines[0];
      if (main) return main.id;
    }
  }
  return undefined;
}

/** Read a routine's ladder AST from the loosely-typed `Routine.ladder` slot. */
export function getLadder(routine: Routine | undefined): LadderRoutine | undefined {
  const ladder = routine?.ladder;
  if (ladder && typeof ladder === "object" && Array.isArray((ladder as { rungs?: unknown }).rungs)) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

/** Immutably replace a routine's ladder via an updater. */
export function withRoutineLadder(
  project: PlcProject,
  routineId: string,
  updater: (ladder: LadderRoutine) => LadderRoutine,
): PlcProject {
  return {
    ...project,
    controllers: project.controllers.map((controller) => ({
      ...controller,
      programs: controller.programs.map((program) => ({
        ...program,
        routines: program.routines.map((routine) =>
          routine.id === routineId
            ? { ...routine, ladder: updater(getLadder(routine) ?? createLadderRoutine()) }
            : routine,
        ),
      })),
    })),
  };
}

/** Immutably map every routine's ladder across the whole project. */
export function mapAllLadders(
  project: PlcProject,
  fn: (ladder: LadderRoutine) => LadderRoutine,
): PlcProject {
  return {
    ...project,
    controllers: project.controllers.map((controller) => ({
      ...controller,
      programs: controller.programs.map((program) => ({
        ...program,
        routines: program.routines.map((routine) => {
          const ladder = getLadder(routine);
          return ladder ? { ...routine, ladder: fn(ladder) } : routine;
        }),
      })),
    })),
  };
}

/** Immutably map a program's routines. */
export function withProgramRoutines(
  project: PlcProject,
  programId: string,
  updater: (routines: Routine[]) => Routine[],
): PlcProject {
  return {
    ...project,
    controllers: project.controllers.map((controller) => ({
      ...controller,
      programs: controller.programs.map((program) =>
        program.id === programId ? { ...program, routines: updater(program.routines) } : program,
      ),
    })),
  };
}

export function getAllTags(project: PlcProject): Tag[] {
  return project.controllers.flatMap((controller) => [
    ...controller.controllerTags,
    ...controller.programs.flatMap((program) => program.programTags),
  ]);
}

export function tagExists(project: PlcProject, name: string): boolean {
  return getAllTags(project).some((tag) => tag.name === name);
}

/** Immutably add a controller-scoped tag to the first controller. */
export function withControllerTag(project: PlcProject, tag: Tag): PlcProject {
  return {
    ...project,
    controllers: project.controllers.map((controller, index) =>
      index === 0
        ? { ...controller, controllerTags: [...controller.controllerTags, tag] }
        : controller,
    ),
  };
}

/** Immutably transform every controller- and program-scoped tag. */
export function mapAllTags(project: PlcProject, fn: (tag: Tag) => Tag | null): PlcProject {
  const keep = (tags: Tag[]) => tags.map(fn).filter((t): t is Tag => t !== null);
  return {
    ...project,
    controllers: project.controllers.map((controller) => ({
      ...controller,
      controllerTags: keep(controller.controllerTags),
      programs: controller.programs.map((program) => ({
        ...program,
        programTags: keep(program.programTags),
      })),
    })),
  };
}
