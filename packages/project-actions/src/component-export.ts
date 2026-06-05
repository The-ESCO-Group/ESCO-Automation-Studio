import type {
  AddOnInstruction,
  Controller,
  IoModule,
  PlcProject,
  Program,
  Routine,
  Tag,
  Task,
  UserDefinedType,
} from "@esco/core";
import { fail, ok } from "./helpers";
import type { ProjectActionResult } from "./types";

export type ComponentExportKind =
  | "controller"
  | "routine"
  | "task"
  | "program"
  | "tag"
  | "data-type"
  | "custom-instruction"
  | "device-definition"
  | "device-tree";

export interface ComponentExportDependencies {
  tags: string[];
  dataTypes: string[];
  routines: string[];
  devices: string[];
}

export interface ComponentExportEnvelope<TPayload> {
  format: "esco.component.export.v1";
  kind: ComponentExportKind;
  name: string;
  exportedAt: string;
  project: {
    id: string;
    name: string;
  };
  controller?: {
    id: string;
    name: string;
  };
  owner?: {
    id: string;
    name: string;
    type: "program" | "controller";
  };
  dependencies: ComponentExportDependencies;
  payload: TPayload;
}

export interface ComponentExportData<TPayload = unknown> {
  fileName: string;
  mediaType: "application/vnd.esco.component+json";
  text: string;
  envelope: ComponentExportEnvelope<TPayload>;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeFilePart(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "component";
}

function sorted(values: Iterable<string | undefined>): string[] {
  return Array.from(new Set(Array.from(values).map((value) => value?.trim()).filter((value): value is string => !!value))).sort(
    (a, b) => a.localeCompare(b),
  );
}

function componentText<TPayload>(envelope: ComponentExportEnvelope<TPayload>): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function buildEnvelope<TPayload>(
  project: PlcProject,
  kind: ComponentExportKind,
  name: string,
  payload: TPayload,
  dependencies: ComponentExportDependencies,
  context: Pick<ComponentExportEnvelope<TPayload>, "controller" | "owner"> = {},
): ComponentExportEnvelope<TPayload> {
  return {
    format: "esco.component.export.v1",
    kind,
    name,
    exportedAt: project.updatedAt,
    project: { id: project.id, name: project.name },
    ...context,
    dependencies,
    payload: cloneJson(payload),
  };
}

function componentResult<TPayload>(
  project: PlcProject,
  envelope: ComponentExportEnvelope<TPayload>,
  extension: string,
): ProjectActionResult<ComponentExportData<TPayload>> {
  return ok(project, {
    fileName: `${safeFilePart(envelope.name)}.${extension}.json`,
    mediaType: "application/vnd.esco.component+json",
    text: componentText(envelope),
    envelope,
  });
}

function identifierTokens(value: unknown): Set<string> {
  return new Set(JSON.stringify(value).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
}

function allTags(project: PlcProject): Tag[] {
  return project.controllers.flatMap((controller) => [
    ...controller.controllerTags,
    ...controller.programs.flatMap((program) => program.programTags),
  ]);
}

function controllerTags(controller: Controller): Tag[] {
  return [
    ...controller.controllerTags,
    ...controller.programs.flatMap((program) => program.programTags),
  ];
}

function tagDependencies(project: PlcProject, payload: unknown): string[] {
  const tokens = identifierTokens(payload);
  return sorted(allTags(project).filter((tag) => tokens.has(tag.name)).map((tag) => tag.name));
}

function tagDataTypeDependencies(project: PlcProject, tagNames: string[]): string[] {
  const wanted = new Set(tagNames);
  return sorted(allTags(project).filter((tag) => wanted.has(tag.name)).map((tag) => tag.dataType));
}

function programDataTypeDependencies(program: Program): string[] {
  return sorted(program.programTags.map((tag) => tag.dataType));
}

function findRoutineContext(
  project: PlcProject,
  routineId: string,
): { controller: Controller; program: Program; routine: Routine } | undefined {
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      const routine = program.routines.find((candidate) => candidate.id === routineId);
      if (routine) return { controller, program, routine };
    }
  }
  return undefined;
}

function findProgramContext(
  project: PlcProject,
  programId: string,
): { controller: Controller; program: Program } | undefined {
  for (const controller of project.controllers) {
    const program = controller.programs.find((candidate) => candidate.id === programId);
    if (program) return { controller, program };
  }
  return undefined;
}

function findControllerContext(project: PlcProject, controllerId: string): Controller | undefined {
  return project.controllers.find((candidate) => candidate.id === controllerId);
}

function findTagContext(
  project: PlcProject,
  tagId: string,
): { controller: Controller; program?: Program; tag: Tag } | undefined {
  for (const controller of project.controllers) {
    const controllerTag = controller.controllerTags.find((candidate) => candidate.id === tagId);
    if (controllerTag) return { controller, tag: controllerTag };
    for (const program of controller.programs) {
      const programTag = program.programTags.find((candidate) => candidate.id === tagId);
      if (programTag) return { controller, program, tag: programTag };
    }
  }
  return undefined;
}

