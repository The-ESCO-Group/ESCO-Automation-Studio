import { STRUCTURED_TYPES, arrayDimensionsOf, memberDefs, type Controller, type Program } from "@esco/core";
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

interface IndexToken {
  raw: string;
  literal?: number;
}

interface ReferenceSegment {
  name: string;
  line: number;
  indices?: IndexToken[];
}

interface ReferencePath {
  programName?: string;
  base: string;
  line: number;
  text: string;
  baseIndices?: IndexToken[];
  segments: ReferenceSegment[];
  endIndex: number;
}

const DECLARATION_OPENERS = new Set(["VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP"]);
const DECLARATION_CLOSERS = new Set(["END_VAR"]);

const RESERVED_IDENTIFIERS = new Set([
  "ACTION",
  "BY",
  "CASE",
  "CONFIGURATION",
  "DO",
  "ELSE",
  "ELSIF",
  "END_ACTION",
  "END_CASE",
  "END_CONFIGURATION",
  "END_FOR",
  "END_FUNCTION",
  "END_FUNCTION_BLOCK",
  "END_IF",
  "END_PROGRAM",
  "END_REPEAT",
  "END_RESOURCE",
  "END_STEP",
  "END_STRUCT",
  "END_TRANSITION",
  "END_TYPE",
  "END_WHILE",
  "FALSE",
  "FOR",
  "FUNCTION",
  "FUNCTION_BLOCK",
  "IF",
  "INITIAL_STEP",
  "NOT",
  "OF",
  "OR",
  "PROGRAM",
  "REPEAT",
  "RESOURCE",
  "RETURN",
  "STEP",
  "STRUCT",
  "THEN",
  "TO",
  "TRANSITION",
  "TRUE",
  "TYPE",
  "UNTIL",
  "WHILE",
  "WITH",
  "XOR",
  "AND",
  "MOD",
  ...DECLARATION_OPENERS,
  ...DECLARATION_CLOSERS,
]);

const DATA_TYPE_IDENTIFIERS = new Set([
  "BOOL",
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
  "STRING",
  "TIMER",
  "COUNTER",
  "CONTROL",
  "MESSAGE",
  "MODULE",
  "AXIS",
  "DATE",
  "TIME",
  "TIME_OF_DAY",
  "DATE_AND_TIME",
]);

function normalized(value: string): string {
  return value.toUpperCase();
}

function significantTokens(source: string): StToken[] {
  return tokenizeStructuredText(source).filter((token) => token.kind !== "comment" && token.kind !== "string");
}

function nextToken(tokens: readonly StToken[], index: number): StToken | undefined {
  return tokens[index + 1];
}

function prevToken(tokens: readonly StToken[], index: number): StToken | undefined {
  return tokens[index - 1];
}

function isIdentifier(token: StToken | undefined): token is StToken {
  return token?.kind === "identifier";
}

function isLabel(tokens: readonly StToken[], index: number): boolean {
  return nextToken(tokens, index)?.value === ":" && normalized(tokens[index]!.value) !== "PROGRAM";
}

function isFunctionOrInstructionCall(tokens: readonly StToken[], index: number): boolean {
  return nextToken(tokens, index)?.value === "(";
}

function isJsrRoutineOperand(tokens: readonly StToken[], index: number): boolean {
  const previous = prevToken(tokens, index);
  const call = tokens[index - 2];
  return previous?.value === "(" && call?.value.toUpperCase() === "JSR";
}

function isNamedArgument(tokens: readonly StToken[], index: number): boolean {
  const next = nextToken(tokens, index);
  const previous = prevToken(tokens, index);
  if (next?.value !== ":=" && !(next?.value === "=" && tokens[index + 2]?.value === ">")) return false;
  return previous?.value === "(" || previous?.value === ",";
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
        { name: member.name, dataType: member.dataType, ...(arrayDimensionsOf(member).length ? { dimensions: arrayDimensionsOf(member) } : {}) },
      ])),
    );
  }
  for (const aoi of controller.addOnInstructions) {
    info.set(
      normalized(aoi.name),
      new Map([
        ...aoi.parameters.map((parameter) => [
          normalized(parameter.name),
          { name: parameter.name, dataType: parameter.dataType, ...(arrayDimensionsOf(parameter).length ? { dimensions: arrayDimensionsOf(parameter) } : {}) },
        ] as const),
        ...aoi.localTags.map((localTag) => [
          normalized(localTag.name),
          { name: localTag.name, dataType: localTag.dataType, ...(arrayDimensionsOf(localTag).length ? { dimensions: arrayDimensionsOf(localTag) } : {}) },
        ] as const),
      ]),
    );
  }
  return info;
}

