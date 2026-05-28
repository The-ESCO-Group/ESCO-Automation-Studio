import type {
  AddOnInstruction,
  IoModule,
  PlcProject,
  Tag,
  UserDefinedType,
} from "@esco/core";

/**
 * Non-logic structure comparison: tags, data types (UDTs), Add-On Instruction
 * definitions, and I/O modules. Each is diffed by name into added / removed /
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

function describeTag(a: Tag, b: Tag): string[] {
  const { cmp, details } = fieldDiff();
  cmp("type", a.dataType, b.dataType);
  cmp("dimension", a.dimension, b.dimension);
  cmp("scope", a.scope, b.scope);
  cmp("alias", a.aliasFor, b.aliasFor);
  cmp("constant", a.constant, b.constant);
  cmp("produced", a.produced, b.produced);
  cmp("consumed", a.consumed, b.consumed);
  cmp("description", a.description, b.description);
  return details;
}

const memberSignature = (udt: UserDefinedType): string =>
  udt.members.map((m) => `${m.name}:${m.dataType}${m.dimension ? `[${m.dimension}]` : ""}`).join(",");

function describeUdt(a: UserDefinedType, b: UserDefinedType): string[] {
  const { cmp, details } = fieldDiff();
  cmp("members", memberSignature(a), memberSignature(b));
  cmp("description", a.description, b.description);
  return details;
}

const paramSignature = (aoi: AddOnInstruction): string =>
  aoi.parameters.map((p) => `${p.name}:${p.usage ?? ""}`).join(",");

function describeAoi(a: AddOnInstruction, b: AddOnInstruction): string[] {
  const { cmp, details } = fieldDiff();
  cmp("revision", a.revision, b.revision);
  cmp("signature", a.signature, b.signature);
  cmp("protected", Boolean(a.protected), Boolean(b.protected));
  cmp("parameters", paramSignature(a), paramSignature(b));
  cmp("routines", a.routineNames.join(","), b.routineNames.join(","));
  return details;
}

function describeModule(a: IoModule, b: IoModule): string[] {
  const { cmp, details } = fieldDiff();
  cmp("catalog", a.catalogNumber, b.catalogNumber);
  cmp("slot", a.slot, b.slot);
  cmp("parent", a.parentModule, b.parentModule);
  cmp("commPath", a.commPath, b.commPath);
  cmp("description", a.description, b.description);
  return details;
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

/** Compare the non-logic structure (tags, UDTs, AOIs, I/O) of two projects. */
export function compareStructure(left: PlcProject, right: PlcProject): StructureComparison {
  return {
    tags: diffByName(allTags(left), allTags(right), (t) => t.name, describeTag),
    dataTypes: diffByName(allUdts(left), allUdts(right), (u) => u.name, describeUdt),
    addOnInstructions: diffByName(allAois(left), allAois(right), (a) => a.name, describeAoi),
    modules: diffByName(allModules(left), allModules(right), (m) => m.name, describeModule),
  };
}
