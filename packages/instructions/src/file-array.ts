import type { InstructionDefinition, InstructionRuntimeContext } from "./types";
import { isNumericLiteral, operandValue } from "./operands";
import { evaluateComparisonExpression, evaluateExpression, isValidExpression } from "./expression";

/**
 * File / array instructions. AVE (average), STD (sample standard deviation), and
 * SRT (in-place ascending sort) are executed offline element-wise over `Length`
 * elements addressed as `base[index]` against tag memory (a missing element
 * reads as 0); element counts are bounded so a bad Length can never hang a scan.
 * SIZE uses declared tag metadata to return the requested modelled array dimension.
 * FIFO/LIFO stack instructions (FFL/FFU/LFL/LFU) execute bounded numeric
 * load/unload behavior with CONTROL position/status bits. FAL/FSC execute
 * bounded array-expression loops for ALL, INC, and numeric-per-scan modes.
 * Offline numeric approximations, not byte-for-byte Logix.
 */

const NUMERIC = ["DINT", "REAL"];
const CONTROL = ["CONTROL"];
const ELEMENT_LIMIT = 100_000;

function startIndex(ctx: InstructionRuntimeContext, raw: string | undefined): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  const result = evaluateExpression(trimmed, (path) => ctx.readNumber(path));
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : result.ok ? result.value : ctx.readNumber(trimmed);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** Resolve an operand like `Arr`, `Arr[3]`, or `Arr[Index]` to a base + start. */
function elementBase(ctx: InstructionRuntimeContext, operand: string): { base: string; start: number } {
  const match = operand.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]+)])?$/);
  if (!match) return { base: operand.trim(), start: 0 };
  return { base: match[1]!, start: startIndex(ctx, match[2]) };
}

function clampLength(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), ELEMENT_LIMIT);
}

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

function op(node: { operands: { value: string }[] }, index: number): string {
  return node.operands[index]?.value?.trim() ?? "";
}

function member(control: string, name: string): string {
  return `${control}.${name}`;
}

function readElements(ctx: InstructionRuntimeContext, operand: string, length: number): number[] {
  const { base, start } = elementBase(ctx, operand);
  const values: number[] = [];
  for (let i = 0; i < length; i += 1) values.push(ctx.readNumber(`${base}[${start + i}]`));
  return values;
}

function elementPath(ctx: InstructionRuntimeContext, operand: string, position: number): string {
  const { base, start } = elementBase(ctx, operand);
  return `${base}[${start + position}]`;
}

function readPosition(ctx: InstructionRuntimeContext, control: string, fallbackOperand: string): number {
  let position = Math.trunc(ctx.readNumber(member(control, "POS")));
  if (position === 0 && fallbackOperand) position = Math.trunc(ctx.numeric(fallbackOperand));
  return Number.isFinite(position) ? position : 0;
}

function writePosition(
  ctx: InstructionRuntimeContext,
  control: string,
  fallbackOperand: string,
  position: number,
): void {
  ctx.writeNumber(member(control, "POS"), position);
  if (fallbackOperand && !isNumericLiteral(fallbackOperand)) ctx.writeNumber(fallbackOperand, position);
}

function writeStackStatus(
  ctx: InstructionRuntimeContext,
  control: string,
  fallbackPosition: string,
  length: number,
  position: number,
  error: boolean,
): void {
  ctx.writeNumber(member(control, "LEN"), length);
  writePosition(ctx, control, fallbackPosition, position);
  ctx.writeBool(member(control, "ER"), error);
  ctx.writeBool(member(control, "EM"), position <= 0);
  ctx.writeBool(member(control, "DN"), !error && (length <= 0 || position >= length));
}

function stackLength(ctx: InstructionRuntimeContext, operand: string): number {
  const length = Math.trunc(ctx.numeric(operand));
  if (!Number.isFinite(length)) return 0;
  return Math.min(length, ELEMENT_LIMIT);
}

