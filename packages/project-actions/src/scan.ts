import {
  arrayDimensionsOf,
  arrayElementNames,
  isStructuredType,
  memberDefs,
  type Controller,
  type PlcProject,
  type Program,
  type Routine,
  type Tag,
} from "@esco/core";
import { parseJsrParameterLayout } from "@esco/instructions";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import { collectOutputTags, createRuntime, type TraceEntry } from "@esco/simulator";
import { defaultRoutineId, findRoutine, getAllTags, getLadder, validate } from "./helpers";
import { controllerTaskStatusReport } from "./task-status";
import {
  createOfflineTaskSchedulerState,
  selectOfflineTaskScanSet,
  type OfflineTaskSchedulerState,
} from "./task-scheduler";
import {
  collectStructuredTextOutputTags,
  collectStructuredTextSbrOperands,
  copyStructuredTextParameters,
  executeStructuredTextSource,
} from "./structured-text-scan";
import type { ProjectActionResult, ScanOptions } from "./types";

/** Alias tag name → full target path, for the simulator to resolve reads/writes. */
function aliasMap(project: PlcProject): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const tag of getAllTags(project)) {
    if (tag.aliasFor) aliases.set(tag.name, tag.aliasFor.trim());
  }
  return aliases;
}

/** Routines (by name) of the program that owns `routineId`, for JSR resolution. */
function siblingRoutines(project: PlcProject, routineId: string): Map<string, LadderRoutine> {
  const map = new Map<string, LadderRoutine>();
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      if (!program.routines.some((routine) => routine.id === routineId)) continue;
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (ladder) map.set(routine.name, ladder);
      }
      return map;
    }
  }
  return map;
}

function scanRoutineIds(project: PlcProject, options: ScanOptions = {}): string[] {
  if (options.routineId) return [options.routineId];
  const scheduled = controllerTaskStatusReport(project).scheduledRoutineIds;
  if (scheduled.length > 0) return scheduled;
  const fallback = defaultRoutineId(project);
  return fallback ? [fallback] : [];
}

/** Default per-scan time step (ms) for the timer model. */
export const SCAN_STEP_MS = 250;
const MAX_ST_ROUTINE_CALL_DEPTH = 32;

export type TagValues = Record<string, boolean | number | string>;

export interface ScheduledScanOptions extends ScanOptions {
  schedulerState?: OfflineTaskSchedulerState;
}

export interface ScheduledScanData {
  values: TagValues;
  schedulerState: OfflineTaskSchedulerState;
  scannedTaskKeys: string[];
  heldEventTaskKeys: string[];
  triggeredEventTaskKeys: string[];
}

export interface ScheduledTraceData extends ScheduledScanData {
  trace: TraceEntry[];
}

const zeroFor = (type: string): boolean | number | string =>
  type === "BOOL" ? false : type === "STRING" ? "" : 0;

type ValuePath = { path: string; type: string };
type ValueMember = { name: string; type: string; dimension?: number; dimensions?: number[] };
type ProgramOwner = { controller: Controller; program: Program };
type ScopedProgramPath = { localPath: string; qualifiedPath: string; type: string };

function membersFor(controller: Controller, dataType: string): ValueMember[] | undefined {
  if (isStructuredType(dataType)) {
    return memberDefs(dataType).map((member) => ({ name: member.name, type: member.type }));
  }
  const udt = controller.dataTypes.find((candidate) => candidate.name === dataType);
  if (udt) return udt.members.map((member) => ({
    name: member.name,
    type: member.dataType,
    ...(member.dimension && member.dimension > 0 ? { dimension: member.dimension } : {}),
    ...(member.dimensions?.length ? { dimensions: member.dimensions } : {}),
  }));
  const aoi = controller.addOnInstructions.find((candidate) => candidate.name === dataType);
  return aoi
    ? [
        ...aoi.parameters.map((parameter) => ({ name: parameter.name, type: parameter.dataType })),
        ...aoi.localTags.map((localTag) => ({
          name: localTag.name,
          type: localTag.dataType,
          ...(localTag.dimension && localTag.dimension > 0 ? { dimension: localTag.dimension } : {}),
          ...(localTag.dimensions?.length ? { dimensions: localTag.dimensions } : {}),
        })),
      ]
    : undefined;
}

