import type { HmiTagQuality, HmiTagValue } from "./runtime-tag-provider";

/**
 * Safe HMI expression evaluator. Expressions bind a property to a computed value
 * over live tags, e.g. `{Tank_Level} > {Tank_Setpoint}` or
 * `if({Motor_Running}, "RUN", "STOP")`.
 *
 * It NEVER uses `eval`/`Function`: the source is tokenized and parsed into an AST
 * and walked by hand, so an expression can only read the tags the resolver
 * exposes and call the small whitelisted function set — there is no path to
 * JavaScript globals, prototypes, or the host. Tag references are written in
 * braces (`{TagName}`, `{Program:MainProgram.Tag}`, `{System.CurrentScreen}`);
 * bare identifiers may only be `true`/`false`/`null` or a known function name.
 */

export type ExpressionQuality = HmiTagQuality;

export interface ExpressionDiagnostic {
  code: "syntax" | "unknown-tag" | "type" | "runtime";
  message: string;
}

export interface ExpressionResult {
  ok: boolean;
  value: HmiTagValue;
  quality: ExpressionQuality;
  diagnostics: ExpressionDiagnostic[];
  references: string[];
}

export interface ExpressionTagLookup {
  (path: string): { value: HmiTagValue; quality: HmiTagQuality } | undefined;
}

// ---- Tokenizer ---------------------------------------------------------------

type TokenType =
  | "number"
  | "string"
  | "ident"
  | "tag"
  | "op"
  | "lparen"
  | "rparen"
  | "comma"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const TWO_CHAR_OPS = new Set(["&&", "||", "==", "!=", ">=", "<="]);
const ONE_CHAR_OPS = new Set(["!", ">", "<", "+", "-", "*", "/", "%"]);

class Tokenizer {
  private pos = 0;
  constructor(private readonly src: string) {}

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]!;
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.pos += 1;
        continue;
      }
      if (ch === "{") {
        tokens.push(this.readTag());
        continue;
      }
      if (ch === '"' || ch === "'") {
        tokens.push(this.readString(ch));
        continue;
      }
      if (ch >= "0" && ch <= "9") {
        tokens.push(this.readNumber());
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        tokens.push(this.readIdent());
        continue;
      }
      if (ch === "(") {
        tokens.push({ type: "lparen", value: ch, pos: this.pos++ });
        continue;
      }
      if (ch === ")") {
        tokens.push({ type: "rparen", value: ch, pos: this.pos++ });
        continue;
      }
      if (ch === ",") {
        tokens.push({ type: "comma", value: ch, pos: this.pos++ });
        continue;
      }
      const two = this.src.slice(this.pos, this.pos + 2);
      if (TWO_CHAR_OPS.has(two)) {
        tokens.push({ type: "op", value: two, pos: this.pos });
        this.pos += 2;
        continue;
      }
      if (ONE_CHAR_OPS.has(ch)) {
        tokens.push({ type: "op", value: ch, pos: this.pos++ });
        continue;
      }
      throw new ExpressionSyntaxError(`Unexpected character "${ch}" at position ${this.pos}.`);
    }
    tokens.push({ type: "eof", value: "", pos: this.pos });
    return tokens;
  }

  private readTag(): Token {
    const start = this.pos;
    this.pos += 1; // {
    let path = "";
    while (this.pos < this.src.length && this.src[this.pos] !== "}") {
      path += this.src[this.pos];
      this.pos += 1;
    }
    if (this.src[this.pos] !== "}") {
      throw new ExpressionSyntaxError(`Unterminated tag reference starting at position ${start}.`);
    }
    this.pos += 1; // }
    const trimmed = path.trim();
    if (!trimmed) throw new ExpressionSyntaxError(`Empty tag reference at position ${start}.`);
    return { type: "tag", value: trimmed, pos: start };
  }

  private readString(quote: string): Token {
    const start = this.pos;
    this.pos += 1;
    let value = "";
    while (this.pos < this.src.length && this.src[this.pos] !== quote) {
      if (this.src[this.pos] === "\\" && this.pos + 1 < this.src.length) {
        value += this.src[this.pos + 1];
        this.pos += 2;
        continue;
      }
      value += this.src[this.pos];
      this.pos += 1;
    }
    if (this.src[this.pos] !== quote) {
      throw new ExpressionSyntaxError(`Unterminated string starting at position ${start}.`);
    }
    this.pos += 1;
    return { type: "string", value, pos: start };
  }

  private readNumber(): Token {
    const start = this.pos;
    let value = "";
    while (this.pos < this.src.length && /[0-9.]/.test(this.src[this.pos]!)) {
      value += this.src[this.pos];
      this.pos += 1;
    }
    return { type: "number", value, pos: start };
  }

  private readIdent(): Token {
    const start = this.pos;
    let value = "";
    while (this.pos < this.src.length && /[A-Za-z0-9_]/.test(this.src[this.pos]!)) {
      value += this.src[this.pos];
      this.pos += 1;
    }
    return { type: "ident", value, pos: start };
  }
}