/**
 * AVE/STD/SRT use a CONTROL structure but, unlike FAL/FSC, complete within the
 * scan they run. Mirror that: while the rung is true the instruction is enabled,
 * .LEN holds the element count, and once the (single-scan) pass finishes .POS
 * reaches .LEN and .DN sets. A negative Length is an error (.ER set, .DN clear,
 * no work) just as it would fault a real controller's CONTROL. On a false rung
 * the instruction de-energises: .EN and .DN clear (.POS/.LEN are left intact, as
 * Logix does, so a watch still shows the last completed extent).
 */
function writeFileOpStatus(
  ctx: InstructionRuntimeContext,
  control: string,
  length: number,
  error: boolean,
): void {
  if (!control) return;
  const len = Math.max(0, length);
  ctx.writeBool(member(control, "EN"), true);
  ctx.writeNumber(member(control, "LEN"), len);
  ctx.writeNumber(member(control, "POS"), error ? 0 : len);
  ctx.writeBool(member(control, "ER"), error);
  ctx.writeBool(member(control, "DN"), !error);
}

function resetFileOpControl(ctx: InstructionRuntimeContext, control: string): void {
  if (!control) return;
  ctx.writeBool(member(control, "EN"), false);
  ctx.writeBool(member(control, "DN"), false);
}

type FileMode = { kind: "all" } | { kind: "inc" } | { kind: "numeric"; count: number };

function parseFileMode(ctx: InstructionRuntimeContext, operand: string): FileMode {
  const upper = operand.trim().toUpperCase();
  if (upper === "ALL") return { kind: "all" };
  if (upper === "INC") return { kind: "inc" };
  const count = Math.trunc(ctx.numeric(operand));
  return { kind: "numeric", count: Math.max(1, Number.isFinite(count) ? count : 1) };
}

function resolvePositionedPath(path: string, control: string, position: number): string {
  const controlPos = `${control}.POS`.toUpperCase();
  return path.replace(/\[([^\]]+)\]/g, (match, inner: string) => {
    const normalized = inner.trim().toUpperCase();
    if (normalized === controlPos || normalized === "POS") return `[${position}]`;
    return match;
  });
}

function numericAt(ctx: InstructionRuntimeContext, operand: string, control: string, position: number): number {
  return ctx.numeric(resolvePositionedPath(operand, control, position));
}

function evaluateAt(
  ctx: InstructionRuntimeContext,
  expression: string,
  control: string,
  position: number,
): { ok: true; value: number } | { ok: false } {
  return evaluateExpression(expression, (path) => numericAt(ctx, path, control, position));
}

function evaluateComparisonAt(
  ctx: InstructionRuntimeContext,
  expression: string,
  control: string,
  position: number,
): { ok: true; value: number } | { ok: false } {
  return evaluateComparisonExpression(
    expression,
    (path) => numericAt(ctx, path, control, position),
    (path) => ctx.readString(resolvePositionedPath(path, control, position)),
  );
}

function resetFileControl(
  ctx: InstructionRuntimeContext,
  control: string,
  clearSearch = false,
): void {
  if (!control) return;
  ctx.writeBool(member(control, "EN"), false);
  ctx.writeBool(member(control, "DN"), false);
  ctx.writeNumber(member(control, "POS"), 0);
  if (clearSearch) {
    ctx.writeBool(member(control, "FD"), false);
    ctx.writeBool(member(control, "IN"), false);
  }
}

function fileLoopCount(mode: FileMode, wasEnabled: boolean, remaining: number): number {
  if (remaining <= 0) return 0;
  if (mode.kind === "all") return wasEnabled ? 0 : remaining;
  if (mode.kind === "inc") return wasEnabled ? 0 : 1;
  return Math.min(mode.count, remaining);
}

function falValidate(node: { operands: { value: string }[] }): string[] {
  const missing = requireOperands(["control", "length", "position", "mode", "expression", "dest"])(node);
  const expression = op(node, 4);
  if (!expression) return missing;
  return isValidExpression(expression)
    ? missing
    : [...missing, "Operand 'expression' must be a safe numeric expression."];
}

