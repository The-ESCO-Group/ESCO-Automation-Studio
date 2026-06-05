import { arrayDimensionsOf, arrayElementNames, isStructuredType, memberDefs, type Controller, type PlcProject, type Tag } from "@esco/core";
import {
  defaultValues,
  outputTags,
  scanScheduledProject,
  scanProject,
  traceScan,
  type OfflineTaskSchedulerState,
  type TagValues,
} from "@esco/project-actions";
import type { TraceEntry } from "@esco/simulator";
export type { TagValues, TraceEntry };

/** Forced tag values that override logic during a scan. */
export type Forces = Record<string, boolean | number | string>;

export interface WatchMember {
  name: string;
  type: "BOOL" | "DINT" | "REAL" | "STRING";
  value: boolean | number | string;
}

export interface WatchRow {
  name: string;
  dataType: string;
  role: "input" | "output";
  kind: "bool" | "number" | "string" | "struct";
  value?: boolean | number | string;
  members?: WatchMember[];
}

export interface TrendSample {
  id: number;
  at: string;
  values: Record<string, boolean | number | string>;
}

export interface ScheduledScanOnceResult {
  values: TagValues;
  schedulerState: OfflineTaskSchedulerState;
  scannedTaskKeys: string[];
  heldEventTaskKeys: string[];
  triggeredEventTaskKeys: string[];
}

export type MonitorValueKind = "bool" | "number" | "string" | "aggregate";

export interface MonitorTagValue {
  path: string;
  kind: MonitorValueKind;
  display: string;
  value?: boolean | number | string;
}

const TREND_ROW_LIMIT = 32;
const MONITOR_PREVIEW_LIMIT = 8;
let nextTrendId = 1;

type WatchMemberDef = { name: string; type: string; dimension?: number; dimensions?: number[] };

function programValuePath(programName: string, localPath: string): string {
  return `Program:${programName}.${localPath}`;
}

function owningProgramName(project: PlcProject, tag: Tag): string | undefined {
  if (tag.scope !== "program" || !tag.programId) return undefined;
  for (const controller of project.controllers) {
    const program = controller.programs.find((candidate) => candidate.id === tag.programId);
    if (program) return program.name;
  }
  return undefined;
}

function tagValuePath(project: PlcProject, tag: Tag): string {
  const programName = owningProgramName(project, tag);
  return programName ? programValuePath(programName, tag.name) : tag.name;
}

function controllerForTag(project: PlcProject, tag: Tag): Controller | undefined {
  return project.controllers.find((controller) => controller.id === tag.controllerId) ?? project.controllers[0];
}

function scalarKind(dataType: string): Exclude<MonitorValueKind, "aggregate"> {
  if (dataType === "BOOL") return "bool";
  if (dataType === "STRING") return "string";
  return "number";
}

function scalarValue(dataType: string, path: string, values: TagValues): boolean | number | string {
  if (dataType === "BOOL") return values[path] === true;
  if (dataType === "STRING") return String(values[path] ?? "");
  return Number(values[path] ?? 0);
}

function scalarDisplay(dataType: string, path: string, values: TagValues): string {
  const value = scalarValue(dataType, path, values);
  return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}

