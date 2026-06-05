import type {
  InstructionCategory,
  InstructionDefinition,
  InstructionFidelityMetadata,
  InstructionOperandDefinition,
} from "./types";
import { operandValue } from "./operands";

/**
 * String and ASCII instructions. Scalar string operations execute over offline
 * tag memory. Serial buffer instructions use a deterministic offline model:
 * the Channel operand is a STRING tag whose contents act as the serial buffer.
 * Hardware handshake/status instructions remain model-only.
 */

const STRING_TYPES = ["STRING"];
const NUMERIC_TYPES = ["DINT", "REAL"];

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

function stringLiteral(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length < 2) return undefined;
  const quote = trimmed[0];
  if ((quote !== `"` && quote !== "'") || trimmed[trimmed.length - 1] !== quote) return undefined;
  return trimmed.slice(1, -1);
}

function textValue(ctx: Parameters<InstructionDefinition["execute"]>[1], value: string): string {
  return stringLiteral(value) ?? ctx.readString(value);
}

function writeText(ctx: Parameters<InstructionDefinition["execute"]>[1], dest: string, value: string): void {
  if (dest) ctx.writeString(dest, value);
}

function writeNumber(ctx: Parameters<InstructionDefinition["execute"]>[1], dest: string, value: number): void {
  if (dest) ctx.writeNumber(dest, value);
}

function count(ctx: Parameters<InstructionDefinition["execute"]>[1], value: string): number {
  const n = Math.trunc(ctx.numeric(value));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function startIndex(ctx: Parameters<InstructionDefinition["execute"]>[1], value: string): number {
  const n = Math.trunc(ctx.numeric(value));
  return Number.isFinite(n) ? Math.max(0, n - 1) : 0;
}

function executableString(
  type: string,
  displayName: string,
  description: string,
  operands: InstructionOperandDefinition[],
  execute: InstructionDefinition["execute"],
  category: InstructionCategory = "file",
  fidelity?: InstructionFidelityMetadata,
): InstructionDefinition {
  return {
    type,
    displayName,
    category,
    description,
    operands,
    ...(fidelity ? { fidelity } : {}),
    validate: requireOperands(operands.filter((o) => o.required).map((o) => o.name)),
    execute,
    render: { symbol: type, style: "box" },
  };
}

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
    fidelity: {
      status: "model-only",
      summary: description,
      limitations: [
        "pass-through rung execution only",
        "no serial-port hardware access",
        "no serial control/status side effects",
      ],
    },
    modelOnly: true,
    validate: () => [],
    execute: (_node, ctx) => ctx.rungIn,
    render: { symbol: type, style: "box" },
  };
}

const strSrc = (name: string, label: string): InstructionOperandDefinition =>
  ({ name, label, required: true, allowedTypes: STRING_TYPES, direction: "read" });
const strDst = (name: string, label: string): InstructionOperandDefinition =>
  ({ name, label, required: true, allowedTypes: STRING_TYPES, direction: "write" });
const numSrc = (name: string, label: string): InstructionOperandDefinition =>
  ({ name, label, required: true, allowedTypes: NUMERIC_TYPES, direction: "read" });
const numDst = (name: string, label: string): InstructionOperandDefinition =>
  ({ name, label, required: true, allowedTypes: NUMERIC_TYPES, direction: "write" });
const optionalNumSrc = (name: string, label: string): InstructionOperandDefinition =>
  ({ name, label, required: false, allowedTypes: NUMERIC_TYPES, direction: "read" });
const optionalNumDst = (name: string, label: string): InstructionOperandDefinition =>
  ({ name, label, required: false, allowedTypes: NUMERIC_TYPES, direction: "write" });
const optionalControlDst = (name: string, label: string): InstructionOperandDefinition =>
  ({ name, label, required: false, allowedTypes: ["CONTROL"], direction: "write" });

// String/ASCII instructions reuse existing categories (no new category needed):
// string manipulation -> "file" (data family), ASCII/serial -> "message" (comms family).
const ascii = (type: string, displayName: string, description: string, operands: InstructionOperandDefinition[] = []) =>
  modelOnlyString(type, displayName, "message", `${description} (model-only): preserved and displayed; no serial port and not simulated.`, operands);
const asciiBuffer = (
  type: string,
  displayName: string,
  description: string,
  operands: InstructionOperandDefinition[],
  execute: InstructionDefinition["execute"],
) => executableString(type, displayName, description, operands, execute, "message", {
  status: "executable-partial",
  summary: `${description} This uses a STRING-backed offline channel buffer and never opens serial hardware.`,
  limitations: [
    "no serial-port hardware access",
    "no controller channel status",
    "offline STRING buffer semantics only",
  ],
});

