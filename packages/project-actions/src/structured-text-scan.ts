import {
  createDefaultRegistry,
  evaluateExpression,
  parseJsrParameterLayout,
  parseNumericLiteral,
  type InstructionRuntimeContext,
  type InstructionDefinition,
} from "@esco/instructions";
import { tokenizeStructuredText, type StructuredTextToken } from "@esco/parser-l5x";
import type { PlcValue, TagMemory, TraceEntry } from "@esco/simulator";

type PathTypeResolver = (path: string) => string | undefined;

interface ExecutionStatus {
  exitRequested: boolean;
  returnRequested: boolean;
  returnParameters: string[];
}

interface ExecuteStructuredTextOptions {
  source: string;
  memory: TagMemory;
  typeOfPath?: PathTypeResolver;
  trace?: TraceEntry[];
  inputParameters?: string[];
  callRoutine?: (name: string, rawParameters: string[], line: number) => void;
  deltaMs?: number;
  arrayDimension?: (source: string, dimension: number) => number | undefined;
}

const CONTROL_KEYWORDS = new Set([
  "IF", "ELSIF", "ELSE", "END_IF", "THEN",
  "CASE", "OF", "END_CASE",
  "FOR", "TO", "BY", "DO", "END_FOR",
  "WHILE", "END_WHILE",
  "REPEAT", "UNTIL", "END_REPEAT",
  "EXIT", "RETURN",
]);
const BLOCK_STARTS = new Set(["IF", "CASE", "FOR", "WHILE", "REPEAT"]);
const BLOCK_ENDS = new Set(["END_IF", "END_CASE", "END_FOR", "END_WHILE", "END_REPEAT"]);
const STRING_RELATIONAL_OPS = new Set(["=", "<>", "<", "<=", ">", ">="]);
const LOGICAL_OR_KEYWORDS = new Set(["OR", "XOR"]);
const LOGICAL_AND_KEYWORDS = new Set(["AND"]);
const LOGICAL_AND_OPERATORS = new Set(["&"]);
const MAX_ST_LOOP_ITERATIONS = 1024;
const ST_INSTRUCTION_REGISTRY = createDefaultRegistry();
const TYPED_NUMERIC_PREFIXES = new Set([
  "SINT",
  "INT",
  "DINT",
  "LINT",
  "USINT",
  "UINT",
  "UDINT",
  "ULINT",
  "REAL",
  "LREAL",
]);

function executableTokens(source: string): StructuredTextToken[] {
  return tokenizeStructuredText(source).filter((token) => token.kind !== "comment");
}

function upper(token: StructuredTextToken | undefined): string {
  return token?.value.toUpperCase() ?? "";
}

function isKeyword(token: StructuredTextToken | undefined, keyword: string): boolean {
  return token?.kind === "keyword" && upper(token) === keyword;
}

function isWordToken(token: StructuredTextToken | undefined): boolean {
  return !!token && (token.kind === "identifier" || token.kind === "keyword" || token.kind === "number");
}

function expressionTokenValue(token: StructuredTextToken): string {
  const value = token.value;
  if (token.kind === "keyword") {
    const keyword = value.toUpperCase();
    if (keyword === "TRUE") return "1";
    if (keyword === "FALSE") return "0";
    return keyword;
  }
  return value;
}

function joinExpression(tokens: StructuredTextToken[]): string {
  let out = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const previous = tokens[index - 1];
    if (out && isWordToken(previous) && isWordToken(token)) out += " ";
    out += expressionTokenValue(token);
  }
  return stripTypedNumericPrefixes(out);
}

function joinPath(tokens: StructuredTextToken[]): string {
  return tokens.map((token) => token.value).join("").trim();
}

function stripTypedNumericPrefixes(expression: string): string {
  return expression.replace(/\b([A-Za-z][A-Za-z0-9_]*)#([0-9A-Fa-f_.]+)\b/g, (_match, typeName: string, digits: string) =>
    TYPED_NUMERIC_PREFIXES.has(typeName.toUpperCase()) ? digits.replace(/_/g, "") : `${typeName}#${digits}`,
  );
}

function stringLiteralValue(text: string): string {
  const body = text.startsWith("'") && text.endsWith("'") ? text.slice(1, -1) : text;
  return body.replace(/\$([nNrRtT'$])/g, (_match, code: string) => {
    const normalized = code.toUpperCase();
    if (normalized === "N") return "\n";
    if (normalized === "R") return "\r";
    if (normalized === "T") return "\t";
    return code;
  });
}

function readUntilKeyword(
  tokens: StructuredTextToken[],
  start: number,
  keyword: string,
): { segment: StructuredTextToken[]; next: number } {
  const segment: StructuredTextToken[] = [];
  let parens = 0;
  let brackets = 0;
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token.kind === "punctuation") {
      if (token.value === "(") parens += 1;
      else if (token.value === ")") parens = Math.max(0, parens - 1);
      else if (token.value === "[") brackets += 1;
      else if (token.value === "]") brackets = Math.max(0, brackets - 1);
    }
    if (parens === 0 && brackets === 0 && isKeyword(token, keyword)) {
      return { segment, next: index + 1 };
    }
    segment.push(token);
    index += 1;
  }
  return { segment, next: index };
}

function readStatement(tokens: StructuredTextToken[], start: number): { statement: StructuredTextToken[]; next: number } {
  const statement: StructuredTextToken[] = [];
  let parens = 0;
  let brackets = 0;
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (parens === 0 && brackets === 0 && token.kind === "keyword" && CONTROL_KEYWORDS.has(upper(token))) break;
    if (token.kind === "punctuation") {
      if (token.value === "(") parens += 1;
      else if (token.value === ")") parens = Math.max(0, parens - 1);
      else if (token.value === "[") brackets += 1;
      else if (token.value === "]") brackets = Math.max(0, brackets - 1);
      else if (token.value === ";" && parens === 0 && brackets === 0) {
        return { statement, next: index + 1 };
      }
    }
    statement.push(token);
    index += 1;
  }
  return { statement, next: index };
}