function findTaskContext(
  project: PlcProject,
  taskId: string,
): { controller: Controller; task: Task; scheduledPrograms: Program[] } | undefined {
  for (const controller of project.controllers) {
    const task = controller.tasks.find((candidate) => candidate.id === taskId);
    if (task) {
      const scheduled = task.scheduledProgramIds
        .map((programId) => controller.programs.find((program) => program.id === programId))
        .filter((program): program is Program => Boolean(program));
      return { controller, task, scheduledPrograms: scheduled };
    }
  }
  return undefined;
}

function findDataTypeContext(
  project: PlcProject,
  dataTypeId: string,
): { controller: Controller; dataType: UserDefinedType } | undefined {
  for (const controller of project.controllers) {
    const dataType = controller.dataTypes.find((candidate) => candidate.id === dataTypeId);
    if (dataType) return { controller, dataType };
  }
  return undefined;
}

function findCustomInstructionContext(
  project: PlcProject,
  instructionId: string,
): { controller: Controller; instruction: AddOnInstruction } | undefined {
  for (const controller of project.controllers) {
    const instruction = controller.addOnInstructions.find((candidate) => candidate.id === instructionId);
    if (instruction) return { controller, instruction };
  }
  return undefined;
}

function findModuleContext(
  project: PlcProject,
  controllerId: string,
  moduleId: string,
): { controller: Controller; module: IoModule } | undefined {
  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  const module = controller?.ioConfiguration.modules.find((candidate) => candidate.id === moduleId);
  return controller && module ? { controller, module } : undefined;
}

export function exportControllerComponent(
  project: PlcProject,
  controllerId: string,
): ProjectActionResult<ComponentExportData<Controller>> {
  const controller = findControllerContext(project, controllerId);
  if (!controller) return fail(project, `Controller "${controllerId}" was not found for export.`);
  const envelope = buildEnvelope(project, "controller", controller.name, controller, {
    tags: sorted(controllerTags(controller).map((tag) => tag.name)),
    dataTypes: sorted([
      ...controller.dataTypes.map((dataType) => dataType.name),
      ...controllerTags(controller).map((tag) => tag.dataType),
      ...controller.addOnInstructions.flatMap((instruction) => [
        ...instruction.parameters.map((parameter) => parameter.dataType),
        ...instruction.localTags.map((tag) => tag.dataType),
      ]),
    ]),
    routines: sorted([
      ...controller.programs.flatMap((program) => program.routines.map((routine) => routine.name)),
      ...controller.addOnInstructions.flatMap((instruction) => [
        ...instruction.routineNames,
        ...(instruction.routines?.map((routine) => routine.name) ?? []),
      ]),
    ]),
    devices: sorted(controller.ioConfiguration.modules.map((module) => module.name || module.catalogNumber)),
  }, {
    controller: { id: controller.id, name: controller.name },
    owner: { id: controller.id, name: controller.name, type: "controller" },
  });
  return componentResult(project, envelope, "esco-controller");
}

export function exportTagComponent(
  project: PlcProject,
  tagId: string,
): ProjectActionResult<ComponentExportData<Tag>> {
  const context = findTagContext(project, tagId);
  if (!context) return fail(project, `Tag "${tagId}" was not found for export.`);
  const referencedTags = sorted([
    context.tag.name,
    context.tag.aliasFor,
    context.tag.consumeInfo?.remoteTag,
  ]);
  const envelope = buildEnvelope(project, "tag", context.tag.name, context.tag, {
    tags: referencedTags,
    dataTypes: sorted([context.tag.dataType]),
    routines: [],
    devices: sorted([context.tag.consumeInfo?.producer]),
  }, {
    controller: { id: context.controller.id, name: context.controller.name },
    owner: context.program
      ? { id: context.program.id, name: context.program.name, type: "program" }
      : { id: context.controller.id, name: context.controller.name, type: "controller" },
  });
  return componentResult(project, envelope, "esco-tag");
}

export function exportRoutineComponent(
  project: PlcProject,
  routineId: string,
): ProjectActionResult<ComponentExportData<Routine>> {
  const context = findRoutineContext(project, routineId);
  if (!context) return fail(project, `Routine "${routineId}" was not found for export.`);
  const tags = tagDependencies(project, context.routine);
  const envelope = buildEnvelope(project, "routine", context.routine.name, context.routine, {
    tags,
    dataTypes: tagDataTypeDependencies(project, tags),
    routines: [context.routine.name],
    devices: [],
  }, {
    controller: { id: context.controller.id, name: context.controller.name },
    owner: { id: context.program.id, name: context.program.name, type: "program" },
  });
  return componentResult(project, envelope, "esco-routine");
}