function indexText(indices: readonly IndexToken[]): string {
  return `[${indices.map((index) => index.raw).join(",")}]`;
}

function parseIndexTokens(tokens: readonly StToken[], startIndex: number): { indices: IndexToken[]; endIndex: number; text: string } | undefined {
  if (tokens[startIndex]?.value !== "[") return undefined;
  if (tokens[startIndex + 1]?.value === ":=" && tokens[startIndex + 2]?.value === "]") return undefined;
  const parts: StToken[][] = [[]];
  for (let i = startIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.value === "]") {
      if (parts.some((part) => part.length === 0)) return undefined;
      const indices = parts.map((part) => {
        const raw = part.map((item) => item.value).join("");
        const literal = /^-?\d+$/.test(raw) ? Number(raw) : undefined;
        return Number.isSafeInteger(literal) ? { raw, literal } : { raw };
      });
      return { indices, endIndex: i, text: indexText(indices) };
    }
    if (token.value === ",") {
      parts.push([]);
      continue;
    }
    parts[parts.length - 1]!.push(token);
  }
  return undefined;
}

function collectSuffix(tokens: readonly StToken[], fromIndex: number, reference: ReferencePath): ReferencePath {
  let i = fromIndex;
  if (tokens[i]?.value === "[") {
    const parsed = parseIndexTokens(tokens, i);
    if (parsed) {
      reference.baseIndices = parsed.indices;
      reference.text += parsed.text;
      reference.endIndex = parsed.endIndex;
      i = parsed.endIndex + 1;
    }
  }
  while (tokens[i]?.value === "." && isIdentifier(tokens[i + 1])) {
    const name = tokens[i + 1]!;
    const segment: ReferenceSegment = { name: name.value, line: name.line };
    reference.text += `.${name.value}`;
    reference.endIndex = i + 1;
    i += 2;
    if (tokens[i]?.value === "[") {
      const parsed = parseIndexTokens(tokens, i);
      if (parsed) {
        segment.indices = parsed.indices;
        reference.text += parsed.text;
        reference.endIndex = parsed.endIndex;
        i = parsed.endIndex + 1;
      }
    }
    reference.segments.push(segment);
  }
  return reference;
}

function collectReference(tokens: readonly StToken[], index: number): ReferencePath | undefined {
  const token = tokens[index];
  if (!isIdentifier(token)) return undefined;
  const upper = normalized(token.value);
  if (
    upper === "PROGRAM" &&
    nextToken(tokens, index)?.value === ":" &&
    isIdentifier(tokens[index + 2]) &&
    tokens[index + 3]?.value === "." &&
    isIdentifier(tokens[index + 4])
  ) {
    const programName = tokens[index + 2]!.value;
    const base = tokens[index + 4]!.value;
    return collectSuffix(tokens, index + 5, {
      programName,
      base,
      line: token.line,
      text: `Program:${programName}.${base}`,
      segments: [],
      endIndex: index + 4,
    });
  }
  return collectSuffix(tokens, index + 1, {
    base: token.value,
    line: token.line,
    text: token.value,
    segments: [],
    endIndex: index,
  });
}

function validateIndices(
  findings: ValidationFinding[],
  target: string,
  routineName: string,
  line: number,
  path: string,
  indices: readonly IndexToken[],
  dimensions: readonly number[] | undefined,
): void {
  if (!dimensions || dimensions.length === 0) {
    findings.push({
      ruleId: "array-index-on-scalar",
      severity: "error",
      message: `Structured Text routine "${routineName}" line ${line}: "${path}" is indexed but is not an array.`,
      target,
    });
    return;
  }
  if (indices.length !== dimensions.length) {
    findings.push({
      ruleId: "array-dimension-mismatch",
      severity: "error",
      message: `Structured Text routine "${routineName}" line ${line}: "${path}" supplies ${indices.length} subscript(s), but the declaration has ${dimensions.length} dimension(s).`,
      target,
    });
    return;
  }
  indices.forEach((index, dimensionIndex) => {
    if (index.literal === undefined) return;
    const size = dimensions[dimensionIndex]!;
    if (index.literal < 0) {
      findings.push({
        ruleId: "array-index-out-of-range",
        severity: "error",
        message: `Structured Text routine "${routineName}" line ${line}: array index ${index.literal} is negative for "${path}" dimension ${dimensionIndex}.`,
        target,
      });
    } else if (index.literal >= size) {
      findings.push({
        ruleId: "array-index-out-of-range",
        severity: "error",
        message: `Structured Text routine "${routineName}" line ${line}: array index ${index.literal} is out of range for "${path}" dimension ${dimensionIndex} (size ${size}).`,
        target,
      });
    }
  });
}

