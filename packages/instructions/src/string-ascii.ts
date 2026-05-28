import type { InstructionCategory, InstructionDefinition, InstructionOperandDefinition } from "./types";

/**
 * String and ASCII-serial instructions. All are registered model-only: they
 * parse, render, preserve their operands, validate as info (never an error), and
 * pass the rung condition through unchanged. They are NOT simulated — the
 * offline runtime models numeric/boolean tag memory only and has no string I/O,
 * and the ASCII serial instructions (ABL/ACB/ARD/AWT…) imply a serial port,
 * which this offline tool never touches. Preserved for display, validation, and
 * round-trip; not executed.
 */

function modelOnlyString(
  type: string,
  displayName: string,
  category: InstructionCategory,
  description: string,
  operands: InstructionOperandDefinition[] = [],
): InstructionDefinition {
  return {
    type,
    displayName,
    category,
    description,
    operands,
    modelOnly: true,
    validate: () => [],
    execute: (_node, ctx) => ctx.rungIn,
    render: { symbol: type, style: "box" },
  };
}

const src = (name: string, label: string): InstructionOperandDefinition => ({ name, label, required: false, direction: "read" });
const dst = (name: string, label: string): InstructionOperandDefinition => ({ name, label, required: false, direction: "write" });

// String/ASCII instructions reuse existing categories (no new category needed):
// string manipulation -> "file" (data family), ASCII/serial -> "message" (comms family).
const str = (type: string, displayName: string, description: string, operands: InstructionOperandDefinition[] = []) =>
  modelOnlyString(type, displayName, "file", `${description} (model-only): preserved and displayed; not simulated.`, operands);
const ascii = (type: string, displayName: string, description: string, operands: InstructionOperandDefinition[] = []) =>
  modelOnlyString(type, displayName, "message", `${description} (model-only): preserved and displayed; no serial port and not simulated.`, operands);

// --- String manipulation ---
export const CONCAT = str("CONCAT", "String Concatenate", "Concatenate two strings", [src("sourceA", "Source A"), src("sourceB", "Source B"), dst("dest", "Dest")]);
export const DELETE = str("DELETE", "String Delete", "Delete characters from a string", [src("source", "Source"), src("qty", "Qty"), src("start", "Start"), dst("dest", "Dest")]);
export const FIND = str("FIND", "String Find", "Find a substring", [src("source", "Source"), src("search", "Search"), src("start", "Start"), dst("result", "Result")]);
export const INSERT = str("INSERT", "String Insert", "Insert characters into a string", [src("sourceA", "Source A"), src("sourceB", "Source B"), src("start", "Start"), dst("dest", "Dest")]);
export const LEFT = str("LEFT", "String Left", "Leftmost characters of a string", [src("source", "Source"), src("qty", "Qty"), dst("dest", "Dest")]);
export const LEN = str("LEN", "String Length", "Length of a string", [src("source", "Source"), dst("dest", "Dest")]);
export const MID = str("MID", "String Middle", "Middle characters of a string", [src("source", "Source"), src("qty", "Qty"), src("start", "Start"), dst("dest", "Dest")]);
export const RIGHT = str("RIGHT", "String Right", "Rightmost characters of a string", [src("source", "Source"), src("qty", "Qty"), dst("dest", "Dest")]);
export const LOWER = str("LOWER", "String To Lower", "Lowercase a string", [src("source", "Source"), dst("dest", "Dest")]);
export const UPPER = str("UPPER", "String To Upper", "Uppercase a string", [src("source", "Source"), dst("dest", "Dest")]);

// --- ASCII conversion ---
export const ACI = ascii("ACI", "ASCII to Integer", "Convert ASCII string to integer", [src("source", "Source"), dst("dest", "Dest")]);
export const ACB = ascii("ACB", "ASCII to Buffer", "Convert ASCII characters to a buffer", [src("source", "Source"), dst("dest", "Dest")]);
export const AEX = ascii("AEX", "ASCII Extract", "Extract characters from an ASCII string", [src("source", "Source"), src("index", "Index"), src("qty", "Qty"), dst("dest", "Dest")]);
export const ASC = ascii("ASC", "String To ASCII", "Convert a string to ASCII", [src("source", "Source"), dst("dest", "Dest")]);

// --- ASCII serial port (NO serial port; never executed offline) ---
export const ABL = ascii("ABL", "ASCII Test Buffer Line", "Test a serial buffer for a line", [src("channel", "Channel"), dst("result", "Result")]);
export const ACL = ascii("ACL", "ASCII Clear Buffers", "Clear serial buffers", [src("channel", "Channel")]);
export const ACN = ascii("ACN", "ASCII Concatenate", "Concatenate ASCII strings", [src("sourceA", "Source A"), src("sourceB", "Source B"), dst("dest", "Dest")]);
export const AHL = ascii("AHL", "ASCII Handshake Lines", "Read/set serial handshake lines", [src("channel", "Channel")]);
export const ARD = ascii("ARD", "ASCII Read", "Read characters from a serial buffer", [src("channel", "Channel"), dst("dest", "Dest")]);
export const ARL = ascii("ARL", "ASCII Read Line", "Read a line from a serial buffer", [src("channel", "Channel"), dst("dest", "Dest")]);
export const ASR = ascii("ASR", "ASCII String Compare", "Compare ASCII strings", [src("sourceA", "Source A"), src("sourceB", "Source B")]);
export const AWA = ascii("AWA", "ASCII Write Append", "Write an ASCII string with appended characters", [src("channel", "Channel"), src("source", "Source")]);
export const AWT = ascii("AWT", "ASCII Write", "Write an ASCII string", [src("channel", "Channel"), src("source", "Source")]);

/** Every string/ASCII instruction, for bulk registration. */
export const STRING_ASCII_INSTRUCTIONS: InstructionDefinition[] = [
  CONCAT, DELETE, FIND, INSERT, LEFT, LEN, MID, RIGHT, LOWER, UPPER,
  ACI, ACB, AEX, ASC,
  ABL, ACL, ACN, AHL, ARD, ARL, ASR, AWA, AWT,
];