export function exportTaskComponent(
  project: PlcProject,
  taskId: string,
): ProjectActionResult<ComponentExportData<Task>> {
  const context = findTaskContext(project, taskId);
  if (!context) return fail(project, `Task "${taskId}" was not found for export.`);
  const envelope = buildEnvelope(project, "task", context.task.name, context.task, {
    tags: sorted(context.scheduledPrograms.flatMap((program) => program.programTags.map((tag) => tag.name))),
    dataTypes: sorted(context.scheduledPrograms.flatMap(programDataTypeDependencies)),
    routines: sorted(context.scheduledPrograms.flatMap((program) => program.routines.map((routine) => routine.name))),
    devices: [],
  }, {
    controller: { id: context.controller.id, name: context.controller.name },
    owner: { id: context.controller.id, name: context.controller.name, type: "controller" },
  });
  return componentResult(project, envelope, "esco-task");
}

export function exportProgramComponent(
  project: PlcProject,
  programId: string,
): ProjectActionResult<ComponentExportData<Program>> {
  const context = findProgramContext(project, programId);
  if (!context) return fail(project, `Program "${programId}" was not found for export.`);
  const referencedTags = tagDependencies(project, context.program);
  const localTags = context.program.programTags.map((tag) => tag.name);
  const tags = sorted([...referencedTags, ...localTags]);
  const envelope = buildEnvelope(project, "program", context.program.name, context.program, {
    tags,
    dataTypes: sorted([...tagDataTypeDependencies(project, tags), ...programDataTypeDependencies(context.program)]),
    routines: sorted(context.program.routines.map((routine) => routine.name)),
    devices: [],
  }, {
    controller: { id: context.controller.id, name: context.controller.name },
    owner: { id: context.controller.id, name: context.controller.name, type: "controller" },
  });
  return componentResult(project, envelope, "esco-program");
}

export function exportDataTypeComponent(
  project: PlcProject,
  dataTypeId: string,
): ProjectActionResult<ComponentExportData<UserDefinedType>> {
  const context = findDataTypeContext(project, dataTypeId);
  if (!context) return fail(project, `Data Type "${dataTypeId}" was not found for export.`);
  const envelope = buildEnvelope(project, "data-type", context.dataType.name, context.dataType, {
    tags: [],
    dataTypes: sorted(context.dataType.members.map((member) => member.dataType)),
    routines: [],
    devices: [],
  }, {
    controller: { id: context.controller.id, name: context.controller.name },
    owner: { id: context.controller.id, name: context.controller.name, type: "controller" },
  });
  return componentResult(project, envelope, "esco-data-type");
}

export function exportCustomInstructionComponent(
  project: PlcProject,
  instructionId: string,
): ProjectActionResult<ComponentExportData<AddOnInstruction>> {
  const context = findCustomInstructionContext(project, instructionId);
  if (!context) return fail(project, `Custom Instruction "${instructionId}" was not found for export.`);
  const envelope = buildEnvelope(project, "custom-instruction", context.instruction.name, context.instruction, {
    tags: sorted(context.instruction.localTags.map((tag) => tag.name)),
    dataTypes: sorted([
      ...context.instruction.parameters.map((parameter) => parameter.dataType),
      ...context.instruction.localTags.map((tag) => tag.dataType),
    ]),
    routines: sorted([
      ...context.instruction.routineNames,
      ...(context.instruction.routines?.map((routine) => routine.name) ?? []),
    ]),
    devices: [],
  }, {
    controller: { id: context.controller.id, name: context.controller.name },
    owner: { id: context.controller.id, name: context.controller.name, type: "controller" },
  });
  return componentResult(project, envelope, "esco-custom-instruction");
}

export function exportDeviceDefinitionComponent(
  project: PlcProject,
  controllerId: string,
  moduleId: string,
): ProjectActionResult<ComponentExportData<IoModule>> {
  const context = findModuleContext(project, controllerId, moduleId);
  if (!context) return fail(project, `Device definition "${moduleId}" was not found for export.`);
  const envelope = buildEnvelope(project, "device-definition", context.module.name || context.module.catalogNumber || "Device", context.module, {
    tags: [],
    dataTypes: sorted([context.module.productType]),
    routines: [],
    devices: sorted([context.module.name || context.module.catalogNumber]),
  }, {
    controller: { id: context.controller.id, name: context.controller.name },
    owner: { id: context.controller.id, name: context.controller.name, type: "controller" },
  });
  return componentResult(project, envelope, "esco-device");
}

export function exportDeviceTreeComponent(
  project: PlcProject,
  controllerId: string,
): ProjectActionResult<ComponentExportData<{ modules: IoModule[] }>> {
  const controller = project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) return fail(project, `Controller "${controllerId}" was not found for device-tree export.`);
  const payload = { modules: controller.ioConfiguration.modules };
  const envelope = buildEnvelope(project, "device-tree", `${controller.name} Device Tree`, payload, {
    tags: [],
    dataTypes: sorted(controller.ioConfiguration.modules.map((module) => module.productType)),
    routines: [],
    devices: sorted(controller.ioConfiguration.modules.map((module) => module.name || module.catalogNumber)),
  }, {
    controller: { id: controller.id, name: controller.name },
    owner: { id: controller.id, name: controller.name, type: "controller" },
  });
  return componentResult(project, envelope, "esco-devices");
}
