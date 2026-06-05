/**
 * Reconstruct an executable ESCO project from a compiled `.easruntime` payload.
 *
 * A `.easruntime` stores routine logic in flattened, execution-oriented form:
 * ladder rungs as neutral Logix rung text, Structured Text as source lines. To
 * actually *run* it, the SoftController rebuilds a {@link PlcProject} whose ladder
 * routines carry a real AST again — parsed back from the neutral rung text with
 * {@link parseRungText}, the inverse of the serializer that produced it. The
 * reconstructed project then drives the existing, fully-tested scan engine
 * (`scanProject` from `@esco/project-actions`), which handles task ordering,
 * ladder + Structured Text execution, program scoping, JSR/AOI calls, and the
 * timer model.
 *
 * This is ESCO-native end to end: the only "parser" reused is the neutral
 * rung-text parser, not any `.ACD`/`.L5X` file path.
 *
 * The `.easruntime` also carries ESCO-native UDT and AOI definition metadata.
 * Those definitions are restored before tags are attached so UDT/AOI member
 * paths and unprotected AOI ladder bodies execute the same way they do in the
 * source project. Protected/bodyless AOIs remain model-only, never faked.
 */

import {
  type AddOnInstruction,
  type AoiLocalTag,
  type AoiParameter,
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type ExternalAccess,
  type PlcProject,
  type Program,
  type Routine,
  type Task,
  type UdtMember,
  type UserDefinedType,
} from "@esco/core";
import { createDefaultRegistry, type InstructionRegistry } from "@esco/instructions";
import type { LadderRoutine, LadderRung } from "@esco/ladder";
import { parseRungText } from "@esco/parser-l5x";
import {
  controllerTaskStatusReport,
  defaultValues,
  type EscoRuntime,
  type RuntimeAddOnInstruction,
  type RuntimeAoiLocalTag,
  type RuntimeAoiParameter,
  type RuntimeDataType,
  type RuntimeRoutine,
  type RuntimeTag,
  type RuntimeUdtMember,
  type TagValues,
} from "@esco/project-actions";
import { createId } from "@esco/shared";
import type { LoadedRuntimeInfo, SoftControllerTagInfo } from "./types";

/** Rebuild a ladder routine's AST from its flattened neutral rung text. */
function buildLadderRoutine(
  runtimeRoutine: RuntimeRoutine,
  registry: InstructionRegistry,
  knownInstructionTypes: Set<string>,
): LadderRoutine {
  const payload = runtimeRoutine.payload;
  const sourceRungs = payload.kind === "ladder" ? payload.rungs : [];
  const rungs: LadderRung[] = sourceRungs.map((rung) => ({
    id: createId("rung"),
    routineId: runtimeRoutine.id,
    number: rung.number,
    ...(rung.comment ? { comment: rung.comment } : {}),
    root: parseRungText(rung.text, registry, knownInstructionTypes).root,
    sourceText: rung.text,
  }));
  return { id: createId("ladder"), rungs };
}

/** Restore one routine into executable form (ladder AST / ST source / preserved note). */
function restoreRoutine(
  programId: string,
  runtimeRoutine: RuntimeRoutine,
  registry: InstructionRegistry,
  knownInstructionTypes: Set<string>,
): Routine {
  const routine = createRoutine(programId, runtimeRoutine.name, runtimeRoutine.language);
  routine.id = runtimeRoutine.id;
  const payload = runtimeRoutine.payload;
  if (payload.kind === "ladder") {
    routine.ladder = buildLadderRoutine(runtimeRoutine, registry, knownInstructionTypes);
  } else if (payload.kind === "structured-text") {
    routine.structuredText = payload.lines.join("\n");
  } else if (payload.kind === "graphical") {
    // Graphical (FBD/SFC) routines are not executed offline; preserve the note.
    routine.sourceText = payload.note;
  }
  return routine;
}

function restoreUdtMember(runtimeMember: RuntimeUdtMember): UdtMember {
  return {
    name: runtimeMember.name,
    dataType: runtimeMember.dataType,
    ...(runtimeMember.dimension && runtimeMember.dimension > 0 ? { dimension: runtimeMember.dimension } : {}),
    ...(runtimeMember.dimensions?.length ? { dimensions: runtimeMember.dimensions } : {}),
    ...(runtimeMember.description ? { description: runtimeMember.description } : {}),
    ...(runtimeMember.radix ? { radix: runtimeMember.radix } : {}),
    ...(runtimeMember.externalAccess ? { externalAccess: runtimeMember.externalAccess as ExternalAccess } : {}),
    ...(runtimeMember.hidden != null ? { hidden: runtimeMember.hidden } : {}),
    ...(runtimeMember.target ? { target: runtimeMember.target } : {}),
    ...(runtimeMember.bitNumber != null ? { bitNumber: runtimeMember.bitNumber } : {}),
  };
}