function executeFal(node: { operands: { value: string }[] }, ctx: InstructionRuntimeContext): boolean {
  const control = op(node, 0);
  if (!control) return ctx.rungIn;
  if (!ctx.rungIn) {
    resetFileControl(ctx, control);
    return false;
  }

  const length = clampLength(ctx.numeric(op(node, 1)));
  const positionOperand = op(node, 2);
  const mode = parseFileMode(ctx, op(node, 3));
  const expression = op(node, 4);
  const dest = op(node, 5);
  const wasEnabled = ctx.readBool(member(control, "EN"));
  let position = readPosition(ctx, control, positionOperand);
  if (!wasEnabled && position <= 0) position = Math.trunc(ctx.numeric(positionOperand));
  position = Math.max(0, Math.min(position, length));

  ctx.writeBool(member(control, "EN"), true);
  ctx.writeNumber(member(control, "LEN"), length);
  ctx.writeBool(member(control, "ER"), false);

  const remaining = length - position;
  const iterations = mode.kind === "all" ? remaining : fileLoopCount(mode, wasEnabled, remaining);
  for (let i = 0; i < iterations; i += 1) {
    const result = evaluateAt(ctx, expression, control, position);
    if (!result.ok || !Number.isFinite(result.value)) {
      ctx.writeBool(member(control, "ER"), true);
      break;
    }
    if (dest) ctx.writeNumber(resolvePositionedPath(dest, control, position), result.value);
    position += 1;
  }

  writePosition(ctx, control, positionOperand, position);
  ctx.writeBool(member(control, "DN"), position >= length);
  return ctx.rungIn;
}

function fscValidate(node: { operands: { value: string }[] }): string[] {
  const missing = requireOperands(["control", "length", "position", "mode", "expression"])(node);
  const expression = op(node, 4);
  if (!expression) return missing;
  return isValidExpression(expression)
    ? missing
    : [...missing, "Operand 'expression' must be a safe comparison expression."];
}

function executeFsc(node: { operands: { value: string }[] }, ctx: InstructionRuntimeContext): boolean {
  const control = op(node, 0);
  if (!control) return ctx.rungIn;
  if (!ctx.rungIn) {
    resetFileControl(ctx, control, true);
    return false;
  }

  const length = clampLength(ctx.numeric(op(node, 1)));
  const positionOperand = op(node, 2);
  const mode = parseFileMode(ctx, op(node, 3));
  const expression = op(node, 4);
  const wasEnabled = ctx.readBool(member(control, "EN"));
  let position = readPosition(ctx, control, positionOperand);
  if (!wasEnabled && position <= 0) position = Math.trunc(ctx.numeric(positionOperand));
  position = Math.max(0, Math.min(position, length));

  ctx.writeBool(member(control, "EN"), true);
  ctx.writeNumber(member(control, "LEN"), length);

  if (ctx.readBool(member(control, "IN"))) {
    writePosition(ctx, control, positionOperand, position);
    return ctx.rungIn;
  }

  ctx.writeBool(member(control, "FD"), false);
  const remaining = length - position;
  const iterations = mode.kind === "all" ? remaining : fileLoopCount(mode, wasEnabled, remaining);
  for (let i = 0; i < iterations; i += 1) {
    const result = evaluateComparisonAt(ctx, expression, control, position);
    const found = result.ok && Number.isFinite(result.value) && result.value !== 0;
    if (found) {
      ctx.writeBool(member(control, "FD"), true);
      ctx.writeBool(member(control, "IN"), true);
      writePosition(ctx, control, positionOperand, position);
      ctx.writeBool(member(control, "DN"), false);
      return ctx.rungIn;
    }
    position += 1;
  }

  writePosition(ctx, control, positionOperand, position);
  ctx.writeBool(member(control, "DN"), position >= length);
  return ctx.rungIn;
}