function topLevelAssignmentIndex(tokens: StructuredTextToken[]): number {
  let parens = 0;
  let brackets = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === "punctuation") {
      if (token.value === "(") parens += 1;
      else if (token.value === ")") parens = Math.max(0, parens - 1);
      else if (token.value === "[") brackets += 1;
      else if (token.value === "]") brackets = Math.max(0, brackets - 1);
    }
    if (parens === 0 && brackets === 0 && token.kind === "operator" && token.value === ":=") return index;
  }
  return -1;
}

interface AssignmentOperator {
  assignAt: number;
  targetEnd: number;
  expressionStart: number;
  nonRetentive: boolean;
}

function topLevelAssignmentOperator(tokens: StructuredTextToken[]): AssignmentOperator | undefined {
  let parens = 0;
  let brackets = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (
      parens === 0 &&
      brackets === 0 &&
      token.kind === "punctuation" &&
      token.value === "[" &&
      tokens[index + 1]?.kind === "operator" &&
      tokens[index + 1]?.value === ":=" &&
      tokens[index + 2]?.kind === "punctuation" &&
      tokens[index + 2]?.value === "]"
    ) {
      return { assignAt: index + 1, targetEnd: index, expressionStart: index + 3, nonRetentive: true };
    }
    if (token.kind === "punctuation") {
      if (token.value === "(") parens += 1;
      else if (token.value === ")") parens = Math.max(0, parens - 1);
      else if (token.value === "[") brackets += 1;
      else if (token.value === "]") brackets = Math.max(0, brackets - 1);
    }
    if (parens === 0 && brackets === 0 && token.kind === "operator" && token.value === ":=") {
      return { assignAt: index, targetEnd: index, expressionStart: index + 1, nonRetentive: false };
    }
  }
  return undefined;
}

function topLevelColonIndex(tokens: StructuredTextToken[], end = tokens.length): number {
  let parens = 0;
  let brackets = 0;
  for (let index = 0; index < end; index += 1) {
    const token = tokens[index]!;
    if (token.kind === "punctuation") {
      if (token.value === "(") parens += 1;
      else if (token.value === ")") parens = Math.max(0, parens - 1);
      else if (token.value === "[") brackets += 1;
      else if (token.value === "]") brackets = Math.max(0, brackets - 1);
    }
    if (
      parens === 0 &&
      brackets === 0 &&
      token.kind === "operator" &&
      token.value === ":" &&
      upper(tokens[index - 1]) !== "PROGRAM"
    ) {
      return index;
    }
  }
  return -1;
}

function singlePath(tokens: StructuredTextToken[]): string | undefined {
  if (tokens.length === 0) return undefined;
  const path = joinPath(tokens);
  return /^[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:\[[^\]]+])*$/.test(path)
    ? path
    : undefined;
}

function compactExpressionTokens(tokens: StructuredTextToken[]): StructuredTextToken[] {
  return trimStatementTerminator(tokens).filter((token) => token.value.trim() !== "");
}

function stripEnclosingParens(tokens: StructuredTextToken[]): StructuredTextToken[] {
  let current = compactExpressionTokens(tokens);
  while (
    current.length >= 2 &&
    current[0]?.kind === "punctuation" &&
    current[0].value === "(" &&
    current[current.length - 1]?.kind === "punctuation" &&
    current[current.length - 1]!.value === ")"
  ) {
    let depth = 0;
    let wraps = true;
    for (let index = 0; index < current.length; index += 1) {
      const token = current[index]!;
      if (token.kind !== "punctuation") continue;
      if (token.value === "(") depth += 1;
      else if (token.value === ")") depth -= 1;
      if (depth === 0 && index < current.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    current = compactExpressionTokens(current.slice(1, -1));
  }
  return current;
}

function topLevelRelationalIndex(tokens: StructuredTextToken[]): number {
  let parens = 0;
  let brackets = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === "punctuation") {
      if (token.value === "(") parens += 1;
      else if (token.value === ")") parens = Math.max(0, parens - 1);
      else if (token.value === "[") brackets += 1;
      else if (token.value === "]") brackets = Math.max(0, brackets - 1);
    }
    if (
      parens === 0 &&
      brackets === 0 &&
      token.kind === "operator" &&
      STRING_RELATIONAL_OPS.has(token.value)
    ) {
      return index;
    }
  }
  return -1;
}

function topLevelLogicalIndex(
  tokens: StructuredTextToken[],
  keywords: Set<string>,
  operators = new Set<string>(),
): number {
  let parens = 0;
  let brackets = 0;
  let candidate = -1;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === "punctuation") {
      if (token.value === "(") parens += 1;
      else if (token.value === ")") parens = Math.max(0, parens - 1);
      else if (token.value === "[") brackets += 1;
      else if (token.value === "]") brackets = Math.max(0, brackets - 1);
    }
    if (parens === 0 && brackets === 0) {
      if (keywords.has(upper(token))) candidate = index;
      else if (token.kind === "operator" && operators.has(token.value)) candidate = index;
    }
  }
  return candidate;
}

function stringComparableValue(tokens: StructuredTextToken[], memory: TagMemory): string | undefined {
  const valueTokens = stripEnclosingParens(tokens);
  if (valueTokens.length === 1 && valueTokens[0]!.kind === "string") {
    return stringLiteralValue(valueTokens[0]!.value);
  }
  const path = singlePath(valueTokens);
  if (!path) return undefined;
  const value = memory.read(path);
  return typeof value === "string" ? value : undefined;
}

function compareStrings(left: string, operator: string, right: string): boolean {
  switch (operator) {
    case "=":
      return left === right;
    case "<>":
      return left !== right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    default:
      return false;
  }
}

