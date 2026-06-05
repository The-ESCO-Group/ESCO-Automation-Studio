/**
 * ESCO Runtime compiler.
 *
 * Turns the editable ESCO project model into an execution-oriented `.easruntime`
 * runtime payload: an ordered task → program → routine scan model, flattened /
 * normalized routine payloads, power-up tag state, tag metadata, I/O binding
 * metadata, and a build/validation summary. This is NOT a project save clone —
 * it is a compiled runtime view of the project.
 *
 * Pure and ESCO-native: it reads only the ESCO model and never touches any
 * proprietary controller file.
 */

import type {
  AddOnInstruction,
  AoiLocalTag,
  AoiParameter,
  Controller,
  IoModule,
  IoPort,
  ModuleConnection,
  PlcProject,
  Program,
  Routine,
  Tag,
  Task,
  UdtMember,
  UserDefinedType,
} from "@esco/core";
import {
  createDefaultRegistry,
  instructionFidelity,
  type InstructionFidelityStatus,
} from "@esco/instructions";
import { rungToText, routineNodes, type LadderRoutine } from "@esco/ladder";
import type { HmiProject, HmiSurfaceBase } from "@esco/hmi-model";
import { tokenizeStructuredText, type StructuredTextToken } from "@esco/parser-l5x";
import { nowIso } from "@esco/shared";
import type { ValidationFinding } from "@esco/validator";
import { getLadder, validate } from "./helpers";
import { defaultValues } from "./scan";
import { controllerTaskStatusReport } from "./task-status";
import {
  EASRT_EXTENSION,
  EASRT_FORMAT_NAME,
  EASRT_RUNTIME_VERSION,
  EASRT_SCHEMA_VERSION,
  type EscoRuntime,
  type RuntimeAddOnInstruction,
  type RuntimeAoiLocalTag,
  type RuntimeAoiParameter,
  type RuntimeBuildSummary,
  type RuntimeController,
  type RuntimeDataType,
  type RuntimeHmi,
  type RuntimeInstructionFidelity,
  type RuntimeInstructionSourceLanguage,
  type RuntimeIoModule,
  type RuntimeIoPort,
  type RuntimeModuleConnection,
  type RuntimeModuleProfileChannel,
  type RuntimePreservedInstruction,
  type RuntimeProgram,
  type RuntimeRoutine,
  type RuntimeRoutinePayload,
  type RuntimeScalar,
  type RuntimeTag,
  type RuntimeTask,
  type RuntimeUdtMember,
} from "./runtime-format";

/** Shared instruction catalog used to classify compiled ladder logic. */
const instructionRegistry = createDefaultRegistry();

/** Version of ESCO Automation Studio stamped into the runtime provenance. */
const DEFAULT_APP_VERSION = "0.1.0";

export interface BuildRuntimeOptions {
  /** App version recorded in provenance (defaults to the bundled version). */
  appVersion?: string;
  /** Build timestamp (ISO). Injectable to keep builds deterministic in tests. */
  builtAt?: string;
  /** Pre-compiled HMI runtime references, when the host already derived them. */
  hmi?: RuntimeHmi;
  /**
   * HMI project to derive runtime references and unsupported-binding warnings
   * from. Takes precedence over `hmi` when both are supplied. Only its
   * structural references are captured — never its mutable timestamps.
   */
  hmiProject?: HmiProject;
}

export interface BuildRuntimeResult {
  ok: boolean;
  runtime?: EscoRuntime;
  summary?: RuntimeBuildSummary;
  /** Blocking problems that prevented runtime generation. */
  errors: string[];
  /** Non-blocking notes about anything compiled with caveats. */
  warnings: string[];
}

const SIMULATABLE_LANGUAGES = new Set(["ladder", "structured-text"]);

function routinePayload(routine: Routine, warnings: string[]): RuntimeRoutinePayload {
  if (routine.language === "ladder") {
    const ladder: LadderRoutine | undefined = getLadder(routine);
    if (!ladder || ladder.rungs.length === 0) return { kind: "empty" };
    const rungs = [...ladder.rungs]
      .sort((a, b) => a.number - b.number)
      .map((rung) => ({
        number: rung.number,
        text: rungToText(rung),
        ...(rung.comment ? { comment: rung.comment } : {}),
      }));
    return { kind: "ladder", rungs };
  }
  if (routine.language === "structured-text") {
    const source = routine.structuredText ?? "";
    if (!source.trim()) return { kind: "empty" };
    return { kind: "structured-text", lines: source.split(/\r?\n/) };
  }
  // Function Block / SFC: preserved for inspection, not executed by the offline runtime.
  const preserved = Boolean(routine.sourceText && routine.sourceText.trim());
  warnings.push(
    `Routine "${routine.name}" (${routine.language}) is preserved for inspection but is not executed by the ESCO offline runtime.`,
  );
  return {
    kind: "graphical",
    language: routine.language,
    preserved,
    note: preserved
      ? "Graphical routine body preserved as read-only source; not executed offline."
      : "Graphical routine has no serializable body; only its identity is recorded.",
  };
}

