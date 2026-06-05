import {
  arrayDimensionsOf,
  createContinuousTask as createCoreContinuousTask,
  createProgram as createCoreProgram,
} from "@esco/core";
import type { AddOnInstruction, Controller, PlcProject, Program, Routine, Tag, UserDefinedType } from "@esco/core";
import { createDefaultRegistry } from "@esco/instructions";
import { rungNodes } from "@esco/ladder";
import { nowIso } from "@esco/shared";
import { fail, getLadder, ok } from "./helpers";
import { logixIdentifierError } from "./logix-names";
import type {
  CreateProgramInput,
  CreateTaskInput,
  DeleteAoiInput,
  DeleteProgramInput,
  DeleteRoutineInput,
  DeleteTaskInput,
  DeleteUdtInput,
  ProjectActionResult,
} from "./types";

const registry = createDefaultRegistry();

/** A place an Add-On Instruction is called from a routine. */
export interface AoiReference {
  controllerName: string;
  programName: string;
  routineName: string;
  routineId: string;
  rungNumber: number;
}

/**
 * Find every call of an Add-On Instruction across all routines. An AOI call
 * shows up in ladder as a node whose instruction type is the AOI name.
 */
export function aoiReferences(project: PlcProject, aoiName: string): AoiReference[] {
  const references: AoiReference[] = [];
  const target = aoiName.toUpperCase(); // the rung parser upper-cases instruction types
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const rung of ladder.rungs) {
          if (rungNodes(rung).some((node) => node.instructionType.toUpperCase() === target)) {
            references.push({
              controllerName: controller.name,
              programName: program.name,
              routineName: routine.name,
              routineId: routine.id,
              rungNumber: rung.number,
            });
          }
        }
      }
    }
  }
  return references;
}

/** A tag whose data type is a given UDT/AOI/structure type. */
export interface TagOfType {
  name: string;
  scope: Tag["scope"];
  programName?: string;
  dimension?: number;
  dimensions?: number[];
}

/** Every tag in the project whose data type is `typeName` (e.g. instances of a UDT). */
export function tagsUsingType(project: PlcProject, typeName: string): TagOfType[] {
  const results: TagOfType[] = [];
  for (const controller of project.controllers) {
    for (const tag of controller.controllerTags) {
      if (tag.dataType === typeName) {
        const dimensions = arrayDimensionsOf(tag);
        results.push({
          name: tag.name,
          scope: tag.scope,
          ...(dimensions[0] ? { dimension: dimensions[0] } : {}),
          ...(dimensions.length > 1 ? { dimensions } : {}),
        });
      }
    }
    for (const program of controller.programs) {
      for (const tag of program.programTags) {
        if (tag.dataType === typeName) {
          const dimensions = arrayDimensionsOf(tag);
          results.push({
            name: tag.name,
            scope: tag.scope,
            programName: program.name,
            ...(dimensions[0] ? { dimension: dimensions[0] } : {}),
            ...(dimensions.length > 1 ? { dimensions } : {}),
          });
        }
      }
    }
  }
  return results;
}

/** Preview member access paths for a UDT, e.g. `MotorUdt.Status`, `MotorUdt.Speed`. */
export function udtMemberPaths(udt: UserDefinedType): string[] {
  return udt.members.map((member) => {
    const dimensions = arrayDimensionsOf(member);
    return `${udt.name}.${member.name}${dimensions.length > 0 ? `[${dimensions.map(() => 0).join(",")}]` : ""}`;
  });
}

function sameName(left: string | undefined, right: string): boolean {
  return (left ?? "").toLowerCase() === right.toLowerCase();
}

function optionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function positiveInt(value: number | undefined, fallback?: number): number | undefined {
  return value != null && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function findProgramOwner(project: PlcProject, programId: string): { controller: Controller; program: Program } | undefined {
  for (const controller of project.controllers) {
    const program = controller.programs.find((candidate) => candidate.id === programId);
    if (program) return { controller, program };
  }
  return undefined;
}

function findRoutineOwner(project: PlcProject, routineId: string): { controller: Controller; program: Program; routine: Routine } | undefined {
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      const routine = program.routines.find((candidate) => candidate.id === routineId);
      if (routine) return { controller, program, routine };
    }
  }
  return undefined;
}

