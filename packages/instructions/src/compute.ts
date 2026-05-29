import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

const NUMERIC = ["DINT", "REAL"];

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

type ExprToken =
  | { kind: "number"; value: number }
  | { kind: "path"; value: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "%" }
  | { kind: "lparen" }
  | { kind: "rparen" };

type ExprResult = { ok: true; value: number } | { ok: false };

const isIdentStart = (char: string): boolean => /[A-Za-z_]/.test(char);
const isIdentChar = (char: string): boolean => /[A-Za-z0-9_]/.test(char);
const isHexishChar = (char: string): boolean => /[0-9A-Fa-f]/.test(char);

function parseRadixLiteral(radixText: string, digits: string): number | undefined {
  const radix = Number(radixText);
  if (!Number.isInteger(radix) || radix < 2 || radix > 16 || digits.length === 0) return undefined;

  let value = 0;
  for (const char of digits) {
    const digit = Number.parseInt(char, 16);
    if (!Number.isInteger(digit) || digit >= radix) return undefined;
    value = value * radix + digit;
  }
  return value;
}

function tokenizeExpression(expression: string): ExprToken[] | undefined {
  const tokens: ExprToken[] = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i]!;
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (char === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/" || char === "%") {
      tokens.push({ kind: "op", value: char });
      i++;
      continue;
    }

    if (/\d/.test(char) || (char === "." && /\d/.test(expression[i + 1] ?? ""))) {
      const start = i;
      if (char === ".") {
        i++;
        while (/\d/.test(expression[i] ?? "")) i++;
      } else {
        while (/\d/.test(expression[i] ?? "")) i++;
        if (expression[i] === "#") {
          const radixText = expression.slice(start, i);
          i++;
          const digitsStart = i;
          while (isHexishChar(expression[i] ?? "")) i++;
          const value = parseRadixLiteral(radixText, expression.slice(digitsStart, i));
          if (value === undefined) return undefined;
          tokens.push({ kind: "number", value });
          continue;
        }
        if (expression[i] === ".") {
          i++;
          while (/\d/.test(expression[i] ?? "")) i++;
        }
      }

      const value = Number(expression.slice(start, i));
      if (!Number.isFinite(value)) return undefined;
      tokens.push({ kind: "number", value });
      continue;
    }

    if (isIdentStart(char)) {
      const start = i;
      i++;
      while (i < expression.length) {
        if (isIdentChar(expression[i] ?? "")) {
          i++;
        } else if (expression[i] === ".") {
          const memberStart = i + 1;
          if (!isIdentStart(expression[memberStart] ?? "")) return undefined;
          i = memberStart + 1;
          while (isIdentChar(expression[i] ?? "")) i++;
        } else if (expression[i] === "[") {
          i++;
          while (i < expression.length && expression[i] !== "]") i++;
          if (expression[i] !== "]") return undefined;
          i++;
        } else {
          break;
        }
      }
      tokens.push({ kind: "path", value: expression.slice(start, i) });
      continue;
    }

    return undefined;
  }

  return tokens;
}

class ArithmeticParser {
  private cursor = 0;

  constructor(
    private readonly tokens: ExprToken[],
    private readonly numeric: (operand: string) => number,
  ) {}

  parse(): ExprResult {
    const value = this.expression();
    if (value === undefined || this.cursor !== this.tokens.length || !Number.isFinite(value)) return { ok: false };
    return { ok: true, value };
  }

  private peek(): ExprToken | undefined {
    return this.tokens[this.cursor];
  }

  private take(): ExprToken | undefined {
    return this.tokens[this.cursor++];
  }

  private expression(): number | undefined {
    let left = this.term();
    if (left === undefined) return undefined;

    while (this.peek()?.kind === "op" && (this.peek() as { value: string }).value.match(/[+-]/)) {
      const op = (this.take() as Extract<ExprToken, { kind: "op" }>).value;
      const right = this.term();
      if (right === undefined) return undefined;
      left = op === "+" ? left + right : left - right;
      if (!Number.isFinite(left)) return undefined;
    }

    return left;
  }