function orderedRoutines(program: Program): Routine[] {
  const main = program.mainRoutineId
    ? program.routines.find((routine) => routine.id === program.mainRoutineId)
    : undefined;
  const fault = program.faultRoutineId
    ? program.routines.find((routine) => routine.id === program.faultRoutineId)
    : undefined;
  const rest = program.routines.filter((routine) => routine !== main && routine !== fault);
  return [...(main ? [main] : []), ...rest, ...(fault ? [fault] : [])];
}

function buildRoutine(
  routine: Routine,
  executionIndex: number,
  warnings: string[],
): RuntimeRoutine {
  return {
    id: routine.id,
    name: routine.name,
    language: routine.language,
    executionIndex,
    scheduled: executionIndex >= 0,
    executable: SIMULATABLE_LANGUAGES.has(routine.language),
    payload: routinePayload(routine, warnings),
  };
}

function buildProgram(
  program: Program,
  executionIndexOf: (routineId: string) => number,
  warnings: string[],
): RuntimeProgram {
  return {
    id: program.id,
    name: program.name,
    ...(program.mainRoutineId ? { mainRoutineId: program.mainRoutineId } : {}),
    ...(program.faultRoutineId ? { faultRoutineId: program.faultRoutineId } : {}),
    inhibited: Boolean(program.inhibited),
    routines: orderedRoutines(program).map((routine) =>
      buildRoutine(routine, executionIndexOf(routine.id), warnings),
    ),
  };
}

/** Deterministic task scan order: enabled before inhibited, then by priority, then name. */
function orderedTasks(controller: Controller): Task[] {
  return [...controller.tasks].sort((a, b) => {
    const inhibitDelta = Number(Boolean(a.inhibited)) - Number(Boolean(b.inhibited));
    if (inhibitDelta !== 0) return inhibitDelta;
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });
}

function buildTask(
  task: Task,
  programsById: Map<string, Program>,
  executionIndexOf: (routineId: string) => number,
  warnings: string[],
): RuntimeTask {
  const programs = task.scheduledProgramIds
    .map((id) => programsById.get(id))
    .filter((program): program is Program => Boolean(program))
    .map((program) => buildProgram(program, executionIndexOf, warnings));
  if (task.scheduledProgramIds.length === 0 && !task.inhibited) {
    warnings.push(`Task "${task.name}" has no scheduled programs.`);
  }
  return {
    id: task.id,
    name: task.name,
    type: task.type,
    ...(task.periodMs != null ? { periodMs: task.periodMs } : {}),
    ...(task.priority != null ? { priority: task.priority } : {}),
    ...(task.watchdogMs != null ? { watchdogMs: task.watchdogMs } : {}),
    inhibited: Boolean(task.inhibited),
    programs,
  };
}

function buildIoPort(port: IoPort): RuntimeIoPort {
  return {
    ...(port.id ? { id: port.id } : {}),
    ...(port.type ? { type: port.type } : {}),
    ...(port.address ? { address: port.address } : {}),
    ...(port.upstream != null ? { upstream: port.upstream } : {}),
    ...(port.busSize != null ? { busSize: port.busSize } : {}),
    ...(port.safetyNetwork ? { safetyNetwork: port.safetyNetwork } : {}),
  };
}

function buildModuleConnection(connection: ModuleConnection): RuntimeModuleConnection {
  return {
    ...(connection.name ? { name: connection.name } : {}),
    ...(connection.rpi != null ? { rpi: connection.rpi } : {}),
    ...(connection.type ? { type: connection.type } : {}),
    ...(connection.priority ? { priority: connection.priority } : {}),
    ...(connection.unicast != null ? { unicast: connection.unicast } : {}),
    ...(connection.eventId != null ? { eventId: connection.eventId } : {}),
    ...(connection.programmaticallySendEventTrigger != null
      ? { programmaticallySendEventTrigger: connection.programmaticallySendEventTrigger }
      : {}),
    ...(connection.inputConnectionType ? { inputConnectionType: connection.inputConnectionType } : {}),
    ...(connection.inputProductionTrigger ? { inputProductionTrigger: connection.inputProductionTrigger } : {}),
    ...(connection.outputRedundantOwner != null
      ? { outputRedundantOwner: connection.outputRedundantOwner }
      : {}),
  };
}