function findUdtOwner(project: PlcProject, udtId: string): { controller: Controller; udt: UserDefinedType } | undefined {
  for (const controller of project.controllers) {
    const udt = controller.dataTypes.find((candidate) => candidate.id === udtId);
    if (udt) return { controller, udt };
  }
  return undefined;
}

function findAoiOwner(project: PlcProject, aoiId: string): { controller: Controller; aoi: AddOnInstruction } | undefined {
  for (const controller of project.controllers) {
    const aoi = controller.addOnInstructions.find((candidate) => candidate.id === aoiId);
    if (aoi) return { controller, aoi };
  }
  return undefined;
}

function routineReferenceCount(program: Program, target: Routine): number {
  let count = 0;
  for (const routine of program.routines) {
    if (routine.id === target.id) continue;
    const ladder = getLadder(routine);
    if (!ladder) continue;
    for (const rung of ladder.rungs) {
      for (const node of rungNodes(rung)) {
        const operands = registry.get(node.instructionType)?.operands ?? [];
        node.operands.forEach((operand, index) => {
          if (operands[index]?.isRoutineRef && sameName(operand.value, target.name)) count += 1;
        });
      }
    }
  }
  return count;
}

export function createProgram(
  project: PlcProject,
  input: CreateProgramInput,
): ProjectActionResult<{ controllerId: string; programId: string; programName: string; scheduledTaskId?: string }> {
  const controllerId = input.controllerId?.trim();
  const name = input.name?.trim();
  if (!controllerId) return fail(project, "Controller id is required.");
  if (!name) return fail(project, "Program name is required.");

  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return fail(project, `Controller "${controllerId}" not found.`);

  const invalidName = logixIdentifierError(name, "Program");
  if (invalidName) return fail(project, invalidName);
  if (controller.programs.some((program) => sameName(program.name, name))) {
    return fail(project, `Program "${name}" already exists in that controller.`);
  }

  const scheduledTaskId = optionalText(input.scheduledTaskId);
  if (scheduledTaskId && !controller.tasks.some((task) => task.id === scheduledTaskId)) {
    return fail(project, `Task "${scheduledTaskId}" not found for controller "${controller.name}".`);
  }

  const program = {
    ...createCoreProgram(controller.id, name),
    ...(optionalText(input.description) ? { description: optionalText(input.description) } : {}),
  };
  const next: PlcProject = {
    ...project,
    updatedAt: nowIso(),
    controllers: project.controllers.map((candidate) => {
      if (candidate.id !== controller.id) return candidate;
      return {
        ...candidate,
        programs: [...candidate.programs, program],
        tasks: scheduledTaskId
          ? candidate.tasks.map((task) =>
              task.id === scheduledTaskId && !task.scheduledProgramIds.includes(program.id)
                ? { ...task, scheduledProgramIds: [...task.scheduledProgramIds, program.id] }
                : task,
            )
          : candidate.tasks,
      };
    }),
  };

  return ok(next, {
    controllerId: controller.id,
    programId: program.id,
    programName: program.name,
    ...(scheduledTaskId ? { scheduledTaskId } : {}),
  });
}

export function createTask(
  project: PlcProject,
  input: CreateTaskInput,
): ProjectActionResult<{ controllerId: string; taskId: string; taskName: string; scheduledProgramIds: string[] }> {
  const controllerId = input.controllerId?.trim();
  const name = input.name?.trim();
  if (!controllerId) return fail(project, "Controller id is required.");
  if (!name) return fail(project, "Task name is required.");

  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return fail(project, `Controller "${controllerId}" not found.`);

  const invalidName = logixIdentifierError(name, "Task");
  if (invalidName) return fail(project, invalidName);
  if (controller.tasks.some((task) => sameName(task.name, name))) {
    return fail(project, `Task "${name}" already exists in that controller.`);
  }
  if (input.type === "continuous" && controller.tasks.some((task) => task.type === "continuous")) {
    return fail(project, "A controller can only have one continuous task.");
  }

  const scheduledProgramIds = (input.scheduledProgramIds ?? []).map((programId) => programId.trim());
  if (scheduledProgramIds.some((programId) => !programId)) return fail(project, "Scheduled program id is required.");
  const knownProgramIds = new Set(controller.programs.map((program) => program.id));
  const missingProgramId = scheduledProgramIds.find((programId) => !knownProgramIds.has(programId));
  if (missingProgramId) return fail(project, `Program "${missingProgramId}" not found for controller "${controller.name}".`);

  const task = {
    ...createCoreContinuousTask(controller.id, name, scheduledProgramIds),
    type: input.type,
    ...(input.type === "periodic" ? { periodMs: positiveInt(input.periodMs, 10) } : {}),
    ...(input.type !== "continuous" ? { priority: positiveInt(input.priority, 10) } : {}),
    watchdogMs: positiveInt(input.watchdogMs, 500),
    ...(input.inhibited ? { inhibited: true } : {}),
    ...(input.disableUpdateOutputs ? { disableUpdateOutputs: true } : {}),
  };
  const next: PlcProject = {
    ...project,
    updatedAt: nowIso(),
    controllers: project.controllers.map((candidate) =>
      candidate.id === controller.id ? { ...candidate, tasks: [...candidate.tasks, task] } : candidate,
    ),
  };

  return ok(next, { controllerId: controller.id, taskId: task.id, taskName: task.name, scheduledProgramIds });
}