class ExpressionSyntaxError extends Error {}

// ---- AST ---------------------------------------------------------------------

type Node =
  | { kind: "literal"; value: HmiTagValue }
  | { kind: "tag"; path: string }
  | { kind: "unary"; op: string; operand: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };

const FUNCTIONS = new Set(["if", "min", "max", "clamp", "round", "formatnumber"]);

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.parseOr();
    if (this.peek().type !== "eof") {
      throw new ExpressionSyntaxError(`Unexpected "${this.peek().value}" at position ${this.peek().pos}.`);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private next(): Token {
    return this.tokens[this.index++]!;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new ExpressionSyntaxError(`Expected ${type} but found "${token.value || "end of input"}".`);
    }
    return this.next();
  }

  private matchOp(...ops: string[]): Token | undefined {
    const token = this.peek();
    if (token.type === "op" && ops.includes(token.value)) return this.next();
    return undefined;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    let op = this.matchOp("||");
    while (op) {
      left = { kind: "binary", op: "||", left, right: this.parseAnd() };
      op = this.matchOp("||");
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseEquality();
    let op = this.matchOp("&&");
    while (op) {
      left = { kind: "binary", op: "&&", left, right: this.parseEquality() };
      op = this.matchOp("&&");
    }
    return left;
  }

  private parseEquality(): Node {
    let left = this.parseComparison();
    let op = this.matchOp("==", "!=");
    while (op) {
      left = { kind: "binary", op: op.value, left, right: this.parseComparison() };
      op = this.matchOp("==", "!=");
    }
    return left;
  }

  private parseComparison(): Node {
    let left = this.parseAdditive();
    let op = this.matchOp("<", "<=", ">", ">=");
    while (op) {
      left = { kind: "binary", op: op.value, left, right: this.parseAdditive() };
      op = this.matchOp("<", "<=", ">", ">=");
    }
    return left;
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    let op = this.matchOp("+", "-");
    while (op) {
      left = { kind: "binary", op: op.value, left, right: this.parseMultiplicative() };
      op = this.matchOp("+", "-");
    }
    return left;
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    let op = this.matchOp("*", "/", "%");
    while (op) {
      left = { kind: "binary", op: op.value, left, right: this.parseUnary() };
      op = this.matchOp("*", "/", "%");
    }
    return left;
  }

  private parseUnary(): Node {
    const op = this.matchOp("!", "-", "+");
    if (op) return { kind: "unary", op: op.value, operand: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const token = this.peek();
    if (token.type === "number") {
      this.next();
      const value = Number(token.value);
      if (!Number.isFinite(value)) throw new ExpressionSyntaxError(`Invalid number "${token.value}".`);
      return { kind: "literal", value };
    }
    if (token.type === "string") {
      this.next();
      return { kind: "literal", value: token.value };
    }
    if (token.type === "tag") {
      this.next();
      return { kind: "tag", path: token.value };
    }
    if (token.type === "lparen") {
      this.next();
      const node = this.parseOr();
      this.expect("rparen");
      return node;
    }
    if (token.type === "ident") {
      this.next();
      const lower = token.value.toLowerCase();
      if (this.peek().type === "lparen") {
        if (!FUNCTIONS.has(lower)) {
          throw new ExpressionSyntaxError(`Unknown function "${token.value}".`);
        }
        return { kind: "call", name: lower, args: this.parseArgs() };
      }
      if (lower === "true") return { kind: "literal", value: true };
      if (lower === "false") return { kind: "literal", value: false };
      if (lower === "null") return { kind: "literal", value: null };
      throw new ExpressionSyntaxError(
        `Unknown identifier "${token.value}" (tags must be written as {${token.value}}).`,
      );
    }
    throw new ExpressionSyntaxError(`Unexpected "${token.value || "end of input"}" at position ${token.pos}.`);
  }

  private parseArgs(): Node[] {
    this.expect("lparen");
    const args: Node[] = [];
    if (this.peek().type === "rparen") {
      this.next();
      return args;
    }
    args.push(this.parseOr());
    while (this.peek().type === "comma") {
      this.next();
      args.push(this.parseOr());
    }
    this.expect("rparen");
    return args;
  }
}

// ---- Evaluation --------------------------------------------------------------

interface EvalState {
  lookup: ExpressionTagLookup;
  diagnostics: ExpressionDiagnostic[];
  references: Set<string>;
  quality: ExpressionQuality;
}

function downgrade(state: EvalState, quality: ExpressionQuality): void {
  if (quality === "bad") state.quality = "bad";
  else if (quality === "uncertain" && state.quality === "good") state.quality = "uncertain";
}

function truthy(value: HmiTagValue): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  return false;
}

