/**
 * ESCO Runtime actions — build, export, and import `.easruntime` artifacts.
 *
 * These wrap the runtime compiler ({@link buildRuntime}) and format plumbing in
 * the app's {@link ProjectActionResult} convention. Importing a runtime does NOT
 * pretend to be a fully editable project: it reconstructs an inspectable model
 * skeleton and stamps `provenance.sourceType = "esco-runtime"` so the UI can mark
 * it clearly as compiled, read-only runtime source.
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
  type IoModule,
  type IoPort,
  type ModuleConnection,
  type PlcProject,
  type Routine,
  type UdtMember,
  type UserDefinedType,
} from "@esco/core";
import { createDefaultRegistry } from "@esco/instructions";
import { isHmiProject, withHmiProject } from "@esco/hmi-model";
import { createLadderRoutine, type LadderBranch, type LadderRoutine, type LadderRung } from "@esco/ladder";
import { parseRungText } from "@esco/parser-l5x";
import { createId } from "@esco/shared";
import { fail, ok } from "./helpers";
import { recordImportProvenance } from "./provenance";
import { buildRuntime, type BuildRuntimeOptions } from "./runtime-build";
import {
  EASRT_EXTENSION,
  parseRuntimeFile,
  serializeRuntime,
  type EscoRuntime,
  type RuntimeBuildSummary,
  type RuntimeAddOnInstruction,
  type RuntimeAoiLocalTag,
  type RuntimeAoiParameter,
  type RuntimeDataType,
  type RuntimeIoModule,
  type RuntimeIoPort,
  type RuntimeModuleConnection,
  type RuntimeModuleProfileChannel,
  type RuntimeRoutine,
  type RuntimeUdtMember,
} from "./runtime-format";
import type { ProjectActionResult } from "./types";

const instructionRegistry = createDefaultRegistry();

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface BuildRuntimeData {
  runtime: EscoRuntime;
  summary: RuntimeBuildSummary;
}

/**
 * Compile the project into an ESCO Runtime payload. Fails professionally (with
 * the blocking errors) when validation prevents runtime generation.
 */
export function buildEscoRuntime(
  project: PlcProject,
  options?: BuildRuntimeOptions,
): ProjectActionResult<BuildRuntimeData> {
  const result = buildRuntime(project, options);
  if (!result.ok || !result.runtime || !result.summary) {
    return fail(
      project,
      result.errors[0] ?? "ESCO Runtime build failed.",
    );
  }
  return ok(project, { runtime: result.runtime, summary: result.summary }, result.warnings);
}

export interface ExportRuntimeData {
  fileName: string;
  text: string;
  checksum: string;
  builtAt: string;
  runtimeVersion: string;
  summary: RuntimeBuildSummary;
}

/** Build and serialize a `.easruntime` file for the project. */
export function exportEscoRuntime(
  project: PlcProject,
  options?: BuildRuntimeOptions,
): ProjectActionResult<ExportRuntimeData> {
  const built = buildRuntime(project, options);
  if (!built.ok || !built.runtime || !built.summary) {
    return fail(project, built.errors[0] ?? "ESCO Runtime build failed.");
  }
  const text = serializeRuntime(built.runtime);
  const fileName = `${runtimeFileSlug(project.name)}${EASRT_EXTENSION}`;
  // The checksum is embedded in `text`; surface it for the activity log / UI too.
  const parsed = parseRuntimeFile(text);
  return ok(
    project,
    {
      fileName,
      text,
      checksum: parsed.checksum?.actual ?? "",
      builtAt: built.runtime.provenance.builtAt,
      runtimeVersion: built.runtime.runtimeVersion,
      summary: built.summary,
    },
    built.warnings,
  );
}

export interface ImportRuntimeData {
  runtime: EscoRuntime;
  checksumValid: boolean;
  /** True — this is compiled runtime source, not a fully editable project. */
  runtimeOnly: true;
}

/**
 * Parse and verify a `.easruntime` file and reconstruct an inspectable project
 * skeleton from it. The returned project is marked `provenance: "esco-runtime"`;
 * it is for inspection (tree/structure/tags), not full logic editing.
 */