function stringProp(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanProp(row: Record<string, unknown>, key: string): boolean | undefined {
  const value = row[key];
  return typeof value === "boolean" ? value : undefined;
}

function moduleProfileChannels(module: IoModule): RuntimeModuleProfileChannel[] {
  const candidate = (module as IoModule & { profileChannels?: unknown }).profileChannels;
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    const channel: RuntimeModuleProfileChannel = {
      ...(stringProp(value, "id") ? { id: stringProp(value, "id") } : {}),
      ...(stringProp(value, "label") ? { label: stringProp(value, "label") } : {}),
      ...(stringProp(value, "direction") ? { direction: stringProp(value, "direction") } : {}),
      ...(stringProp(value, "signal") ? { signal: stringProp(value, "signal") } : {}),
      ...(booleanProp(value, "enabled") != null ? { enabled: booleanProp(value, "enabled") } : {}),
      ...(stringProp(value, "dataFormat") ? { dataFormat: stringProp(value, "dataFormat") } : {}),
      ...(stringProp(value, "range") ? { range: stringProp(value, "range") } : {}),
      ...(stringProp(value, "diagnostic") ? { diagnostic: stringProp(value, "diagnostic") } : {}),
    };
    return Object.keys(channel).length > 0 ? [channel] : [];
  });
}

function buildIoModule(module: IoModule): RuntimeIoModule {
  const ports = module.ports?.map(buildIoPort) ?? [];
  const connections = module.connections?.map(buildModuleConnection) ?? [];
  const profileChannels = moduleProfileChannels(module);
  return {
    name: module.name,
    ...(module.catalogNumber ? { catalogNumber: module.catalogNumber } : {}),
    ...(module.slot != null ? { slot: module.slot } : {}),
    ...(module.description ? { description: module.description } : {}),
    ...(module.parentModule ? { parentModule: module.parentModule } : {}),
    ...(module.parentPortId ? { parentPortId: module.parentPortId } : {}),
    ...(module.commPath ? { commPath: module.commPath } : {}),
    ...(module.vendor ? { vendor: module.vendor } : {}),
    ...(module.productType ? { productType: module.productType } : {}),
    ...(module.productCode ? { productCode: module.productCode } : {}),
    ...(module.majorRevision ? { major: module.majorRevision } : {}),
    ...(module.minorRevision ? { minor: module.minorRevision } : {}),
    ...(module.electronicKeying ? { electronicKeying: module.electronicKeying } : {}),
    ...(module.inhibited != null ? { inhibited: module.inhibited } : {}),
    ...(module.majorFault != null ? { majorFault: module.majorFault } : {}),
    ...(ports.length ? { ports } : {}),
    ...(connections.length ? { connections } : {}),
    ...(profileChannels.length ? { profileChannels, profileChannelCount: profileChannels.length } : {}),
    ...(connections.length ? { connectionCount: connections.length } : {}),
  };
}

function isScalar(value: unknown): value is RuntimeScalar {
  return typeof value === "boolean" || typeof value === "number" || typeof value === "string";
}

function runtimeValuePath(tag: Tag, program: Program | undefined): string {
  return program ? `Program:${program.name}.${tag.name}` : tag.name;
}

function overlayAuthoredValue(
  values: Record<string, RuntimeScalar>,
  path: string,
  value: unknown,
): void {
  if (isScalar(value)) {
    if (Object.prototype.hasOwnProperty.call(values, path)) values[path] = value;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => overlayAuthoredValue(values, `${path}[${index}]`, item));
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
    overlayAuthoredValue(values, `${path}.${key}`, record[key]);
  }
}

function compileInitialValues(project: PlcProject): Record<string, RuntimeScalar> {
  const values: Record<string, RuntimeScalar> = { ...defaultValues(project) };
  for (const controller of project.controllers) {
    for (const tag of controller.controllerTags) overlayAuthoredValue(values, runtimeValuePath(tag, undefined), tag.value);
    for (const program of controller.programs) {
      for (const tag of program.programTags) overlayAuthoredValue(values, runtimeValuePath(tag, program), tag.value);
    }
  }
  return values;
}