function toNumber(state: EvalState, value: HmiTagValue): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  state.diagnostics.push({ code: "type", message: `Value "${String(value)}" is not numeric.` });
  downgrade(state, "uncertain");
  return NaN;
}

function evalNode(node: Node, state: EvalState): HmiTagValue {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "tag": {
      state.references.add(node.path);
      const resolved = state.lookup(node.path);
      if (!resolved) {
        state.diagnostics.push({ code: "unknown-tag", message: `Tag "${node.path}" is not defined.` });
        downgrade(state, "bad");
        return null;
      }
      downgrade(state, resolved.quality);
      return resolved.value;
    }
    case "unary": {
      if (node.op === "!") return !truthy(evalNode(node.operand, state));
      const n = toNumber(state, evalNode(node.operand, state));
      return node.op === "-" ? -n : n;
    }
    case "binary":
      return evalBinary(node, state);
    case "call":
      return evalCall(node, state);
  }
}

function evalBinary(node: Extract<Node, { kind: "binary" }>, state: EvalState): HmiTagValue {
  // Short-circuit logical operators.
  if (node.op === "&&") {
    return truthy(evalNode(node.left, state)) ? truthy(evalNode(node.right, state)) : false;
  }
  if (node.op === "||") {
    return truthy(evalNode(node.left, state)) ? true : truthy(evalNode(node.right, state));
  }

  const left = evalNode(node.left, state);
  const right = evalNode(node.right, state);

  if (node.op === "==" || node.op === "!=") {
    const equal = looseEqual(left, right);
    return node.op === "==" ? equal : !equal;
  }

  const a = toNumber(state, left);
  const b = toNumber(state, right);
  switch (node.op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      if (b === 0) {
        state.diagnostics.push({ code: "runtime", message: "Division by zero." });
        downgrade(state, "bad");
        return null;
      }
      return a / b;
    case "%":
      if (b === 0) {
        state.diagnostics.push({ code: "runtime", message: "Modulo by zero." });
        downgrade(state, "bad");
        return null;
      }
      return a % b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    default:
      state.diagnostics.push({ code: "syntax", message: `Unsupported operator "${node.op}".` });
      return null;
  }
}