function memberDisplay(controller: Controller, path: string, dataType: string, values: TagValues): string {
  const members = membersFor(controller, dataType);
  if (!members?.length) return scalarDisplay(dataType, path, values);
  const shown = members.slice(0, 4).map((member) => {
    const memberPath = `${path}.${member.name}`;
    const memberDimensions = arrayDimensionsOf(member);
    if (memberDimensions.length > 0) {
      const first = arrayElementNames(memberPath, memberDimensions)[0];
      return `${member.name}=[${first ? scalarDisplay(member.type, first, values) : ""}]`;
    }
    return `${member.name}=${scalarDisplay(member.type, memberPath, values)}`;
  });
  return `${shown.join(", ")}${members.length > shown.length ? ", ..." : ""}`;
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

export function scheduledScanOnce(
  project: PlcProject,
  values: TagValues,
  schedulerState: OfflineTaskSchedulerState,
  forces: Forces = {},
  deltaMs?: number,
  simulatedEventTaskTriggers: readonly string[] = [],
): ScheduledScanOnceResult {
  const result = scanScheduledProject(project, values, {
    schedulerState,
    forces,
    ...(deltaMs != null ? { deltaMs } : {}),
    ...(simulatedEventTaskTriggers.length ? { simulatedEventTaskTriggers } : {}),
  });
  return {
    values: result.data?.values ?? values,
    schedulerState: result.data?.schedulerState ?? schedulerState,
    scannedTaskKeys: result.data?.scannedTaskKeys ?? [],
    heldEventTaskKeys: result.data?.heldEventTaskKeys ?? [],
    triggeredEventTaskKeys: result.data?.triggeredEventTaskKeys ?? [],
  };
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

/** Studio-style tag monitor value for one declared tag row. */
export function monitorTagValue(project: PlcProject, values: TagValues, tag: Tag): MonitorTagValue {
  const path = tagValuePath(project, tag);
  const controller = controllerForTag(project, tag);
  const dimensions = arrayDimensionsOf(tag);
  const members = controller ? membersFor(controller, tag.dataType) : undefined;

  if (dimensions.length > 0) {
    const capped = dimensions.map((dimension) => Math.min(dimension, MONITOR_PREVIEW_LIMIT));
    const total = dimensions.reduce((product, dimension) => product * dimension, 1);
    const preview = arrayElementNames(path, capped).slice(0, MONITOR_PREVIEW_LIMIT).map((element) =>
      members && controller
        ? `{${memberDisplay(controller, element, tag.dataType, values)}}`
        : scalarDisplay(tag.dataType, element, values),
    );
    return {
      path,
      kind: "aggregate",
      display: `[${preview.join(", ")}${total > MONITOR_PREVIEW_LIMIT ? ", ..." : ""}]`,
    };
  }

  if (members && controller) {
    return { path, kind: "aggregate", display: memberDisplay(controller, path, tag.dataType, values) };
  }

  const value = scalarValue(tag.dataType, path, values);
  return {
    path,
    kind: scalarKind(tag.dataType),
    value,
    display: typeof value === "boolean" ? (value ? "true" : "false") : String(value),
  };
}

export function coerceMonitorWriteValue(dataType: string, raw: string): boolean | number | string | undefined {
  if (dataType === "BOOL") {
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "on"].includes(normalized)) return true;
    if (["0", "false", "off"].includes(normalized)) return false;
    return undefined;
  }
  if (dataType === "STRING") return raw;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
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
  if (dataType === "STRING") {
    return { name: path, dataType, role, kind: "string", value: String(values[path] ?? "") };
  }
  return { name: path, dataType, role, kind: "number", value: Number(values[path] ?? 0) };
}

function watchMemberType(dataType: string): WatchMember["type"] {
  return dataType === "BOOL" || dataType === "REAL" || dataType === "STRING" ? dataType : "DINT";
}

function watchMemberValue(dataType: string, path: string, values: TagValues): WatchMember["value"] {
  if (dataType === "BOOL") return values[path] === true;
  if (dataType === "STRING") return String(values[path] ?? "");
  return Number(values[path] ?? 0);
}

function membersFor(controller: Controller, dataType: string): WatchMemberDef[] | undefined {
  if (isStructuredType(dataType)) {
    return memberDefs(dataType).map((member) => ({ name: member.name, type: member.type }));
  }
  const udt = controller.dataTypes.find((candidate) => candidate.name === dataType);
  return udt?.members.map((member) => ({
    name: member.name,
    type: member.dataType,
    ...(member.dimension && member.dimension > 0 ? { dimension: member.dimension } : {}),
    ...(member.dimensions?.length ? { dimensions: member.dimensions } : {}),
  }));
}

