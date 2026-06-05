import {
  STRUCTURED_TYPES,
  arrayDimensionsOf,
  memberDefs,
  type Controller,
  type Program,
} from "@esco/core";
import { tokenizeStructuredText } from "@esco/parser-l5x";
import type { ValidationFinding, ValidationRule } from "./types";

type StToken = ReturnType<typeof tokenizeStructuredText>[number];

interface TagInfo {
  dataType: string;
  dimensions?: number[];
}

interface MemberInfo extends TagInfo {
  name: string;
}

interface ReferencePath {
  programName?: string;
  segments: string[];
  text: string;
}

type NumericSelectorKind = "integer" | "real";

interface CaseExpressionNumericType {
  dataType: string;
  kind: NumericSelectorKind;
  text: string;
  line: number;
}

const BLOCK_STARTS = new Set(["IF", "CASE", "FOR", "WHILE", "REPEAT"]);
const BLOCK_ENDS = new Set(["END_IF", "END_CASE", "END_FOR", "END_WHILE", "END_REPEAT"]);
const NUMERIC_TYPES = new Set(["SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT", "REAL", "LREAL"]);
const REAL_TYPES = new Set(["REAL", "LREAL"]);
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

function upper(token: StToken | undefined): string {
  return token?.value.toUpperCase() ?? "";
}

function normalized(value: string): string {
  return value.toUpperCase();
}

function isKeyword(token: StToken | undefined, keyword: string): boolean {
  return token?.kind === "keyword" && upper(token) === keyword;
}

function significantTokens(source: string): StToken[] {
  return tokenizeStructuredText(source).filter((token) => token.kind !== "comment");
}

function trimStatementTerminator(tokens: readonly StToken[]): StToken[] {
  let end = tokens.length;
  while (end > 0 && tokens[end - 1]?.kind === "punctuation" && tokens[end - 1]?.value === ";") end -= 1;
  return tokens.slice(0, end);
}

function compactExpressionTokens(tokens: readonly StToken[]): StToken[] {
  return trimStatementTerminator(tokens).filter((token) => token.value.trim() !== "");
}

