import {
  isStructuredType,
  memberDefs,
  type PlcProject,
  type StructMember,
} from "@esco/core";
import { createDefaultRegistry } from "@esco/instructions";
import { collectOutputTags, createRuntime } from "@esco/simulator";
import { getMainLadder, getTags } from "./project-edit";

// One shared registry for all simulation in the app.
const registry = createDefaultRegistry();

/** Default per-scan time step (ms) for the timer model. */
export const SCAN_STEP_MS = 250;

export type PlcValue = boolean | number;
export type TagValues = Record<string, PlcValue>;

export interface WatchMember {
  name: string;
  type: "BOOL" | "DINT";
  value: PlcValue;
}

export interface WatchRow {
  name: string;
  dataType: string;
  role: "input" | "output";
  kind: "bool" | "number" | "struct";
  value?: PlcValue;
  members?: WatchMember[];
}

function memberPath(tag: string, member: StructMember): string {
  return `${tag}.${member.name}`;
}

function zeroFor(type: "BOOL" | "DINT" | string): PlcValue {
  return type === "BOOL" ? false : 0;
}

/** Every value path the project tracks: atomic tag names + structured members. */
function allPaths(project: PlcProject): { path: string; type: string }[] {
  const paths: { path: string; type: string }[] = [];
  for (const tag of getTags(project)) {
    if (isStructuredType(tag.dataType)) {
      for (const member of memberDefs(tag.dataType)) {
        paths.push({ path: memberPath(tag.name, member), type: member.type });
      }
    } else {
      paths.push({ path: tag.name, type: tag.dataType });
    }
  }
  return paths;
}

/** Power-up values: every tracked path at its zero (false / 0). */
export function zeroValues(project: PlcProject): TagValues {
  const values: TagValues = {};
  for (const { path, type } of allPaths(project)) {
    values[path] = zeroFor(type);
  }
  return values;
}

function outputsOf(project: PlcProject): Set<string> {
  const ladder = getMainLadder(project);
  return ladder ? collectOutputTags(ladder, registry) : new Set<string>();
}

/** Rows for the Watch panel: every tag with its role and current value(s). */
export function watchRows(project: PlcProject, values: TagValues): WatchRow[] {
  const outputs = outputsOf(project);
  return getTags(project).map((tag) => {
    const role: WatchRow["role"] = outputs.has(tag.name) ? "output" : "input";
    if (isStructuredType(tag.dataType)) {
      return {
        name: tag.name,
        dataType: tag.dataType,
        role,
        kind: "struct",
        members: memberDefs(tag.dataType).map((member) => ({
          name: member.name,
          type: member.type,
          value: values[memberPath(tag.name, member)] ?? zeroFor(member.type),
        })),
      };
    }
    if (tag.dataType === "BOOL") {
      return { name: tag.name, dataType: tag.dataType, role, kind: "bool", value: values[tag.name] === true };
    }
    return { name: tag.name, dataType: tag.dataType, role, kind: "number", value: Number(values[tag.name] ?? 0) };
  });
}

/**
 * Run one scan of the currently edited main routine: build a runtime for the
 * current ladder, seed it with the live values, scan once (advancing the timer
 * model by `deltaMs`), and return the resulting values for every tracked path.
 */
export function scanOnce(
  project: PlcProject,
  values: TagValues,
  deltaMs = SCAN_STEP_MS,
): TagValues {
  const ladder = getMainLadder(project);
  const runtime = createRuntime({ routine: ladder, tags: [], registry });

  for (const [path, value] of Object.entries(values)) {
    runtime.writeTag(path, value);
  }
  runtime.scanOnce(deltaMs);

  const next: TagValues = {};
  for (const { path, type } of allPaths(project)) {
    const value = runtime.readTag(path);
    next[path] = type === "BOOL" ? value === true : Number(value ?? 0);
  }
  return next;
}
