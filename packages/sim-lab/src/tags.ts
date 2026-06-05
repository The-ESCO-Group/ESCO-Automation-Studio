/** Virtual-tag helpers: collection, lookup, scaling, and defaults. */

import type { PlcValue } from "@esco/simulator";
import type { SimDataType, SimLogicBlock, SimProject, SimScaling, SimVirtualTag } from "./types";

/** Every virtual tag in the project, in a stable order (devices then logic). */
export function collectAllTags(project: SimProject): SimVirtualTag[] {
  const tags: SimVirtualTag[] = [];
  for (const device of project.devices) tags.push(...device.tags);
  for (const block of project.logicBlocks) {
    for (const spec of block.requiredTags) {
      if (!tags.some((t) => t.name === spec.name)) {
        tags.push({
          id: `logictag_${block.id}_${spec.name}`,
          name: spec.name,
          dataType: spec.dataType,
          direction: spec.role,
          units: spec.units,
          description: `Logic tag for ${block.name}`,
          initial: spec.initial,
        });
      }
    }
  }
  return tags;
}

/** Map of tag name -> tag for fast lookup. */
export function tagIndex(project: SimProject): Map<string, SimVirtualTag> {
  const index = new Map<string, SimVirtualTag>();
  for (const tag of collectAllTags(project)) index.set(tag.name, tag);
  return index;
}

export function findTag(project: SimProject, name: string): SimVirtualTag | undefined {
  return tagIndex(project).get(name);
}

/** Default power-up value for a data type. */
export function defaultValue(dataType: SimDataType): PlcValue {
  switch (dataType) {
    case "BOOL":
      return false;
    case "REAL":
      return 0;
    case "DINT":
      return 0;
  }
}

/** Convert an engineering-unit value to raw counts using a scaling. */
export function euToRaw(scaling: SimScaling, eu: number): number {
  const span = scaling.euMax - scaling.euMin;
  if (span === 0) return scaling.rawMin;
  const ratio = (eu - scaling.euMin) / span;
  return Math.round(scaling.rawMin + ratio * (scaling.rawMax - scaling.rawMin));
}

/** Convert raw counts to an engineering-unit value using a scaling. */
export function rawToEu(scaling: SimScaling, raw: number): number {
  const span = scaling.rawMax - scaling.rawMin;
  if (span === 0) return scaling.euMin;
  const ratio = (raw - scaling.rawMin) / span;
  return scaling.euMin + ratio * (scaling.euMax - scaling.euMin);
}

/** Whether a scaling is well-formed (used by validation). */
export function isValidScaling(scaling: SimScaling): boolean {
  return (
    Number.isFinite(scaling.rawMin) &&
    Number.isFinite(scaling.rawMax) &&
    Number.isFinite(scaling.euMin) &&
    Number.isFinite(scaling.euMax) &&
    scaling.rawMax !== scaling.rawMin &&
    scaling.euMax !== scaling.euMin
  );
}

/** Recognised engineering-unit tokens for validation. */
export const KNOWN_UNITS = new Set([
  "gpm",
  "lpm",
  "psi",
  "bar",
  "kpa",
  "degF",
  "degC",
  "K",
  "%",
  "A",
  "V",
  "kW",
  "hp",
  "rpm",
  "Hz",
  "mm",
  "in",
  "ft",
  "m",
  "gal",
  "L",
  "s",
]);

/** Required-tag specs contributed by a logic block, for missing-tag checks. */
export function logicBlockTagNames(block: SimLogicBlock): string[] {
  return block.requiredTags.map((spec) => spec.name);
}
