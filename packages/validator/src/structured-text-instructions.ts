import { memberDefs, type Controller, type Program } from "@esco/core";
import {
  createDefaultRegistry,
  instructionFidelity,
  instructionFidelityLabel,
  isNumericLiteral,
  type InstructionDefinition,
  type InstructionOperandDefinition,
} from "@esco/instructions";
import type { LadderNode } from "@esco/ladder";
import { tokenizeStructuredText } from "@esco/parser-l5x";
import type { ValidationFinding, ValidationRule } from "./types";

type StToken = ReturnType<typeof tokenizeStructuredText>[number];

interface OperandPath {
  programName?: string;
  segments: string[];
  suffix: string;
}

const registry = createDefaultRegistry();
const SPECIAL_ST_CALLS = new Set(["JSR", "SBR", "RET"]);
const DECLARATION_OPENERS = new Set(["VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP"]);
const DECLARATION_CLOSERS = new Set(["END_VAR"]);
const STATEMENT_BOUNDARY_KEYWORDS = new Set(["THEN", "ELSE", "DO", "REPEAT"]);
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

function normalized(value: string): string {
  return value.toUpperCase();
}

function isStringFamilyDataType(controller: Controller, dataType: string): boolean {
  const resolved = normalized(dataType);
  return resolved === "STRING" || controller.dataTypes.some((candidate) =>
    candidate.family === "StringFamily" && normalized(candidate.name) === resolved,
  );
}

function executableTokens(source: string): StToken[] {
  return tokenizeStructuredText(source).filter((token) => token.kind !== "comment");
}

function isWordToken(token: StToken | undefined): boolean {
  return !!token && (token.kind === "identifier" || token.kind === "keyword" || token.kind === "number");
}

function expressionTokenValue(token: StToken): string {
  if (token.kind === "keyword") {
    const keyword = normalized(token.value);
    if (keyword === "TRUE") return "1";
    if (keyword === "FALSE") return "0";
    return keyword;
  }
  return token.value;
}

function stripTypedNumericPrefixes(expression: string): string {
  return expression.replace(/\b([A-Za-z][A-Za-z0-9_]*)#([0-9A-Fa-f_.]+)\b/g, (_match, typeName: string, digits: string) =>
    TYPED_NUMERIC_PREFIXES.has(normalized(typeName)) ? digits.replace(/_/g, "") : `${typeName}#${digits}`,
  );
}

function joinExpression(tokens: readonly StToken[]): string {
  let out = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const previous = tokens[index - 1];
    if (out && isWordToken(previous) && isWordToken(token)) out += " ";
    out += expressionTokenValue(token);
  }
  return stripTypedNumericPrefixes(out);
}

function joinPath(tokens: readonly StToken[]): string {
  return tokens.map((token) => token.value).join("").trim();
}

function trimStatementTerminator(tokens: readonly StToken[]): StToken[] {
  let end = tokens.length;
  while (end > 0 && tokens[end - 1]?.kind === "punctuation" && tokens[end - 1]?.value === ";") end -= 1;
  return tokens.slice(0, end);
}

