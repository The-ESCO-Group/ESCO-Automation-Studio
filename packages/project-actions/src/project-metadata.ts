import type { PlcProject } from "@esco/core";
import { nowIso } from "@esco/shared";
import { fail, ok } from "./helpers";
import { logixIdentifierError } from "./logix-names";
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

/**
 * Validate a Studio 5000 communication driver name (e.g. "AB_ETHIP-1").
 * Blank is allowed (clears the value). Offline metadata only.
 */
function commDriverError(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text.length > 64) return "Communication driver name must be 64 characters or fewer.";
  if (!/^[A-Za-z0-9_.-]+$/.test(text)) {
    return 'Communication driver may only contain letters, digits, dot, hyphen, and underscore (e.g. "AB_ETHIP-1").';
  }
  return undefined;
}

/**
 * Validate a Studio 5000 communication path (backslash-separated segments,
 * e.g. "AB_ETHIP-1\\192.168.1.10\\Backplane\\0"). Blank is allowed (clears the
 * value). Offline metadata only — never used to reach a controller.
 */
function commPathError(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text.length > 256) return "Communication path must be 256 characters or fewer.";
  if ([...text].some((ch) => ch.charCodeAt(0) < 0x20)) return "Communication path contains invalid control characters.";
  if (text.startsWith("\\") || text.endsWith("\\")) {
    return "Communication path must not start or end with a backslash.";
  }
  if (text.split("\\").some((segment) => segment.trim() === "")) {
    return "Communication path has a blank segment (remove the extra backslash).";
  }
  return undefined;
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
  const invalidName = logixIdentifierError(name, "Controller");
  if (invalidName) return fail(project, invalidName);
  const driverError = commDriverError(input.commDriver);
  if (driverError) return fail(project, driverError);
  const pathError = commPathError(input.commPath);
  if (pathError) return fail(project, pathError);

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
        ...(hasOwn(input, "commPath") ? { commPath: optionalText(input.commPath) } : {}),
        ...(hasOwn(input, "commDriver") ? { commDriver: optionalText(input.commDriver) } : {}),
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

  const currentTask = owner.tasks.find((task) => task.id === taskId)!;
  const invalidName = logixIdentifierError(name, "Task");
  if (invalidName) return fail(project, invalidName);
  if (
    name !== currentTask.name &&
    owner.tasks.some((task) => task.id !== taskId && task.name === name)
  ) {
    return fail(project, `Task "${name}" already exists in that controller.`);
  }

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
                ...(hasOwn(input, "disableUpdateOutputs") ? { disableUpdateOutputs: input.disableUpdateOutputs } : {}),
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

  const invalidName = logixIdentifierError(name, "Program");
  if (invalidName) return fail(project, invalidName);
  if (
    name !== program.name &&
    owner.programs.some((candidate) => candidate.id !== programId && candidate.name === name)
  ) {
    return fail(project, `Program "${name}" already exists in that controller.`);
  }

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
