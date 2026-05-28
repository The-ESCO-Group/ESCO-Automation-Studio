import type { PlcProject } from "@esco/core";
import { createDefaultRegistry } from "@esco/instructions";
import { collectOutputTags, createRuntime, type TagDescriptor } from "@esco/simulator";
import { getBoolTags, getMainLadder } from "./project-edit";

// One shared registry for all simulation in the app.
const registry = createDefaultRegistry();

export type TagValues = Record<string, boolean>;

export interface WatchRow {
  name: string;
  dataType: string;
  role: "input" | "output";
  value: boolean;
}

/** Power-up values: every BOOL tag at false. */
export function zeroValues(project: PlcProject): TagValues {
  const values: TagValues = {};
  for (const tag of getBoolTags(project)) {
    values[tag.name] = false;
  }
  return values;
}

function outputsOf(project: PlcProject): Set<string> {
  const ladder = getMainLadder(project);
  return ladder ? collectOutputTags(ladder, registry) : new Set<string>();
}

/** Rows for the Watch panel: every BOOL tag with its role and current value. */
export function watchRows(project: PlcProject, values: TagValues): WatchRow[] {
  const outputs = outputsOf(project);
  return getBoolTags(project).map((tag) => ({
    name: tag.name,
    dataType: tag.dataType,
    role: outputs.has(tag.name) ? "output" : "input",
    value: values[tag.name] === true,
  }));
}

/**
 * Run one scan of the currently edited main routine: build a runtime for the
 * current ladder + BOOL tags, seed it with the live values, scan once, and
 * return the resulting values.
 */
export function scanOnce(project: PlcProject, values: TagValues): TagValues {
  const ladder = getMainLadder(project);
  const boolTags = getBoolTags(project);
  const outputs = outputsOf(project);

  const tags: TagDescriptor[] = boolTags.map((tag) => ({
    name: tag.name,
    dataType: "BOOL",
    role: outputs.has(tag.name) ? "output" : "input",
    initialValue: false,
  }));

  const runtime = createRuntime({ routine: ladder, tags, registry });
  for (const tag of boolTags) {
    runtime.writeTag(tag.name, values[tag.name] === true);
  }
  runtime.scanOnce();

  const next: TagValues = {};
  for (const tag of boolTags) {
    next[tag.name] = runtime.readTag(tag.name) === true;
  }
  return next;
}