function splitTopLevelCommas(tokens: readonly StToken[]): StToken[][] {
  const parts: StToken[][] = [];
  let part: StToken[] = [];
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

function splitCallArguments(tokens: readonly StToken[]): StToken[][] {
  const args = splitTopLevelCommas(tokens).map((part) => trimStatementTerminator(part).filter((token) => token.value.trim() !== ""));
  return args.length === 1 && args[0]!.length === 0 ? [] : args;
}

function topLevelAssignmentIndex(tokens: readonly StToken[]): number {
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

function topLevelOutputAssignmentIndex(tokens: readonly StToken[]): number {
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

function namedArgumentParts(tokens: readonly StToken[]): { displayName: string; normalizedName: string; value: StToken[] } | undefined {
  const inputAt = topLevelAssignmentIndex(tokens);
  const outputAt = topLevelOutputAssignmentIndex(tokens);
  const operatorAt = inputAt === -1 ? outputAt : outputAt === -1 ? inputAt : Math.min(inputAt, outputAt);
  if (operatorAt <= 0) return undefined;
  const displayName = joinPath(tokens.slice(0, operatorAt));
  const normalizedName = normalizeOperandName(displayName);
  const valueStart = operatorAt === outputAt ? operatorAt + 2 : operatorAt + 1;
  const value = tokens.slice(valueStart);
  return normalizedName && value.length > 0 ? { displayName, normalizedName, value } : undefined;
}

function operandText(tokens: readonly StToken[]): string {
  return joinExpression(trimStatementTerminator(tokens));
}

function instructionCallOperands(
  definition: InstructionDefinition,
  args: readonly StToken[][],
): { operands: string[]; messages: string[] } {
  const operands: string[] = [];
  const messages: string[] = [];
  const byName = new Map<string, number>();
  definition.operands.forEach((operand, index) => {
    byName.set(normalizeOperandName(operand.name), index);
    byName.set(normalizeOperandName(operand.label), index);
  });

  let positional = 0;
  for (const arg of args) {
    const named = namedArgumentParts(arg);
    if (named) {
      const index = byName.get(named.normalizedName);
      if (index === undefined) {
        messages.push(`Unknown named operand "${named.displayName}" for ${definition.type}.`);
        continue;
      }
      if (operands[index] !== undefined) {
        messages.push(`Duplicate operand "${named.displayName}" for ${definition.type}.`);
      }
      operands[index] = operandText(named.value);
      continue;
    }

    while (operands[positional] !== undefined) positional += 1;
    if (positional >= definition.operands.length) {
      messages.push(`Unexpected extra operand "${operandText(arg)}" for ${definition.type}.`);
    }
    operands[positional] = operandText(arg);
    positional += 1;
  }
  return { operands, messages };
}

function previousToken(tokens: readonly StToken[], index: number): StToken | undefined {
  return tokens[index - 1];
}

function isStatementBoundary(tokens: readonly StToken[], index: number): boolean {
  const previous = previousToken(tokens, index);
  if (!previous) return true;
  if (previous.value === ";" || previous.value === ":") return true;
  return previous.kind === "keyword" && STATEMENT_BOUNDARY_KEYWORDS.has(normalized(previous.value));
}

function callAt(tokens: readonly StToken[], index: number): {
  name: string;
  token: StToken;
  args: StToken[][];
  endIndex: number;
} | undefined {
  const token = tokens[index];
  if (!token || (token.kind !== "identifier" && token.kind !== "keyword")) return undefined;
  if (tokens[index + 1]?.kind !== "punctuation" || tokens[index + 1]?.value !== "(") return undefined;

  let depth = 0;
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const item = tokens[cursor]!;
    if (item.kind !== "punctuation") continue;
    if (item.value === "(") depth += 1;
    else if (item.value === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          name: normalized(token.value),
          token,
          args: splitCallArguments(tokens.slice(index + 2, cursor)),
          endIndex: cursor,
        };
      }
    }
  }
  return undefined;
}

function operandKind(definition: InstructionDefinition, index: number, value: string): LadderNode["operands"][number]["kind"] {
  const operand = definition.operands[index];
  if (operand?.isExpression) return "expression";
  if (operand?.isRoutineRef) return "routine";
  return isLiteralOperand(value)
    ? "literal"
    : "tag";
}

function isMissingOperandValidation(message: string): boolean {
  return /^Operand '.+' is required\.$/.test(message);
}

function isLiteralOperand(value: string): boolean {
  const trimmed = value.trim();
  return isNumericLiteral(trimmed) || /^'.*'$/s.test(trimmed) || /^".*"$/s.test(trimmed) || /^(true|false)$/i.test(trimmed);
}

function isWritablePath(value: string): boolean {
  return /^(?:Program:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+])?)*$/.test(value.trim());
}

function segmentName(value: string): string | undefined {
  return value.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]+])?$/)?.[1];
}

function operandPath(value: string): OperandPath | undefined {
  const trimmed = value.trim();
  const match = /^(?:Program:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+])?)*)$/i.exec(trimmed);
  if (!match) return undefined;
  const programName = match[1];
  const body = match[2]!;
  const segments = body.split(".").map(segmentName);
  if (segments.some((segment) => !segment)) return undefined;
  const base = segments[0]!;
  return { ...(programName ? { programName } : {}), segments: segments as string[], suffix: body.slice(base.length) };
}

function localTagTypes(program: Program): Map<string, string> {
  const types = new Map<string, string>();
  for (const tag of program.programTags) types.set(normalized(tag.name), tag.dataType);
  for (const parameter of program.parameters ?? []) types.set(normalized(parameter.name), parameter.dataType);
  return types;
}

function availableTagTypes(controller: Controller, program: Program): Map<string, string> {
  const types = new Map<string, string>();
  for (const tag of controller.controllerTags) types.set(normalized(tag.name), tag.dataType);
  for (const [name, dataType] of localTagTypes(program)) types.set(name, dataType);
  return types;
}

function programByName(controller: Controller, name: string): Program | undefined {
  return controller.programs.find((candidate) => normalized(candidate.name) === normalized(name));
}