function executeLoad(
  node: { operands: { value: string }[] },
  ctx: InstructionRuntimeContext,
  stackIndex: number,
): boolean {
  const source = op(node, 0);
  const stack = op(node, stackIndex);
  const control = op(node, 2);
  const length = stackLength(ctx, op(node, 3));
  const positionOperand = op(node, 4);

  if (!control) return ctx.rungIn;
  if (!ctx.rungIn) {
    ctx.writeBool(member(control, "EN"), false);
    return false;
  }

  const wasEnabled = ctx.readBool(member(control, "EN"));
  ctx.writeBool(member(control, "EN"), true);
  let position = readPosition(ctx, control, positionOperand);
  const error = length < 0 || position < 0;
  if (error || wasEnabled || position >= length) {
    writeStackStatus(ctx, control, positionOperand, length, Math.max(0, position), error);
    return ctx.rungIn;
  }

  ctx.writeNumber(elementPath(ctx, stack, position), ctx.numeric(source));
  position += 1;
  writeStackStatus(ctx, control, positionOperand, length, position, false);
  return ctx.rungIn;
}

function executeFifoUnload(node: { operands: { value: string }[] }, ctx: InstructionRuntimeContext): boolean {
  const fifo = op(node, 0);
  const dest = op(node, 1);
  const control = op(node, 2);
  const length = stackLength(ctx, op(node, 3));
  const positionOperand = op(node, 4);

  if (!control) return ctx.rungIn;
  if (!ctx.rungIn) {
    ctx.writeBool(member(control, "EU"), false);
    return false;
  }

  const wasEnabled = ctx.readBool(member(control, "EU"));
  ctx.writeBool(member(control, "EU"), true);
  let position = readPosition(ctx, control, positionOperand);
  const error = length < 0 || position < 0;
  if (error || wasEnabled || position <= 0) {
    writeStackStatus(ctx, control, positionOperand, length, Math.max(0, position), error);
    return ctx.rungIn;
  }

  if (dest) ctx.writeNumber(dest, ctx.readNumber(elementPath(ctx, fifo, 0)));
  for (let index = 0; index < position - 1; index += 1) {
    ctx.writeNumber(elementPath(ctx, fifo, index), ctx.readNumber(elementPath(ctx, fifo, index + 1)));
  }
  ctx.writeNumber(elementPath(ctx, fifo, position - 1), 0);
  position -= 1;
  writeStackStatus(ctx, control, positionOperand, length, position, false);
  return ctx.rungIn;
}

function executeLifoUnload(node: { operands: { value: string }[] }, ctx: InstructionRuntimeContext): boolean {
  const lifo = op(node, 0);
  const dest = op(node, 1);
  const control = op(node, 2);
  const length = stackLength(ctx, op(node, 3));
  const positionOperand = op(node, 4);

  if (!control) return ctx.rungIn;
  if (!ctx.rungIn) {
    ctx.writeBool(member(control, "EU"), false);
    return false;
  }

  const wasEnabled = ctx.readBool(member(control, "EU"));
  ctx.writeBool(member(control, "EU"), true);
  let position = readPosition(ctx, control, positionOperand);
  const error = length < 0 || position < 0;
  if (error || wasEnabled || position <= 0) {
    writeStackStatus(ctx, control, positionOperand, length, Math.max(0, position), error);
    return ctx.rungIn;
  }

  position -= 1;
  if (dest) ctx.writeNumber(dest, ctx.readNumber(elementPath(ctx, lifo, position)));
  ctx.writeNumber(elementPath(ctx, lifo, position), 0);
  writeStackStatus(ctx, control, positionOperand, length, position, false);
  return ctx.rungIn;
}

