/**
 * Shared expression engine for the CPT (Compute) and CMP (Compare) instructions.
 *
 * Logix CPT/CMP share one expression grammar: arithmetic (+ - * / MOD ** with the
 * `%` synonym), relational (< <= > >= = <>), bitwise/logical (AND OR XOR NOT),
 * parentheses, numeric and radix literals (`16#FF`, `2#1010`), tag / member /
 * array-element paths, and a fixed set of math functions (ABS, SIN, COS, TAN,
 * ASN/ASIN, ACS/ACOS, ATN/ATAN, LN, LOG, SQR/SQRT, TRN/TRUNC, DEG, RAD). This is
 * a single recursive-descent evaluator so both instructions stay consistent and
 * there is one place that defines "a safe expression".
 *
 * Semantics chosen to match Logix:
 *  - Relational/equality operators yield 1 or 0.
 *  - AND/OR/XOR/NOT are **bitwise** on 32-bit integers (NOT is a bitwise
 *    complement, not a logical negation) — the same footgun Studio 5000 has.
 *  - Division / modulo by zero yields 0 (deterministic, never a crash).
 *
 * {@link evaluateExpression} returns `ok:false` ONLY for a syntax error
 * (unbalanced parens, an unknown function, a stray comma, an invalid radix
 * literal, a trailing operator, …). A syntactically valid expression always
 * returns `ok:true` with a numeric `value`, which MAY be non-finite for a
 * domain error such as `LN(0)` or `SQRT(-1)`; the caller decides how to treat a
 * non-finite value (CPT guards it to 0, CMP treats it as false). Keeping domain
 * errors out of `ok` means validation (which resolves every tag to 0) never
 * flags an otherwise-valid expression like `LN(level)`.
 */

/** Resolve a tag / member / element path to a number (literals are handled by the parser). */
export type ResolvePath = (path: string) => number;

export type ExpressionResult = { ok: true; value: number } | { ok: false };

/** Truncate to a 32-bit signed integer for the bitwise operators. */
const i32 = (n: number): number => n | 0;

/** Math functions usable inside an expression. Names are matched case-insensitively. */
const FUNCTIONS: Record<string, (x: number) => number> = {
  ABS: Math.abs,
  SIN: Math.sin,
  COS: Math.cos,
  TAN: Math.tan,
  ASN: Math.asin,
  ASIN: Math.asin,
  ACS: Math.acos,
  ACOS: Math.acos,
  ATN: Math.atan,
  ATAN: Math.atan,
  LN: Math.log,
  LOG: Math.log10,
  SQR: Math.sqrt,
  SQRT: Math.sqrt,
  TRN: Math.trunc,
  TRUNC: Math.trunc,
  DEG: (x) => (x * 180) / Math.PI,
  RAD: (x) => (x * Math.PI) / 180,
};

/** Keyword operators (lexed from identifiers, matched case-insensitively). */
const KEYWORD_OPS = new Set(["MOD", "AND", "OR", "XOR", "NOT"]);

type Token =
  | { k: "num"; v: number }
  | { k: "path"; v: string }
  | { k: "func"; v: string }
  | { k: "op"; v: string }
  | { k: "lp" }
  | { k: "rp" };

const isIdentStart = (char: string): boolean => /[A-Za-z_]/.test(char);
const isIdentChar = (char: string): boolean => /[A-Za-z0-9_]/.test(char);
const isHexishChar = (char: string): boolean => /[0-9A-Fa-f]/.test(char);

/** Parse a Logix radix literal body (`16#FF`); returns undefined for an invalid digit/radix. */
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

/** Next non-whitespace character index at or after `from`. */
function skipSpace(expression: string, from: number): number {
  let i = from;
  while (i < expression.length && /\s/.test(expression[i]!)) i++;
  return i;
}