function buildTag(tag: Tag, program: Program | undefined, initialValues: Record<string, RuntimeScalar>): RuntimeTag {
  const path = runtimeValuePath(tag, program);
  const initial = initialValues[path];
  return {
    path,
    name: tag.name,
    scope: program ? "program" : "controller",
    ...(program ? { programName: program.name } : {}),
    dataType: tag.dataType,
    ...(tag.dimensions?.length ? { dimensions: tag.dimensions } : {}),
    ...(isScalar(initial) ? { initialValue: initial } : {}),
    ...(tag.constant != null ? { constant: tag.constant } : {}),
    ...(tag.radix ? { radix: tag.radix } : {}),
    ...(tag.externalAccess ? { externalAccess: tag.externalAccess } : {}),
    ...(tag.description ? { description: tag.description } : {}),
  };
}

function buildUdtMember(member: UdtMember): RuntimeUdtMember {
  return {
    name: member.name,
    dataType: member.dataType,
    ...(member.dimension && member.dimension > 0 ? { dimension: member.dimension } : {}),
    ...(member.dimensions?.length ? { dimensions: member.dimensions } : {}),
    ...(member.description ? { description: member.description } : {}),
    ...(member.radix ? { radix: member.radix } : {}),
    ...(member.externalAccess ? { externalAccess: member.externalAccess } : {}),
    ...(member.hidden != null ? { hidden: member.hidden } : {}),
    ...(member.target ? { target: member.target } : {}),
    ...(member.bitNumber != null ? { bitNumber: member.bitNumber } : {}),
  };
}

function buildDataType(dataType: UserDefinedType): RuntimeDataType {
  return {
    id: dataType.id,
    name: dataType.name,
    ...(dataType.description ? { description: dataType.description } : {}),
    ...(dataType.family ? { family: dataType.family } : {}),
    ...(dataType.safetyClass ? { safetyClass: dataType.safetyClass } : {}),
    members: dataType.members.map(buildUdtMember),
  };
}

function buildAoiParameter(parameter: AoiParameter): RuntimeAoiParameter {
  return {
    name: parameter.name,
    dataType: parameter.dataType,
    ...(parameter.usage ? { usage: parameter.usage } : {}),
    ...(parameter.required != null ? { required: parameter.required } : {}),
    ...(parameter.dimension && parameter.dimension > 0 ? { dimension: parameter.dimension } : {}),
    ...(parameter.dimensions?.length ? { dimensions: parameter.dimensions } : {}),
    ...(parameter.visible != null ? { visible: parameter.visible } : {}),
    ...(parameter.defaultValue != null ? { defaultValue: parameter.defaultValue } : {}),
    ...(parameter.description ? { description: parameter.description } : {}),
    ...(parameter.radix ? { radix: parameter.radix } : {}),
    ...(parameter.externalAccess ? { externalAccess: parameter.externalAccess } : {}),
    ...(parameter.constant != null ? { constant: parameter.constant } : {}),
  };
}

function buildAoiLocalTag(localTag: AoiLocalTag): RuntimeAoiLocalTag {
  return {
    name: localTag.name,
    dataType: localTag.dataType,
    ...(localTag.dimension && localTag.dimension > 0 ? { dimension: localTag.dimension } : {}),
    ...(localTag.dimensions?.length ? { dimensions: localTag.dimensions } : {}),
    ...(localTag.description ? { description: localTag.description } : {}),
    ...(localTag.radix ? { radix: localTag.radix } : {}),
    ...(localTag.externalAccess ? { externalAccess: localTag.externalAccess } : {}),
  };
}

function aoiMetadataWarning(aoi: AddOnInstruction): string | undefined {
  const hasLadderBody = (aoi.routines ?? []).some((routine) => routine.language === "ladder");
  if (!aoi.protected && hasLadderBody) return undefined;
  const reason = aoi.protected ? "source-protected" : "has no ladder body available";
  return (
    `Add-On Instruction "${aoi.name}" is preserved as definition metadata but ${reason}; ` +
    "calls are review-only and not simulated by the ESCO offline runtime."
  );
}