export function importEscoRuntime(text: string, fileName?: string): ProjectActionResult<ImportRuntimeData> {
  const loaded = parseRuntimeFile(text, fileName);
  if (!loaded.ok || !loaded.runtime) {
    return fail(createProject("Untitled"), loaded.error ?? "Invalid ESCO Runtime file.");
  }

  const reconstructionWarnings: string[] = [];
  const project = runtimeToInspectionProject(loaded.runtime, reconstructionWarnings);
  const stamped = recordImportProvenance(project, {
    sourceType: "esco-runtime",
    ...(fileName ? { fileName } : {}),
    importedAt: loaded.runtime.provenance.builtAt,
  });
  return ok(
    stamped,
    { runtime: loaded.runtime, checksumValid: loaded.checksum?.valid ?? false, runtimeOnly: true },
    [
      "Imported a compiled ESCO Runtime (read-only). Structure and tags are inspectable; " +
        "routine logic is compiled and not fully editable. Open the source .easproj to edit.",
      ...reconstructionWarnings,
    ],
  );
}

/**
 * Reconstruct an inspectable {@link PlcProject} from a runtime payload. Routine
 * bodies are restored from runtime payloads. Normal ladder rung text is parsed
 * back into editable AST; unparseable/lossy rung text is preserved as read-only
 * source and reported through `warnings`.
 */
export function runtimeToInspectionProject(runtime: EscoRuntime, warnings: string[] = []): PlcProject {
  const project = createProject(runtime.identity.projectName, runtime.identity.description);
  project.id = runtime.identity.projectId;

  for (const runtimeController of runtime.controllers) {
    const controller = createController(project.id, runtimeController.name);
    controller.id = runtimeController.id;
    if (runtimeController.processorType) controller.processorType = runtimeController.processorType;
    if (runtimeController.catalogNumber) controller.catalogNumber = runtimeController.catalogNumber;
    if (runtimeController.firmwareRevision) controller.firmwareRevision = runtimeController.firmwareRevision;
    controller.dataTypes = (runtimeController.dataTypes ?? []).map(restoreDataType);
    const knownInstructionTypes = new Set(
      (runtimeController.addOnInstructions ?? []).map((aoi) => aoi.name.toUpperCase()),
    );
    controller.addOnInstructions = (runtimeController.addOnInstructions ?? []).map((aoi) =>
      restoreAddOnInstruction(aoi, warnings, knownInstructionTypes),
    );

    // Programs + routines.
    for (const runtimeTask of runtimeController.tasks) {
      for (const runtimeProgram of runtimeTask.programs) {
        if (controller.programs.some((existing) => existing.id === runtimeProgram.id)) continue;
        const program = createProgram(controller.id, runtimeProgram.name);
        program.id = runtimeProgram.id;
        if (runtimeProgram.mainRoutineId) program.mainRoutineId = runtimeProgram.mainRoutineId;
        if (runtimeProgram.faultRoutineId) program.faultRoutineId = runtimeProgram.faultRoutineId;
        if (runtimeProgram.inhibited) program.inhibited = true;
        for (const runtimeRoutine of runtimeProgram.routines) {
          program.routines.push(restoreRoutine(program.id, runtimeRoutine, warnings, knownInstructionTypes));
        }
        controller.programs.push(program);
      }
      const task = createContinuousTask(
        controller.id,
        runtimeTask.name,
        runtimeTask.programs.map((program) => program.id),
      );
      task.id = runtimeTask.id;
      task.type = runtimeTask.type as typeof task.type;
      if (runtimeTask.periodMs != null) task.periodMs = runtimeTask.periodMs;
      if (runtimeTask.priority != null) task.priority = runtimeTask.priority;
      if (runtimeTask.watchdogMs != null) task.watchdogMs = runtimeTask.watchdogMs;
      if (runtimeTask.inhibited) task.inhibited = true;
      controller.tasks.push(task);
    }

    // Tags.
    for (const runtimeTag of runtime.tags) {
      const program =
        runtimeTag.scope === "program"
          ? controller.programs.find((candidate) => candidate.name === runtimeTag.programName)
          : undefined;
      if (runtimeTag.scope === "program" && !program) continue;
      const tag = createTag(controller.id, runtimeTag.name, runtimeTag.dataType, {
        scope: runtimeTag.scope,
        ...(program ? { programId: program.id } : {}),
        ...(runtimeTag.description ? { description: runtimeTag.description } : {}),
        ...(runtimeTag.initialValue !== undefined ? { value: runtimeTag.initialValue } : {}),
        ...(runtimeTag.dimensions?.length ? { dimensions: runtimeTag.dimensions } : {}),
        ...(runtimeTag.externalAccess ? { externalAccess: runtimeTag.externalAccess as ExternalAccess } : {}),
        ...(runtimeTag.constant ? { constant: true } : {}),
      });
      if (program) program.programTags.push(tag);
      else controller.controllerTags.push(tag);
    }

    // I/O configuration — reconstructed as offline catalog/configuration metadata.
    // Authored ports/connections/profile channels are preserved; live module state
    // is never fabricated.
    for (const runtimeModule of runtimeController.io) {
      controller.ioConfiguration.modules.push(restoreIoModule(runtimeModule));
    }

    project.controllers.push(controller);
  }

  const hmiSnapshot = runtime.hmi?.projectSnapshot;
  if (isHmiProject(hmiSnapshot)) {
    return withHmiProject(project, cloneJson(hmiSnapshot));
  }

  if (hmiSnapshot !== undefined) {
    warnings.push("Runtime HMI project snapshot was present but could not be validated; preserving screen references only.");
  }

  return project;
}