function tokenize(expression: string): Token[] | undefined {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i]!;
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === "(") {
      tokens.push({ k: "lp" });
      i++;
      continue;
    }
    if (char === ")") {
      tokens.push({ k: "rp" });
      i++;
      continue;
    }

    // Multi-character operators first, then single-character.
    const two = expression.slice(i, i + 2);
    if (two === "**") {
      tokens.push({ k: "op", v: "**" });
      i += 2;
      continue;
    }
    if (two === "<=" || two === ">=" || two === "<>") {
      tokens.push({ k: "op", v: two });
      i += 2;
      continue;
    }
    if (two === "==") {
      tokens.push({ k: "op", v: "=" });
      i += 2;
      continue;
    }
    if (two === "!=") {
      tokens.push({ k: "op", v: "<>" });
      i += 2;
      continue;
    }
    if ("+-*/%<>=".includes(char)) {
      tokens.push({ k: "op", v: char });
      i++;
      continue;
    }

    // Numeric / radix literal.
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
          tokens.push({ k: "num", v: value });
          continue;
        }
        if (expression[i] === ".") {
          i++;
          while (/\d/.test(expression[i] ?? "")) i++;
        }
      }
      const value = Number(expression.slice(start, i));
      if (!Number.isFinite(value)) return undefined;
      tokens.push({ k: "num", v: value });
      continue;
    }

    // Identifier: a function call, a keyword operator, or a tag/member/element path.
    if (isIdentStart(char)) {
      const identStart = i;
      i++;
      while (i < expression.length && isIdentChar(expression[i] ?? "")) i++;
      const ident = expression.slice(identStart, i);
      const upper = ident.toUpperCase();

      // A bare identifier immediately followed by '(' and known as a function → a call.
      if (FUNCTIONS[upper] && expression[skipSpace(expression, i)] === "(") {
        tokens.push({ k: "func", v: upper });
        continue;
      }
      // A reserved operator keyword (MOD/AND/OR/XOR/NOT).
      if (KEYWORD_OPS.has(upper)) {
        tokens.push({ k: "op", v: upper });
        continue;
      }
      // Otherwise a path: continue consuming `.member` and `[index]` segments.
      while (i < expression.length) {
        if (expression[i] === ".") {
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
      tokens.push({ k: "path", v: expression.slice(identStart, i) });
      continue;
    }

    return undefined; // unknown character (e.g. a comma)
  }

  return tokens;
}

/**
 * Recursive-descent evaluator. Each level returns a number, or `undefined` on a
 * syntax error. Precedence, lowest to highest:
 *   OR · XOR · AND · (= <>) · (< <= > >=) · (+ -) · (* / % MOD) · unary(- + NOT)
 *   · ** (right-assoc) · primary
 */