function stripEnclosingParens(tokens: readonly StToken[]): StToken[] {
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

function readUntilKeyword(tokens: readonly StToken[], start: number, keyword: string): { segment: StToken[]; next: number } {
  const segment: StToken[] = [];
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

function matchingEndIndex(tokens: readonly StToken[], start: number, end: number, opener: string, closer: string): number {
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

function topLevelKeywordIndex(tokens: readonly StToken[], start: number, end: number, keywords: Set<string>): number {
  let depth = 0;
  for (let index = start; index < end; index += 1) {
    const keyword = upper(tokens[index]);
    if (depth === 0 && keywords.has(keyword)) return index;
    if (BLOCK_STARTS.has(keyword)) depth += 1;
    else if (BLOCK_ENDS.has(keyword)) depth = Math.max(0, depth - 1);
  }
  return -1;
}

function skipStatementTerminator(tokens: readonly StToken[], index: number): number {
  let next = index;
  while (tokens[next]?.kind === "punctuation" && tokens[next]?.value === ";") next += 1;
  return next;
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

function stripTypedNumericPrefixes(expression: string): string {
  return expression.replace(/\b([A-Za-z][A-Za-z0-9_]*)#([0-9A-Fa-f_.]+)\b/g, (_match, typeName: string, digits: string) =>
    TYPED_NUMERIC_PREFIXES.has(typeName.toUpperCase()) ? digits.replace(/_/g, "") : `${typeName}#${digits}`,
  );
}

function parseImmediateNumber(value: string): number | undefined {
  const trimmed = stripTypedNumericPrefixes(value.trim());
  const radixMatch = trimmed.match(/^([+-]?)(\d+)#([0-9A-Fa-f](?:_?[0-9A-Fa-f])*)$/);
  if (radixMatch) {
    const sign = radixMatch[1] === "-" ? -1 : 1;
    const radix = Number(radixMatch[2]);
    const digits = radixMatch[3]!.replace(/_/g, "");
    if (!Number.isInteger(radix) || radix < 2 || radix > 16) return undefined;
    let parsed = 0;
    for (const char of digits) {
      const digit = Number.parseInt(char, 16);
      if (!Number.isInteger(digit) || digit >= radix) return undefined;
      parsed = parsed * radix + digit;
    }
    return sign * parsed;
  }

  if (/^[+-]?((\d(?:_?\d)*)(\.(\d(?:_?\d)*)?)?|\.(\d(?:_?\d)*))$/.test(trimmed)) {
    const parsed = Number(trimmed.replace(/_/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function typedNumericPrefix(value: string): string | undefined {
  const match = value.trim().match(/^([A-Za-z][A-Za-z0-9_]*)#/);
  const prefix = match?.[1]?.toUpperCase();
  return prefix && TYPED_NUMERIC_PREFIXES.has(prefix) ? prefix : undefined;
}

function immediateSelectorKind(value: string): NumericSelectorKind | undefined {
  if (parseImmediateNumber(value) === undefined) return undefined;
  const prefix = typedNumericPrefix(value);
  if (prefix && REAL_TYPES.has(prefix)) return "real";
  const untyped = stripTypedNumericPrefixes(value.trim());
  return untyped.includes(".") ? "real" : "integer";
}

function withDimensions(value: { dataType: string; dimension?: number; dimensions?: readonly number[] }): TagInfo {
  const dimensions = arrayDimensionsOf(value);
  return {
    dataType: value.dataType,
    ...(dimensions.length > 0 ? { dimensions } : {}),
  };
}

function tagInfoFor(controller: Controller, program: Program): Map<string, TagInfo> {
  const tags = new Map<string, TagInfo>();
  for (const tag of controller.controllerTags) tags.set(normalized(tag.name), withDimensions(tag));
  for (const tag of program.programTags) tags.set(normalized(tag.name), withDimensions(tag));
  for (const parameter of program.parameters ?? []) tags.set(normalized(parameter.name), withDimensions(parameter));
  return tags;
}

function programLocalInfo(program: Program): Map<string, TagInfo> {
  const tags = new Map<string, TagInfo>();
  for (const tag of program.programTags) tags.set(normalized(tag.name), withDimensions(tag));
  for (const parameter of program.parameters ?? []) tags.set(normalized(parameter.name), withDimensions(parameter));
  return tags;
}

function memberInfoFor(controller: Controller): Map<string, Map<string, MemberInfo>> {
  const info = new Map<string, Map<string, MemberInfo>>();
  for (const structured of Object.keys(STRUCTURED_TYPES)) {
    info.set(
      normalized(structured),
      new Map(memberDefs(structured).map((member) => [
        normalized(member.name),
        { name: member.name, dataType: member.type },
      ])),
    );
  }
  for (const udt of controller.dataTypes) {
    info.set(
      normalized(udt.name),
      new Map(udt.members.map((member) => [
        normalized(member.name),
        {
          name: member.name,
          dataType: member.dataType,
          ...(arrayDimensionsOf(member).length ? { dimensions: arrayDimensionsOf(member) } : {}),
        },
      ])),
    );
  }
  for (const aoi of controller.addOnInstructions) {
    info.set(
      normalized(aoi.name),
      new Map([
        ...aoi.parameters.map((parameter) => [
          normalized(parameter.name),
          {
            name: parameter.name,
            dataType: parameter.dataType,
            ...(arrayDimensionsOf(parameter).length ? { dimensions: arrayDimensionsOf(parameter) } : {}),
          },
        ] as const),
        ...aoi.localTags.map((localTag) => [
          normalized(localTag.name),
          {
            name: localTag.name,
            dataType: localTag.dataType,
            ...(arrayDimensionsOf(localTag).length ? { dimensions: arrayDimensionsOf(localTag) } : {}),
          },
        ] as const),
      ]),
    );
  }
  return info;
}

function labelText(tokens: readonly StToken[]): string {
  return trimStatementTerminator(tokens).map((token) => token.value).join("").replace(/\s+/g, "");
}

function labelIsImmediateSelector(tokens: readonly StToken[]): boolean {
  const text = labelText(tokens);
  if (!text) return false;
  const rangeAt = text.indexOf("..");
  if (rangeAt >= 0) {
    return parseImmediateNumber(text.slice(0, rangeAt)) !== undefined && parseImmediateNumber(text.slice(rangeAt + 2)) !== undefined;
  }
  return parseImmediateNumber(text) !== undefined;
}

function labelsAreImmediateSelectors(tokens: readonly StToken[]): boolean {
  const labels = splitTopLevelCommas(tokens).map((label) => trimStatementTerminator(label).filter((token) => token.value.trim() !== ""));
  return labels.length > 0 && labels.every((label) => label.length > 0 && labelIsImmediateSelector(label));
}

function skipArraySubscript(tokens: readonly StToken[], start: number): number {
  if (tokens[start]?.value !== "[") return start;
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.value === "[") depth += 1;
    else if (token.value === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return start;
}

function referencePathFromTokens(tokens: readonly StToken[]): ReferencePath | undefined {
  const expression = stripEnclosingParens(tokens);
  if (expression.length === 0) return undefined;

  let index = 0;
  let programName: string | undefined;
  const segments: string[] = [];

  if (
    normalized(expression[0]?.value ?? "") === "PROGRAM" &&
    expression[1]?.value === ":" &&
    expression[2]?.kind === "identifier" &&
    expression[3]?.value === "." &&
    expression[4]?.kind === "identifier"
  ) {
    programName = expression[2]!.value;
    segments.push(expression[4]!.value);
    index = 5;
  } else if (expression[0]?.kind === "identifier") {
    segments.push(expression[0].value);
    index = 1;
  } else {
    return undefined;
  }

  index = skipArraySubscript(expression, index);
  while (index < expression.length) {
    if (expression[index]?.value !== "." || expression[index + 1]?.kind !== "identifier") return undefined;
    segments.push(expression[index + 1]!.value);
    index = skipArraySubscript(expression, index + 2);
  }
  if (index !== expression.length) return undefined;

  return {
    ...(programName ? { programName } : {}),
    segments,
    text: expression.map((token) => token.value).join("").trim(),
  };
}

function resolveReferenceType(
  reference: ReferencePath,
  programsByName: ReadonlyMap<string, Program>,
  availableTags: ReadonlyMap<string, TagInfo>,
  membersByType: ReadonlyMap<string, ReadonlyMap<string, MemberInfo>>,
): string | undefined {
  const scope = reference.programName ? programsByName.get(normalized(reference.programName)) : undefined;
  if (reference.programName && !scope) return undefined;
  const tags = scope ? programLocalInfo(scope) : availableTags;
  const base = tags.get(normalized(reference.segments[0] ?? ""));
  if (!base) return undefined;

  let currentType = base.dataType;
  for (const segment of reference.segments.slice(1)) {
    const members = membersByType.get(normalized(currentType));
    const member = members?.get(normalized(segment));
    if (!member) return undefined;
    currentType = member.dataType;
  }
  return currentType;
}

function caseDataTypeKind(dataType: string): NumericSelectorKind | "nonnumeric" | "unknown" {
  const type = normalized(dataType);
  if (NUMERIC_TYPES.has(type)) return REAL_TYPES.has(type) ? "real" : "integer";
  if (type === "BOOL" || type === "STRING" || STRUCTURED_TYPES[type]) return "nonnumeric";
  return "unknown";
}

function caseExpressionResolvedType(
  expression: readonly StToken[],
  programsByName: ReadonlyMap<string, Program>,
  availableTags: ReadonlyMap<string, TagInfo>,
  membersByType: ReadonlyMap<string, ReadonlyMap<string, MemberInfo>>,
): string | undefined {
  const tokens = stripEnclosingParens(expression);
  if (tokens.length === 0) return undefined;
  const raw = labelText(tokens);
  if (parseImmediateNumber(raw) !== undefined) return typedNumericPrefix(raw);
  if (tokens.length === 1 && tokens[0]!.kind === "string") return "STRING";
  if (tokens.length === 1 && (upper(tokens[0]) === "TRUE" || upper(tokens[0]) === "FALSE")) return "BOOL";

  const reference = referencePathFromTokens(tokens);
  if (!reference) return undefined;
  return resolveReferenceType(reference, programsByName, availableTags, membersByType);
}

function caseExpressionNonNumericType(
  expression: readonly StToken[],
  programsByName: ReadonlyMap<string, Program>,
  availableTags: ReadonlyMap<string, TagInfo>,
  membersByType: ReadonlyMap<string, ReadonlyMap<string, MemberInfo>>,
): string | undefined {
  const dataType = caseExpressionResolvedType(expression, programsByName, availableTags, membersByType);
  if (!dataType) return undefined;
  return caseDataTypeKind(dataType) === "nonnumeric" ? dataType : undefined;
}

function caseExpressionNumericType(
  expression: readonly StToken[],
  programsByName: ReadonlyMap<string, Program>,
  availableTags: ReadonlyMap<string, TagInfo>,
  membersByType: ReadonlyMap<string, ReadonlyMap<string, MemberInfo>>,
): CaseExpressionNumericType | undefined {
  const tokens = stripEnclosingParens(expression);
  const dataType = caseExpressionResolvedType(tokens, programsByName, availableTags, membersByType);
  if (!dataType) return undefined;
  const kind = caseDataTypeKind(dataType);
  if (kind !== "integer" && kind !== "real") return undefined;
  return {
    dataType,
    kind,
    text: tokens.map((token) => token.value).join("").trim(),
    line: tokens[0]?.line ?? expression[0]?.line ?? 0,
  };
}

function validateCaseExpression(
  findings: ValidationFinding[],
  target: string,
  routineName: string,
  expression: readonly StToken[],
  programsByName: ReadonlyMap<string, Program>,
  availableTags: ReadonlyMap<string, TagInfo>,
  membersByType: ReadonlyMap<string, ReadonlyMap<string, MemberInfo>>,
): void {
  const nonNumericType = caseExpressionNonNumericType(expression, programsByName, availableTags, membersByType);
  if (!nonNumericType) return;
  const compact = stripEnclosingParens(expression);
  const raw = compact.map((token) => token.value).join("").trim();
  findings.push({
    ruleId: "structured-text-case-expression",
    severity: "error",
    message: `Structured Text routine "${routineName}" line ${compact[0]?.line ?? expression[0]?.line ?? 0}: CASE expression "${raw}" resolves to ${nonNumericType}; controller-editor CASE rules require a numeric expression.`,
    target,
  });
}

function selectorTypedPrefixMismatch(selectorType: CaseExpressionNumericType, raw: string): boolean {
  const prefix = typedNumericPrefix(raw);
  return !!prefix && prefix !== normalized(selectorType.dataType);
}

function selectorKindMismatch(selectorType: CaseExpressionNumericType, raw: string): boolean {
  const selectorKind = immediateSelectorKind(raw);
  if (!selectorKind) return false;
  if (selectorTypedPrefixMismatch(selectorType, raw)) return true;
  return selectorType.kind === "integer" && selectorKind === "real";
}

function mismatchedSelectorLabels(selectorType: CaseExpressionNumericType, tokens: readonly StToken[]): string[] {
  const mismatches: string[] = [];
  for (const label of splitTopLevelCommas(tokens)) {
    const trimmed = trimStatementTerminator(label).filter((token) => token.value.trim() !== "");
    if (trimmed.length === 0 || !labelIsImmediateSelector(trimmed)) continue;
    const raw = labelText(trimmed);
    const rangeAt = raw.indexOf("..");
    if (rangeAt === -1) {
      if (selectorKindMismatch(selectorType, raw)) mismatches.push(raw);
      continue;
    }
    const low = raw.slice(0, rangeAt);
    const high = raw.slice(rangeAt + 2);
    if (selectorKindMismatch(selectorType, low) || selectorKindMismatch(selectorType, high)) mismatches.push(raw);
  }
  return mismatches;
}

function exactRealSelectorLabels(selectorType: CaseExpressionNumericType, tokens: readonly StToken[]): string[] {
  if (selectorType.kind !== "real") return [];
  const exactMatches: string[] = [];
  for (const label of splitTopLevelCommas(tokens)) {
    const trimmed = trimStatementTerminator(label).filter((token) => token.value.trim() !== "");
    if (trimmed.length === 0 || !labelIsImmediateSelector(trimmed)) continue;
    const raw = labelText(trimmed);
    if (raw.includes("..") || selectorKindMismatch(selectorType, raw)) continue;
    exactMatches.push(raw);
  }
  return exactMatches;
}

function validateCaseLabels(
  findings: ValidationFinding[],
  target: string,
  routineName: string,
  tokens: readonly StToken[],
  start: number,
  end: number,
  selectorType: CaseExpressionNumericType | undefined,
): void {
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
      upper(tokens[index - 1]) !== "PROGRAM"
    ) {
      const labelTokens = tokens.slice(candidate, index);
      if (!labelsAreImmediateSelectors(labelTokens)) {
        const raw = labelTokens.map((item) => item.value).join("").trim();
        findings.push({
          ruleId: "structured-text-case-label",
          severity: "error",
          message: `Structured Text routine "${routineName}" line ${tokens[candidate]?.line ?? token.line}: CASE selector label "${raw}" must be an immediate numeric value or range.`,
          target,
        });
      } else if (selectorType) {
        for (const raw of mismatchedSelectorLabels(selectorType, labelTokens)) {
          findings.push({
            ruleId: "structured-text-case-selector-type",
            severity: "error",
            message: `Structured Text routine "${routineName}" line ${tokens[candidate]?.line ?? token.line}: CASE selector label "${raw}" must match ${selectorType.dataType} expression "${selectorType.text}".`,
            target,
          });
        }
        for (const raw of exactRealSelectorLabels(selectorType, labelTokens)) {
          findings.push({
            ruleId: "structured-text-case-real-selector",
            severity: "warning",
            message: `Structured Text routine "${routineName}" line ${tokens[candidate]?.line ?? token.line}: CASE selector label "${raw}" is an exact REAL match for "${selectorType.text}"; controller-editor guidance recommends using a range selector for REAL values.`,
            target,
          });
        }
      }
      candidate = index + 1;
    }
  }
}

export const structuredTextCase: ValidationRule = {
  id: "structured-text-case",
  name: "Structured Text CASE labels",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];

    for (const controller of project.controllers) {
      const programsByName = new Map(controller.programs.map((program) => [normalized(program.name), program]));
      const membersByType = memberInfoFor(controller);
      for (const program of controller.programs) {
        const availableTags = tagInfoFor(controller, program);
        for (const routine of program.routines) {
          if (routine.language !== "structured-text") continue;
          const target = `${controller.name}/${program.name}/${routine.name}`;
          const tokens = significantTokens(routine.structuredText ?? routine.sourceText ?? "");
          for (let index = 0; index < tokens.length; index += 1) {
            if (!isKeyword(tokens[index], "CASE")) continue;
            const header = readUntilKeyword(tokens, index + 1, "OF");
            validateCaseExpression(findings, target, routine.name, header.segment, programsByName, availableTags, membersByType);
            const selectorType = caseExpressionNumericType(header.segment, programsByName, availableTags, membersByType);
            const endCase = matchingEndIndex(tokens, header.next, tokens.length, "CASE", "END_CASE");
            const elseAt = topLevelKeywordIndex(tokens, header.next, endCase, new Set(["ELSE"]));
            validateCaseLabels(findings, target, routine.name, tokens, header.next, elseAt === -1 ? endCase : elseAt, selectorType);
          }
        }
      }
    }

    return findings;
  },
};
