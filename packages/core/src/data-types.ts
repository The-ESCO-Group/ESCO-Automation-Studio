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
    { name: "CD", type: "BOOL" },
    { name: "DN", type: "BOOL" },
    { name: "OV", type: "BOOL" },
    { name: "UN", type: "BOOL" },
  ],
  // Classic PID structure (representative subset). Process loops are model-only:
  // the members let the Watch seed/display them and let member-path validation
  // recognise references like PID_01.SP, but the PID instruction is never
  // simulated (see @esco/instructions process.ts). REAL members are modelled as
  // DINT numerics for offline display — there is no controller-faithful math.
  PID: [
    { name: "SP", type: "DINT" },
    { name: "PV", type: "DINT" },
    { name: "OUT", type: "DINT" },
    { name: "KP", type: "DINT" },
    { name: "KI", type: "DINT" },
    { name: "KD", type: "DINT" },
    { name: "ERR", type: "DINT" },
    { name: "MAXO", type: "DINT" },
    { name: "MINO", type: "DINT" },
    { name: "EN", type: "BOOL" },
    { name: "DN", type: "BOOL" },
  ],
  // Enhanced PID (PIDE) function-block structure (representative subset).
  PIDE: [
    { name: "SP", type: "DINT" },
    { name: "PV", type: "DINT" },
    { name: "CV", type: "DINT" },
    { name: "CVEU", type: "DINT" },
    { name: "KP", type: "DINT" },
    { name: "KI", type: "DINT" },
    { name: "KD", type: "DINT" },
    { name: "ERR", type: "DINT" },
    { name: "EN", type: "BOOL" },
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

/** Element value-paths for an array tag: `Name[0]` … `Name[dimension-1]`. */
export function arrayElementNames(name: string, dimension: number): string[] {
  const count = Math.max(0, Math.floor(dimension));
  return Array.from({ length: count }, (_, i) => `${name}[${i}]`);
}

/**
 * Parse an array element reference into its base tag and index.
 *  - "MyArray[3]" → { base: "MyArray", index: 3 }
 *  - "Plain" / "Tag.Member" → null
 */
export function parseArrayIndex(operand: string): { base: string; index: number } | null {
  const match = operand.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]$/);
  return match ? { base: match[1]!, index: Number(match[2]) } : null;
}