function restoreDataType(runtimeDataType: RuntimeDataType): UserDefinedType {
  return {
    id: runtimeDataType.id,
    name: runtimeDataType.name,
    ...(runtimeDataType.description ? { description: runtimeDataType.description } : {}),
    ...(runtimeDataType.family ? { family: runtimeDataType.family } : {}),
    ...(runtimeDataType.safetyClass ? { safetyClass: runtimeDataType.safetyClass } : {}),
    members: runtimeDataType.members.map(restoreUdtMember),
  };
}

function restoreAoiParameter(runtimeParameter: RuntimeAoiParameter): AoiParameter {
  return {
    name: runtimeParameter.name,
    dataType: runtimeParameter.dataType,
    ...(runtimeParameter.usage ? { usage: runtimeParameter.usage } : {}),
    ...(runtimeParameter.required != null ? { required: runtimeParameter.required } : {}),
    ...(runtimeParameter.dimension && runtimeParameter.dimension > 0 ? { dimension: runtimeParameter.dimension } : {}),
    ...(runtimeParameter.dimensions?.length ? { dimensions: runtimeParameter.dimensions } : {}),
    ...(runtimeParameter.visible != null ? { visible: runtimeParameter.visible } : {}),
    ...(runtimeParameter.defaultValue != null ? { defaultValue: runtimeParameter.defaultValue } : {}),
    ...(runtimeParameter.description ? { description: runtimeParameter.description } : {}),
    ...(runtimeParameter.radix ? { radix: runtimeParameter.radix } : {}),
    ...(runtimeParameter.externalAccess ? { externalAccess: runtimeParameter.externalAccess as ExternalAccess } : {}),
    ...(runtimeParameter.constant != null ? { constant: runtimeParameter.constant } : {}),
  };
}

function restoreAoiLocalTag(runtimeLocalTag: RuntimeAoiLocalTag): AoiLocalTag {
  return {
    name: runtimeLocalTag.name,
    dataType: runtimeLocalTag.dataType,
    ...(runtimeLocalTag.dimension && runtimeLocalTag.dimension > 0 ? { dimension: runtimeLocalTag.dimension } : {}),
    ...(runtimeLocalTag.dimensions?.length ? { dimensions: runtimeLocalTag.dimensions } : {}),
    ...(runtimeLocalTag.description ? { description: runtimeLocalTag.description } : {}),
    ...(runtimeLocalTag.radix ? { radix: runtimeLocalTag.radix } : {}),
    ...(runtimeLocalTag.externalAccess ? { externalAccess: runtimeLocalTag.externalAccess as ExternalAccess } : {}),
  };
}

function restoreAddOnInstruction(
  runtimeAoi: RuntimeAddOnInstruction,
  registry: InstructionRegistry,
  knownInstructionTypes: Set<string>,
): AddOnInstruction {
  return {
    id: runtimeAoi.id,
    name: runtimeAoi.name,
    ...(runtimeAoi.description ? { description: runtimeAoi.description } : {}),
    ...(runtimeAoi.revision ? { revision: runtimeAoi.revision } : {}),
    ...(runtimeAoi.revisionExtension ? { revisionExtension: runtimeAoi.revisionExtension } : {}),
    ...(runtimeAoi.softwareRevision ? { softwareRevision: runtimeAoi.softwareRevision } : {}),
    ...(runtimeAoi.vendor ? { vendor: runtimeAoi.vendor } : {}),
    ...(runtimeAoi.signature ? { signature: runtimeAoi.signature } : {}),
    ...(runtimeAoi.createdDate ? { createdDate: runtimeAoi.createdDate } : {}),
    ...(runtimeAoi.createdBy ? { createdBy: runtimeAoi.createdBy } : {}),
    ...(runtimeAoi.editedDate ? { editedDate: runtimeAoi.editedDate } : {}),
    ...(runtimeAoi.editedBy ? { editedBy: runtimeAoi.editedBy } : {}),
    ...(runtimeAoi.revisionNote ? { revisionNote: runtimeAoi.revisionNote } : {}),
    ...(runtimeAoi.additionalHelpText ? { additionalHelpText: runtimeAoi.additionalHelpText } : {}),
    ...(runtimeAoi.protected != null ? { protected: runtimeAoi.protected } : {}),
    ...(runtimeAoi.protectionType ? { protectionType: runtimeAoi.protectionType } : {}),
    ...(runtimeAoi.safetyClass ? { safetyClass: runtimeAoi.safetyClass } : {}),
    ...(runtimeAoi.executePrescan != null ? { executePrescan: runtimeAoi.executePrescan } : {}),
    ...(runtimeAoi.executePostscan != null ? { executePostscan: runtimeAoi.executePostscan } : {}),
    ...(runtimeAoi.executeEnableInFalse != null ? { executeEnableInFalse: runtimeAoi.executeEnableInFalse } : {}),
    parameters: runtimeAoi.parameters.map(restoreAoiParameter),
    localTags: runtimeAoi.localTags.map(restoreAoiLocalTag),
    routineNames: [...runtimeAoi.routineNames],
    ...(runtimeAoi.routines?.length
      ? { routines: runtimeAoi.routines.map((routine) => restoreRoutine(runtimeAoi.id, routine, registry, knownInstructionTypes)) }
      : {}),
  };
}

