import type {
  AddOnInstruction,
  IoModule,
  IoPort,
  ModuleConnection,
  PlcProject,
  Program,
  Tag,
  Task,
  UserDefinedType,
} from "@esco/core";
import { arrayDimensionSuffix } from "@esco/core";

/**
 * Non-logic structure comparison: tasks, programs, tags, data types (UDTs),
 * Add-On Instruction definitions, and I/O modules — i.e. the Controller
 * Organizer tree. Each category is diffed by name into added / removed /
 * changed, with a human-readable list of what changed. Pure and offline.
 */

export interface NamedChange {
  name: string;
  details: string[];
}

export interface NamedDiff {
  /** Names present only in the comparison (right) project. */
  added: string[];
  /** Names present only in the current (left) project. */
  removed: string[];
  /** Names present in both but differing, with field-level details. */
  changed: NamedChange[];
  /** Count of names present in both and identical. */
  unchanged: number;
}

export interface StructureComparison {
  tasks: NamedDiff;
  programs: NamedDiff;
  tags: NamedDiff;
  dataTypes: NamedDiff;
  addOnInstructions: NamedDiff;
  modules: NamedDiff;
}

function diffByName<T>(
  left: T[],
  right: T[],
  nameOf: (item: T) => string,
  describe: (a: T, b: T) => string[],
): NamedDiff {
  const leftMap = new Map(left.map((item) => [nameOf(item), item]));
  const rightMap = new Map(right.map((item) => [nameOf(item), item]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: NamedChange[] = [];
  let unchanged = 0;

  for (const [name, a] of leftMap) {
    const b = rightMap.get(name);
    if (!b) {
      removed.push(name);
      continue;
    }
    const details = describe(a, b);
    if (details.length > 0) changed.push({ name, details });
    else unchanged += 1;
  }
  for (const name of rightMap.keys()) {
    if (!leftMap.has(name)) added.push(name);
  }

  added.sort();
  removed.sort();
  changed.sort((x, y) => x.name.localeCompare(y.name));
  return { added, removed, changed, unchanged };
}

/** Field comparator that records "label: a → b" when two values differ. */
function fieldDiff(): { cmp: (label: string, a: unknown, b: unknown) => void; details: string[] } {
  const details: string[] = [];
  return {
    details,
    cmp(label, a, b) {
      const sa = a === undefined || a === null ? "" : String(a);
      const sb = b === undefined || b === null ? "" : String(b);
      if (sa !== sb) details.push(`${label}: ${sa || "—"} → ${sb || "—"}`);
    },
  };
}

/** Flatten a consumed tag's producer binding into a comparable string. */
const consumeSignature = (tag: Tag): string => {
  const c = tag.consumeInfo;
  if (!c) return "";
  return [c.producer, c.remoteTag, c.remoteInstance, c.rpi].map((v) => v ?? "").join("|");
};

function describeTag(a: Tag, b: Tag): string[] {
  const { cmp, details } = fieldDiff();
  cmp("type", a.dataType, b.dataType);
  cmp("dimensions", arrayDimensionSuffix(a), arrayDimensionSuffix(b));
  cmp("scope", a.scope, b.scope);
  cmp("alias", a.aliasFor, b.aliasFor);
  cmp("constant", a.constant, b.constant);
  cmp("produced", a.produced, b.produced);
  cmp("consumed", a.consumed, b.consumed);
  cmp("producer", consumeSignature(a), consumeSignature(b));
  cmp("description", a.description, b.description);
  return details;
}

const memberSignature = (udt: UserDefinedType): string =>
  udt.members.map((m) => `${m.name}:${m.dataType}${arrayDimensionSuffix(m)}`).join(",");

function describeUdt(a: UserDefinedType, b: UserDefinedType): string[] {
  const { cmp, details } = fieldDiff();
  cmp("members", memberSignature(a), memberSignature(b));
  cmp("description", a.description, b.description);
  return details;
}

const paramSignature = (aoi: AddOnInstruction): string =>
  aoi.parameters.map((p) => `${p.name}:${p.usage ?? ""}`).join(",");

const localTagSignature = (aoi: AddOnInstruction): string =>
  aoi.localTags.map((t) => `${t.name}:${t.dataType}${arrayDimensionSuffix(t)}`).join(",");

function describeAoi(a: AddOnInstruction, b: AddOnInstruction): string[] {
  const { cmp, details } = fieldDiff();
  cmp("revision", a.revision, b.revision);
  cmp("signature", a.signature, b.signature);
  cmp("protected", Boolean(a.protected), Boolean(b.protected));
  cmp("parameters", paramSignature(a), paramSignature(b));
  cmp("localTags", localTagSignature(a), localTagSignature(b));
  cmp("routines", a.routineNames.join(","), b.routineNames.join(","));
  return details;
}

interface ProfileChannel {
  id?: string;
  label?: string;
  direction?: string;
  signal?: string;
  enabled?: boolean;
  dataFormat?: string;
  range?: string;
  diagnostic?: string;
}

function clean(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

const portSignature = (ports: readonly IoPort[] | undefined): string =>
  (ports ?? [])
    .map((port, index) =>
      [
        port.id || `#${index}`,
        clean(port.type),
        clean(port.address),
        port.upstream === true ? "upstream" : "",
        clean(port.busSize),
      ].join(":"),
    )
    .sort()
    .join(",");

const connectionSignature = (connections: readonly ModuleConnection[] | undefined): string =>
  (connections ?? [])
    .map((connection, index) =>
      [
        connection.name || `#${index}`,
        clean(connection.type),
        clean(connection.rpi),
        clean(connection.priority),
        connection.unicast === true ? "unicast" : "",
        clean(connection.inputConnectionType),
        clean(connection.inputProductionTrigger),
        connection.outputRedundantOwner === true ? "redundant-owner" : "",
      ].join(":"),
    )
    .sort()
    .join(",");

function profileChannels(module: IoModule): ProfileChannel[] {
  const candidate = (module as IoModule & { profileChannels?: unknown }).profileChannels;
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    return [row as ProfileChannel];
  });
}

const profileChannelSignature = (module: IoModule): string =>
  profileChannels(module)
    .map((channel, index) =>
      [
        channel.id || `#${index}`,
        clean(channel.label),
        clean(channel.direction),
        clean(channel.signal),
        channel.enabled === false ? "disabled" : "enabled",
        clean(channel.dataFormat),
        clean(channel.range),
        clean(channel.diagnostic),
      ].join(":"),
    )
    .sort()
    .join(",");

function describeModule(a: IoModule, b: IoModule): string[] {
  const { cmp, details } = fieldDiff();
  cmp("catalog", a.catalogNumber, b.catalogNumber);
  cmp("slot", a.slot, b.slot);
  cmp("parent", a.parentModule, b.parentModule);
  cmp("parent port", a.parentPortId, b.parentPortId);
  cmp("commPath", a.commPath, b.commPath);
  cmp("vendor", a.vendor, b.vendor);
  cmp("product type", a.productType, b.productType);
  cmp("product code", a.productCode, b.productCode);
  cmp("revision", [a.majorRevision, a.minorRevision].filter(Boolean).join("."), [b.majorRevision, b.minorRevision].filter(Boolean).join("."));
  cmp("keying", a.electronicKeying, b.electronicKeying);
  cmp("inhibited", Boolean(a.inhibited), Boolean(b.inhibited));
  cmp("major fault on connection loss", Boolean(a.majorFault), Boolean(b.majorFault));
  cmp("ports", portSignature(a.ports), portSignature(b.ports));
  cmp("connections", connectionSignature(a.connections), connectionSignature(b.connections));
  cmp("profile channels", profileChannelSignature(a), profileChannelSignature(b));
  cmp("description", a.description, b.description);
  return details;
}

/** Resolve a routine id to its name within its own program (ids differ across projects). */
const routineNameIn = (program: Program, id?: string): string =>
  id ? program.routines.find((r) => r.id === id)?.name ?? "" : "";

const routineSetSignature = (program: Program): string =>
  program.routines.map((r) => r.name).sort().join(",");

function describeProgram(a: Program, b: Program): string[] {
  const { cmp, details } = fieldDiff();
  cmp("main routine", routineNameIn(a, a.mainRoutineId), routineNameIn(b, b.mainRoutineId));
  cmp("fault routine", routineNameIn(a, a.faultRoutineId), routineNameIn(b, b.faultRoutineId));
  cmp("inhibited", Boolean(a.inhibited), Boolean(b.inhibited));
  cmp("folder", Boolean(a.useAsFolder), Boolean(b.useAsFolder));
  cmp("test edits", Boolean(a.testEdits), Boolean(b.testEdits));
  cmp("safety class", a.safetyClass, b.safetyClass);
  cmp("routines", routineSetSignature(a), routineSetSignature(b));
  cmp("scope tags", a.programTags.length, b.programTags.length);
  cmp("description", a.description, b.description);
  return details;
}

/** Resolve scheduled program ids to a stable, name-based signature for cross-project comparison. */
const scheduledSignature = (ids: string[], names: Map<string, string>): string =>
  ids.map((id) => names.get(id) ?? id).sort().join(", ");

function makeDescribeTask(
  leftPrograms: Map<string, string>,
  rightPrograms: Map<string, string>,
): (a: Task, b: Task) => string[] {
  return (a, b) => {
    const { cmp, details } = fieldDiff();
    cmp("type", a.type, b.type);
    cmp("period (ms)", a.periodMs, b.periodMs);
    cmp("priority", a.priority, b.priority);
    cmp("watchdog (ms)", a.watchdogMs, b.watchdogMs);
    cmp("inhibited", Boolean(a.inhibited), Boolean(b.inhibited));
    cmp("safety class", a.safetyClass, b.safetyClass);
    cmp(
      "scheduled programs",
      scheduledSignature(a.scheduledProgramIds, leftPrograms),
      scheduledSignature(b.scheduledProgramIds, rightPrograms),
    );
    cmp("description", a.description, b.description);
    return details;
  };
}

const allTags = (project: PlcProject): Tag[] =>
  project.controllers.flatMap((c) => [
    ...c.controllerTags,
    ...c.programs.flatMap((p) => p.programTags),
  ]);
const allUdts = (project: PlcProject): UserDefinedType[] =>
  project.controllers.flatMap((c) => c.dataTypes);
const allAois = (project: PlcProject): AddOnInstruction[] =>
  project.controllers.flatMap((c) => c.addOnInstructions);
const allModules = (project: PlcProject): IoModule[] =>
  project.controllers.flatMap((c) => c.ioConfiguration.modules);
const allPrograms = (project: PlcProject): Program[] =>
  project.controllers.flatMap((c) => c.programs);
const allTasks = (project: PlcProject): Task[] =>
  project.controllers.flatMap((c) => c.tasks);
const programIdToName = (project: PlcProject): Map<string, string> =>
  new Map(allPrograms(project).map((p) => [p.id, p.name]));

/** Compare the non-logic structure (tasks, programs, tags, UDTs, AOIs, I/O) of two projects. */
export function compareStructure(left: PlcProject, right: PlcProject): StructureComparison {
  const describeTask = makeDescribeTask(programIdToName(left), programIdToName(right));
  return {
    tasks: diffByName(allTasks(left), allTasks(right), (t) => t.name, describeTask),
    programs: diffByName(allPrograms(left), allPrograms(right), (p) => p.name, describeProgram),
    tags: diffByName(allTags(left), allTags(right), (t) => t.name, describeTag),
    dataTypes: diffByName(allUdts(left), allUdts(right), (u) => u.name, describeUdt),
    addOnInstructions: diffByName(allAois(left), allAois(right), (a) => a.name, describeAoi),
    modules: diffByName(allModules(left), allModules(right), (m) => m.name, describeModule),
  };
}