function looseEqual(left: HmiTagValue, right: HmiTagValue): boolean {
  if (typeof left === "number" && typeof right === "string") return left === Number(right);
  if (typeof left === "string" && typeof right === "number") return Number(left) === right;
  return left === right;
}

function evalCall(node: Extract<Node, { kind: "call" }>, state: EvalState): HmiTagValue {
  switch (node.name) {
    case "if": {
      if (node.args.length !== 3) {
        state.diagnostics.push({ code: "syntax", message: "if(condition, whenTrue, whenFalse) requires 3 arguments." });
        return null;
      }
      // Lazy: only the taken branch is evaluated.
      return truthy(evalNode(node.args[0]!, state))
        ? evalNode(node.args[1]!, state)
        : evalNode(node.args[2]!, state);
    }
    case "min":
    case "max": {
      if (node.args.length === 0) {
        state.diagnostics.push({ code: "syntax", message: `${node.name}() requires at least one argument.` });
        return null;
      }
      const values = node.args.map((arg) => toNumber(state, evalNode(arg, state)));
      return node.name === "min" ? Math.min(...values) : Math.max(...values);
    }
    case "clamp": {
      if (node.args.length !== 3) {
        state.diagnostics.push({ code: "syntax", message: "clamp(value, low, high) requires 3 arguments." });
        return null;
      }
      const value = toNumber(state, evalNode(node.args[0]!, state));
      const low = toNumber(state, evalNode(node.args[1]!, state));
      const high = toNumber(state, evalNode(node.args[2]!, state));
      return Math.min(Math.max(value, low), high);
    }
    case "round": {
      const value = toNumber(state, evalNode(node.args[0]!, state));
      const digits = node.args[1] ? toNumber(state, evalNode(node.args[1]!, state)) : 0;
      const factor = 10 ** Math.max(0, Math.trunc(digits));
      return Math.round(value * factor) / factor;
    }
    case "formatnumber": {
      const value = toNumber(state, evalNode(node.args[0]!, state));
      const digits = node.args[1] ? toNumber(state, evalNode(node.args[1]!, state)) : 0;
      if (!Number.isFinite(value)) return "";
      return value.toFixed(Math.max(0, Math.min(20, Math.trunc(digits))));
    }
    default:
      state.diagnostics.push({ code: "syntax", message: `Unknown function "${node.name}".` });
      return null;
  }
}

/**
 * Evaluate an HMI expression against a tag lookup. Always returns a result —
 * syntax errors, unknown tags, and runtime errors surface as diagnostics with a
 * degraded quality rather than throwing.
 */
export function evaluateHmiExpression(source: string, lookup: ExpressionTagLookup): ExpressionResult {
  const state: EvalState = { lookup, diagnostics: [], references: new Set(), quality: "good" };
  if (!source.trim()) {
    return {
      ok: false,
      value: null,
      quality: "bad",
      diagnostics: [{ code: "syntax", message: "Expression is empty." }],
      references: [],
    };
  }
  let ast: Node;
  try {
    ast = new Parser(new Tokenizer(source).tokenize()).parse();
  } catch (error) {
    const message = error instanceof ExpressionSyntaxError ? error.message : "Invalid expression.";
    return {
      ok: false,
      value: null,
      quality: "bad",
      diagnostics: [{ code: "syntax", message }],
      references: [],
    };
  }
  const value = evalNode(ast, state);
  const hasError = state.diagnostics.some((d) => d.code === "syntax" || d.code === "unknown-tag" || d.code === "runtime");
  return {
    ok: !hasError,
    value,
    quality: state.quality,
    diagnostics: state.diagnostics,
    references: [...state.references],
  };
}

/** Extract the tag references in an expression without evaluating it. */
export function expressionTagReferences(source: string): string[] {
  try {
    const tokens = new Tokenizer(source).tokenize();
    const seen = new Set<string>();
    for (const token of tokens) if (token.type === "tag") seen.add(token.value);
    return [...seen];
  } catch {
    return [];
  }
}