/** AVE - File Average. Dest = mean of Length elements of Array while the rung is true. */
export const AVE: InstructionDefinition = {
  type: "AVE",
  displayName: "File Average",
  category: "file",
  description: "Dest = average of Length elements of Array (offline element-wise) while the rung is true.",
  operands: [
    { name: "array", label: "Array", required: true, direction: "read" },
    { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
  ],
  validate: requireOperands(["array", "dest", "control", "length"]),
  execute: (node, ctx) => {
    const control = operandValue(node, 2);
    if (!ctx.rungIn) {
      resetFileOpControl(ctx, control);
      return false;
    }
    const rawLength = Math.trunc(ctx.numeric(operandValue(node, 3)));
    const length = clampLength(rawLength);
    const dest = operandValue(node, 1);
    if (dest && length > 0) {
      const values = readElements(ctx, operandValue(node, 0), length);
      ctx.writeNumber(dest, values.reduce((sum, v) => sum + v, 0) / length);
    }
    writeFileOpStatus(ctx, control, length, rawLength < 0);
    return ctx.rungIn;
  },
  render: { symbol: "AVE", style: "box" },
};

/** STD - File Standard Deviation (sample, divides by N-1). */
export const STD: InstructionDefinition = {
  type: "STD",
  displayName: "File Standard Deviation",
  category: "file",
  description: "Dest = sample standard deviation of Length elements of Array (offline) while the rung is true.",
  operands: [
    { name: "array", label: "Array", required: true, direction: "read" },
    { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
  ],
  validate: requireOperands(["array", "dest", "control", "length"]),
  execute: (node, ctx) => {
    const control = operandValue(node, 2);
    if (!ctx.rungIn) {
      resetFileOpControl(ctx, control);
      return false;
    }
    const rawLength = Math.trunc(ctx.numeric(operandValue(node, 3)));
    const length = clampLength(rawLength);
    const dest = operandValue(node, 1);
    if (dest && length > 0) {
      const values = readElements(ctx, operandValue(node, 0), length);
      const mean = values.reduce((sum, v) => sum + v, 0) / length;
      const variance = length > 1
        ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (length - 1)
        : 0;
      ctx.writeNumber(dest, Math.sqrt(variance));
    }
    writeFileOpStatus(ctx, control, length, rawLength < 0);
    return ctx.rungIn;
  },
  render: { symbol: "STD", style: "box" },
};

/** SRT - File Sort. Sorts Length elements of Array ascending, in place. */
export const SRT: InstructionDefinition = {
  type: "SRT",
  displayName: "File Sort",
  category: "file",
  description: "Sorts Length elements of Array into ascending order (offline, in place) while the rung is true.",
  operands: [
    { name: "array", label: "Array", required: true, direction: "write" },
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
  ],
  validate: requireOperands(["array", "control", "length"]),
  execute: (node, ctx) => {
    const control = operandValue(node, 1);
    if (!ctx.rungIn) {
      resetFileOpControl(ctx, control);
      return false;
    }
    const rawLength = Math.trunc(ctx.numeric(operandValue(node, 2)));
    const length = clampLength(rawLength);
    if (length > 0) {
      const { base, start } = elementBase(ctx, operandValue(node, 0));
      const values: number[] = [];
      for (let i = 0; i < length; i += 1) values.push(ctx.readNumber(`${base}[${start + i}]`));
      values.sort((a, b) => a - b);
      for (let i = 0; i < length; i += 1) ctx.writeNumber(`${base}[${start + i}]`, values[i]!);
    }
    writeFileOpStatus(ctx, control, length, rawLength < 0);
    return ctx.rungIn;
  },
  render: { symbol: "SRT", style: "box" },
};

/** FAL - File Arithmetic/Logic. Evaluates Expression over file elements into Destination. */
export const FAL: InstructionDefinition = {
  type: "FAL",
  displayName: "File Arithmetic/Logic",
  category: "file",
  description: "Evaluates Expression over array elements according to Mode and stores each result in Destination.",
  operands: [
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "position", label: "Position", required: true, allowedTypes: NUMERIC, direction: "write" },
    { name: "mode", label: "Mode", required: true, isLabelRef: true, direction: "read" },
    { name: "expression", label: "Expression", required: true, direction: "read", isExpression: true },
    { name: "dest", label: "Destination", required: true, allowedTypes: NUMERIC, direction: "write" },
  ],
  validate: falValidate,
  execute: executeFal,
  render: { symbol: "FAL", style: "box" },
};

/** FSC - File Search/Compare. Searches until Expression evaluates true. */
export const FSC: InstructionDefinition = {
  type: "FSC",
  displayName: "File Search/Compare",
  category: "file",
  description: "Evaluates Expression across file elements until a true comparison is found or Length is reached.",
  operands: [
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "position", label: "Position", required: true, allowedTypes: NUMERIC, direction: "write" },
    { name: "mode", label: "Mode", required: true, isLabelRef: true, direction: "read" },
    { name: "expression", label: "Expression", required: true, direction: "read", isExpression: true },
  ],
  validate: fscValidate,
  execute: executeFsc,
  render: { symbol: "FSC", style: "box" },
};