function typeDependencyMessages(project: PlcProject, typeName: string, excludedUdtId?: string): string[] {
  const messages: string[] = [];
  const tagCount = tagsUsingType(project, typeName).length;
  if (tagCount) messages.push(`${tagCount} tag${tagCount === 1 ? "" : "s"}`);

  let udtMemberCount = 0;
  let aoiMemberCount = 0;
  let programParameterCount = 0;
  for (const controller of project.controllers) {
    for (const udt of controller.dataTypes) {
      if (udt.id === excludedUdtId) continue;
      udtMemberCount += udt.members.filter((member) => sameName(member.dataType, typeName)).length;
    }
    for (const aoi of controller.addOnInstructions) {
      aoiMemberCount += aoi.parameters.filter((parameter) => sameName(parameter.dataType, typeName)).length;
      aoiMemberCount += aoi.localTags.filter((localTag) => sameName(localTag.dataType, typeName)).length;
    }
    for (const program of controller.programs) {
      programParameterCount += (program.parameters ?? []).filter((parameter) => sameName(parameter.dataType, typeName)).length;
    }
  }

  if (udtMemberCount) messages.push(`${udtMemberCount} UDT member${udtMemberCount === 1 ? "" : "s"}`);
  if (aoiMemberCount) messages.push(`${aoiMemberCount} AOI parameter/local tag${aoiMemberCount === 1 ? "" : "s"}`);
  if (programParameterCount) messages.push(`${programParameterCount} program parameter${programParameterCount === 1 ? "" : "s"}`);
  return messages;
}

export function deleteTask(
  project: PlcProject,
  input: DeleteTaskInput,
): ProjectActionResult<{ taskId: string; taskName: string; controllerId: string }> {
  const taskId = input.taskId?.trim();
  if (!taskId) return fail(project, "Task id is required.");

  for (const controller of project.controllers) {
    const task = controller.tasks.find((candidate) => candidate.id === taskId);
    if (!task) continue;
    return ok(
      {
        ...project,
        controllers: project.controllers.map((candidate) =>
          candidate.id === controller.id
            ? { ...candidate, tasks: candidate.tasks.filter((item) => item.id !== taskId) }
            : candidate,
        ),
      },
      { taskId, taskName: task.name, controllerId: controller.id },
    );
  }

  return fail(project, `Task "${taskId}" not found.`);
}

export function deleteProgram(
  project: PlcProject,
  input: DeleteProgramInput,
): ProjectActionResult<{ programId: string; programName: string; controllerId: string }> {
  const programId = input.programId?.trim();
  if (!programId) return fail(project, "Program id is required.");
  const owner = findProgramOwner(project, programId);
  if (!owner) return fail(project, `Program "${programId}" not found.`);

  const { controller, program } = owner;
  return ok(
    {
      ...project,
      controllers: project.controllers.map((candidate) => {
        if (candidate.id !== controller.id) return candidate;
        return {
          ...candidate,
          faultRoutineName: sameName(candidate.faultRoutineName, program.name) ? undefined : candidate.faultRoutineName,
          powerUpRoutineName: sameName(candidate.powerUpRoutineName, program.name) ? undefined : candidate.powerUpRoutineName,
          programs: candidate.programs.filter((item) => item.id !== programId),
          tasks: candidate.tasks.map((task) => ({
            ...task,
            scheduledProgramIds: task.scheduledProgramIds.filter((id) => id !== programId),
          })),
        };
      }),
    },
    { programId, programName: program.name, controllerId: controller.id },
  );
}