function validateReferencePath(
  findings: ValidationFinding[],
  target: string,
  routineName: string,
  reference: ReferencePath,
  tagInfo: TagInfo,
  membersByType: Map<string, Map<string, MemberInfo>>,
): void {
  let currentType = tagInfo.dataType;
  let currentPath = reference.programName ? `Program:${reference.programName}.${reference.base}` : reference.base;
  if (reference.baseIndices) {
    validateIndices(findings, target, routineName, reference.line, currentPath, reference.baseIndices, tagInfo.dimensions);
    currentPath += indexText(reference.baseIndices);
  }

  for (const segment of reference.segments) {
    const members = membersByType.get(normalized(currentType));
    if (!members) {
      findings.push({
        ruleId: "unknown-member",
        severity: "warning",
        message: `Structured Text routine "${routineName}" line ${segment.line}: member "${segment.name}" cannot be used because "${currentPath}" is ${currentType}.`,
        target,
      });
      return;
    }
    const member = members.get(normalized(segment.name));
    if (!member) {
      findings.push({
        ruleId: "unknown-member",
        severity: "warning",
        message: `Structured Text routine "${routineName}" line ${segment.line}: member "${segment.name}" does not exist on ${currentType} reference "${currentPath}".`,
        target,
      });
      return;
    }
    currentPath = `${currentPath}.${segment.name}`;
    if (segment.indices) {
      validateIndices(findings, target, routineName, segment.line, currentPath, segment.indices, member.dimensions);
      currentPath += indexText(segment.indices);
    }
    currentType = member.dataType;
  }
}

export const structuredTextReferences: ValidationRule = {
  id: "structured-text-references",
  name: "Structured Text references",
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
          const reported = new Set<string>();
          let inDeclaration = false;

          for (let i = 0; i < tokens.length; i += 1) {
            const token = tokens[i]!;
            const upper = normalized(token.value);
            if (DECLARATION_OPENERS.has(upper)) {
              inDeclaration = true;
              continue;
            }
            if (DECLARATION_CLOSERS.has(upper)) {
              inDeclaration = false;
              continue;
            }
            if (inDeclaration || !isIdentifier(token)) continue;

            const isProgramQualifiedStart =
              upper === "PROGRAM" &&
              nextToken(tokens, i)?.value === ":" &&
              isIdentifier(tokens[i + 2]) &&
              tokens[i + 3]?.value === "." &&
              isIdentifier(tokens[i + 4]);

            if (
              (!isProgramQualifiedStart && RESERVED_IDENTIFIERS.has(upper)) ||
              DATA_TYPE_IDENTIFIERS.has(upper) ||
              prevToken(tokens, i)?.value === "." ||
              isLabel(tokens, i) ||
              isFunctionOrInstructionCall(tokens, i) ||
              isJsrRoutineOperand(tokens, i) ||
              isNamedArgument(tokens, i)
            ) {
              continue;
            }

            const reference = collectReference(tokens, i);
            if (!reference) continue;
            i = reference.endIndex;
            const key = `${reference.line}:${reference.text}`;

            const referenceScope = reference.programName
              ? programsByName.get(normalized(reference.programName))
              : undefined;
            if (reference.programName && !referenceScope) {
              if (!reported.has(key)) {
                findings.push({
                  ruleId: "undefined-tag",
                  severity: "error",
                  message: `Structured Text routine "${routine.name}" line ${reference.line}: unknown program "${reference.programName}" in reference "${reference.text}".`,
                  target,
                });
                reported.add(key);
              }
              continue;
            }

            const tags = referenceScope ? programLocalInfo(referenceScope) : availableTags;
            const tagInfo = tags.get(normalized(reference.base));
            if (!tagInfo && !reported.has(key)) {
              findings.push({
                ruleId: "undefined-tag",
                severity: "error",
                message: `Structured Text routine "${routine.name}" line ${reference.line}: undefined tag "${reference.text}".`,
                target,
              });
              reported.add(key);
              continue;
            }
            if (tagInfo) validateReferencePath(findings, target, routine.name, reference, tagInfo, membersByType);
          }
        }
      }
    }

    return findings;
  },
};
