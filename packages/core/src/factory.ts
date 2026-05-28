import { createId, nowIso } from "@esco/shared";
import type {
  Controller,
  IOConfiguration,
  PlcProject,
  Program,
  Routine,
  Tag,
  Task,
} from "./types";

export function createProject(name: string, description?: string): PlcProject {
  const ts = nowIso();
  return {
    id: createId("proj"),
    name,
    description,
    controllers: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createController(projectId: string, name: string): Controller {
  return {
    id: createId("ctrl"),
    projectId,
    name,
    tasks: [],
    programs: [],
    controllerTags: [],
    dataTypes: [],
    addOnInstructions: [],
    ioConfiguration: emptyIoConfiguration(),
  };
}

export function emptyIoConfiguration(): IOConfiguration {
  return { modules: [] };
}

export function createContinuousTask(
  controllerId: string,
  name: string,
  scheduledProgramIds: string[] = [],
): Task {
  return {
    id: createId("task"),
    controllerId,
    name,
    type: "continuous",
    scheduledProgramIds,
  };
}

export function createProgram(controllerId: string, name: string): Program {
  return {
    id: createId("prog"),
    controllerId,
    name,
    routines: [],
    programTags: [],
  };
}

export function createRoutine(
  programId: string,
  name: string,
  language: Routine["language"] = "ladder",
): Routine {
  return {
    id: createId("rtn"),
    programId,
    name,
    language,
  };
}

export function createTag(
  controllerId: string,
  name: string,
  dataType: string,
  options: Partial<Pick<Tag, "scope" | "programId" | "description" | "value">> = {},
): Tag {
  return {
    id: createId("tag"),
    controllerId,
    name,
    dataType,
    scope: options.scope ?? "controller",
    programId: options.programId,
    description: options.description,
    value: options.value,
  };
}