  private term(): number | undefined {
    let left = this.factor();
    if (left === undefined) return undefined;

    while (this.peek()?.kind === "op" && (this.peek() as { value: string }).value.match(/[*/%]/)) {
      const op = (this.take() as Extract<ExprToken, { kind: "op" }>).value;
      const right = this.factor();
      if (right === undefined) return undefined;
      if (op === "*") left *= right;
      else if (op === "/") left = right === 0 ? 0 : left / right;
      else left = right === 0 ? 0 : left % right;
      if (!Number.isFinite(left)) return undefined;
    }

    return left;
  }

  private factor(): number | undefined {
    const token = this.take();
    if (!token) return undefined;

    if (token.kind === "op" && token.value === "-") {
      const value = this.factor();
      return value === undefined ? undefined : -value;
    }
    if (token.kind === "op" && token.value === "+") {
      return this.factor();
    }
    if (token.kind === "number") return token.value;
    if (token.kind === "path") {
      const value = this.numeric(token.value);
      return Number.isFinite(value) ? value : undefined;
    }
    if (token.kind === "lparen") {
      const value = this.expression();
      if (value === undefined || this.take()?.kind !== "rparen") return undefined;
      return value;
    }

    return undefined;
  }
}

function evaluateNumericExpression(
  expression: string,
  numeric: (operand: string) => number,
): ExprResult {
  const tokens = tokenizeExpression(expression);
  if (!tokens || tokens.length === 0) return { ok: false };
  return new ArithmeticParser(tokens, numeric).parse();
}

/** Truncate to a 32-bit signed integer for bitwise/masked operations. */
const i32 = (n: number): number => n | 0;

/** Two-source compute box: Dest = A op B while the rung is true. */
function binaryBox(
  type: string,
  displayName: string,
  description: string,
  op: (a: number, b: number) => number,
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "math",
    description,
    operands: [
      { name: "sourceA", label: "Source A", required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "sourceB", label: "Source B", required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    ],
    validate: requireOperands(["sourceA", "sourceB", "dest"]),
    execute: (node, ctx) => {
      if (ctx.rungIn) {
        const dest = operandValue(node, 2);
        if (dest) ctx.writeNumber(dest, op(ctx.numeric(operandValue(node, 0)), ctx.numeric(operandValue(node, 1))));
      }
      return ctx.rungIn;
    },
    render: { symbol: type, style: "box" },
  };
}

/** Single-source compute box: Dest = op(Source) while the rung is true. */
function unaryBox(
  type: string,
  displayName: string,
  description: string,
  op: (a: number) => number,
): InstructionDefinition {
  return {
    type,
    displayName,
    category: "math",
    description,
    operands: [
      { name: "source", label: "Source", required: true, allowedTypes: NUMERIC, direction: "read" },
      { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    ],
    validate: requireOperands(["source", "dest"]),
    execute: (node, ctx) => {
      if (ctx.rungIn) {
        const dest = operandValue(node, 1);
        if (dest) ctx.writeNumber(dest, op(ctx.numeric(operandValue(node, 0))));
      }
      return ctx.rungIn;
    },
    render: { symbol: type, style: "box" },
  };
}

// --- Bitwise (operate on 32-bit integers) ---
export const AND = binaryBox("AND", "Bitwise AND", "Dest = Source A AND Source B (bitwise).", (a, b) => i32(a) & i32(b));
export const OR = binaryBox("OR", "Bitwise OR", "Dest = Source A OR Source B (bitwise).", (a, b) => i32(a) | i32(b));
export const XOR = binaryBox("XOR", "Bitwise XOR", "Dest = Source A XOR Source B (bitwise).", (a, b) => i32(a) ^ i32(b));
export const NOT = unaryBox("NOT", "Bitwise NOT", "Dest = NOT Source (bitwise complement).", (a) => ~i32(a));

// --- Extended math ---
export const MOD = binaryBox("MOD", "Modulo", "Dest = Source A modulo Source B (0 when B = 0).", (a, b) => (b === 0 ? 0 : a % b));
export const SQR = unaryBox("SQR", "Square Root", "Dest = square root of Source (0 when negative).", (a) => (a < 0 ? 0 : Math.sqrt(a)));
export const NEG = unaryBox("NEG", "Negate", "Dest = -Source.", (a) => -a);
export const ABS = unaryBox("ABS", "Absolute Value", "Dest = |Source|.", (a) => Math.abs(a));

/** CPT - Compute. Evaluates a safe numeric expression into Dest while the rung is true. */
export const CPT: InstructionDefinition = {
  type: "CPT",
  displayName: "Compute",
  category: "math",
  description: "Dest = Expression when the rung is true.",
  operands: [
    { name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" },
    { name: "expression", label: "Expression", required: true, direction: "read" },
  ],
  validate: (node) => {
    const missing = requireOperands(["dest", "expression"])(node);
    const expression = operandValue(node, 1);
    if (!expression) return missing;
    const parsed = evaluateNumericExpression(expression, () => 0);
    return parsed.ok ? missing : [...missing, "Operand 'expression' must be a safe numeric expression."];
  },
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const dest = operandValue(node, 0);
      const expression = operandValue(node, 1);
      if (dest && expression) {
        const result = evaluateNumericExpression(expression, (operand) => ctx.numeric(operand));
        if (result.ok) ctx.writeNumber(dest, result.value);
      }
    }
    return ctx.rungIn;
  },
  render: { symbol: "CPT", style: "box" },
};