/** Rebuild an offline {@link IoModule} from a compiled runtime module reference. */
function restoreIoModule(runtimeModule: RuntimeIoModule): IoModule {
  const module: IoModule & { profileChannels?: RuntimeModuleProfileChannel[] } = {
    id: createId("iomod"),
    name: runtimeModule.name,
    ...(runtimeModule.catalogNumber ? { catalogNumber: runtimeModule.catalogNumber } : {}),
    ...(runtimeModule.slot != null ? { slot: runtimeModule.slot } : {}),
    ...(runtimeModule.description ? { description: runtimeModule.description } : {}),
    ...(runtimeModule.parentModule ? { parentModule: runtimeModule.parentModule } : {}),
    ...(runtimeModule.parentPortId ? { parentPortId: runtimeModule.parentPortId } : {}),
    ...(runtimeModule.commPath ? { commPath: runtimeModule.commPath } : {}),
    ...(runtimeModule.vendor ? { vendor: runtimeModule.vendor } : {}),
    ...(runtimeModule.productType ? { productType: runtimeModule.productType } : {}),
    ...(runtimeModule.productCode ? { productCode: runtimeModule.productCode } : {}),
    ...(runtimeModule.major ? { majorRevision: runtimeModule.major } : {}),
    ...(runtimeModule.minor ? { minorRevision: runtimeModule.minor } : {}),
    ...(runtimeModule.electronicKeying ? { electronicKeying: runtimeModule.electronicKeying } : {}),
    ...(runtimeModule.inhibited != null ? { inhibited: runtimeModule.inhibited } : {}),
    ...(runtimeModule.majorFault != null ? { majorFault: runtimeModule.majorFault } : {}),
    ...(runtimeModule.ports?.length ? { ports: runtimeModule.ports.map(restoreIoPort) } : {}),
    ...(runtimeModule.connections?.length ? { connections: runtimeModule.connections.map(restoreModuleConnection) } : {}),
  };
  if (runtimeModule.profileChannels?.length) module.profileChannels = runtimeModule.profileChannels.map((channel) => ({ ...channel }));
  return module;
}

function restoreIoPort(runtimePort: RuntimeIoPort): IoPort {
  return {
    ...(runtimePort.id ? { id: runtimePort.id } : {}),
    ...(runtimePort.type ? { type: runtimePort.type } : {}),
    ...(runtimePort.address ? { address: runtimePort.address } : {}),
    ...(runtimePort.upstream != null ? { upstream: runtimePort.upstream } : {}),
    ...(runtimePort.busSize != null ? { busSize: runtimePort.busSize } : {}),
    ...(runtimePort.safetyNetwork ? { safetyNetwork: runtimePort.safetyNetwork } : {}),
  };
}