function buildAddOnInstruction(aoi: AddOnInstruction, warnings: string[]): RuntimeAddOnInstruction {
  const warning = aoiMetadataWarning(aoi);
  if (warning) warnings.push(warning);
  return {
    id: aoi.id,
    name: aoi.name,
    ...(aoi.description ? { description: aoi.description } : {}),
    ...(aoi.revision ? { revision: aoi.revision } : {}),
    ...(aoi.revisionExtension ? { revisionExtension: aoi.revisionExtension } : {}),
    ...(aoi.softwareRevision ? { softwareRevision: aoi.softwareRevision } : {}),
    ...(aoi.vendor ? { vendor: aoi.vendor } : {}),
    ...(aoi.signature ? { signature: aoi.signature } : {}),
    ...(aoi.createdDate ? { createdDate: aoi.createdDate } : {}),
    ...(aoi.createdBy ? { createdBy: aoi.createdBy } : {}),
    ...(aoi.editedDate ? { editedDate: aoi.editedDate } : {}),
    ...(aoi.editedBy ? { editedBy: aoi.editedBy } : {}),
    ...(aoi.revisionNote ? { revisionNote: aoi.revisionNote } : {}),
    ...(aoi.additionalHelpText ? { additionalHelpText: aoi.additionalHelpText } : {}),
    ...(aoi.protected != null ? { protected: aoi.protected } : {}),
    ...(aoi.protectionType ? { protectionType: aoi.protectionType } : {}),
    ...(aoi.safetyClass ? { safetyClass: aoi.safetyClass } : {}),
    ...(aoi.executePrescan != null ? { executePrescan: aoi.executePrescan } : {}),
    ...(aoi.executePostscan != null ? { executePostscan: aoi.executePostscan } : {}),
    ...(aoi.executeEnableInFalse != null ? { executeEnableInFalse: aoi.executeEnableInFalse } : {}),
    parameters: aoi.parameters.map(buildAoiParameter),
    localTags: aoi.localTags.map(buildAoiLocalTag),
    routineNames: [...aoi.routineNames],
    ...(aoi.routines?.length
      ? { routines: aoi.routines.map((routine) => buildRoutine(routine, -1, warnings)) }
      : {}),
  };
}

function buildController(
  controller: Controller,
  executionIndexOf: (routineId: string) => number,
  initialValues: Record<string, RuntimeScalar>,
  warnings: string[],
): { controller: RuntimeController; tags: RuntimeTag[]; rungCount: number } {
  const programsById = new Map(controller.programs.map((program) => [program.id, program]));
  const tasks = orderedTasks(controller).map((task) =>
    buildTask(task, programsById, executionIndexOf, warnings),
  );

  const tags: RuntimeTag[] = [
    ...controller.controllerTags.map((tag) => buildTag(tag, undefined, initialValues)),
    ...controller.programs.flatMap((program) =>
      program.programTags.map((tag) => buildTag(tag, program, initialValues)),
    ),
  ];

  let rungCount = 0;
  for (const program of controller.programs) {
    for (const routine of program.routines) {
      const ladder = getLadder(routine);
      if (ladder) rungCount += ladder.rungs.length;
    }
  }

  const io = controller.ioConfiguration.modules.map(buildIoModule);
  const dataTypes = controller.dataTypes.map(buildDataType);
  const addOnInstructions = controller.addOnInstructions.map((aoi) => buildAddOnInstruction(aoi, warnings));
  if (io.length > 0) {
    warnings.push(
      `Controller "${controller.name}": ${io.length} I/O module${io.length === 1 ? "" : "s"} ` +
        "preserved as binding metadata only; the ESCO offline runtime does not simulate field I/O.",
    );
  }

  return {
    controller: {
      id: controller.id,
      name: controller.name,
      ...(controller.processorType ? { processorType: controller.processorType } : {}),
      ...(controller.catalogNumber ? { catalogNumber: controller.catalogNumber } : {}),
      ...(controller.firmwareRevision ? { firmwareRevision: controller.firmwareRevision } : {}),
      tasks,
      io,
      dataTypes,
      addOnInstructions,
    },
    tags,
    rungCount,
  };
}

// ---------------------------------------------------------------------------
// Instruction fidelity — honest accounting of what executes vs. is preserved.
// ---------------------------------------------------------------------------

/**
 * Offline executability of a project-defined AOI call: the simulator inlines an
 * AOI's imported ladder body, so an AOI with a ladder routine that is not
 * source-protected is executable; otherwise it is preserved for review.
 */
function aoiStatus(aoi: AddOnInstruction): InstructionFidelityStatus {
  const hasLadderBody = (aoi.routines ?? []).some((routine) => routine.language === "ladder");
  return !aoi.protected && hasLadderBody ? "executable-partial" : "review-only";
}