function evaluateStringComparison(tokens: StructuredTextToken[], memory: TagMemory): boolean | undefined {
  const expression = stripEnclosingParens(tokens);
  const operatorAt = topLevelRelationalIndex(expression);
  if (operatorAt <= 0 || operatorAt >= expression.length - 1) return undefined;
  const left = stringComparableValue(expression.slice(0, operatorAt), memory);
  const right = stringComparableValue(expression.slice(operatorAt + 1), memory);
  if (left === undefined || right === undefined) return undefined;
  return compareStrings(left, expression[operatorAt]!.value, right);
}

interface BooleanExpressionResult {
  value: boolean;
  usesStringComparison: boolean;
}

function evaluateNumericBooleanExpression(tokens: StructuredTextToken[], memory: TagMemory): boolean | undefined {
  const expression = joinExpression(tokens);
  const evaluated = evaluateExpression(expression, (path) => memory.readNumber(path));
  return evaluated.ok && Number.isFinite(evaluated.value) ? evaluated.value !== 0 : undefined;
}

function evaluateBooleanExpression(tokens: StructuredTextToken[], memory: TagMemory): BooleanExpressionResult | undefined {
  const expression = stripEnclosingParens(tokens);
  if (expression.length === 0) return undefined;

  const orAt = topLevelLogicalIndex(expression, LOGICAL_OR_KEYWORDS);
  if (orAt > 0 && orAt < expression.length - 1) {
    const left = evaluateBooleanExpression(expression.slice(0, orAt), memory);
    const right = evaluateBooleanExpression(expression.slice(orAt + 1), memory);
    if (!left || !right) return undefined;
    return {
      value: upper(expression[orAt]) === "XOR" ? left.value !== right.value : left.value || right.value,
      usesStringComparison: left.usesStringComparison || right.usesStringComparison,
    };
  }

  const andAt = topLevelLogicalIndex(expression, LOGICAL_AND_KEYWORDS, LOGICAL_AND_OPERATORS);
  if (andAt > 0 && andAt < expression.length - 1) {
    const left = evaluateBooleanExpression(expression.slice(0, andAt), memory);
    const right = evaluateBooleanExpression(expression.slice(andAt + 1), memory);
    if (!left || !right) return undefined;
    return {
      value: left.value && right.value,
      usesStringComparison: left.usesStringComparison || right.usesStringComparison,
    };
  }

  if (isKeyword(expression[0], "NOT")) {
    const inner = evaluateBooleanExpression(expression.slice(1), memory);
    return inner ? { value: !inner.value, usesStringComparison: inner.usesStringComparison } : undefined;
  }

  const stringComparison = evaluateStringComparison(expression, memory);
  if (stringComparison !== undefined) return { value: stringComparison, usesStringComparison: true };

  const numeric = evaluateNumericBooleanExpression(expression, memory);
  return numeric === undefined ? undefined : { value: numeric, usesStringComparison: false };
}

function coerceForTarget(value: PlcValue, targetType: string | undefined): PlcValue {
  if (targetType === "BOOL") {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    return value.length > 0;
  }
  if (targetType === "STRING") return String(value ?? "");
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function evaluateValue(
  tokens: StructuredTextToken[],
  memory: TagMemory,
  target: string,
  typeOfPath?: PathTypeResolver,
): PlcValue | undefined {
  if (tokens.length === 0) return undefined;
  const targetType = typeOfPath?.(target);

  if (tokens.length === 1 && tokens[0]!.kind === "string") {
    return coerceForTarget(stringLiteralValue(tokens[0]!.value), targetType);
  }
  if (tokens.length === 1 && isKeyword(tokens[0], "TRUE")) return coerceForTarget(true, targetType);
  if (tokens.length === 1 && isKeyword(tokens[0], "FALSE")) return coerceForTarget(false, targetType);

  const sourcePath = singlePath(tokens);
  if (targetType === "STRING" && sourcePath) return String(memory.read(sourcePath) ?? "");

  const stringComparison = evaluateStringComparison(tokens, memory);
  if (stringComparison !== undefined) return coerceForTarget(stringComparison, targetType);

  const booleanExpression = evaluateBooleanExpression(tokens, memory);
  if (booleanExpression && (targetType === "BOOL" || booleanExpression.usesStringComparison)) {
    return coerceForTarget(booleanExpression.value, targetType);
  }

  const expression = joinExpression(tokens);
  const evaluated = evaluateExpression(expression, (path) => memory.readNumber(path));
  if (!evaluated.ok) return undefined;
  return coerceForTarget(evaluated.value, targetType);
}

function evaluateCondition(tokens: StructuredTextToken[], memory: TagMemory): boolean {
  const booleanExpression = evaluateBooleanExpression(tokens, memory);
  if (booleanExpression) return booleanExpression.value;

  const value = evaluateValue(tokens, memory, "", () => "DINT");
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value.length > 0;
}

function assignmentParts(statement: StructuredTextToken[]): { target: string; expression: StructuredTextToken[]; nonRetentive: boolean } | undefined {
  const operator = topLevelAssignmentOperator(statement);
  if (!operator || operator.assignAt <= 0) return undefined;
  const labelAt = topLevelColonIndex(statement, operator.targetEnd);
  const targetTokens = statement.slice(labelAt === -1 ? 0 : labelAt + 1, operator.targetEnd);
  const target = singlePath(targetTokens) ? joinPath(targetTokens) : "";
  const expression = statement.slice(operator.expressionStart);
  return target && expression.length > 0 ? { target, expression, nonRetentive: operator.nonRetentive } : undefined;
}

function statementBody(statement: StructuredTextToken[]): StructuredTextToken[] {
  const labelAt = topLevelColonIndex(statement);
  return labelAt === -1 ? statement : statement.slice(labelAt + 1);
}

function splitCallArguments(tokens: StructuredTextToken[]): StructuredTextToken[][] {
  const args = splitTopLevelCommas(tokens).map((part) => trimStatementTerminator(part).filter((token) => token.value.trim() !== ""));
  return args.length === 1 && args[0]!.length === 0 ? [] : args;
}

function topLevelOutputAssignmentIndex(tokens: StructuredTextToken[]): number {
  let parens = 0;
  let brackets = 0;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    if (token.kind === "punctuation") {
      if (token.value === "(") parens += 1;
      else if (token.value === ")") parens = Math.max(0, parens - 1);
      else if (token.value === "[") brackets += 1;
      else if (token.value === "]") brackets = Math.max(0, brackets - 1);
    }
    if (
      parens === 0 &&
      brackets === 0 &&
      token.kind === "operator" &&
      token.value === "=" &&
      tokens[index + 1]?.kind === "operator" &&
      tokens[index + 1]?.value === ">"
    ) {
      return index;
    }
  }
  return -1;
}

