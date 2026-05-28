/**
 * Built-in PLC data types and the layout of the predefined structured types
 * (TIMER, COUNTER). Used by the simulator/Watch to seed and display member
 * values, and by the editor to create tags of the right type.
 */

export type AtomicType = "BOOL" | "DINT" | "REAL";

export interface StructMember {
  name: string;
  /** Member atomic type (PRE/ACC are DINT; status bits are BOOL). */
  type: "BOOL" | "DINT";
}

/** Tag data types the editor can create. */
export const TAG_DATA_TYPES = ["BOOL", "DINT", "REAL", "TIMER", "COUNTER"] as const;
export type TagDataType = (typeof TAG_DATA_TYPES)[number];

/** Member layout of the predefined structured types. */
export const STRUCTURED_TYPES: Record<string, StructMember[]> = {
  TIMER: [
    { name: "PRE", type: "DINT" },
    { name: "ACC", type: "DINT" },
    { name: "EN", type: "BOOL" },
    { name: "TT", type: "BOOL" },
    { name: "DN", type: "BOOL" },
  ],
  COUNTER: [
    { name: "PRE", type: "DINT" },
    { name: "ACC", type: "DINT" },
    { name: "CU", type: "BOOL" },
    { name: "DN", type: "BOOL" },
  ],
};

export function isStructuredType(dataType: string): boolean {
  return dataType in STRUCTURED_TYPES;
}

export function isBooleanType(dataType: string): boolean {
  return dataType === "BOOL";
}

export function isNumericType(dataType: string): boolean {
  return dataType === "DINT" || dataType === "REAL";
}

/** Member definitions for a structured type, or [] for atomic types. */
export function memberDefs(dataType: string): StructMember[] {
  return STRUCTURED_TYPES[dataType] ?? [];
}