function appendValuePaths(
  paths: ValuePath[],
  controller: Controller,
  path: string,
  dataType: string,
  dimensions?: number | readonly number[],
  seen: Set<string> = new Set(),
): void {
  if (dimensions && arrayElementNames(path, dimensions).length > 0) {
    for (const element of arrayElementNames(path, dimensions)) {
      appendValuePaths(paths, controller, element, dataType, undefined, seen);
    }
    return;
  }

  if (dataType === "STRING") {
    paths.push({ path, type: dataType });
    paths.push({ path: `${path}.LEN`, type: "DINT" });
    return;
  }

  const members = membersFor(controller, dataType);
  if (!members || seen.has(dataType)) {
    paths.push({ path, type: dataType });
    return;
  }

  const nested = new Set(seen);
  nested.add(dataType);
  for (const member of members) {
    const memberDimensions = arrayDimensionsOf(member);
    appendValuePaths(
      paths,
      controller,
      `${path}.${member.name}`,
      member.type,
      memberDimensions.length ? memberDimensions : undefined,
      nested,
    );
  }
}

function programValuePath(program: Program, localPath: string): string {
  return `Program:${program.name}.${localPath}`;
}

function appendTagPaths(paths: ValuePath[], controller: Controller, tag: Tag, basePath = tag.name): void {
  const dimensions = arrayDimensionsOf(tag);
  appendValuePaths(paths, controller, basePath, tag.dataType, dimensions.length ? dimensions : undefined);
}

function tagValuePaths(controller: Controller, tag: Tag, basePath = tag.name): ValuePath[] {
  const paths: ValuePath[] = [];
  appendTagPaths(paths, controller, tag, basePath);
  return paths;
}

function routineOwner(project: PlcProject, routineId: string): ProgramOwner | undefined {
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      if (program.routines.some((routine) => routine.id === routineId)) return { controller, program };
    }
  }
  return undefined;
}

function routineByName(program: Program, name: string): Routine | undefined {
  const target = name.trim().toLowerCase();
  return program.routines.find((routine) => routine.name.trim().toLowerCase() === target);
}

function structuredTextSource(routine: Routine | undefined): string | undefined {
  return routine?.language === "structured-text" ? (routine.structuredText ?? routine.sourceText ?? "") : undefined;
}

function scopedProgramPaths(owner: ProgramOwner): ScopedProgramPath[] {
  return owner.program.programTags.flatMap((tag) => {
    const local = tagValuePaths(owner.controller, tag, tag.name);
    const qualified = tagValuePaths(owner.controller, tag, programValuePath(owner.program, tag.name));
    return local.flatMap((localPath, index) => {
      const qualifiedPath = qualified[index];
      return qualifiedPath ? [{ localPath: localPath.path, qualifiedPath: qualifiedPath.path, type: localPath.type }] : [];
    });
  });
}

function pathTypeResolver(project: PlcProject, owner?: ProgramOwner): (path: string) => string | undefined {
  const types = new Map(allPaths(project).map(({ path, type }) => [path, type] as const));
  if (owner) {
    for (const { localPath, type } of scopedProgramPaths(owner)) types.set(localPath, type);
  }
  return (path) => types.get(path) ?? types.get(firstElementPath(path));
}

function firstElementPath(path: string): string {
  return path.replace(/\[([^\]]+)]/g, (_match, raw: string) => {
    const indices = raw.split(",").map(() => "0");
    return `[${indices.join(",")}]`;
  });
}

/**
 * Every value path the project tracks: atomic tag names, structured/UDT members,
 * and — for array tags or array members — one path per element.
 */
function allPaths(project: PlcProject): ValuePath[] {
  const paths: ValuePath[] = [];
  for (const controller of project.controllers) {
    for (const tag of controller.controllerTags) appendTagPaths(paths, controller, tag);
    for (const program of controller.programs) {
      for (const tag of program.programTags) appendTagPaths(paths, controller, tag, programValuePath(program, tag.name));
    }
  }
  return paths;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dynamicArrayOutputPattern(path: string): RegExp | undefined {
  let pattern = "^";
  let cursor = 0;
  let dynamic = false;
  const bracketPattern = /\[([^\]]+)]/g;
  let match: RegExpExecArray | null;
  while ((match = bracketPattern.exec(path)) !== null) {
    pattern += escapeRegExp(path.slice(cursor, match.index));
    const raw = match[1] ?? "";
    if (/^[0-9,\s]+$/.test(raw)) {
      pattern += escapeRegExp(`[${raw.replace(/\s+/g, "")}]`);
    } else {
      pattern += "\\[[0-9]+(?:,[0-9]+)*\\]";
      dynamic = true;
    }
    cursor = match.index + match[0].length;
  }
  pattern += escapeRegExp(path.slice(cursor));
  return dynamic ? new RegExp(`${pattern}$`) : undefined;
}