function normalizeOperandName(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function namedArgumentParts(tokens: StructuredTextToken[]): { name: string; value: StructuredTextToken[] } | undefined {
  const inputAt = topLevelAssignmentIndex(tokens);
  const outputAt = topLevelOutputAssignmentIndex(tokens);
  const operatorAt =
    inputAt === -1 ? outputAt : outputAt === -1 ? inputAt : Math.min(inputAt, outputAt);
  if (operatorAt <= 0) return undefined;
  const name = normalizeOperandName(joinPath(tokens.slice(0, operatorAt)));
  const valueStart = operatorAt === outputAt ? operatorAt + 2 : operatorAt + 1;
  const value = tokens.slice(valueStart);
  return name && value.length > 0 ? { name, value } : undefined;
}

function instructionCallOperands(
  definition: InstructionDefinition,
  args: StructuredTextToken[][],
): string[] {
  const operands: string[] = [];
  const byName = new Map<string, number>();
  definition.operands.forEach((operand, index) => {
    byName.set(normalizeOperandName(operand.name), index);
    byName.set(normalizeOperandName(operand.label), index);
  });

  let positional = 0;
  for (const arg of args) {
    const named = namedArgumentParts(arg);
    if (named) {
      const index = byName.get(named.name);
      if (index !== undefined) operands[index] = operandText(named.value);
      continue;
    }
    while (operands[positional] !== undefined) positional += 1;
    operands[positional] = operandText(arg);
    positional += 1;
  }
  return operands;
}

function callParts(statement: StructuredTextToken[]): {
  name: string;
  args: StructuredTextToken[][];
  token: StructuredTextToken;
} | undefined {
  const body = statementBody(statement).filter((token) => token.value.trim() !== "");
  const token = body[0];
  if (!token || (token.kind !== "identifier" && token.kind !== "keyword")) return undefined;
  if (body[1]?.kind !== "punctuation" || body[1]?.value !== "(") return undefined;

  let depth = 0;
  for (let index = 1; index < body.length; index += 1) {
    const item = body[index]!;
    if (item.kind !== "punctuation") continue;
    if (item.value === "(") depth += 1;
    else if (item.value === ")") {
      depth -= 1;
      if (depth === 0) {
        const trailing = body.slice(index + 1).filter((candidate) => candidate.value.trim() !== "");
        if (trailing.length > 0) return undefined;
        return {
          name: token.value.toUpperCase(),
          args: splitCallArguments(body.slice(2, index)),
          token,
        };
      }
    }
  }
  return undefined;
}

function operandText(tokens: StructuredTextToken[]): string {
  return joinExpression(trimStatementTerminator(tokens));
}

function literalValue(text: string): PlcValue | undefined {
  const trimmed = text.trim();
  const numeric = parseNumericLiteral(trimmed);
  if (numeric !== undefined) return numeric;
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  const quoted = trimmed.match(/^'(.*)'$/s) ?? trimmed.match(/^"(.*)"$/s);
  return quoted ? stringLiteralValue(`'${quoted[1] ?? ""}'`) : undefined;
}

function parameterSuffix(path: string, source: string): string | undefined {
  const base = source.trim();
  if (!base) return undefined;
  if (path === base) return "";
  if (path.startsWith(`${base}.`) || path.startsWith(`${base}[`)) return path.slice(base.length);
  return undefined;
}

function copyParameterValue(
  memory: TagMemory,
  sourceText: string,
  destinationText: string,
  typeOfPath?: PathTypeResolver,
): { path: string; value: PlcValue } | undefined {
  const destination = destinationText.trim();
  if (!destination || literalValue(destination) !== undefined) return undefined;

  const targetType = typeOfPath?.(destination);
  const literal = literalValue(sourceText);
  if (literal !== undefined) {
    const value = coerceForTarget(literal, targetType);
    memory.write(destination, value);
    return { path: destination, value };
  }

  const source = sourceText.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:\[[^\]]+])*$/.test(source)) {
    const snapshot = memory.snapshot();
    let copied: { path: string; value: PlcValue } | undefined;
    for (const [path, current] of Object.entries(snapshot)) {
      const suffix = parameterSuffix(path, source);
      if (suffix === undefined) continue;
      const targetPath = `${destination}${suffix}`;
      memory.write(targetPath, current);
      copied = { path: targetPath, value: current };
    }
    if (copied) return copied;
  }

  const evaluated = evaluateExpression(stripTypedNumericPrefixes(source), (path) => memory.readNumber(path));
  const value = evaluated.ok
    ? coerceForTarget(evaluated.value, targetType)
    : coerceForTarget(memory.read(source), targetType);
  memory.write(destination, value);
  return { path: destination, value };
}

function executeAssignment(
  statement: StructuredTextToken[],
  memory: TagMemory,
  typeOfPath?: PathTypeResolver,
  trace?: TraceEntry[],
): void {
  const parts = assignmentParts(statement);
  if (!parts) return;

  const value = evaluateValue(parts.expression, memory, parts.target, typeOfPath);
  if (value === undefined) return;
  memory.write(parts.target, value);
  trace?.push({
    rung: statement[0]?.line ?? 0,
    instruction: parts.nonRetentive ? "ST_NONRETENTIVE_ASSIGN" : "ST_ASSIGN",
    operands: [parts.target, joinExpression(parts.expression)],
    conditionIn: true,
    conditionOut: true,
    writes: [{ path: parts.target, value }],
  });
}