function classifyInstruction(
  type: string,
  aoiByName: Map<string, AddOnInstruction>,
): { status: InstructionFidelityStatus; summary: string } {
  const def = instructionRegistry.get(type);
  if (def) {
    const fidelity = instructionFidelity(def);
    return { status: fidelity.status, summary: fidelity.summary };
  }
  const aoi = aoiByName.get(type.toUpperCase());
  if (aoi) {
    const status = aoiStatus(aoi);
    return {
      status,
      summary:
        status === "executable-partial"
          ? "Add-On Instruction: its imported ladder body is inlined and executed by the offline runtime."
          : "Add-On Instruction: source-protected or has no ladder body; preserved for review and not executed offline.",
    };
  }
  const fidelity = instructionFidelity(undefined);
  return { status: fidelity.status, summary: fidelity.summary };
}

const ST_DECLARATION_OPENERS = new Set(["VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP"]);
const ST_DECLARATION_CLOSERS = new Set(["END_VAR"]);
const ST_STATEMENT_BOUNDARY_KEYWORDS = new Set(["THEN", "ELSE", "DO", "REPEAT"]);
const ST_CONTROL_CALL_EXCLUSIONS = new Set([
  "IF",
  "ELSIF",
  "CASE",
  "FOR",
  "WHILE",
  "REPEAT",
  "RETURN",
  "EXIT",
  "END_IF",
  "END_CASE",
  "END_FOR",
  "END_WHILE",
  "END_REPEAT",
]);

function normalized(value: string): string {
  return value.toUpperCase();
}

function executableStructuredTextTokens(source: string): StructuredTextToken[] {
  return tokenizeStructuredText(source).filter((token) => token.kind !== "comment");
}

function previousToken(tokens: readonly StructuredTextToken[], index: number): StructuredTextToken | undefined {
  return tokens[index - 1];
}

function isStructuredTextStatementBoundary(tokens: readonly StructuredTextToken[], index: number): boolean {
  const previous = previousToken(tokens, index);
  if (!previous) return true;
  if (previous.value === ";" || previous.value === ":") return true;
  return previous.kind === "keyword" && ST_STATEMENT_BOUNDARY_KEYWORDS.has(normalized(previous.value));
}

function structuredTextCallAt(
  tokens: readonly StructuredTextToken[],
  index: number,
): { name: string; endIndex: number } | undefined {
  const token = tokens[index];
  if (!token || (token.kind !== "identifier" && token.kind !== "keyword")) return undefined;
  const name = normalized(token.value);
  if (ST_CONTROL_CALL_EXCLUSIONS.has(name)) return undefined;
  if (tokens[index + 1]?.kind !== "punctuation" || tokens[index + 1]?.value !== "(") return undefined;

  let depth = 0;
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const item = tokens[cursor]!;
    if (item.kind !== "punctuation") continue;
    if (item.value === "(") depth += 1;
    else if (item.value === ")") {
      depth -= 1;
      if (depth === 0) return { name, endIndex: cursor };
    }
  }
  return undefined;
}

function structuredTextInstructionCalls(source: string): string[] {
  const tokens = executableStructuredTextTokens(source);
  const calls: string[] = [];
  let inDeclaration = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const upper = normalized(token.value);
    if (ST_DECLARATION_OPENERS.has(upper)) {
      inDeclaration = true;
      continue;
    }
    if (ST_DECLARATION_CLOSERS.has(upper)) {
      inDeclaration = false;
      continue;
    }
    if (inDeclaration || !isStructuredTextStatementBoundary(tokens, index)) continue;

    const call = structuredTextCallAt(tokens, index);
    if (!call) continue;
    calls.push(call.name);
    index = call.endIndex;
  }

  return calls;
}

function addSourceLanguage(
  item: RuntimePreservedInstruction,
  sourceLanguage: RuntimeInstructionSourceLanguage,
): void {
  if (item.sourceLanguages.includes(sourceLanguage)) return;
  item.sourceLanguages.push(sourceLanguage);
  item.sourceLanguages.sort((a, b) => a.localeCompare(b));
}

function preservedInstructionWarning(item: RuntimePreservedInstruction): string {
  const plural = item.count === 1 ? "" : "s";
  const source =
    item.sourceLanguages.length === 2
      ? " in ladder and Structured Text"
      : item.sourceLanguages[0] === "structured-text"
        ? " in Structured Text"
        : " in ladder";
  if (item.status === "unsupported") {
    return (
      `Instruction "${item.type}" is not in the ESCO instruction catalog (${item.count} occurrence${plural}${source}): ` +
      "preserved verbatim as read-only logic and never executed by the offline runtime."
    );
  }
  const label = item.status === "review-only" ? "review-only" : "model-only";
  return (
    `Instruction "${item.type}" (${label}) appears ${item.count} time${plural}${source}: ` +
    "preserved for review and not executed by the ESCO offline runtime."
  );
}