function programHasLocalName(program: Program, name: string): boolean {
  const upper = normalized(name);
  return (
    program.programTags.some((tag) => normalized(tag.name) === upper) ||
    (program.parameters ?? []).some((parameter) => normalized(parameter.name) === upper)
  );
}

function aliasTargetForReference(controller: Controller, program: Program, reference: { programName?: string; segments: string[] }): string | undefined {
  const base = reference.segments[0];
  if (!base) return undefined;
  const upper = normalized(base);

  if (reference.programName) {
    const scopedProgram = programByName(controller, reference.programName);
    const tag = scopedProgram?.programTags.find((candidate) => normalized(candidate.name) === upper);
    return tag?.aliasFor?.trim();
  }

  const localTag = program.programTags.find((tag) => normalized(tag.name) === upper);
  if (localTag) return localTag.aliasFor?.trim();
  if ((program.parameters ?? []).some((parameter) => normalized(parameter.name) === upper)) return undefined;
  return controller.controllerTags.find((tag) => normalized(tag.name) === upper)?.aliasFor?.trim();
}

function maybeQualifyAliasTarget(controller: Controller, sourceProgramName: string | undefined, targetPath: string): string {
  if (!sourceProgramName || targetPath.trim().startsWith("Program:")) return targetPath;
  const targetReference = operandPath(targetPath);
  const targetBase = targetReference?.segments[0];
  const sourceProgram = programByName(controller, sourceProgramName);
  if (!targetBase || !sourceProgram || !programHasLocalName(sourceProgram, targetBase)) return targetPath;
  return `Program:${sourceProgramName}.${targetPath}`;
}

function resolveAliasPath(
  controller: Controller,
  program: Program,
  value: string,
  seen = new Set<string>(),
): string | undefined {
  const reference = operandPath(value);
  if (!reference) return value;
  const base = reference.segments[0];
  if (!base) return value;
  const targetPath = aliasTargetForReference(controller, program, reference);
  if (!targetPath) return value;
  const seenKey = `${normalized(reference.programName ?? "")}:${normalized(base)}`;
  if (seen.has(seenKey)) return undefined;
  seen.add(seenKey);
  return resolveAliasPath(
    controller,
    program,
    `${maybeQualifyAliasTarget(controller, reference.programName, targetPath)}${reference.suffix}`,
    seen,
  );
}

function baseTypeOfPath(controller: Controller, program: Program, value: string): { type?: string; path?: ReturnType<typeof operandPath> } | undefined {
  const resolvedValue = resolveAliasPath(controller, program, value);
  if (!resolvedValue) return undefined;
  const reference = operandPath(resolvedValue);
  if (!reference) return undefined;
  const tagName = reference.segments[0];
  if (!tagName) return { path: reference };
  if (reference.programName) {
    const programName = reference.programName;
    const targetProgram = programByName(controller, programName);
    return {
      path: reference,
      type: targetProgram ? localTagTypes(targetProgram).get(normalized(tagName)) : undefined,
    };
  }
  return { path: reference, type: availableTagTypes(controller, program).get(normalized(tagName)) };
}

function memberType(controller: Controller, dataType: string, memberName: string): string | undefined {
  const normalizedType = normalized(dataType);
  const builtIn = memberDefs(normalizedType).find((member) => normalized(member.name) === normalized(memberName));
  if (builtIn) return builtIn.type;

  const udt = controller.dataTypes.find((candidate) => normalized(candidate.name) === normalizedType);
  const udtMember = udt?.members.find((member) => normalized(member.name) === normalized(memberName));
  if (udtMember) return udtMember.dataType;

  const aoi = controller.addOnInstructions.find((candidate) => normalized(candidate.name) === normalizedType);
  const aoiMember =
    aoi?.parameters.find((parameter) => normalized(parameter.name) === normalized(memberName)) ??
    aoi?.localTags.find((localTag) => normalized(localTag.name) === normalized(memberName));
  return aoiMember?.dataType;
}

function typeOfOperandPath(controller: Controller, program: Program, value: string): string | undefined {
  const resolved = baseTypeOfPath(controller, program, value);
  if (!resolved?.path || !resolved.type) return undefined;
  let currentType = resolved.type;
  for (const memberName of resolved.path.segments.slice(1)) {
    const nextType = memberType(controller, currentType, memberName);
    if (!nextType) return undefined;
    currentType = nextType;
  }
  return currentType;
}