/** Power-up values: every tracked path at its zero (false / 0). */
export function defaultValues(project: PlcProject): TagValues {
  const values: TagValues = {};
  for (const { path, type } of allPaths(project)) values[path] = zeroFor(type);
  return values;
}

/** Tags written by the scheduled scan set (or a given routine) — its outputs. */
export function outputTags(project: PlcProject, routineId?: string): Set<string> {
  const outputs = new Set<string>();
  const valuePaths = allPaths(project).map(({ path }) => path);
  const addOutput = (path: string): void => {
    outputs.add(path);
    const dynamicPattern = dynamicArrayOutputPattern(path);
    if (dynamicPattern) {
      for (const valuePath of valuePaths) {
        if (dynamicPattern.test(valuePath)) outputs.add(valuePath);
      }
    }
  };
  const routineIds = routineId ? [routineId] : scanRoutineIds(project);
  for (const controller of project.controllers) {
    const aois = new Map(controller.addOnInstructions.map((aoi) => [aoi.name.toUpperCase(), aoi]));
    for (const id of routineIds) {
      const routine = findRoutine(project, id);
      if (!routine) continue;
      const ladder = getLadder(routine);
      const owner = controller.programs.find((program) => program.routines.some((candidate) => candidate.id === routine.id));
      if (!owner) continue;
      const localNames = new Set(owner.programTags.map((tag) => tag.name));
      const qualify = (path: string): string => {
        const base = path.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
        return base && localNames.has(base) ? programValuePath(owner, path) : path;
      };
      if (ladder) {
        for (const tag of collectOutputTags(ladder)) addOutput(qualify(tag));
        for (const node of routineNodes(ladder)) {
          const aoi = aois.get(node.instructionType.toUpperCase());
          const instance = node.operands[0]?.value.trim();
          if (!aoi || !instance) continue;
          for (const parameter of aoi.parameters) {
            const usage = (parameter.usage ?? "").toLowerCase();
            if (usage === "output" || usage === "inout") addOutput(qualify(`${instance}.${parameter.name}`));
          }
        }
      } else if (routine.language === "structured-text") {
        for (const tag of collectStructuredTextOutputTags(routine.structuredText ?? routine.sourceText ?? "")) addOutput(qualify(tag));
      }
    }
  }
  return outputs;
}

/**
 * Run one scan of a routine set, seeding the runtime with `values` and returning
 * the next values. With no explicit routine, imported task-scheduled programs'
 * main routines scan in task/program order; projects without task metadata fall
 * back to the first program's main routine. Does not mutate the project.
 */
function buildScanRuntime(project: PlcProject, values: TagValues, options: ScanOptions, routineId?: string) {
  const activeRoutineId = routineId ?? options.routineId ?? defaultRoutineId(project);
  const ladder = getLadder(findRoutine(project, activeRoutineId ?? ""));
  const routines = siblingRoutines(project, activeRoutineId ?? "");
  const tags = getAllTags(project).map((tag) => ({
    name: tag.name,
    dataType: tag.dataType,
    role: "internal" as const,
    initialValue: zeroFor(tag.dataType),
    ...(tag.dimension && tag.dimension > 0 ? { dimension: tag.dimension } : {}),
    ...(tag.dimensions?.length ? { dimensions: tag.dimensions } : {}),
  }));
  const aliases = aliasMap(project);
  const addOnInstructions = project.controllers.flatMap((controller) => controller.addOnInstructions);
  const runtime = createRuntime({ routine: ladder, routines, aliases, tags, addOnInstructions });
  const valueKeys = new Set(Object.keys(values));
  for (const [path, value] of Object.entries(values)) {
    if (!aliases.has(path)) runtime.writeTag(path, value);
  }
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      for (const { localPath, qualifiedPath } of scopedProgramPaths({ controller, program })) {
        if (values[qualifiedPath] == null && values[localPath] != null) {
          runtime.writeTag(qualifiedPath, values[localPath]!);
        }
      }
    }
  }
  for (const [path, value] of Object.entries(values)) {
    const target = aliases.get(path);
    if (target && !valueKeys.has(target)) runtime.writeTag(path, value);
  }
  // Forced values override logic: forceTag re-applies them before and after scan.
  for (const [path, value] of Object.entries(options.forces ?? {})) runtime.forceTag(path, value);
  return runtime;
}