function emptyStatus(): ExecutionStatus {
  return { exitRequested: false, returnRequested: false, returnParameters: [] };
}

function returnStatus(returnParameters: string[] = []): ExecutionStatus {
  return { exitRequested: false, returnRequested: true, returnParameters };
}

function skipStatementTerminator(tokens: StructuredTextToken[], index: number): number {
  let next = index;
  while (tokens[next]?.kind === "punctuation" && tokens[next]?.value === ";") next += 1;
  return next;
}

function trimStatementTerminator(tokens: StructuredTextToken[]): StructuredTextToken[] {
  let end = tokens.length;
  while (end > 0 && tokens[end - 1]?.kind === "punctuation" && tokens[end - 1]?.value === ";") end -= 1;
  return tokens.slice(0, end);
}

function matchingEndIndex(
  tokens: StructuredTextToken[],
  start: number,
  end: number,
  opener: string,
  closer: string,
): number {
  let depth = 0;
  for (let index = start; index < end; index += 1) {
    const keyword = upper(tokens[index]);
    if (keyword === opener) {
      depth += 1;
    } else if (keyword === closer) {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return end;
}

function topLevelKeywordIndex(
  tokens: StructuredTextToken[],
  start: number,
  end: number,
  keywords: Set<string>,
): number {
  let depth = 0;
  for (let index = start; index < end; index += 1) {
    const keyword = upper(tokens[index]);
    if (depth === 0 && keywords.has(keyword)) return index;
    if (BLOCK_STARTS.has(keyword)) depth += 1;
    else if (BLOCK_ENDS.has(keyword)) depth = Math.max(0, depth - 1);
  }
  return -1;
}

function evaluateNumber(tokens: StructuredTextToken[], memory: TagMemory): number | undefined {
  const value = evaluateValue(trimStatementTerminator(tokens), memory, "", () => "DINT");
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitTopLevelCommas(tokens: StructuredTextToken[]): StructuredTextToken[][] {
  const parts: StructuredTextToken[][] = [];
  let part: StructuredTextToken[] = [];
  let parens = 0;
  let brackets = 0;
  for (const token of tokens) {
    if (token.kind === "punctuation") {
      if (token.value === "(") parens += 1;
      else if (token.value === ")") parens = Math.max(0, parens - 1);
      else if (token.value === "[") brackets += 1;
      else if (token.value === "]") brackets = Math.max(0, brackets - 1);
      else if (token.value === "," && parens === 0 && brackets === 0) {
        parts.push(part);
        part = [];
        continue;
      }
    }
    part.push(token);
  }
  parts.push(part);
  return parts;
}

function caseLabelText(tokens: StructuredTextToken[]): string {
  return joinExpression(trimStatementTerminator(tokens)).replace(/\s+/g, "");
}

function immediateCaseNumber(text: string): number | undefined {
  return parseNumericLiteral(stripTypedNumericPrefixes(text));
}

function caseRangeBounds(text: string): { low: number; high: number } | undefined {
  const rangeAt = text.indexOf("..");
  if (rangeAt < 0) return undefined;
  const low = immediateCaseNumber(text.slice(0, rangeAt));
  const high = immediateCaseNumber(text.slice(rangeAt + 2));
  return low === undefined || high === undefined ? undefined : { low, high };
}

function caseLabelIsImmediateSelector(tokens: StructuredTextToken[]): boolean {
  const text = caseLabelText(tokens);
  if (!text) return false;
  return caseRangeBounds(text) !== undefined || immediateCaseNumber(text) !== undefined;
}

function caseLabelsAreImmediateSelectors(labels: StructuredTextToken[]): boolean {
  const parts = splitTopLevelCommas(labels).map((label) => trimStatementTerminator(label).filter((token) => token.value.trim() !== ""));
  return parts.length > 0 && parts.every((part) => part.length > 0 && caseLabelIsImmediateSelector(part));
}

function caseSelectorMatches(selector: number, labels: StructuredTextToken[]): boolean {
  for (const label of splitTopLevelCommas(labels)) {
    const trimmed = trimStatementTerminator(label).filter((token) => token.value.trim() !== "");
    if (trimmed.length === 0) continue;
    const raw = caseLabelText(trimmed);
    const range = caseRangeBounds(raw);
    if (range) {
      const min = Math.min(range.low, range.high);
      const max = Math.max(range.low, range.high);
      if (selector >= min && selector <= max) return true;
      continue;
    }
    const value = immediateCaseNumber(raw);
    if (value !== undefined && selector === value) return true;
  }
  return false;
}

function traceWrite(
  trace: TraceEntry[] | undefined,
  token: StructuredTextToken | undefined,
  instruction: string,
  operands: string[],
  path: string,
  value: PlcValue,
): void {
  trace?.push({
    rung: token?.line ?? 0,
    instruction,
    operands,
    conditionIn: true,
    conditionOut: true,
    writes: [{ path, value }],
  });
}

function nextCaseLabel(
  tokens: StructuredTextToken[],
  start: number,
  end: number,
): { labelStart: number; colon: number } | undefined {
  let candidate = skipStatementTerminator(tokens, start);
  let parens = 0;
  let brackets = 0;
  let depth = 0;

  for (let index = candidate; index < end; index += 1) {
    const token = tokens[index]!;
    const keyword = upper(token);
    if (token.kind === "punctuation") {
      if (token.value === "(") parens += 1;
      else if (token.value === ")") parens = Math.max(0, parens - 1);
      else if (token.value === "[") brackets += 1;
      else if (token.value === "]") brackets = Math.max(0, brackets - 1);
      else if (token.value === ";" && parens === 0 && brackets === 0 && depth === 0) {
        candidate = skipStatementTerminator(tokens, index + 1);
      }
    }
    if (parens === 0 && brackets === 0) {
      if (BLOCK_STARTS.has(keyword)) depth += 1;
      else if (BLOCK_ENDS.has(keyword)) depth = Math.max(0, depth - 1);
    }
    if (
      parens === 0 &&
      brackets === 0 &&
      depth === 0 &&
      token.kind === "operator" &&
      token.value === ":" &&
      candidate < index &&
      caseLabelsAreImmediateSelectors(tokens.slice(candidate, index))
    ) {
      return { labelStart: candidate, colon: index };
    }
  }
  return undefined;
}

function caseBranches(
  tokens: StructuredTextToken[],
  start: number,
  end: number,
): { labels: StructuredTextToken[]; bodyStart: number; bodyEnd: number }[] {
  const branches: { labels: StructuredTextToken[]; bodyStart: number; bodyEnd: number }[] = [];
  let next = nextCaseLabel(tokens, start, end);
  while (next) {
    const labels = tokens.slice(next.labelStart, next.colon);
    const bodyStart = next.colon + 1;
    const following = nextCaseLabel(tokens, bodyStart, end);
    branches.push({
      labels,
      bodyStart,
      bodyEnd: following?.labelStart ?? end,
    });
    next = following;
  }
  return branches;
}

function numericOperand(operand: string, memory: TagMemory): number {
  const text = operand.trim();
  const literal = parseNumericLiteral(text);
  if (literal !== undefined) return literal;
  if (/^true$/i.test(text)) return 1;
  if (/^false$/i.test(text)) return 0;
  const evaluated = evaluateExpression(stripTypedNumericPrefixes(text), (path) => memory.readNumber(path));
  if (evaluated.ok && Number.isFinite(evaluated.value)) return evaluated.value;
  return memory.readNumber(text);
}

function executeRegisteredInstructionCall(
  call: { name: string; args: StructuredTextToken[][]; token: StructuredTextToken },
  options: ExecuteStructuredTextOptions,
): ExecutionStatus | undefined {
  const definition = ST_INSTRUCTION_REGISTRY.get(call.name);
  if (!definition) return undefined;
  const rawArgs = instructionCallOperands(definition, call.args);

  const writes: { path: string; value: PlcValue }[] = [];
  const tracing = !!options.trace;
  const context: InstructionRuntimeContext = {
    rungIn: true,
    deltaMs: options.deltaMs ?? 0,
    readValue: (path) => options.memory.read(path),
    writeValue: (path, value) => {
      options.memory.write(path, value);
      if (tracing) writes.push({ path, value });
    },
    readBool: (path) => options.memory.readBool(path),
    writeBool: (path, value) => {
      options.memory.writeBool(path, value);
      if (tracing) writes.push({ path, value });
    },
    readNumber: (path) => options.memory.readNumber(path),
    writeNumber: (path, value) => {
      options.memory.write(path, value);
      if (tracing) writes.push({ path, value });
    },
    readString: (path) => options.memory.readString(path),
    writeString: (path, value) => {
      options.memory.writeString(path, value);
      if (tracing) writes.push({ path, value });
    },
    numeric: (operand) => numericOperand(operand, options.memory),
    arrayDimension: options.arrayDimension,
  };

  const node = {
    id: `st-${call.token.line}-${call.name}`,
    instructionType: definition.type,
    operands: Array.from({ length: Math.max(definition.operands.length, rawArgs.length) }, (_value, index) => {
      const value = rawArgs[index] ?? "";
      return {
        name: definition.operands[index]?.name ?? `arg${index}`,
        kind: definition.operands[index]?.isExpression
        ? "expression" as const
        : definition.operands[index]?.isRoutineRef
          ? "routine" as const
          : parseNumericLiteral(value) !== undefined || /^'.*'$/.test(value.trim()) || /^".*"$/.test(value.trim())
            ? "literal" as const
            : "tag" as const,
        value,
      };
    }),
  };
  const conditionOut = definition.modelOnly ? true : definition.execute(node, context);

  options.trace?.push({
    rung: call.token.line,
    instruction: definition.modelOnly ? `ST_MODEL_ONLY_${definition.type}` : `ST_${definition.type}`,
    operands: rawArgs,
    conditionIn: true,
    conditionOut,
    writes,
  });
  return emptyStatus();
}

function executeCallStatement(
  statement: StructuredTextToken[],
  options: ExecuteStructuredTextOptions,
): ExecutionStatus | undefined {
  const call = callParts(statement);
  if (!call) return undefined;
  const rawArgs = call.args.map(operandText);

  if (call.name === "JSR") {
    const routineName = rawArgs[0]?.trim();
    if (routineName) {
      const rawParameters = rawArgs.slice(1);
      options.callRoutine?.(routineName, rawParameters, call.token.line);
      options.trace?.push({
        rung: call.token.line,
        instruction: "ST_JSR",
        operands: [routineName, ...rawParameters],
        conditionIn: true,
        conditionOut: true,
        writes: [],
      });
    }
    return emptyStatus();
  }

  if (call.name === "SBR") {
    const writes: { path: string; value: PlcValue }[] = [];
    rawArgs.forEach((destination, index) => {
      const source = options.inputParameters?.[index];
      if (!source) return;
      const write = copyParameterValue(options.memory, source, destination, options.typeOfPath);
      if (write) writes.push(write);
    });
    options.trace?.push({
      rung: call.token.line,
      instruction: "ST_SBR",
      operands: rawArgs,
      conditionIn: true,
      conditionOut: true,
      writes,
    });
    return emptyStatus();
  }

  if (call.name === "RET") {
    options.trace?.push({
      rung: call.token.line,
      instruction: "ST_RET",
      operands: rawArgs,
      conditionIn: true,
      conditionOut: true,
      writes: [],
    });
    return returnStatus(rawArgs);
  }

  return executeRegisteredInstructionCall(call, options);
}

function executeBlock(
  tokens: StructuredTextToken[],
  start: number,
  end: number,
  options: ExecuteStructuredTextOptions,
): ExecutionStatus {
  let index = start;
  while (index < end) {
    const token = tokens[index]!;
    if (token.kind === "punctuation" && token.value === ";") {
      index += 1;
      continue;
    }

    if (isKeyword(token, "EXIT")) {
      return { ...emptyStatus(), exitRequested: true };
    }
    if (isKeyword(token, "RETURN")) {
      return returnStatus();
    }
    if (isKeyword(token, "IF")) {
      const result = executeIfAt(tokens, index, end, options);
      if (result.status.exitRequested || result.status.returnRequested) return result.status;
      index = result.next;
      continue;
    }
    if (isKeyword(token, "CASE")) {
      const result = executeCaseAt(tokens, index, end, options);
      if (result.status.exitRequested || result.status.returnRequested) return result.status;
      index = result.next;
      continue;
    }
    if (isKeyword(token, "FOR")) {
      const result = executeForAt(tokens, index, end, options);
      if (result.status.returnRequested) return result.status;
      index = result.next;
      continue;
    }
    if (isKeyword(token, "WHILE")) {
      const result = executeWhileAt(tokens, index, end, options);
      if (result.status.returnRequested) return result.status;
      index = result.next;
      continue;
    }
    if (isKeyword(token, "REPEAT")) {
      const result = executeRepeatAt(tokens, index, end, options);
      if (result.status.returnRequested) return result.status;
      index = result.next;
      continue;
    }
    if (CONTROL_KEYWORDS.has(upper(token))) {
      return emptyStatus();
    }

    const { statement, next } = readStatement(tokens, index);
    const callStatus = executeCallStatement(statement, options);
    if (callStatus?.returnRequested) return callStatus;
    if (!callStatus) executeAssignment(statement, options.memory, options.typeOfPath, options.trace);
    index = next > index ? next : index + 1;
  }
  return emptyStatus();
}

function executeIfAt(
  tokens: StructuredTextToken[],
  start: number,
  end: number,
  options: ExecuteStructuredTextOptions,
): { next: number; status: ExecutionStatus } {
  const header = readUntilKeyword(tokens, start + 1, "THEN");
  const endIf = matchingEndIndex(tokens, header.next, end, "IF", "END_IF");
  let branchStart = header.next;
  let branchCondition = evaluateCondition(header.segment, options.memory);
  let branchTaken = false;

  while (branchStart <= endIf) {
    const boundary = topLevelKeywordIndex(tokens, branchStart, endIf, new Set(["ELSIF", "ELSE"]));
    const branchEnd = boundary === -1 ? endIf : boundary;
    if (!branchTaken && branchCondition) {
      const status = executeBlock(tokens, branchStart, branchEnd, options);
      return { next: skipStatementTerminator(tokens, endIf + 1), status };
    }

    if (boundary === -1) break;
    const keyword = upper(tokens[boundary]);
    if (keyword === "ELSIF") {
      const nextHeader = readUntilKeyword(tokens, boundary + 1, "THEN");
      branchCondition = !branchTaken && evaluateCondition(nextHeader.segment, options.memory);
      branchStart = nextHeader.next;
      continue;
    }
    if (keyword === "ELSE") {
      if (!branchTaken) {
        branchTaken = true;
        const status = executeBlock(tokens, boundary + 1, endIf, options);
        return { next: skipStatementTerminator(tokens, endIf + 1), status };
      }
      break;
    }
  }

  return { next: skipStatementTerminator(tokens, endIf + 1), status: emptyStatus() };
}

function executeCaseAt(
  tokens: StructuredTextToken[],
  start: number,
  end: number,
  options: ExecuteStructuredTextOptions,
): { next: number; status: ExecutionStatus } {
  const header = readUntilKeyword(tokens, start + 1, "OF");
  const endCase = matchingEndIndex(tokens, header.next, end, "CASE", "END_CASE");
  const selector = evaluateNumber(header.segment, options.memory);
  const elseAt = topLevelKeywordIndex(tokens, header.next, endCase, new Set(["ELSE"]));
  const branchEnd = elseAt === -1 ? endCase : elseAt;

  if (selector !== undefined) {
    for (const branch of caseBranches(tokens, header.next, branchEnd)) {
      if (!caseSelectorMatches(selector, branch.labels)) continue;
      const status = executeBlock(tokens, branch.bodyStart, branch.bodyEnd, options);
      return { next: skipStatementTerminator(tokens, endCase + 1), status };
    }
  }

  if (elseAt !== -1) {
    const status = executeBlock(tokens, elseAt + 1, endCase, options);
    return { next: skipStatementTerminator(tokens, endCase + 1), status };
  }

  return { next: skipStatementTerminator(tokens, endCase + 1), status: emptyStatus() };
}

function executeForAt(
  tokens: StructuredTextToken[],
  start: number,
  end: number,
  options: ExecuteStructuredTextOptions,
): { next: number; status: ExecutionStatus } {
  const header = readUntilKeyword(tokens, start + 1, "DO");
  const endFor = matchingEndIndex(tokens, header.next, end, "FOR", "END_FOR");
  const assignAt = topLevelAssignmentIndex(header.segment);
  const toAt = topLevelKeywordIndex(header.segment, assignAt + 1, header.segment.length, new Set(["TO"]));
  const byAt = toAt === -1 ? -1 : topLevelKeywordIndex(header.segment, toAt + 1, header.segment.length, new Set(["BY"]));
  if (assignAt <= 0 || toAt === -1) return { next: skipStatementTerminator(tokens, endFor + 1), status: emptyStatus() };

  const indexPath = joinPath(header.segment.slice(0, assignAt));
  const initial = evaluateNumber(header.segment.slice(assignAt + 1, toAt), options.memory);
  const terminal = evaluateNumber(header.segment.slice(toAt + 1, byAt === -1 ? header.segment.length : byAt), options.memory);
  const step = byAt === -1 ? 1 : evaluateNumber(header.segment.slice(byAt + 1), options.memory);
  if (!indexPath || initial === undefined || terminal === undefined || step === undefined || step === 0) {
    return { next: skipStatementTerminator(tokens, endFor + 1), status: emptyStatus() };
  }

  const forward = step > 0;
  let value = initial;
  let iterations = 0;
  while (
    Number.isFinite(value) &&
    iterations < MAX_ST_LOOP_ITERATIONS &&
    (forward ? value <= terminal : value >= terminal)
  ) {
    options.memory.write(indexPath, value);
    traceWrite(options.trace, tokens[start], "ST_FOR_INDEX", [indexPath, String(value)], indexPath, value);
    const status = executeBlock(tokens, header.next, endFor, options);
    if (status.returnRequested) return { next: skipStatementTerminator(tokens, endFor + 1), status };
    if (status.exitRequested) break;
    iterations += 1;
    value += step;
  }

  return { next: skipStatementTerminator(tokens, endFor + 1), status: emptyStatus() };
}

function executeWhileAt(
  tokens: StructuredTextToken[],
  start: number,
  end: number,
  options: ExecuteStructuredTextOptions,
): { next: number; status: ExecutionStatus } {
  const header = readUntilKeyword(tokens, start + 1, "DO");
  const endWhile = matchingEndIndex(tokens, header.next, end, "WHILE", "END_WHILE");
  let iterations = 0;
  while (iterations < MAX_ST_LOOP_ITERATIONS && evaluateCondition(header.segment, options.memory)) {
    const status = executeBlock(tokens, header.next, endWhile, options);
    iterations += 1;
    if (status.returnRequested) return { next: skipStatementTerminator(tokens, endWhile + 1), status };
    if (status.exitRequested) break;
  }
  return { next: skipStatementTerminator(tokens, endWhile + 1), status: emptyStatus() };
}

function executeRepeatAt(
  tokens: StructuredTextToken[],
  start: number,
  end: number,
  options: ExecuteStructuredTextOptions,
): { next: number; status: ExecutionStatus } {
  const endRepeat = matchingEndIndex(tokens, start + 1, end, "REPEAT", "END_REPEAT");
  const untilAt = topLevelKeywordIndex(tokens, start + 1, endRepeat, new Set(["UNTIL"]));
  if (untilAt === -1) return { next: skipStatementTerminator(tokens, endRepeat + 1), status: emptyStatus() };
  const condition = trimStatementTerminator(tokens.slice(untilAt + 1, endRepeat));

  let iterations = 0;
  do {
    const status = executeBlock(tokens, start + 1, untilAt, options);
    iterations += 1;
    if (status.returnRequested) return { next: skipStatementTerminator(tokens, endRepeat + 1), status };
    if (status.exitRequested) break;
    if (evaluateCondition(condition, options.memory)) break;
  } while (iterations < MAX_ST_LOOP_ITERATIONS);

  return { next: skipStatementTerminator(tokens, endRepeat + 1), status: emptyStatus() };
}

/**
 * Execute the conservative Structured Text subset that maps cleanly onto the
 * existing offline tag-memory model: scalar/member/array assignments, nested
 * IF/ELSIF/ELSE/END_IF control flow, bounded FOR/WHILE/REPEAT loops, CASE, and
 * program-local JSR/SBR/RET routine-call plumbing supplied by the scan layer.
 * Unsupported statements are skipped instead of guessed, preserving
 * deterministic offline behavior.
 */
export function executeStructuredTextSource(options: ExecuteStructuredTextOptions): ExecutionStatus {
  const tokens = executableTokens(options.source);
  return executeBlock(tokens, 0, tokens.length, options);
}

export function collectStructuredTextSbrOperands(source: string): string[] {
  const tokens = executableTokens(source);
  let index = 0;
  while (index < tokens.length) {
    const { statement, next } = readStatement(tokens, index);
    const call = callParts(statement);
    if (call?.name === "SBR") return call.args.map(operandText);
    index = next > index ? next : index + 1;
  }
  return [];
}

export function copyStructuredTextParameters(
  memory: TagMemory,
  sources: string[],
  destinations: string[],
  typeOfPath?: PathTypeResolver,
): void {
  destinations.forEach((destination, index) => {
    const source = sources[index];
    if (source) copyParameterValue(memory, source, destination, typeOfPath);
  });
}

/** Static write-target discovery for Watch role/output highlighting. */
export function collectStructuredTextOutputTags(source: string): Set<string> {
  const outputs = new Set<string>();
  const tokens = executableTokens(source);
  let index = 0;
  while (index < tokens.length) {
    const { statement, next } = readStatement(tokens, index);
    const parts = assignmentParts(statement);
    if (parts) outputs.add(parts.target);
    const call = callParts(statement);
    if (call?.name === "JSR") {
      const rawArgs = call.args.map(operandText);
      const layout = parseJsrParameterLayout(rawArgs.slice(1));
      if (layout.explicitInputCount) {
        for (const destination of layout.returnParameters) {
          const path = singlePath(executableTokens(destination));
          if (path) outputs.add(path);
        }
      }
    } else if (call) {
      const definition = ST_INSTRUCTION_REGISTRY.get(call.name);
      if (definition && !definition.modelOnly) {
        const rawArgs = instructionCallOperands(definition, call.args);
        definition.operands.forEach((operand, operandIndex) => {
          if (operand.direction !== "write") return;
          const path = singlePath(executableTokens(rawArgs[operandIndex] ?? ""));
          if (path) outputs.add(path);
        });
      }
    }
    index = next > index ? next : index + 1;
  }
  return outputs;
}