/**
 * Walk every compiled ladder/ST instruction and classify it against the ESCO
 * instruction catalog (and project AOIs). Tallies executable vs. preserved
 * occurrences and appends one deterministic warning per preserved/unsupported
 * opcode, so model-only logic is surfaced honestly instead of faked.
 */
function computeInstructionFidelity(project: PlcProject, warnings: string[]): RuntimeInstructionFidelity {
  const byStatus: Record<InstructionFidelityStatus, number> = {
    "executable-simulation": 0,
    "executable-partial": 0,
    "model-only": 0,
    "review-only": 0,
    unsupported: 0,
  };
  const preservedByType = new Map<string, RuntimePreservedInstruction>();
  let total = 0;

  const recordInstruction = (
    type: string,
    sourceLanguage: RuntimeInstructionSourceLanguage,
    aoiByName: Map<string, AddOnInstruction>,
  ): void => {
    const { status, summary } = classifyInstruction(type, aoiByName);
    byStatus[status] += 1;
    total += 1;
    if (status === "executable-simulation" || status === "executable-partial") return;
    const existing = preservedByType.get(type);
    if (existing) {
      existing.count += 1;
      addSourceLanguage(existing, sourceLanguage);
    } else {
      preservedByType.set(type, {
        type,
        status,
        count: 1,
        sourceLanguages: [sourceLanguage],
        summary,
      });
    }
  };

  for (const controller of project.controllers) {
    const aoiByName = new Map(
      controller.addOnInstructions.map((aoi) => [aoi.name.toUpperCase(), aoi] as const),
    );
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (ladder) {
          for (const node of routineNodes(ladder)) {
            recordInstruction(node.instructionType, "ladder", aoiByName);
          }
          continue;
        }
        if (routine.language === "structured-text") {
          for (const type of structuredTextInstructionCalls(routine.structuredText ?? routine.sourceText ?? "")) {
            recordInstruction(type, "structured-text", aoiByName);
          }
        }
      }
    }
  }

  const preserved = [...preservedByType.values()].sort((a, b) => a.type.localeCompare(b.type));
  for (const item of preserved) warnings.push(preservedInstructionWarning(item));

  return {
    total,
    executable: byStatus["executable-simulation"] + byStatus["executable-partial"],
    modelOnly: byStatus["model-only"] + byStatus["review-only"],
    unsupported: byStatus.unsupported,
    byStatus,
    preserved,
  };
}

// ---------------------------------------------------------------------------
// HMI references — capture what the HMI binds against, warn on what can't run.
// ---------------------------------------------------------------------------

/**
 * Derive deterministic HMI runtime references from an HMI project and append
 * warnings for anything preserved-but-not-driven: unsupported element types,
 * non-runtime-preview commands, and unsupported content. The full ESCO HMI
 * project is also cloned into the runtime so SoftController upload/import can
 * reconstruct the HMI designer without touching proprietary controller files.
 */
function cloneHmiProjectSnapshot(hmiProject: HmiProject): HmiProject {
  return JSON.parse(JSON.stringify(hmiProject)) as HmiProject;
}

function buildHmiReferences(hmiProject: HmiProject, warnings: string[]): RuntimeHmi {
  const surfaces: HmiSurfaceBase[] = [...hmiProject.screens, ...hmiProject.popups, hmiProject.systemBanner];
  const allElements = surfaces.flatMap((surface) => surface.elements);

  let bindingCount = 0;
  let unsupportedElementCount = 0;
  let modelOnlyCommandCount = 0;
  for (const element of allElements) {
    bindingCount += element.bindings.length;
    if (element.unsupported) unsupportedElementCount += 1;
    for (const handler of element.events) {
      for (const command of handler.commands) {
        if (command.safety !== "runtime-preview") modelOnlyCommandCount += 1;
      }
    }
  }
  const unsupportedContentCount = hmiProject.unsupportedContent.length;
  const unsupportedCount = unsupportedElementCount + modelOnlyCommandCount + unsupportedContentCount;

  if (unsupportedElementCount > 0) {
    warnings.push(
      `HMI: ${unsupportedElementCount} graphic element${unsupportedElementCount === 1 ? "" : "s"} ` +
        "use unsupported element types and are preserved read-only; their bindings are not driven by the offline runtime.",
    );
  }
  if (modelOnlyCommandCount > 0) {
    warnings.push(
      `HMI: ${modelOnlyCommandCount} command${modelOnlyCommandCount === 1 ? "" : "s"} ` +
        "are model-only/hardware-only/unsupported and are preserved for review, not executed by the offline runtime.",
    );
  }
  if (unsupportedContentCount > 0) {
    warnings.push(
      `HMI: ${unsupportedContentCount} unsupported content item${unsupportedContentCount === 1 ? "" : "s"} ` +
        "preserved read-only and not driven by the offline runtime.",
    );
  }

  return {
    screenCount: hmiProject.screens.length,
    screenNames: hmiProject.screens.map((screen) => screen.name).sort((a, b) => a.localeCompare(b)),
    projectSnapshot: cloneHmiProjectSnapshot(hmiProject),
    popupCount: hmiProject.popups.length,
    controllerReferenceCount: hmiProject.controllerReferences.length,
    bindingCount,
    recipeCount: hmiProject.recipes?.length ?? 0,
    unsupportedCount,
  };
}