function scanScopedRoutine(
  project: PlcProject,
  runtime: ReturnType<typeof buildScanRuntime>,
  routineId: string,
  forces: TagValues,
  trace?: TraceEntry[],
  deltaMs = SCAN_STEP_MS,
): void {
  const owner = routineOwner(project, routineId);
  const routine = findRoutine(project, routineId);
  const ladder = getLadder(routine);
  const structuredText = structuredTextSource(routine);
  if (!ladder && structuredText === undefined) return;
  const scoped = owner ? scopedProgramPaths(owner) : [];
  const backup = new Map(scoped.map(({ localPath }) => [localPath, runtime.readTag(localPath)] as const));
  const typeOfPath = pathTypeResolver(project, owner);
  const ladderSiblings = siblingRoutines(project, routineId);

  const executeStructuredRoutine = (
    source: string,
    inputParameters: string[] = [],
    depth = 0,
  ): string[] => {
    if (depth >= MAX_ST_ROUTINE_CALL_DEPTH) return [];
    const status = executeStructuredTextSource({
      source,
      memory: runtime.memory,
      typeOfPath,
      trace,
      inputParameters,
      deltaMs,
      arrayDimension: (source, dimension) => runtime.arrayDimension(source, dimension),
      callRoutine: (name, rawParameters, line) => {
        if (!owner) return;
        const target = routineByName(owner.program, name);
        if (!target) return;
        const targetLadder = getLadder(target);
        if (targetLadder) {
          runtime.loadRoutines(ladderSiblings);
          runtime.callRoutine(target.name, rawParameters, deltaMs, trace);
          return;
        }
        const targetSource = structuredTextSource(target);
        if (targetSource === undefined) return;
        const sbrOperands = collectStructuredTextSbrOperands(targetSource);
        const layout = parseJsrParameterLayout(rawParameters, sbrOperands.length);
        const returnParameters = executeStructuredRoutine(targetSource, layout.inputParameters, depth + 1);
        copyStructuredTextParameters(runtime.memory, returnParameters, layout.returnParameters, typeOfPath);
        if (trace && layout.returnParameters.length > 0) {
          trace.push({
            rung: line,
            instruction: "ST_JSR_RET",
            operands: [target.name, ...layout.returnParameters],
            conditionIn: true,
            conditionOut: true,
            writes: layout.returnParameters.map((path) => ({ path, value: runtime.readTag(path) })),
          });
        }
      },
    });
    return status.returnParameters;
  };

  for (const { localPath, qualifiedPath } of scoped) {
    const forced = Object.prototype.hasOwnProperty.call(forces, qualifiedPath);
    runtime.writeTag(localPath, forced ? forces[qualifiedPath]! : runtime.readTag(qualifiedPath));
  }

  if (ladder) {
    runtime.loadRoutines(siblingRoutines(project, routineId));
    runtime.loadRoutine(ladder);
    runtime.scanOnce(deltaMs, trace);
  } else if (structuredText !== undefined) {
    runtime.loadRoutines(ladderSiblings);
    if (routine) executeStructuredRoutine(structuredText);
    for (const [path, value] of Object.entries(forces)) runtime.writeTag(path, value);
  }

  for (const { localPath, qualifiedPath } of scoped) {
    const forced = Object.prototype.hasOwnProperty.call(forces, qualifiedPath);
    runtime.writeTag(qualifiedPath, forced ? forces[qualifiedPath]! : runtime.readTag(localPath));
  }
  for (const [localPath, value] of backup) {
    runtime.writeTag(localPath, value);
  }
}

function readBack(project: PlcProject, runtime: ReturnType<typeof buildScanRuntime>): TagValues {
  const next: TagValues = {};
  for (const { path, type } of allPaths(project)) {
    const value = runtime.readTag(path);
    next[path] =
      type === "BOOL" ? value === true : type === "STRING" ? String(value ?? "") : Number(value ?? 0);
  }
  for (const [path, value] of Object.entries(runtime.memory.snapshot())) {
    if (path.includes(".__esco")) next[path] = value;
  }
  return next;
}

export function scanProject(
  project: PlcProject,
  values: TagValues,
  options: ScanOptions = {},
): ProjectActionResult<{ values: TagValues }> {
  const routineIds = scanRoutineIds(project, options);
  const runtime = buildScanRuntime(project, values, options, routineIds[0]);
  for (const routineId of routineIds) {
    scanScopedRoutine(project, runtime, routineId, options.forces ?? {}, undefined, options.deltaMs ?? SCAN_STEP_MS);
  }
  return { ok: true, project, data: { values: readBack(project, runtime) }, findings: validate(project) };
}