class ExpressionParser {
  private cursor = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly resolve: ResolvePath,
  ) {}

  evaluate(): number | undefined {
    const value = this.orExpr();
    if (value === undefined || this.cursor !== this.tokens.length) return undefined;
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.cursor];
  }

  private isOp(...ops: string[]): boolean {
    const token = this.peek();
    return token?.k === "op" && ops.includes(token.v);
  }

  /** Left-associative binary level driven by an operator set and a combiner. */
  private binaryLevel(
    next: () => number | undefined,
    ops: string[],
    combine: (a: number, op: string, b: number) => number,
  ): number | undefined {
    let left = next();
    if (left === undefined) return undefined;
    while (this.isOp(...ops)) {
      const op = (this.tokens[this.cursor++] as { v: string }).v;
      const right = next();
      if (right === undefined) return undefined;
      left = combine(left, op, right);
    }
    return left;
  }

  private orExpr(): number | undefined {
    return this.binaryLevel(() => this.xorExpr(), ["OR"], (a, _op, b) => i32(a) | i32(b));
  }

  private xorExpr(): number | undefined {
    return this.binaryLevel(() => this.andExpr(), ["XOR"], (a, _op, b) => i32(a) ^ i32(b));
  }

  private andExpr(): number | undefined {
    return this.binaryLevel(() => this.equalityExpr(), ["AND"], (a, _op, b) => i32(a) & i32(b));
  }

  private equalityExpr(): number | undefined {
    return this.binaryLevel(
      () => this.relationalExpr(),
      ["=", "<>"],
      (a, op, b) => (op === "=" ? (a === b ? 1 : 0) : a !== b ? 1 : 0),
    );
  }

  private relationalExpr(): number | undefined {
    return this.binaryLevel(
      () => this.additiveExpr(),
      ["<", "<=", ">", ">="],
      (a, op, b) => {
        switch (op) {
          case "<":
            return a < b ? 1 : 0;
          case "<=":
            return a <= b ? 1 : 0;
          case ">":
            return a > b ? 1 : 0;
          default:
            return a >= b ? 1 : 0;
        }
      },
    );
  }

  private additiveExpr(): number | undefined {
    return this.binaryLevel(
      () => this.multiplicativeExpr(),
      ["+", "-"],
      (a, op, b) => (op === "+" ? a + b : a - b),
    );
  }

  private multiplicativeExpr(): number | undefined {
    return this.binaryLevel(
      () => this.unaryExpr(),
      ["*", "/", "%", "MOD"],
      (a, op, b) => {
        if (op === "*") return a * b;
        if (op === "/") return b === 0 ? 0 : a / b;
        return b === 0 ? 0 : a % b; // % and MOD
      },
    );
  }

  private unaryExpr(): number | undefined {
    if (this.isOp("-", "+", "NOT")) {
      const op = (this.tokens[this.cursor++] as { v: string }).v;
      const value = this.unaryExpr();
      if (value === undefined) return undefined;
      if (op === "-") return -value;
      if (op === "NOT") return ~i32(value);
      return value; // unary '+'
    }
    return this.powerExpr();
  }

  private powerExpr(): number | undefined {
    const base = this.primary();
    if (base === undefined) return undefined;
    if (this.isOp("**")) {
      this.cursor++;
      const exponent = this.unaryExpr(); // right-associative; allows `2 ** -1`
      if (exponent === undefined) return undefined;
      return Math.pow(base, exponent);
    }
    return base;
  }

  private primary(): number | undefined {
    const token = this.tokens[this.cursor++];
    if (!token) return undefined;
    if (token.k === "num") return token.v;
    if (token.k === "path") return this.resolve(token.v);
    if (token.k === "lp") {
      const value = this.orExpr();
      if (value === undefined || this.tokens[this.cursor++]?.k !== "rp") return undefined;
      return value;
    }
    if (token.k === "func") {
      if (this.tokens[this.cursor++]?.k !== "lp") return undefined;
      const arg = this.orExpr();
      if (arg === undefined || this.tokens[this.cursor++]?.k !== "rp") return undefined;
      return FUNCTIONS[token.v]!(arg);
    }
    return undefined; // an operator or ')' where a value was expected
  }
}

/**
 * Evaluate a CPT/CMP expression, resolving tag paths via `resolve`. Returns
 * `ok:false` for a syntax error; otherwise `ok:true` with the numeric value
 * (which may be non-finite for a domain error — the caller guards that).
 */
export function evaluateExpression(expression: string, resolve: ResolvePath): ExpressionResult {
  const tokens = tokenize(expression);
  if (!tokens || tokens.length === 0) return { ok: false };
  const value = new ExpressionParser(tokens, resolve).evaluate();
  return value === undefined ? { ok: false } : { ok: true, value };
}

/** True when `expression` is syntactically valid (tags resolve to 0 for the check). */
export function isValidExpression(expression: string): boolean {
  return evaluateExpression(expression, () => 0).ok;
}

/**
 * Distinct tag / member / element paths referenced by an expression — the
 * operands a validator should check exist. Numeric and radix literals, function
 * names, and operators are excluded. Returns [] for a syntactically invalid
 * expression (its validity is reported separately, so paths aren't guessed).
 */
export function referencedPaths(expression: string): string[] {
  const tokens = tokenize(expression);
  if (!tokens) return [];
  const paths = new Set<string>();
  for (const token of tokens) {
    if (token.k === "path") paths.add(token.v);
  }
  return [...paths];
}