function makeTag(controllerId: string, runtimeTag: RuntimeTag, programId?: string) {
  return createTag(controllerId, runtimeTag.name, runtimeTag.dataType, {
    scope: runtimeTag.scope,
    ...(programId ? { programId } : {}),
    ...(runtimeTag.description ? { description: runtimeTag.description } : {}),
    ...(runtimeTag.initialValue !== undefined ? { value: runtimeTag.initialValue } : {}),
    ...(runtimeTag.dimensions?.length ? { dimensions: runtimeTag.dimensions } : {}),
    ...(runtimeTag.externalAccess ? { externalAccess: runtimeTag.externalAccess as ExternalAccess } : {}),
    ...(runtimeTag.constant ? { constant: true } : {}),
  });
}

function findProgram(
  project: PlcProject,
  name: string | undefined,
): { controller: PlcProject["controllers"][number]; program: Program } | undefined {
  if (!name) return undefined;
  for (const controller of project.controllers) {
    const program = controller.programs.find((candidate) => candidate.name === name);
    if (program) return { controller, program };
  }
  return undefined;
}

/**
 * Reconstruct a runnable {@link PlcProject} from a runtime payload. Ladder bodies
 * are rebuilt as executable AST; Structured Text is restored as source; tasks,
 * programs, and tags are rebuilt with their scheduling/scope so the scan engine
 * produces the same offline scan set the project compiled from.
 */
export function runtimeToExecutableProject(
  runtime: EscoRuntime,
  registry: InstructionRegistry = createDefaultRegistry(),
): PlcProject {
  const project = createProject(runtime.identity.projectName, runtime.identity.description);
  project.id = runtime.identity.projectId;

  for (const runtimeController of runtime.controllers) {
    const controller = createController(project.id, runtimeController.name);
    controller.id = runtimeController.id;
    if (runtimeController.processorType) controller.processorType = runtimeController.processorType;
    if (runtimeController.catalogNumber) controller.catalogNumber = runtimeController.catalogNumber;
    if (runtimeController.firmwareRevision) controller.firmwareRevision = runtimeController.firmwareRevision;
    const knownInstructionTypes = new Set(
      (runtimeController.addOnInstructions ?? []).map((aoi) => aoi.name.toUpperCase()),
    );
    controller.dataTypes = (runtimeController.dataTypes ?? []).map(restoreDataType);
    controller.addOnInstructions = (runtimeController.addOnInstructions ?? []).map((aoi) =>
      restoreAddOnInstruction(aoi, registry, knownInstructionTypes),
    );

    for (const runtimeTask of runtimeController.tasks) {
      for (const runtimeProgram of runtimeTask.programs) {
        if (controller.programs.some((existing) => existing.id === runtimeProgram.id)) continue;
        const program = createProgram(controller.id, runtimeProgram.name);
        program.id = runtimeProgram.id;
        if (runtimeProgram.mainRoutineId) program.mainRoutineId = runtimeProgram.mainRoutineId;
        if (runtimeProgram.faultRoutineId) program.faultRoutineId = runtimeProgram.faultRoutineId;
        if (runtimeProgram.inhibited) program.inhibited = true;
        for (const runtimeRoutine of runtimeProgram.routines) {
          program.routines.push(restoreRoutine(program.id, runtimeRoutine, registry, knownInstructionTypes));
        }
        controller.programs.push(program);
      }

      const task = createContinuousTask(
        controller.id,
        runtimeTask.name,
        runtimeTask.programs.map((program) => program.id),
      );
      task.id = runtimeTask.id;
      task.type = runtimeTask.type as Task["type"];
      if (runtimeTask.periodMs != null) task.periodMs = runtimeTask.periodMs;
      if (runtimeTask.priority != null) task.priority = runtimeTask.priority;
      if (runtimeTask.watchdogMs != null) task.watchdogMs = runtimeTask.watchdogMs;
      if (runtimeTask.inhibited) task.inhibited = true;
      controller.tasks.push(task);
    }

    project.controllers.push(controller);
  }

  // Tag pass (single, across all controllers). Program tags attach to the program
  // that owns them by name; controller tags attach to the first controller (a
  // runtime tag list is flat and carries no controller id — single-controller is
  // the norm for a runtime target).
  const firstController = project.controllers[0];
  for (const runtimeTag of runtime.tags) {
    if (runtimeTag.scope === "program") {
      const owner = findProgram(project, runtimeTag.programName);
      if (!owner) continue;
      owner.program.programTags.push(makeTag(owner.controller.id, runtimeTag, owner.program.id));
    } else if (firstController) {
      firstController.controllerTags.push(makeTag(firstController.id, runtimeTag));
    }
  }

  return project;
}

