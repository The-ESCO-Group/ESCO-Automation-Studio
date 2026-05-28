import { arrayElementNames, isStructuredType, memberDefs, type PlcProject } from "@esco/core";
import { collectOutputTags, createRuntime } from "@esco/simulator";
import { defaultRoutineId, findRoutine, getAllTags, getLadder, validate } from "./helpers";
import type { ProjectActionResult, ScanOptions } from "./types";

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
export function scanProject(
  project: PlcProject,
  values: TagValues,
  options: ScanOptions = {},
): ProjectActionResult<{ values: TagValues }> {
  const routineId = options.routineId ?? defaultRoutineId(project);
  const ladder = getLadder(findRoutine(project, routineId ?? ""));
  const runtime = createRuntime({ routine: ladder, tags: [] });

  for (const [path, value] of Object.entries(values)) {
    runtime.writeTag(path, value);
  }
  runtime.scanOnce(options.deltaMs ?? SCAN_STEP_MS);

  const next: TagValues = {};
  for (const { path, type } of allPaths(project)) {
    const value = runtime.readTag(path);
    next[path] = type === "BOOL" ? value === true : Number(value ?? 0);
  }

  return { ok: true, project, data: { values: next }, findings: validate(project) };
}