/** CLR - Clear. Sets Dest to 0 while the rung is true. */
export const CLR: InstructionDefinition = {
  type: "CLR",
  displayName: "Clear",
  category: "math",
  description: "Sets Dest to 0 when the rung is true.",
  operands: [{ name: "dest", label: "Dest", required: true, allowedTypes: NUMERIC, direction: "write" }],
  validate: requireOperands(["dest"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const dest = operandValue(node, 0);
      if (dest) ctx.writeNumber(dest, 0);
    }
    return ctx.rungIn;
  },
  render: { symbol: "CLR", style: "box" },
};

/**
 * LIM - Limit Test. Passes when Test is within the limits: when Low ≤ High it is
 * the inclusive range [Low, High]; when Low > High it is the circular range
 * (Test ≥ Low OR Test ≤ High), matching Logix behaviour.
 */
export const LIM: InstructionDefinition = {
  type: "LIM",
  displayName: "Limit Test",
  category: "compare",
  description: "Passes when Test is between the Low and High limits.",
  operands: [
    { name: "low", label: "Low Limit", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "test", label: "Test", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "high", label: "High Limit", required: true, allowedTypes: NUMERIC, direction: "read" },
  ],
  validate: requireOperands(["low", "test", "high"]),
  execute: (node, ctx) => {
    if (!ctx.rungIn) return false;
    const low = ctx.numeric(operandValue(node, 0));
    const test = ctx.numeric(operandValue(node, 1));
    const high = ctx.numeric(operandValue(node, 2));
    return low <= high ? test >= low && test <= high : test >= low || test <= high;
  },
  render: { symbol: "LIM", style: "function" },
};

/** MEQ - Masked Equal. Passes when (Source AND Mask) == (Compare AND Mask). */
export const MEQ: InstructionDefinition = {
  type: "MEQ",
  displayName: "Masked Equal",
  category: "compare",
  description: "Passes when Source equals Compare under the Mask bits.",
  operands: [
    { name: "source", label: "Source", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "mask", label: "Mask", required: true, allowedTypes: NUMERIC, direction: "read" },
    { name: "compare", label: "Compare", required: true, allowedTypes: NUMERIC, direction: "read" },
  ],
  validate: requireOperands(["source", "mask", "compare"]),
  execute: (node, ctx) => {
    if (!ctx.rungIn) return false;
    const source = i32(ctx.numeric(operandValue(node, 0)));
    const mask = i32(ctx.numeric(operandValue(node, 1)));
    const compare = i32(ctx.numeric(operandValue(node, 2)));
    return (source & mask) === (compare & mask);
  },
  render: { symbol: "MEQ", style: "function" },
};
