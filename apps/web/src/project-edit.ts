import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
  type Routine,
  type Tag,
} from "@esco/core";
import { createDefaultHmiProject } from "@esco/hmi-model";
import { createLadderRoutine, createRung, type LadderRoutine } from "@esco/ladder";

/**
 * Web-side helpers for reading and immutably editing the project. The editable
 * ladder is stored as a semantic AST in `Routine.ladder` (core keeps that slot
 * loosely typed); these helpers cast it to a `LadderRoutine` at the edges.
 */

/** Initial workspace state: no controllers, matching ESCO's start page. */
export function createInitialProject(): PlcProject {
  return createProject("Untitled Project", "Blank ESCO Automation Studio workspace.");
}

export interface BlankRoutineProjectOptions {
  projectName?: string;
  description?: string;
  controllerName?: string;
  catalogNumber?: string;
  firmwareRevision?: string;
  chassis?: string;
  slot?: number;
  securityAuthority?: string;
}

function processorTypeForCatalog(catalogNumber: string): string {
  return /L8|558/i.test(catalogNumber) ? "ESCO5580" : "ESCO5571";
}

/** Create a real blank ladder workspace without sample tags or sample rungs. */
export function createBlankRoutineProject(options: BlankRoutineProjectOptions = {}): PlcProject {
  const projectName = options.projectName?.trim() || "Untitled Project";
  const controllerName = options.controllerName?.trim() || "Controller_1";
  const catalogNumber = options.catalogNumber?.trim() || "1756-L71";
  const firmwareRevision = options.firmwareRevision?.trim() || "32.11";
  const chassis = options.chassis?.trim() || "1756-A10";
  const slot = Number.isFinite(options.slot) ? options.slot! : 0;
  const processorType = processorTypeForCatalog(catalogNumber);

  const project = createProject(projectName, options.description?.trim() || "Blank ESCO Automation Studio project.");
  const controller = createController(project.id, controllerName);
  controller.processorType = processorType;
  controller.catalogNumber = catalogNumber;
  controller.firmwareRevision = firmwareRevision;
  controller.chassis = chassis;
  controller.slot = slot;
  controller.commDriver = "Offline Model";
  controller.commPath = `Offline Model\\Local Backplane\\Slot ${slot}`;
  if (options.securityAuthority?.trim()) {
    controller.security = { securityAuthorityName: options.securityAuthority.trim() };
  }

  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  const ladder = createLadderRoutine();
  ladder.rungs = [createRung(routine.id, 0)];
  routine.ladder = ladder;
  program.mainRoutineId = routine.id;
  program.routines.push(routine);

  const task = createContinuousTask(controller.id, "MainTask", [program.id]);
  controller.tasks.push(task);
  controller.programs.push(program);
  controller.ioConfiguration.modules.push(
    {
      id: `${controller.id}-chassis`,
      name: "1756 Backplane",
      catalogNumber: chassis,
      productType: "Chassis",
    },
    {
      id: `${controller.id}-slot${slot}`,
      name: controller.name,
      catalogNumber,
      productType: `${processorType} Processor`,
      slot,
    },
  );
  project.controllers.push(controller);

  const projectWithHmi = { ...project, hmi: createDefaultHmiProject(`${projectName} HMI`) };
  return projectWithHmi;
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

/** Immutably add a controller tag of the given data type (no-op if name exists). */
export function withNewTag(
  project: PlcProject,
  name: string,
  dataType = "BOOL",
): PlcProject {
  const controller = project.controllers[0];
  if (!controller || !name || tagExists(project, name)) return project;

  const tag = createTag(controller.id, name, dataType, {
    description: "Created in the ladder editor.",
    value: dataType === "BOOL" ? false : 0,
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

/** All controller and program tags across the project, in declaration order. */
export function getTags(project: PlcProject): Tag[] {
  return project.controllers.flatMap((controller) => [
    ...controller.controllerTags,
    ...controller.programs.flatMap((program) => program.programTags),
  ]);
}

export function tagExists(project: PlcProject, name: string): boolean {
  return project.controllers.some((controller) =>
    controller.controllerTags.some((tag) => tag.name === name),
  );
}