function appendWatchMembers(
  out: WatchMember[],
  controller: Controller,
  displayName: string,
  path: string,
  dataType: string,
  values: TagValues,
  dimensions?: number | readonly number[],
  seen: Set<string> = new Set(),
): void {
  const elementNames = dimensions ? arrayElementNames(path, dimensions) : [];
  if (elementNames.length > 0) {
    const displayNames = dimensions ? arrayElementNames(displayName, dimensions) : [];
    for (let index = 0; index < elementNames.length; index += 1) {
      appendWatchMembers(
        out,
        controller,
        displayNames[index] ?? elementNames[index]!,
        elementNames[index]!,
        dataType,
        values,
        undefined,
        seen,
      );
    }
    return;
  }

  const members = membersFor(controller, dataType);
  if (!members || seen.has(dataType)) {
    out.push({
      name: displayName,
      type: watchMemberType(dataType),
      value: watchMemberValue(dataType, path, values),
    });
    return;
  }

  const nested = new Set(seen);
  nested.add(dataType);
  for (const member of members) {
    appendWatchMembers(
      out,
      controller,
      `${displayName}.${member.name}`,
      `${path}.${member.name}`,
      member.type,
      values,
      arrayDimensionsOf(member),
      nested,
    );
  }
}

function structRow(
  controller: Controller,
  name: string,
  dataType: string,
  role: WatchRow["role"],
  values: TagValues,
): WatchRow {
  const members: WatchMember[] = [];
  for (const member of membersFor(controller, dataType) ?? []) {
    appendWatchMembers(
      members,
      controller,
      member.name,
      `${name}.${member.name}`,
      member.type,
      values,
      arrayDimensionsOf(member),
    );
  }
  return { name, dataType, role, kind: "struct", members };
}

/** Rows for the Watch panel: every tag with its role and current value(s). */
export function watchRows(project: PlcProject, values: TagValues): WatchRow[] {
  const outputs = outputTags(project);
  const roleOf = (path: string): WatchRow["role"] => (outputs.has(path) ? "output" : "input");
  const rows: WatchRow[] = [];

  for (const controller of project.controllers) {
    const appendTag = (tag: (typeof controller.controllerTags)[number], basePath: string): void => {
      const members = membersFor(controller, tag.dataType);
      const dimensions = arrayDimensionsOf(tag);
      if (dimensions.length > 0 && !members) {
        // One row per array element so each can be watched/edited.
        for (const element of arrayElementNames(basePath, dimensions)) {
          rows.push(atomicRow(element, tag.dataType, roleOf(element), values));
        }
      } else if (dimensions.length > 0 && members) {
        for (const element of arrayElementNames(basePath, dimensions)) {
          rows.push(structRow(controller, element, tag.dataType, roleOf(element), values));
        }
      } else if (members) {
        rows.push(structRow(controller, basePath, tag.dataType, roleOf(basePath), values));
      } else {
        rows.push(atomicRow(basePath, tag.dataType, roleOf(basePath), values));
      }
    };

    for (const tag of controller.controllerTags) {
      appendTag(tag, tag.name);
    }
    for (const program of controller.programs) {
      for (const tag of program.programTags) {
        appendTag(tag, programValuePath(program.name, tag.name));
      }
    }
  }
  return rows;
}

/** Capture an in-session trend row from the rendered watch rows. */
export function createTrendSample(rows: WatchRow[]): TrendSample {
  const values: TrendSample["values"] = {};
  for (const row of rows.slice(0, TREND_ROW_LIMIT)) {
    if (row.kind === "struct") {
      values[row.name] =
        row.members?.map((member) => `${member.name}=${String(member.value)}`).join(" · ") ?? "";
    } else {
      values[row.name] = row.value ?? (row.kind === "bool" ? false : 0);
    }
  }
  return { id: nextTrendId++, at: new Date().toISOString(), values };
}
