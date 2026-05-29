import type { PlcProject } from "@esco/core";
import { nowIso } from "@esco/shared";
import { fail, ok } from "./helpers";
import type {
  ProjectActionResult,
  SetControllerPropertiesInput,
  SetProgramPropertiesInput,
  SetProjectPropertiesInput,
  SetTaskPropertiesInput,
} from "./types";

function optionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

export function setProjectProperties(
  project: PlcProject,
  input: SetProjectPropertiesInput,
): ProjectActionResult<{ name: string }> {
  const name = input.name?.trim();
  if (!name) return fail(project, "Project name is required.");

  return ok({ ...project, name, description: input.description, updatedAt: nowIso() }, { name });
}

export function setControllerProperties(
  project: PlcProject,
  input: SetControllerPropertiesInput,
): ProjectActionResult<{ controllerId: string }> {
  const controllerId = input.controllerId?.trim();
  const name = input.name?.trim();
  if (!controllerId) return fail(project, "Controller id is required.");
  if (!name) return fail(project, "Controller name is required.");
  if (!project.controllers.some((controller) => controller.id === controllerId)) {
    return fail(project, `Controller "${controllerId}" not found.`);
  }

  const next: PlcProject = {
    ...project,
    controllers: project.controllers.map((controller) => {
      if (controller.id !== controllerId) return controller;
      return {
        ...controller,
        name,
        ...(hasOwn(input, "processorType")
          ? { processorType: optionalText(input.processorType) }
          : {}),
        ...(hasOwn(input, "catalogNumber")
          ? { catalogNumber: optionalText(input.catalogNumber) }
          : {}),
        ...(hasOwn(input, "firmwareRevision")
          ? { firmwareRevision: optionalText(input.firmwareRevision) }
          : {}),
        ...(hasOwn(input, "chassis") ? { chassis: optionalText(input.chassis) } : {}),
        ...(hasOwn(input, "slot") ? { slot: input.slot } : {}),
        ...(hasOwn(input, "faultRoutineName")
          ? { faultRoutineName: optionalText(input.faultRoutineName) }
          : {}),
        ...(hasOwn(input, "powerUpRoutineName")
          ? { powerUpRoutineName: optionalText(input.powerUpRoutineName) }
          : {}),
      };
    }),
  };

  return ok(next, { controllerId });
}

export function setTaskProperties(
  project: PlcProject,
  input: SetTaskPropertiesInput,
): ProjectActionResult<{ taskId: string }> {
  const taskId = input.taskId?.trim();
  const name = input.name?.trim();
  if (!taskId) return fail(project, "Task id is required.");
  if (!name) return fail(project, "Task name is required.");

  const owner = project.controllers.find((controller) =>
    controller.tasks.some((task) => task.id === taskId),
  );
  if (!owner) return fail(project, `Task "${taskId}" not found.`);

  let scheduledProgramIds = input.scheduledProgramIds;
  if (scheduledProgramIds) {
    scheduledProgramIds = scheduledProgramIds.map((id) => id.trim());
    const blank = scheduledProgramIds.some((id) => !id);
    if (blank) return fail(project, "Scheduled program id is required.");

    const programIds = new Set(owner.programs.map((program) => program.id));
    const missingProgramId = scheduledProgramIds.find((programId) => !programIds.has(programId));
    if (missingProgramId) {
      return fail(project, `Program "${missingProgramId}" not found for task "${taskId}".`);
    }
  }

  const next: PlcProject = {
    ...project,
    controllers: project.controllers.map((controller) => {
      if (controller.id !== owner.id) return controller;
      return {
        ...controller,
        tasks: controller.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                name,
                type: input.type,
                ...(hasOwn(input, "periodMs") ? { periodMs: input.periodMs } : {}),
                ...(hasOwn(input, "priority") ? { priority: input.priority } : {}),
                ...(hasOwn(input, "watchdogMs") ? { watchdogMs: input.watchdogMs } : {}),
                ...(hasOwn(input, "inhibited") ? { inhibited: input.inhibited } : {}),
                ...(scheduledProgramIds ? { scheduledProgramIds } : {}),
              }
            : task,
        ),
      };
    }),
  };

  return ok(next, { taskId });
}

export function setProgramProperties(
  project: PlcProject,
  input: SetProgramPropertiesInput,
): ProjectActionResult<{ programId: string }> {
  const programId = input.programId?.trim();
  const name = input.name?.trim();
  if (!programId) return fail(project, "Program id is required.");
  if (!name) return fail(project, "Program name is required.");

  const owner = project.controllers.find((controller) =>
    controller.programs.some((program) => program.id === programId),
  );
  const program = owner?.programs.find((candidate) => candidate.id === programId);
  if (!owner || !program) return fail(project, `Program "${programId}" not found.`);

  const routineIds = new Set(program.routines.map((routine) => routine.id));
  const mainRoutineId = hasOwn(input, "mainRoutineId")
    ? optionalText(input.mainRoutineId)
    : undefined;
  const faultRoutineId = hasOwn(input, "faultRoutineId")
    ? optionalText(input.faultRoutineId)
    : undefined;

  if (mainRoutineId && !routineIds.has(mainRoutineId)) {
    return fail(project, `Routine "${mainRoutineId}" not found in program "${programId}".`);
  }
  if (faultRoutineId && !routineIds.has(faultRoutineId)) {
    return fail(project, `Routine "${faultRoutineId}" not found in program "${programId}".`);
  }

  const next: PlcProject = {
    ...project,
    controllers: project.controllers.map((controller) => {
      if (controller.id !== owner.id) return controller;
      return {
        ...controller,
        programs: controller.programs.map((candidate) =>
          candidate.id === programId
            ? {
                ...candidate,
                name,
                ...(hasOwn(input, "description") ? { description: input.description } : {}),
                ...(hasOwn(input, "mainRoutineId") ? { mainRoutineId } : {}),
                ...(hasOwn(input, "faultRoutineId") ? { faultRoutineId } : {}),
                ...(hasOwn(input, "inhibited") ? { inhibited: input.inhibited } : {}),
              }
            : candidate,
        ),
      };
    }),
  };

  return ok(next, { programId });
}