function restoreModuleConnection(runtimeConnection: RuntimeModuleConnection): ModuleConnection {
  return {
    ...(runtimeConnection.name ? { name: runtimeConnection.name } : {}),
    ...(runtimeConnection.rpi != null ? { rpi: runtimeConnection.rpi } : {}),
    ...(runtimeConnection.type ? { type: runtimeConnection.type } : {}),
    ...(runtimeConnection.priority ? { priority: runtimeConnection.priority } : {}),
    ...(runtimeConnection.unicast != null ? { unicast: runtimeConnection.unicast } : {}),
    ...(runtimeConnection.eventId != null ? { eventId: runtimeConnection.eventId } : {}),
    ...(runtimeConnection.programmaticallySendEventTrigger != null
      ? { programmaticallySendEventTrigger: runtimeConnection.programmaticallySendEventTrigger }
      : {}),
    ...(runtimeConnection.inputConnectionType ? { inputConnectionType: runtimeConnection.inputConnectionType } : {}),
    ...(runtimeConnection.inputProductionTrigger ? { inputProductionTrigger: runtimeConnection.inputProductionTrigger } : {}),
    ...(runtimeConnection.outputRedundantOwner != null
      ? { outputRedundantOwner: runtimeConnection.outputRedundantOwner }
      : {}),
  };
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
  warnings: string[],
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
      ? { routines: runtimeAoi.routines.map((routine) => restoreRoutine(runtimeAoi.id, routine, warnings, knownInstructionTypes)) }
      : {}),
  };
}

function branchNodeCount(branch: LadderBranch): number {
  return (
    branch.nodes.length +
    (branch.parallelBranches ?? []).reduce((sum, parallel) => sum + branchNodeCount(parallel), 0) +
    (branch.next ? branchNodeCount(branch.next) : 0)
  );
}

function ladderSourceText(runtimeRoutine: RuntimeRoutine): string {
  const payload = runtimeRoutine.payload;
  if (payload.kind !== "ladder") return "";
  return payload.rungs
    .map((rung) => `${rung.comment ? `// ${rung.comment}\n` : ""}${rung.text};`)
    .join("\n");
}

function buildEditableLadder(
  runtimeRoutine: RuntimeRoutine,
  warnings: string[],
  knownInstructionTypes: Set<string>,
): LadderRoutine | undefined {
  const payload = runtimeRoutine.payload;
  if (payload.kind !== "ladder") return undefined;
  const ladder = createLadderRoutine();

  for (const rung of payload.rungs) {
    const parsed = parseRungText(rung.text, instructionRegistry, knownInstructionTypes);
    const failed = parsed.complexBranch || (rung.text.trim().length > 0 && branchNodeCount(parsed.root) === 0);
    if (failed) {
      warnings.push(
        `Routine "${runtimeRoutine.name}" rung ${rung.number}: ladder source could not be reconstructed as editable AST; ` +
          "preserved as read-only source text.",
      );
      return undefined;
    }
    const restored: LadderRung = {
      id: createId("rung"),
      routineId: ladder.id,
      number: rung.number,
      ...(rung.comment ? { comment: rung.comment } : {}),
      root: parsed.root,
      sourceText: rung.text,
    };
    ladder.rungs.push(restored);
  }

  return ladder;
}

function restoreRoutine(
  programId: string,
  runtimeRoutine: RuntimeRoutine,
  warnings: string[],
  knownInstructionTypes: Set<string>,
): Routine {
  const routine = createRoutine(programId, runtimeRoutine.name, runtimeRoutine.language);
  routine.id = runtimeRoutine.id;
  const payload = runtimeRoutine.payload;
  if (payload.kind === "ladder") {
    const ladder = buildEditableLadder(runtimeRoutine, warnings, knownInstructionTypes);
    if (ladder) routine.ladder = ladder;
    else routine.sourceText = ladderSourceText(runtimeRoutine);
  } else if (payload.kind === "structured-text") {
    routine.structuredText = payload.lines.join("\n");
  } else if (payload.kind === "graphical") {
    routine.sourceText = payload.note;
  }
  return routine;
}

function runtimeFileSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "esco-runtime";
}
