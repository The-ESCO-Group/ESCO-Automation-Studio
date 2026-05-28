import { arrayElementNames, isStructuredType, memberDefs, type PlcProject } from "@esco/core";
import { baseTagName } from "@esco/instructions";
import type { LadderRoutine } from "@esco/ladder";
import { collectOutputTags, createRuntime, type TraceEntry } from "@esco/simulator";
import { defaultRoutineId, findRoutine, getAllTags, getLadder, validate } from "./helpers";
import type { ProjectActionResult, ScanOptions } from "./types";

/** Alias tag name → base tag name, for the simulator to resolve reads/writes. */
function aliasMap(project: PlcProject): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const tag of getAllTags(project)) {
    if (tag.aliasFor) aliases.set(tag.name, baseTagName(tag.aliasFor));
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

/** Default per-scan time step (ms) for the timer model. */
export const SCAN_STEP_MS = 250;

export type TagValues = Record<string, boolean | number>;

const zeroFor = (type: string): boolean | number => (type === "BOOL" ? false : 0);

/**
 * Every value path the project tracks: atomic tag names, structured members,
 * and — for array tags — one path per element (`Name[0]`…`Name[n-1]`).
 */
function allPaths(project: PlcProject): { path: string; type: string }[] {
  const paths: { path: string; type: string }[] = [];
  for (const tag of getAllTags(project)) {
    if (tag.dimension && tag.dimension > 0 && !isStructuredType(tag.dataType)) {
      for (const element of arrayElementNames(tag.name, tag.dimension)) {
        paths.push({ path: element, type: tag.dataType });
      }
    } else if (isStructuredType(tag.dataType)) {
      for (const member of memberDefs(tag.dataType)) {
        paths.push({ path: `${tag.name}.${member.name}`, type: member.type });
      }
    } else {
      paths.push({ path: tag.name, type: tag.dataType });
    }
  }
  return paths;
}

/** Power-up values: every tracked path at its zero (false / 0). */
export function defaultValues(project: PlcProject): TagValues {
  const values: TagValues = {};
  for (const { path, type } of allPaths(project)) values[path] = zeroFor(type);
  return values;
}

/** Tags written by the (default or given) routine — its outputs. */
export function outputTags(project: PlcProject, routineId?: string): Set<string> {
  const ladder = getLadder(findRoutine(project, routineId ?? defaultRoutineId(project) ?? ""));
  return ladder ? collectOutputTags(ladder) : new Set<string>();
}

/**
 * Run one scan of a routine (the first program's main routine by default),
 * seeding the runtime with `values` and returning the next values. Does not
 * mutate the project.
 */
function buildScanRuntime(project: PlcProject, values: TagValues, options: ScanOptions) {
  const routineId = options.routineId ?? defaultRoutineId(project);
  const ladder = getLadder(findRoutine(project, routineId ?? ""));
  const routines = siblingRoutines(project, routineId ?? "");
  const runtime = createRuntime({ routine: ladder, routines, aliases: aliasMap(project), tags: [] });
  for (const [path, value] of Object.entries(values)) runtime.writeTag(path, value);
  // Forced values override logic: forceTag re-applies them before and after scan.
  for (const [path, value] of Object.entries(options.forces ?? {})) runtime.forceTag(path, value);
  return runtime;
}

function readBack(project: PlcProject, runtime: ReturnType<typeof buildScanRuntime>): TagValues {
  const next: TagValues = {};
  for (const { path, type } of allPaths(project)) {
    const value = runtime.readTag(path);
    next[path] = type === "BOOL" ? value === true : Number(value ?? 0);
  }
  return next;
}

export function scanProject(
  project: PlcProject,
  values: TagValues,
  options: ScanOptions = {},
): ProjectActionResult<{ values: TagValues }> {
  const runtime = buildScanRuntime(project, values, options);
  runtime.scanOnce(options.deltaMs ?? SCAN_STEP_MS);
  return { ok: true, project, data: { values: readBack(project, runtime) }, findings: validate(project) };
}

/** Run one scan and capture a per-instruction execution trace (for the debugger). */
export function traceScan(
  project: PlcProject,
  values: TagValues,
  options: ScanOptions = {},
): { values: TagValues; trace: TraceEntry[] } {
  const runtime = buildScanRuntime(project, values, options);
  const trace: TraceEntry[] = [];
  runtime.scanOnce(options.deltaMs ?? SCAN_STEP_MS, trace);
  return { values: readBack(project, runtime), trace };
}