export function deleteRoutine(
  project: PlcProject,
  input: DeleteRoutineInput,
): ProjectActionResult<{ routineId: string; routineName: string; programId: string; controllerId: string }> {
  const routineId = input.routineId?.trim();
  if (!routineId) return fail(project, "Routine id is required.");
  const owner = findRoutineOwner(project, routineId);
  if (!owner) return fail(project, `Routine "${routineId}" not found.`);

  const { controller, program, routine } = owner;
  const references = routineReferenceCount(program, routine);
  if (references) {
    return fail(
      project,
      `Cannot delete routine "${routine.name}": still referenced by ${references} routine-reference operand${references === 1 ? "" : "s"}.`,
    );
  }

  return ok(
    {
      ...project,
      controllers: project.controllers.map((candidate) => {
        if (candidate.id !== controller.id) return candidate;
        return {
          ...candidate,
          faultRoutineName: sameName(candidate.faultRoutineName, routine.name) ? undefined : candidate.faultRoutineName,
          powerUpRoutineName: sameName(candidate.powerUpRoutineName, routine.name) ? undefined : candidate.powerUpRoutineName,
          programs: candidate.programs.map((item) => {
            if (item.id !== program.id) return item;
            const routines = item.routines.filter((candidateRoutine) => candidateRoutine.id !== routineId);
            const fallbackRoutineId = routines[0]?.id;
            return {
              ...item,
              routines,
              mainRoutineId: item.mainRoutineId === routineId ? fallbackRoutineId : item.mainRoutineId,
              faultRoutineId: item.faultRoutineId === routineId ? undefined : item.faultRoutineId,
            };
          }),
        };
      }),
    },
    { routineId, routineName: routine.name, programId: program.id, controllerId: controller.id },
  );
}

export function deleteUdt(
  project: PlcProject,
  input: DeleteUdtInput,
): ProjectActionResult<{ udtId: string; udtName: string; controllerId: string }> {
  const udtId = input.udtId?.trim();
  if (!udtId) return fail(project, "UDT id is required.");
  const owner = findUdtOwner(project, udtId);
  if (!owner) return fail(project, `UDT "${udtId}" not found.`);

  const dependencies = typeDependencyMessages(project, owner.udt.name, owner.udt.id);
  if (dependencies.length) {
    return fail(project, `Cannot delete UDT "${owner.udt.name}": still used by ${dependencies.join(", ")}.`);
  }

  return ok(
    {
      ...project,
      controllers: project.controllers.map((controller) =>
        controller.id === owner.controller.id
          ? { ...controller, dataTypes: controller.dataTypes.filter((udt) => udt.id !== udtId) }
          : controller,
      ),
    },
    { udtId, udtName: owner.udt.name, controllerId: owner.controller.id },
  );
}

export function deleteAoi(
  project: PlcProject,
  input: DeleteAoiInput,
): ProjectActionResult<{ aoiId: string; aoiName: string; controllerId: string }> {
  const aoiId = input.aoiId?.trim();
  if (!aoiId) return fail(project, "Add-On Instruction id is required.");
  const owner = findAoiOwner(project, aoiId);
  if (!owner) return fail(project, `Add-On Instruction "${aoiId}" not found.`);

  const dependencies = typeDependencyMessages(project, owner.aoi.name);
  const callCount = aoiReferences(project, owner.aoi.name).length;
  if (callCount) dependencies.push(`${callCount} logic call${callCount === 1 ? "" : "s"}`);
  if (dependencies.length) {
    return fail(project, `Cannot delete Add-On Instruction "${owner.aoi.name}": still used by ${dependencies.join(", ")}.`);
  }

  return ok(
    {
      ...project,
      controllers: project.controllers.map((controller) =>
        controller.id === owner.controller.id
          ? { ...controller, addOnInstructions: controller.addOnInstructions.filter((aoi) => aoi.id !== aoiId) }
          : controller,
      ),
    },
    { aoiId, aoiName: owner.aoi.name, controllerId: owner.controller.id },
  );
}