/**
 * Power-up tag image for a freshly loaded runtime: every tracked value path at
 * its zero, with compiled scalar power-up values applied on top. Keys match
 * exactly what the scan engine reads/writes, including program-scoped paths.
 */
export function powerUpImage(project: PlcProject, runtime: EscoRuntime): TagValues {
  const image = defaultValues(project);
  for (const [path, value] of Object.entries(runtime.initialValues ?? {})) {
    const canonical = resolveValuePath(path);
    if (canonical in image) image[canonical] = value;
  }
  for (const tag of runtime.tags) {
    const path = tag.path
      ? resolveValuePath(tag.path)
      : tag.scope === "program" && tag.programName
        ? programTagPath(tag.programName, tag.name)
        : controllerTagPath(tag.name);
    if (tag.initialValue !== undefined && path in image) image[path] = tag.initialValue;
  }
  return image;
}

/** Build the loaded-runtime summary surfaced in status / image. */
export function summarizeLoadedRuntime(
  runtime: EscoRuntime,
  project: PlcProject,
  checksum: string,
  loadedAt: string,
): LoadedRuntimeInfo {
  return {
    projectId: runtime.identity.projectId,
    projectName: runtime.identity.projectName,
    ...(runtime.identity.description ? { description: runtime.identity.description } : {}),
    runtimeVersion: runtime.runtimeVersion,
    appVersion: runtime.provenance.appVersion,
    builtAt: runtime.provenance.builtAt,
    checksum,
    controllerCount: runtime.build.controllerCount,
    programCount: runtime.build.programCount,
    routineCount: runtime.build.routineCount,
    tagCount: runtime.tags.length,
    scheduledRoutineCount: controllerTaskStatusReport(project).scheduledRoutineIds.length,
    loadedAt,
  };
}

/** Canonical value path for a controller-scoped tag (its bare name). */
export function controllerTagPath(name: string): string {
  return name.trim();
}

/** Canonical value path for a program-scoped tag, e.g. `Program:Main.Acc`. */
export function programTagPath(programName: string, local: string): string {
  return `Program:${programName}.${local}`;
}

/**
 * Resolve a user-supplied tag path to the canonical value-path key used by the
 * tag image. Accepts a bare controller tag name, the runtime `Program::Tag`
 * double-colon form, or an already-canonical `Program:Name.Tag` path.
 */
export function resolveValuePath(path: string): string {
  const trimmed = path.trim();
  const programScoped = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)::(.+)$/);
  if (programScoped) return programTagPath(programScoped[1]!, programScoped[2]!);
  return trimmed;
}

/** Tag metadata for every addressable path in the runtime, with canonical paths. */
export function runtimeTagInfos(runtime: EscoRuntime): SoftControllerTagInfo[] {
  return runtime.tags.map((tag) => ({
    path:
      tag.scope === "program" && tag.programName
        ? programTagPath(tag.programName, tag.name)
        : controllerTagPath(tag.name),
    name: tag.name,
    scope: tag.scope,
    ...(tag.programName ? { programName: tag.programName } : {}),
    dataType: tag.dataType,
    ...(tag.dimensions?.length ? { dimensions: tag.dimensions } : {}),
  }));
}
