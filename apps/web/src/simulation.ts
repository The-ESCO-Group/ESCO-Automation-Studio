import { isStructuredType, memberDefs, type PlcProject } from "@esco/core";
import {
  defaultValues,
  outputTags,
  scanProject,
  type TagValues,
} from "@esco/project-actions";
import { getTags } from "./project-edit";

export type { TagValues };

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
export function scanOnce(project: PlcProject, values: TagValues, deltaMs?: number): TagValues {
  const result = scanProject(project, values, deltaMs != null ? { deltaMs } : {});
  return result.data?.values ?? values;
}

/** Rows for the Watch panel: every tag with its role and current value(s). */
export function watchRows(project: PlcProject, values: TagValues): WatchRow[] {
  const outputs = outputTags(project);
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
          value: values[`${tag.name}.${member.name}`] ?? (member.type === "BOOL" ? false : 0),
        })),
      };
    }
    if (tag.dataType === "BOOL") {
      return { name: tag.name, dataType: tag.dataType, role, kind: "bool", value: values[tag.name] === true };
    }
    return { name: tag.name, dataType: tag.dataType, role, kind: "number", value: Number(values[tag.name] ?? 0) };
  });
}