/**
 * Compile a project into an ESCO Runtime payload. Returns `ok: false` with
 * blocking `errors` when the project cannot produce a runtime (no controller, or
 * validation reports error-severity problems). Never mutates the project.
 */
export function buildRuntime(project: PlcProject, options: BuildRuntimeOptions = {}): BuildRuntimeResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (project.controllers.length === 0) {
    errors.push("ESCO Runtime build failed: the project has no controller to compile.");
    return { ok: false, errors, warnings };
  }

  const findings: ValidationFinding[] = validate(project);
  const validation = {
    error: findings.filter((finding) => finding.severity === "error").length,
    warning: findings.filter((finding) => finding.severity === "warning").length,
    info: findings.filter((finding) => finding.severity === "info").length,
  };
  for (const finding of findings) {
    if (finding.severity === "error") {
      errors.push(`${finding.message}${finding.target ? ` (${finding.target})` : ""}`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const scheduledRoutineIds = controllerTaskStatusReport(project).scheduledRoutineIds;
  const executionIndex = new Map(scheduledRoutineIds.map((id, index) => [id, index]));
  const executionIndexOf = (routineId: string): number => executionIndex.get(routineId) ?? -1;

  const initialValues = compileInitialValues(project);

  const controllers: RuntimeController[] = [];
  const tags: RuntimeTag[] = [];
  let rungCount = 0;
  for (const controller of project.controllers) {
    const built = buildController(controller, executionIndexOf, initialValues, warnings);
    controllers.push(built.controller);
    tags.push(...built.tags);
    rungCount += built.rungCount;
  }

  // Warning order is stable: controllers/IO (above) → instruction fidelity → HMI.
  const instructionFidelitySummary = computeInstructionFidelity(project, warnings);
  const hmi = options.hmiProject ? buildHmiReferences(options.hmiProject, warnings) : options.hmi;

  const summary: RuntimeBuildSummary = {
    controllerCount: controllers.length,
    taskCount: controllers.reduce((sum, controller) => sum + controller.tasks.length, 0),
    programCount: project.controllers.reduce((sum, controller) => sum + controller.programs.length, 0),
    routineCount: project.controllers.reduce(
      (sum, controller) => sum + controller.programs.reduce((s, program) => s + program.routines.length, 0),
      0,
    ),
    rungCount,
    tagCount: tags.length,
    ioModuleCount: controllers.reduce((sum, controller) => sum + controller.io.length, 0),
    executionOrder: scheduledRoutineIds,
    instructionFidelity: instructionFidelitySummary,
    warnings,
    validation,
  };

  const runtime: EscoRuntime = {
    formatName: EASRT_FORMAT_NAME,
    extension: EASRT_EXTENSION,
    schemaVersion: EASRT_SCHEMA_VERSION,
    runtimeVersion: EASRT_RUNTIME_VERSION,
    provenance: {
      source: "esco-native",
      builtBy: "ESCO Automation Studio",
      appVersion: options.appVersion ?? DEFAULT_APP_VERSION,
      builtAt: options.builtAt ?? nowIso(),
    },
    identity: {
      projectId: project.id,
      projectName: project.name,
      ...(project.description ? { description: project.description } : {}),
    },
    controllers,
    tags,
    initialValues,
    ...(hmi ? { hmi } : {}),
    build: summary,
  };

  return { ok: true, runtime, summary, errors, warnings };
}