function lineEnd(buffer: string): { index: number; length: number } | undefined {
  const lf = buffer.indexOf("\n");
  const cr = buffer.indexOf("\r");
  const candidates = [lf, cr].filter((i) => i >= 0);
  if (candidates.length === 0) return undefined;
  const index = Math.min(...candidates);
  const length = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
  return { index, length };
}

function readCount(
  ctx: Parameters<InstructionDefinition["execute"]>[1],
  operand: string,
  fallback: number,
): number {
  if (!operand) return fallback;
  return Math.min(fallback, count(ctx, operand));
}

// --- String manipulation ---
export const CONCAT = executableString(
  "CONCAT",
  "String Concatenate",
  "Concatenates two strings while the rung is true.",
  [strSrc("sourceA", "Source A"), strSrc("sourceB", "Source B"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    writeText(ctx, operandValue(node, 2), textValue(ctx, operandValue(node, 0)) + textValue(ctx, operandValue(node, 1)));
    return true;
  },
);
export const DELETE = executableString(
  "DELETE",
  "String Delete",
  "Deletes Qty characters from Source beginning at the one-based Start position.",
  [strSrc("source", "Source"), numSrc("qty", "Qty"), numSrc("start", "Start"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const source = textValue(ctx, operandValue(node, 0));
    const start = startIndex(ctx, operandValue(node, 2));
    const qty = count(ctx, operandValue(node, 1));
    writeText(ctx, operandValue(node, 3), source.slice(0, start) + source.slice(start + qty));
    return true;
  },
);
export const FIND = executableString(
  "FIND",
  "String Find",
  "Finds Search in Source from one-based Start and writes the one-based index, or 0 when not found.",
  [strSrc("source", "Source"), strSrc("search", "Search"), numSrc("start", "Start"), numDst("result", "Result")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const source = textValue(ctx, operandValue(node, 0));
    const search = textValue(ctx, operandValue(node, 1));
    const start = startIndex(ctx, operandValue(node, 2));
    const found = search ? source.indexOf(search, start) : -1;
    writeNumber(ctx, operandValue(node, 3), found >= 0 ? found + 1 : 0);
    return true;
  },
);
export const INSERT = executableString(
  "INSERT",
  "String Insert",
  "Inserts Source B into Source A at the one-based Start position.",
  [strSrc("sourceA", "Source A"), strSrc("sourceB", "Source B"), numSrc("start", "Start"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const source = textValue(ctx, operandValue(node, 0));
    const insert = textValue(ctx, operandValue(node, 1));
    const start = Math.min(source.length, startIndex(ctx, operandValue(node, 2)));
    writeText(ctx, operandValue(node, 3), source.slice(0, start) + insert + source.slice(start));
    return true;
  },
);
export const LEFT = executableString(
  "LEFT",
  "String Left",
  "Copies the leftmost Qty characters of Source to Dest.",
  [strSrc("source", "Source"), numSrc("qty", "Qty"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    writeText(ctx, operandValue(node, 2), textValue(ctx, operandValue(node, 0)).slice(0, count(ctx, operandValue(node, 1))));
    return true;
  },
);
export const LEN = executableString(
  "LEN",
  "String Length",
  "Writes the character length of Source to Dest.",
  [strSrc("source", "Source"), numDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    writeNumber(ctx, operandValue(node, 1), textValue(ctx, operandValue(node, 0)).length);
    return true;
  },
);
export const MID = executableString(
  "MID",
  "String Middle",
  "Copies Qty characters from Source beginning at the one-based Start position.",
  [strSrc("source", "Source"), numSrc("qty", "Qty"), numSrc("start", "Start"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const source = textValue(ctx, operandValue(node, 0));
    const start = startIndex(ctx, operandValue(node, 2));
    writeText(ctx, operandValue(node, 3), source.slice(start, start + count(ctx, operandValue(node, 1))));
    return true;
  },
);
export const RIGHT = executableString(
  "RIGHT",
  "String Right",
  "Copies the rightmost Qty characters of Source to Dest.",
  [strSrc("source", "Source"), numSrc("qty", "Qty"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const qty = count(ctx, operandValue(node, 1));
    writeText(ctx, operandValue(node, 2), qty === 0 ? "" : textValue(ctx, operandValue(node, 0)).slice(-qty));
    return true;
  },
);
export const LOWER = executableString(
  "LOWER",
  "String To Lower",
  "Lowercases Source into Dest.",
  [strSrc("source", "Source"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    writeText(ctx, operandValue(node, 1), textValue(ctx, operandValue(node, 0)).toLowerCase());
    return true;
  },
);
export const UPPER = executableString(
  "UPPER",
  "String To Upper",
  "Uppercases Source into Dest.",
  [strSrc("source", "Source"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    writeText(ctx, operandValue(node, 1), textValue(ctx, operandValue(node, 0)).toUpperCase());
    return true;
  },
);

// --- ASCII conversion ---
export const ACI = executableString(
  "ACI",
  "ASCII to Integer",
  "Parses the leading numeric ASCII text in Source and writes the truncated integer to Dest.",
  [strSrc("source", "Source"), numDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    // ASCII to Integer yields an integer: truncate toward zero and wrap to a
    // 32-bit signed DINT, mirroring STOD (String to DINT). Writing the raw float
    // would misrepresent "42.7" as 42.7 instead of the controller's 42.
    const parsed = Number.parseFloat(textValue(ctx, operandValue(node, 0)).trim());
    writeNumber(ctx, operandValue(node, 1), Number.isFinite(parsed) ? Math.trunc(parsed) | 0 : 0);
    return true;
  },
);
export const ACB = asciiBuffer(
  "ACB",
  "ASCII Characters in Buffer",
  "Writes the offline channel buffer character count to Result.",
  [strSrc("channel", "Channel"), numDst("result", "Result")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    writeNumber(ctx, operandValue(node, 1), textValue(ctx, operandValue(node, 0)).length);
    return true;
  },
);
export const AEX = executableString(
  "AEX",
  "ASCII Extract",
  "Extracts Qty characters from Source beginning at the one-based Index.",
  [strSrc("source", "Source"), numSrc("index", "Index"), numSrc("qty", "Qty"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const source = textValue(ctx, operandValue(node, 0));
    const start = startIndex(ctx, operandValue(node, 1));
    writeText(ctx, operandValue(node, 3), source.slice(start, start + count(ctx, operandValue(node, 2))));
    return true;
  },
);
export const ASC = executableString(
  "ASC",
  "String To ASCII",
  "Writes the ASCII code of Source's first character to Dest.",
  [strSrc("source", "Source"), numDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    writeNumber(ctx, operandValue(node, 1), textValue(ctx, operandValue(node, 0)).charCodeAt(0) || 0);
    return true;
  },
);
// ASR (ASCII String Compare) lives in the ASCII serial family but reads no
// channel and touches no serial port: it compares two STRING tags character for
// character, so it executes offline like any other string comparison input.
export const ASR: InstructionDefinition = {
  type: "ASR",
  displayName: "ASCII String Compare",
  category: "compare",
  description: "Passes when Source A and Source B contain identical ASCII text (case-sensitive).",
  operands: [strSrc("sourceA", "Source A"), strSrc("sourceB", "Source B")],
  validate: requireOperands(["sourceA", "sourceB"]),
  execute: (node, ctx) =>
    ctx.rungIn && textValue(ctx, operandValue(node, 0)) === textValue(ctx, operandValue(node, 1)),
  render: { symbol: "ASR", style: "function" },
};

// --- Number <-> String conversion (pure offline; no serial port) ---
export const DTOS = executableString(
  "DTOS",
  "DINT to String",
  "Writes the decimal text of the integer Source to the string Dest.",
  [numSrc("source", "Source"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    writeText(ctx, operandValue(node, 1), String(Math.trunc(ctx.numeric(operandValue(node, 0))) | 0));
    return true;
  },
);
export const RTOS = executableString(
  "RTOS",
  "REAL to String",
  "Writes the text representation of the REAL Source to the string Dest.",
  [numSrc("source", "Source"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const value = ctx.numeric(operandValue(node, 0));
    writeText(ctx, operandValue(node, 1), String(Number.isFinite(value) ? value : 0));
    return true;
  },
);
export const STOD = executableString(
  "STOD",
  "String to DINT",
  "Parses the leading numeric text in the string Source and writes the truncated integer to Dest.",
  [strSrc("source", "Source"), numDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const parsed = Number.parseFloat(textValue(ctx, operandValue(node, 0)).trim());
    writeNumber(ctx, operandValue(node, 1), Number.isFinite(parsed) ? Math.trunc(parsed) | 0 : 0);
    return true;
  },
);
export const STOR = executableString(
  "STOR",
  "String to REAL",
  "Parses the leading numeric text in the string Source and writes the REAL value to Dest.",
  [strSrc("source", "Source"), numDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const parsed = Number.parseFloat(textValue(ctx, operandValue(node, 0)).trim());
    writeNumber(ctx, operandValue(node, 1), Number.isFinite(parsed) ? parsed : 0);
    return true;
  },
);

// --- ASCII channel buffers (offline STRING-backed model; no hardware port) ---
export const ABL = asciiBuffer(
  "ABL",
  "ASCII Test Buffer Line",
  "Writes the available line length in the offline channel buffer, or 0 when no line terminator is present.",
  [strSrc("channel", "Channel"), numDst("result", "Result")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const buffer = textValue(ctx, operandValue(node, 0));
    const end = lineEnd(buffer);
    writeNumber(ctx, operandValue(node, 1), end ? end.index + end.length : 0);
    return true;
  },
);
export const ACL = asciiBuffer(
  "ACL",
  "ASCII Clear Buffers",
  "Clears the offline channel buffer.",
  [strDst("channel", "Channel")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    writeText(ctx, operandValue(node, 0), "");
    return true;
  },
);
export const ACN = executableString(
  "ACN",
  "ASCII Concatenate",
  "Concatenates two ASCII strings while the rung is true.",
  [strSrc("sourceA", "Source A"), strSrc("sourceB", "Source B"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    writeText(ctx, operandValue(node, 2), textValue(ctx, operandValue(node, 0)) + textValue(ctx, operandValue(node, 1)));
    return true;
  },
);
export const AHL = ascii(
  "AHL",
  "ASCII Handshake Lines",
  "Read/set serial handshake lines",
  [
    optionalNumSrc("channel", "Channel"),
    optionalNumSrc("andMask", "AND Mask"),
    optionalNumSrc("orMask", "OR Mask"),
    optionalControlDst("control", "Control"),
    optionalNumDst("channelStatus", "Channel Status"),
  ],
);
export const ARD = asciiBuffer(
  "ARD",
  "ASCII Read",
  "Reads characters from the offline channel buffer into Dest and consumes them from Channel.",
  [strDst("channel", "Channel"), strDst("dest", "Dest"), optionalNumSrc("qty", "Qty")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const channel = operandValue(node, 0);
    const buffer = textValue(ctx, channel);
    const n = readCount(ctx, operandValue(node, 2), buffer.length);
    writeText(ctx, operandValue(node, 1), buffer.slice(0, n));
    writeText(ctx, channel, buffer.slice(n));
    return true;
  },
);
export const ARL = asciiBuffer(
  "ARL",
  "ASCII Read Line",
  "Reads one line from the offline channel buffer into Dest and consumes it from Channel.",
  [strDst("channel", "Channel"), strDst("dest", "Dest")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const channel = operandValue(node, 0);
    const buffer = textValue(ctx, channel);
    const end = lineEnd(buffer);
    const take = end ? end.index + end.length : buffer.length;
    const line = buffer.slice(0, take).replace(/[\r\n]+$/, "");
    writeText(ctx, operandValue(node, 1), line);
    writeText(ctx, channel, buffer.slice(take));
    return true;
  },
);
export const AWA = asciiBuffer(
  "AWA",
  "ASCII Write Append",
  "Appends Source plus CR/LF to the offline channel buffer.",
  [strDst("channel", "Channel"), strSrc("source", "Source")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const channel = operandValue(node, 0);
    writeText(ctx, channel, textValue(ctx, channel) + textValue(ctx, operandValue(node, 1)) + "\r\n");
    return true;
  },
);
export const AWT = asciiBuffer(
  "AWT",
  "ASCII Write",
  "Appends Source to the offline channel buffer.",
  [strDst("channel", "Channel"), strSrc("source", "Source")],
  (node, ctx) => {
    if (!ctx.rungIn) return false;
    const channel = operandValue(node, 0);
    writeText(ctx, channel, textValue(ctx, channel) + textValue(ctx, operandValue(node, 1)));
    return true;
  },
);

/** Every string/ASCII instruction, for bulk registration. */
export const STRING_ASCII_INSTRUCTIONS: InstructionDefinition[] = [
  CONCAT, DELETE, FIND, INSERT, LEFT, LEN, MID, RIGHT, LOWER, UPPER,
  ACI, ACB, AEX, ASC,
  DTOS, RTOS, STOD, STOR,
  ABL, ACL, ACN, AHL, ARD, ARL, ASR, AWA, AWT,
];
