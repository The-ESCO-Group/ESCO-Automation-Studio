import {
  createDemoProject,
  createTag,
  type PlcProject,
  type Routine,
  type Tag,
} from "@esco/core";
import { createLadderRoutine, type LadderRoutine } from "@esco/ladder";
import { buildDemoLadderRoutine } from "@esco/simulator";

/**
 * Web-side helpers for reading and immutably editing the project. The editable
 * ladder is stored as a semantic AST in `Routine.ladder` (core keeps that slot
 * loosely typed); these helpers cast it to a `LadderRoutine` at the edges.
 */

/** The seed project: the core demo with the seal-in ladder attached to MainRoutine. */
export function createInitialProject(): PlcProject {
  const project = createDemoProject();
  const routine = findMainRoutine(project);
  if (routine) {
    routine.ladder = buildDemoLadderRoutine();
  }
  return project;
}

export function findMainRoutine(project: PlcProject): Routine | undefined {
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      const main = program.mainRoutineId
        ? program.routines.find((routine) => routine.id === program.mainRoutineId)
        : program.routines[0];
      if (main) return main;
    }
  }
  return undefined;
}

export function getMainLadder(project: PlcProject): LadderRoutine | undefined {
  const ladder = findMainRoutine(project)?.ladder;
  if (
    ladder &&
    typeof ladder === "object" &&
    Array.isArray((ladder as { rungs?: unknown }).rungs)
  ) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

/** Immutably replace the main routine's ladder via an updater. */
export function withMainLadder(
  project: PlcProject,
  updater: (ladder: LadderRoutine) => LadderRoutine,
): PlcProject {
  const nextLadder = updater(getMainLadder(project) ?? createLadderRoutine());
  const mainId = findMainRoutine(project)?.id;
  if (!mainId) return project;

  return {
    ...project,
    controllers: project.controllers.map((controller) => ({
      ...controller,
      programs: controller.programs.map((program) => ({
        ...program,
        routines: program.routines.map((routine) =>
          routine.id === mainId ? { ...routine, ladder: nextLadder } : routine,
        ),
      })),
    })),
  };
}

/** Immutably add a BOOL controller tag (no-op if the name already exists). */
export function withNewTag(project: PlcProject, name: string): PlcProject {
  const controller = project.controllers[0];
  if (!controller || !name || tagExists(project, name)) return project;

  const tag = createTag(controller.id, name, "BOOL", {
    description: "Created in the ladder editor.",
    value: false,
  });

  return {
    ...project,
    controllers: project.controllers.map((current, index) =>
      index === 0
        ? { ...current, controllerTags: [...current.controllerTags, tag] }
        : current,
    ),
  };
}

export function getBoolTags(project: PlcProject): Tag[] {
  return project.controllers.flatMap((controller) =>
    controller.controllerTags.filter((tag) => tag.dataType === "BOOL"),
  );
}

export function tagExists(project: PlcProject, name: string): boolean {
  return project.controllers.some((controller) =>
    controller.controllerTags.some((tag) => tag.name === name),
  );
}