export function scanScheduledProject(
  project: PlcProject,
  values: TagValues,
  options: ScheduledScanOptions = {},
): ProjectActionResult<ScheduledScanData> {
  if (options.routineId) {
    const result = scanProject(project, values, options);
    return {
      ok: result.ok,
      project,
      data: {
        values: result.data?.values ?? values,
        schedulerState: options.schedulerState ?? createOfflineTaskSchedulerState(),
        scannedTaskKeys: [],
        heldEventTaskKeys: [],
        triggeredEventTaskKeys: [],
      },
      findings: result.findings,
      warnings: result.warnings,
      error: result.error,
    };
  }

  const scanSet = selectOfflineTaskScanSet(
    project,
    options.schedulerState ?? createOfflineTaskSchedulerState(),
    options.deltaMs ?? SCAN_STEP_MS,
    options.simulatedEventTaskTriggers ?? [],
  );
  if (scanSet.routineIds.length === 0) {
    return {
      ok: true,
      project,
      data: {
        values,
        schedulerState: scanSet.state,
        scannedTaskKeys: scanSet.scannedTaskKeys,
        heldEventTaskKeys: scanSet.heldEventTaskKeys,
        triggeredEventTaskKeys: scanSet.triggeredEventTaskKeys,
      },
      findings: validate(project),
    };
  }

  const runtime = buildScanRuntime(project, values, options, scanSet.routineIds[0]);
  for (const routineId of scanSet.routineIds) {
    scanScopedRoutine(project, runtime, routineId, options.forces ?? {}, undefined, options.deltaMs ?? SCAN_STEP_MS);
  }
  return {
    ok: true,
    project,
    data: {
      values: readBack(project, runtime),
      schedulerState: scanSet.state,
      scannedTaskKeys: scanSet.scannedTaskKeys,
      heldEventTaskKeys: scanSet.heldEventTaskKeys,
      triggeredEventTaskKeys: scanSet.triggeredEventTaskKeys,
    },
    findings: validate(project),
  };
}

/** Run one scan and capture a per-instruction execution trace (for the debugger). */
export function traceScan(
  project: PlcProject,
  values: TagValues,
  options: ScanOptions = {},
): { values: TagValues; trace: TraceEntry[] } {
  const routineIds = scanRoutineIds(project, options);
  const runtime = buildScanRuntime(project, values, options, routineIds[0]);
  const trace: TraceEntry[] = [];
  for (const routineId of routineIds) {
    scanScopedRoutine(project, runtime, routineId, options.forces ?? {}, trace, options.deltaMs ?? SCAN_STEP_MS);
  }
  return { values: readBack(project, runtime), trace };
}

/** Run one scheduled offline scan and capture a per-instruction execution trace. */
export function traceScheduledProject(
  project: PlcProject,
  values: TagValues,
  options: ScheduledScanOptions = {},
): ScheduledTraceData {
  if (options.routineId) {
    const result = traceScan(project, values, options);
    return {
      ...result,
    schedulerState: options.schedulerState ?? createOfflineTaskSchedulerState(),
    scannedTaskKeys: [],
    heldEventTaskKeys: [],
    triggeredEventTaskKeys: [],
  };
  }

  const scanSet = selectOfflineTaskScanSet(
    project,
    options.schedulerState ?? createOfflineTaskSchedulerState(),
    options.deltaMs ?? SCAN_STEP_MS,
    options.simulatedEventTaskTriggers ?? [],
  );
  if (scanSet.routineIds.length === 0) {
    return {
      values,
      trace: [],
      schedulerState: scanSet.state,
      scannedTaskKeys: scanSet.scannedTaskKeys,
      heldEventTaskKeys: scanSet.heldEventTaskKeys,
      triggeredEventTaskKeys: scanSet.triggeredEventTaskKeys,
    };
  }

  const runtime = buildScanRuntime(project, values, options, scanSet.routineIds[0]);
  const trace: TraceEntry[] = [];
  for (const routineId of scanSet.routineIds) {
    scanScopedRoutine(project, runtime, routineId, options.forces ?? {}, trace, options.deltaMs ?? SCAN_STEP_MS);
  }
  return {
    values: readBack(project, runtime),
    trace,
    schedulerState: scanSet.state,
    scannedTaskKeys: scanSet.scannedTaskKeys,
    heldEventTaskKeys: scanSet.heldEventTaskKeys,
    triggeredEventTaskKeys: scanSet.triggeredEventTaskKeys,
  };
}
