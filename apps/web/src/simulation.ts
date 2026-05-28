import { arrayElementNames, isStructuredType, memberDefs, type PlcProject } from "@esco/core";
import {
  defaultValues,
  outputTags,
  scanProject,
  traceScan,
  type TagValues,
} from "@esco/project-actions";
import type { TraceEntry } from "@esco/simulator";
import { getTags } from "./project-edit";

export type { TagValues, TraceEntry };

/** Forced tag values that override logic during a scan. */
export type Forces = Record<string, boolean | number>;

export interface WatchMember {
  name: string;
  type: "BOOL" | "DINT";
  value: boolean | number;
}

export interface WatchRow {
  name: string;
  dataType: string;
  role: "input" | "output";
  kind: "bool" | "number" | "struct";
  value?: boolean | number;
  members?: WatchMember[];
}

/** Power-up values for the project (delegates to the action layer). */
export function zeroValues(project: PlcProject): TagValues {
  return defaultValues(project);
}

/** Run one scan via the action layer, returning the next tag values. */
export function scanOnce(
  project: PlcProject,
  values: TagValues,
  forces: Forces = {},
  deltaMs?: number,
): TagValues {
  const result = scanProject(project, values, { forces, ...(deltaMs != null ? { deltaMs } : {}) });
  return result.data?.values ?? values;
}

/** Run one scan and also capture a per-instruction execution trace. */
export function traceOnce(
  project: PlcProject,
  values: TagValues,
  forces: Forces = {},
  deltaMs?: number,
): { values: TagValues; trace: TraceEntry[] } {
  return traceScan(project, values, { forces, ...(deltaMs != null ? { deltaMs } : {}) });
}

/** One Watch row for an atomic path (tag name or array element). */
function atomicRow(
  path: string,
  dataType: string,
  role: WatchRow["role"],
  values: TagValues,
): WatchRow {
  if (dataType === "BOOL") {
    return { name: path, dataType, role, kind: "bool", value: values[path] === true };
  }
  return { name: path, dataType, role, kind: "number", value: Number(values[path] ?? 0) };
}

/** Rows for the Watch panel: every tag with its role and current value(s). */
export function watchRows(project: PlcProject, values: TagValues): WatchRow[] {
  const outputs = outputTags(project);
  const roleOf = (path: string): WatchRow["role"] => (outputs.has(path) ? "output" : "input");
  const rows: WatchRow[] = [];

  for (const tag of getTags(project)) {
    if (tag.dimension && tag.dimension > 0 && !isStructuredType(tag.dataType)) {
      // One row per array element so each can be watched/edited.
      for (const element of arrayElementNames(tag.name, tag.dimension)) {
        rows.push(atomicRow(element, tag.dataType, roleOf(element), values));
      }
    } else if (isStructuredType(tag.dataType)) {
      rows.push({
        name: tag.name,
        dataType: tag.dataType,
        role: roleOf(tag.name),
        kind: "struct",
        members: memberDefs(tag.dataType).map((member) => ({
          name: member.name,
          type: member.type,
          value: values[`${tag.name}.${member.name}`] ?? (member.type === "BOOL" ? false : 0),
        })),
      });
    } else {
      rows.push(atomicRow(tag.name, tag.dataType, roleOf(tag.name), values));
    }
  }
  return rows;
}