/** SIZE - Size In Elements. Writes the declared Source dimension size to Dest. */
export const SIZE: InstructionDefinition = {
  type: "SIZE",
  displayName: "Size In Elements",
  category: "file",
  description: "Writes the declared size of Source's requested array dimension to Size while the rung is true.",
  operands: [
    { name: "source", label: "Source", required: true, direction: "read" },
    { name: "dimension", label: "Dimension", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "size", label: "Size", required: true, allowedTypes: NUMERIC, direction: "write" },
  ],
  validate: requireOperands(["source", "dimension", "size"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const size = operandValue(node, 2);
      const dimension = Math.trunc(ctx.numeric(operandValue(node, 1)));
      if (size) ctx.writeNumber(size, ctx.arrayDimension?.(operandValue(node, 0), dimension) ?? 0);
    }
    return ctx.rungIn;
  },
  render: { symbol: "SIZE", style: "box" },
};

export const FFL: InstructionDefinition = {
  type: "FFL",
  displayName: "FIFO Load",
  category: "file",
  description: "Loads Source into FIFO[Control.POS] on an enable edge, then advances Control.POS.",
  operands: [
    { name: "source", label: "Source", required: true, direction: "read" },
    { name: "fifo", label: "FIFO", required: true, direction: "write" },
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "position", label: "Position", required: false, allowedTypes: NUMERIC, direction: "write" },
  ],
  validate: requireOperands(["source", "fifo", "control", "length"]),
  execute: (node, ctx) => executeLoad(node, ctx, 1),
  render: { symbol: "FFL", style: "box" },
};

export const FFU: InstructionDefinition = {
  type: "FFU",
  displayName: "FIFO Unload",
  category: "file",
  description: "Unloads FIFO[0] to Dest on an enable edge, shifts the FIFO down, and decrements Control.POS.",
  operands: [
    { name: "fifo", label: "FIFO", required: true, direction: "read" },
    { name: "dest", label: "Dest", required: true, direction: "write" },
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "position", label: "Position", required: false, allowedTypes: NUMERIC, direction: "write" },
  ],
  validate: requireOperands(["fifo", "dest", "control", "length"]),
  execute: executeFifoUnload,
  render: { symbol: "FFU", style: "box" },
};

export const LFL: InstructionDefinition = {
  type: "LFL",
  displayName: "LIFO Load",
  category: "file",
  description: "Loads Source into LIFO[Control.POS] on an enable edge, then advances Control.POS.",
  operands: [
    { name: "source", label: "Source", required: true, direction: "read" },
    { name: "lifo", label: "LIFO", required: true, direction: "write" },
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "position", label: "Position", required: false, allowedTypes: NUMERIC, direction: "write" },
  ],
  validate: requireOperands(["source", "lifo", "control", "length"]),
  execute: (node, ctx) => executeLoad(node, ctx, 1),
  render: { symbol: "LFL", style: "box" },
};

export const LFU: InstructionDefinition = {
  type: "LFU",
  displayName: "LIFO Unload",
  category: "file",
  description: "Unloads LIFO[Control.POS - 1] to Dest on an enable edge and decrements Control.POS.",
  operands: [
    { name: "lifo", label: "LIFO", required: true, direction: "read" },
    { name: "dest", label: "Dest", required: true, direction: "write" },
    { name: "control", label: "Control", required: true, allowedTypes: CONTROL, direction: "write" },
    { name: "length", label: "Length", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "position", label: "Position", required: false, allowedTypes: NUMERIC, direction: "write" },
  ],
  validate: requireOperands(["lifo", "dest", "control", "length"]),
  execute: executeLifoUnload,
  render: { symbol: "LFU", style: "box" },
};

/** Executable + model-only file/array instructions, for bulk registration. */
export const FILE_ARRAY_INSTRUCTIONS: InstructionDefinition[] = [
  AVE, STD, SRT, FAL, FSC, SIZE, FFL, FFU, LFL, LFU,
];