function validateOperandShape(
  findings: ValidationFinding[],
  target: string,
  routineName: string,
  line: number,
  definition: InstructionDefinition,
  operand: InstructionOperandDefinition,
  value: string,
  controller: Controller,
  program: Program,
): void {
  const trimmed = value.trim();
  if (!trimmed || operand.isLabelRef || operand.isRoutineRef || operand.isExpression) return;

  if (operand.direction === "write") {
    if (isLiteralOperand(trimmed) || !isWritablePath(trimmed)) {
      findings.push({
        ruleId: "invalid-write-target",
        severity: "error",
        message: `Structured Text routine "${routineName}" line ${line}: ${definition.type} operand "${operand.name}" must be a writable tag path, not "${trimmed}".`,
        target,
      });
      return;
    }
  } else if (isLiteralOperand(trimmed)) {
    return;
  }

  if (!operand.allowedTypes) return;
  const dataType = typeOfOperandPath(controller, program, trimmed);
  if (!dataType) return;
  const allowed = new Set(operand.allowedTypes.map(normalized));
  if (allowed.has(normalized(dataType))) return;
  if (allowed.has("STRING") && isStringFamilyDataType(controller, dataType)) return;
  findings.push({
    ruleId: "operand-type-mismatch",
    severity: "error",
    message: `Structured Text routine "${routineName}" line ${line}: ${definition.type} operand "${operand.name}" expects ${operand.allowedTypes.join("/")}, but tag "${trimmed}" is ${dataType}.`,
    target,
  });
}

function validateCall(
  findings: ValidationFinding[],
  target: string,
  routineName: string,
  call: { name: string; token: StToken; args: StToken[][] },
  controller: Controller,
  program: Program,
): void {
  if (SPECIAL_ST_CALLS.has(call.name)) return;
  const definition = registry.get(call.name);
  if (!definition) return;

  if (definition.modelOnly) {
    const fidelity = instructionFidelity(definition);
    findings.push({
      ruleId: "model-only-instruction",
      severity: "info",
      message: `Structured Text routine "${routineName}" line ${call.token.line}: ${definition.type} is recognized but ${fidelity.status} (fidelity: ${instructionFidelityLabel(fidelity.status)}; preserved and displayed, not simulated).`,
      target,
    });
    return;
  }

  const mapped = instructionCallOperands(definition, call.args);
  for (const message of mapped.messages) {
    findings.push({
      ruleId: "st-instruction-validation",
      severity: "error",
      message: `Structured Text routine "${routineName}" line ${call.token.line}: ${message}`,
      target,
    });
  }

  const node: LadderNode = {
    id: `st-${call.token.line}-${definition.type}`,
    instructionType: definition.type,
    operands: Array.from({ length: Math.max(definition.operands.length, mapped.operands.length) }, (_value, index) => {
      const value = mapped.operands[index] ?? "";
      return {
        name: definition.operands[index]?.name ?? `arg${index}`,
        kind: operandKind(definition, index, value),
        value,
      };
    }),
  };

  for (const message of definition.validate(node)) {
    if (isMissingOperandValidation(message)) continue;
    findings.push({
      ruleId: "st-instruction-validation",
      severity: "error",
      message: `Structured Text routine "${routineName}" line ${call.token.line}: ${definition.type}: ${message}`,
      target,
    });
  }

  definition.operands.forEach((operand, index) => {
    const value = mapped.operands[index] ?? "";
    validateOperandShape(findings, target, routineName, call.token.line, definition, operand, value, controller, program);
    if (!operand.required || value.trim()) return;
    findings.push({
      ruleId: "missing-operand",
      severity: "warning",
      message: `Structured Text routine "${routineName}" line ${call.token.line}: ${definition.type} is missing required operand "${operand.name}".`,
      target,
    });
  });
}

export const structuredTextInstructions: ValidationRule = {
  id: "structured-text-instructions",
  name: "Structured Text instruction calls",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];

    for (const controller of project.controllers) {
      for (const program of controller.programs) {
        for (const routine of program.routines) {
          if (routine.language !== "structured-text") continue;
          const target = `${controller.name}/${program.name}/${routine.name}`;
          const tokens = executableTokens(routine.structuredText ?? routine.sourceText ?? "");
          let inDeclaration = false;

          for (let index = 0; index < tokens.length; index += 1) {
            const token = tokens[index]!;
            const upper = normalized(token.value);
            if (DECLARATION_OPENERS.has(upper)) {
              inDeclaration = true;
              continue;
            }
            if (DECLARATION_CLOSERS.has(upper)) {
              inDeclaration = false;
              continue;
            }
            if (inDeclaration || !isStatementBoundary(tokens, index)) continue;

            const call = callAt(tokens, index);
            if (!call) continue;
            validateCall(findings, target, routine.name, call, controller, program);
            index = call.endIndex;
          }
        }
      }
    }

    return findings;
  },
};
