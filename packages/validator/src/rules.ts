import { STRUCTURED_TYPES, arrayDimensionsOf, arrayDimensionSuffix, memberDefs, type AddOnInstruction, type Tag } from "@esco/core";
import {
  baseTagName,
  createDefaultRegistry,
  instructionFidelity,
  instructionFidelityLabel,
  isNumericLiteral,
  isPlainTag,
  isValidExpression,
  MAX_ROUTINE_PARAMETERS,
  parseStringComparisonExpression,
  parseJsrParameterLayout,
  referencedPaths,
  type InstructionOperandDefinition,
} from "@esco/instructions";
import { routineNodes, rungNodes, type LadderRoutine } from "@esco/ladder";
import type { ValidationFinding, ValidationRule } from "./types";

const registry = createDefaultRegistry();

/** Recognise a populated ladder routine stored in the loosely-typed `Routine.ladder`. */
function asLadderRoutine(ladder: unknown): LadderRoutine | undefined {
  if (
    ladder &&
    typeof ladder === "object" &&
    Array.isArray((ladder as { rungs?: unknown }).rungs)
  ) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

function aoiHasExecutableRll(aoi: AddOnInstruction): boolean {
  if (aoi.protected) return false;
  return (aoi.routines ?? []).some((routine) => !!asLadderRoutine(routine.ladder));
}

function isMissingOperandValidation(message: string): boolean {
  return /^Operand '.+' is required\.$/.test(message);
}

/**
 * EnableIn/EnableOut are implicit Add-On Instruction parameters driven by the
 * rung condition; they are never passed positionally in a call's argument list,
 * so they are excluded when counting the required call arguments.
 */
function isImplicitEnableParameter(name: string): boolean {
  const upper = name.toUpperCase();
  return upper === "ENABLEIN" || upper === "ENABLEOUT";
}

/**
 * Why a Logix tag name is invalid, or `undefined` if it is acceptable. Mirrors
 * the offline name rules Studio 5000 enforces when creating a tag: 1–40 chars,
 * begins with a letter or underscore, only letters/digits/underscores, and no
 * consecutive or trailing underscores.
 */
function invalidNameReason(name: string): string | undefined {
  if (name.length === 0) return "the name is empty";
  if (name.length > 40) return `the name is ${name.length} characters (limit is 40)`;
  if (!/^[A-Za-z_]/.test(name)) return "the name must begin with a letter or underscore";
  if (!/^[A-Za-z0-9_]+$/.test(name)) return "the name may only contain letters, digits, and underscores";
  if (name.includes("__")) return "the name must not contain consecutive underscores";
  if (name.endsWith("_")) return "the name must not end with an underscore";
  return undefined;
}

interface MemberInfo {
  dataType: string;
  dimensions?: number[];
}

/**
 * Bit width of a Logix integer atomic type, or `undefined` if the type is not
 * bit-addressable. Bit access (`Tag.5`) is legal only on SINT/INT/DINT/LINT, and
 * the bit number must be within the type's width; Studio 5000 rejects bit access
 * on REAL/STRING/structured types and bit numbers at or above the width on
 * download. Smaller integers keep their declared type string even though the
 * offline simulator stores them as DINT, so the declared width is checked here.
 */
function integerBitWidth(dataType: string): number | undefined {
  switch (dataType.toUpperCase()) {
    case "SINT":
      return 8;
    case "INT":
      return 16;
    case "DINT":
      return 32;
    case "LINT":
      return 64;
    default:
      return undefined;
  }
}

function isIntegerIndexType(dataType: string): boolean {
  return ["SINT", "INT", "DINT", "LINT"].includes(dataType.toUpperCase());
}

interface ArrayIndexToken {
  raw: string;
  literal?: number;
  path?: string;
  expression?: string;
}

const IDENT = "[A-Za-z_][A-Za-z0-9_]*";

function isIndexPath(value: string): boolean {
  return new RegExp(`^(?:Program:${IDENT}\\.)?${IDENT}(?:\\.${IDENT})*$`).test(value.trim());
}

function parseIndexList(raw: string): ArrayIndexToken[] | undefined {
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return undefined;
  const indices: ArrayIndexToken[] = [];
  for (const part of parts) {
    if (/^-?\d+$/.test(part)) {
      // A signed integer constant subscript. A negative literal is captured here
      // (rather than falling through to the expression branch) so the bounds check
      // can reject it the way Studio 5000's offline verify does.
      const literal = Number(part);
      if (!Number.isSafeInteger(literal)) return undefined;
      indices.push({ raw: part, literal });
    } else if (isIndexPath(part)) {
      indices.push({ raw: part, path: part });
    } else if (isValidExpression(part)) {
      indices.push({ raw: part, expression: part });
    } else {
      return undefined;
    }
  }
  return indices;
}

function indexListText(indices: readonly ArrayIndexToken[]): string {
  return indices.map((index) => index.raw).join(",");
}

function parseIndexedSegment(segment: string): { name: string; indices?: ArrayIndexToken[] } | undefined {
  const match = segment.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]+)])?$/);
  if (!match) return undefined;
  const indices = match[2] != null ? parseIndexList(match[2]) : undefined;
  if (match[2] != null && !indices) return undefined;
  return {
    name: match[1]!,
    ...(indices ? { indices } : {}),
  };
}

function parseTagPath(value: string): { program?: string; base: string; indices?: ArrayIndexToken[]; members?: string } | undefined {
  const match = value.trim().match(/^((?:Program:([A-Za-z_][A-Za-z0-9_]*)\.)?)([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]+)])?(?:\.(.+))?$/);
  if (!match) return undefined;
  const indices = match[4] != null ? parseIndexList(match[4]) : undefined;
  if (match[4] != null && !indices) return undefined;
  return {
    ...(match[2] ? { program: match[2] } : {}),
    base: match[3]!,
    ...(indices ? { indices } : {}),
    ...(match[5] != null ? { members: match[5] } : {}),
  };
}

function tagPathPrefix(path: { program?: string }): string {
  return path.program ? `Program:${path.program}.` : "";
}

function tagPathLabel(path: { program?: string; base: string }): string {
  return `${tagPathPrefix(path)}${path.base}`;
}

function operandValues(node: { operands: { value: string }[] }, start = 0): string[] {
  return node.operands.slice(start).map((operand) => operand.value.trim());
}

function routineInstructionOperands(ladder: LadderRoutine, instructionType: string): string[][] {
  const rungs = [...ladder.rungs].sort((a, b) => a.number - b.number);
  const matches: string[][] = [];
  for (const rung of rungs) {
    for (const node of rungNodes(rung)) {
      if (node.instructionType === instructionType) matches.push(operandValues(node));
    }
  }
  return matches;
}

/** A program should declare a main routine. */
export const missingMainRoutine: ValidationRule = {
  id: "missing-main-routine",
  name: "Missing main routine",
  category: "project-structure",
  severity: "warning",
  run({ project }) {
    return project.controllers.flatMap((controller) =>
      controller.programs
        .filter((program) => !program.mainRoutineId)
        .map((program) => ({
          ruleId: "missing-main-routine",
          severity: "warning" as const,
          message: `Program "${program.name}" has no main routine.`,
          target: `${controller.name}/${program.name}`,
        })),
    );
  },
};

/**
 * A program's configured main/fault routine must name a routine that exists in
 * the program. `mainRoutineId`/`faultRoutineId` reference a routine by id; an
 * offline edit can leave one pointing at a routine that was renamed or removed.
 * The L5X exporter resolves the id to a routine name for the `<Program>`
 * MainRoutineName/FaultRoutineName attributes and silently omits the attribute
 * when the id no longer resolves, so the dangling configuration disappears on
 * round-trip and Studio 5000 has no main routine to scan. This complements
 * `missing-main-routine` (which catches an *absent* main routine) by catching a
 * *dangling* one. Reported as an error because the program will not verify.
 */
export const danglingRoutineReference: ValidationRule = {
  id: "dangling-routine-reference",
  name: "Dangling routine reference",
  category: "project-structure",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const program of controller.programs) {
        const routineIds = new Set(program.routines.map((routine) => routine.id));
        const target = `${controller.name}/${program.name}`;
        if (program.mainRoutineId && !routineIds.has(program.mainRoutineId)) {
          findings.push({
            ruleId: "dangling-routine-reference",
            severity: "error",
            message: `Program "${program.name}" references a main routine that does not exist.`,
            target,
          });
        }
        if (program.faultRoutineId && !routineIds.has(program.faultRoutineId)) {
          findings.push({
            ruleId: "dangling-routine-reference",
            severity: "error",
            message: `Program "${program.name}" references a fault routine that does not exist.`,
            target,
          });
        }
      }
    }
    return findings;
  },
};

/** Tag names must be unique within their controller scope. */
export const duplicateControllerTag: ValidationRule = {
  id: "duplicate-controller-tag",
  name: "Duplicate controller tag",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings = [];
    for (const controller of project.controllers) {
      const seen = new Set<string>();
      for (const tag of controller.controllerTags) {
        if (seen.has(tag.name)) {
          findings.push({
            ruleId: "duplicate-controller-tag",
            severity: "error" as const,
            message: `Duplicate controller tag "${tag.name}".`,
            target: `${controller.name}/${tag.name}`,
          });
        }
        seen.add(tag.name);
      }
    }
    return findings;
  },
};

/**
 * Validate every ladder operand against the instruction registry:
 *  - `missing-operand` (warning): a required operand is blank;
 *  - `undefined-tag` (error): a tag reference has no matching tag;
 *  - `operand-type-mismatch` (error): a tag's data type isn't allowed there.
 * Numeric literals (e.g. MOV(123, …)) are constants, not tag references.
 */
export const ladderOperands: ValidationRule = {
  id: "ladder-operands",
  name: "Ladder operands",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const stringDataTypes = new Set<string>([
        "STRING",
        ...controller.dataTypes
          .filter((dataType) => dataType.family === "StringFamily")
          .map((dataType) => dataType.name.toUpperCase()),
      ]);
      const isStringDataType = (dataType: string | undefined): boolean =>
        !!dataType && stringDataTypes.has(dataType.toUpperCase());
      const operandAllowsDataType = (allowedTypes: readonly string[], dataType: string | undefined): boolean => {
        if (!dataType) return false;
        const resolved = dataType.toUpperCase();
        return allowedTypes.some((allowed) => {
          const normalized = allowed.toUpperCase();
          return normalized === resolved || (normalized === "STRING" && isStringDataType(dataType));
        });
      };

      // Controller-scope tag types/dimensions/aliases (overlaid per program below).
      const controllerTypes = new Map<string, string>();
      const controllerDims = new Map<string, number[]>();
      const controllerAlias = new Map<string, string>();
      for (const tag of controller.controllerTags) {
        controllerTypes.set(tag.name, tag.dataType);
        const dimensions = arrayDimensionsOf(tag);
        if (dimensions.length > 0) controllerDims.set(tag.name, dimensions);
        if (tag.aliasFor) controllerAlias.set(tag.name, tag.aliasFor.trim());
      }
      const aoisByType = new Map(controller.addOnInstructions.map((aoi) => [aoi.name.toUpperCase(), aoi]));
      const programsByName = new Map(controller.programs.map((candidate) => [candidate.name, candidate]));

      // Known members by structured/UDT type, for member-path validation.
      const memberInfo = new Map<string, Map<string, MemberInfo>>();
      for (const structured of Object.keys(STRUCTURED_TYPES)) {
        memberInfo.set(
          structured,
          new Map(memberDefs(structured).map((m) => [m.name, { dataType: m.type }])),
        );
      }
      for (const udt of controller.dataTypes) {
        memberInfo.set(
          udt.name,
          new Map(udt.members.map((m) => [
            m.name,
            {
              dataType: m.dataType,
              ...(arrayDimensionsOf(m).length > 0 ? { dimensions: arrayDimensionsOf(m) } : {}),
            },
          ])),
        );
      }
      for (const aoi of controller.addOnInstructions) {
        memberInfo.set(
          aoi.name,
          new Map([
            ...aoi.parameters.map((parameter) => [
              parameter.name,
              { dataType: parameter.dataType },
            ] as const),
            ...aoi.localTags.map((localTag) => [
              localTag.name,
              {
                dataType: localTag.dataType,
                ...(arrayDimensionsOf(localTag).length > 0 ? { dimensions: arrayDimensionsOf(localTag) } : {}),
              },
            ] as const),
          ]),
        );
      }

      for (const program of controller.programs) {
        // Effective tags inside this program: controller scope overlaid with
        // (shadowed by) the program's own tags.
        const tagTypes = new Map(controllerTypes);
        const tagDims = new Map(controllerDims);
        const tagAlias = new Map(controllerAlias);
        // A JSR resolves only against routines in its own program; a routine of
        // the same name in another program does not satisfy the reference.
        const routineNames = new Set(program.routines.map((routine) => routine.name));
        const programLaddersByName = new Map<string, LadderRoutine>();
        for (const tag of program.programTags) {
          tagTypes.set(tag.name, tag.dataType);
          const dimensions = arrayDimensionsOf(tag);
          if (dimensions.length > 0) tagDims.set(tag.name, dimensions);
          else tagDims.delete(tag.name);
          if (tag.aliasFor) tagAlias.set(tag.name, tag.aliasFor.trim());
          else tagAlias.delete(tag.name);
        }
        for (const candidate of program.routines) {
          const candidateLadder = asLadderRoutine(candidate.ladder);
          if (candidateLadder) programLaddersByName.set(candidate.name, candidateLadder);
        }

        const programLocalScope = (programName: string) => {
          const scopedProgram = programsByName.get(programName);
          if (!scopedProgram) return undefined;
          const types = new Map<string, string>();
          const dims = new Map<string, number[]>();
          const alias = new Map<string, string>();
          for (const tag of scopedProgram.programTags) {
            types.set(tag.name, tag.dataType);
            const dimensions = arrayDimensionsOf(tag);
            if (dimensions.length > 0) dims.set(tag.name, dimensions);
            if (tag.aliasFor) alias.set(tag.name, tag.aliasFor.trim());
          }
          return { program: scopedProgram, types, dims, alias };
        };

        const scopeForPath = (parsed: { program?: string }) => {
          if (!parsed.program) return { types: tagTypes, dims: tagDims, alias: tagAlias };
          return programLocalScope(parsed.program);
        };

        const maybeQualifyAliasTarget = (programName: string | undefined, targetPath: string): string => {
          if (!programName || targetPath.trim().startsWith("Program:")) return targetPath;
          const targetParsed = parseTagPath(targetPath);
          const localScope = programLocalScope(programName);
          return targetParsed && localScope?.types.has(targetParsed.base)
            ? `Program:${programName}.${targetPath}`
            : targetPath;
        };

        // Resolve a tag/member path through alias chains. Aliases may target
        // member or element paths such as Motor.Run or Pumps[2].Running.
        const resolveAliasPath = (path: string, seen = new Set<string>()): string | undefined => {
          const parsed = parseTagPath(path);
          if (!parsed) return path;
          const scope = scopeForPath(parsed);
          if (!scope) return path;
          const targetPath = scope.alias.get(parsed.base);
          if (!targetPath) return path;
          const seenKey = `${parsed.program ?? ""}:${parsed.base}`;
          if (seen.has(seenKey)) return undefined; // alias cycle
          seen.add(seenKey);
          const suffix = path.trim().slice(tagPathPrefix(parsed).length + parsed.base.length);
          return resolveAliasPath(`${maybeQualifyAliasTarget(parsed.program, targetPath)}${suffix}`, seen);
        };

        const typeOfResolvedPath = (path: string): string | undefined => {
          const resolved = resolveAliasPath(path);
          if (!resolved) return undefined;
          const parsed = parseTagPath(resolved);
          if (!parsed) return undefined;
          const scope = scopeForPath(parsed);
          if (!scope) return undefined;
          let currentType = scope.types.get(parsed.base);
          if (!currentType) return undefined;
          if (!parsed.members) return currentType;
          for (const segment of parsed.members.split(".")) {
            const indexed = parseIndexedSegment(segment);
            if (!indexed) return undefined;
            const members = memberInfo.get(currentType);
            if (!members) return undefined;
            const member = members.get(indexed.name);
            if (!member) return undefined;
            currentType = member.dataType;
          }
          return currentType;
        };

        for (const routine of program.routines) {
          const ladder = asLadderRoutine(routine.ladder);
          if (!ladder) continue;
          const target = `${controller.name}/${program.name}/${routine.name}`;

          for (const node of routineNodes(ladder)) {
            const definition = registry.get(node.instructionType);
            if (!definition) {
              const aoi = aoisByType.get(node.instructionType.toUpperCase());
              if (aoi) {
                if (!aoiHasExecutableRll(aoi)) {
                  findings.push({
                    ruleId: "model-only-instruction",
                    severity: "info",
                    message: `Add-On Instruction "${aoi.name}" is project-defined and model-only (no imported executable RLL body is available).`,
                    target,
                  });
                }
                const instance = node.operands[0]?.value?.trim() ?? "";
                if (!instance) {
                  findings.push({
                    ruleId: "missing-operand",
                    severity: "warning",
                    message: `${aoi.name} is missing required AOI instance tag.`,
                    target,
                  });
                } else if (isNumericLiteral(instance)) {
                  findings.push({
                    ruleId: "invalid-write-target",
                    severity: "error",
                    message: `${aoi.name} instance must be a writable tag, not the literal "${instance}".`,
                    target,
                  });
                } else {
                  const base = baseTagName(instance);
                  if (base && !tagTypes.has(base) && !tagAlias.has(base)) {
                    findings.push({
                      ruleId: "undefined-tag",
                      severity: "error",
                      message: `Undefined AOI instance tag "${base}" referenced in routine "${routine.name}".`,
                      target,
                    });
                  } else if (isPlainTag(instance)) {
                    const dataType = typeOfResolvedPath(instance);
                    if (dataType && dataType.toUpperCase() !== aoi.name.toUpperCase()) {
                      findings.push({
                        ruleId: "operand-type-mismatch",
                        severity: "error",
                        message: `AOI call "${aoi.name}" expects an instance tag of type ${aoi.name}, but tag "${instance}" is ${dataType}.`,
                        target,
                      });
                    }
                  }
                }
                // Studio 5000 rejects an AOI call that omits a required parameter
                // at verify time. Required parameters are supplied positionally
                // after the instance tag (EnableIn/EnableOut are implicit and never
                // appear in the argument list). Flag only when too few are supplied,
                // since optional visible parameters may legitimately add extra args.
                const requiredParameters = aoi.parameters.filter(
                  (parameter) => parameter.required && !isImplicitEnableParameter(parameter.name),
                );
                const suppliedArgumentCount = node.operands.length - 1; // operands after the instance tag
                if (instance && suppliedArgumentCount < requiredParameters.length) {
                  const missing = requiredParameters.slice(Math.max(0, suppliedArgumentCount));
                  findings.push({
                    ruleId: "missing-aoi-parameter",
                    severity: "error",
                    message: `AOI call "${aoi.name}" is missing ${missing.length} required parameter argument(s): ${missing.map((parameter) => parameter.name).join(", ")}.`,
                    target,
                  });
                }
                continue;
              }
              findings.push({
                ruleId: "unsupported-instruction",
                severity: "info",
                message: `Instruction "${node.instructionType}" is unsupported (fidelity: ${instructionFidelityLabel(instructionFidelity(undefined).status)}) and will not be simulated.`,
                target,
              });
              continue;
            }

            const checkModelOnlyReviewOperand = (value: string, operandDef: InstructionOperandDefinition): void => {
              if (!operandDef.validateOnModelOnly) return;
              if (value === "") {
                if (operandDef.required) {
                  findings.push({
                    ruleId: "missing-operand",
                    severity: "warning",
                    message: `${node.instructionType} is missing required model-only review operand "${operandDef.name}".`,
                    target,
                  });
                }
                return;
              }
              if (isNumericLiteral(value)) {
                if (operandDef.direction === "write") {
                  findings.push({
                    ruleId: "invalid-write-target",
                    severity: "error",
                    message: `${node.instructionType} operand "${operandDef.name}" must be a writable tag, not the literal "${value}".`,
                    target,
                  });
                }
                return;
              }
              if (operandDef.isLabelRef || operandDef.isRoutineRef || operandDef.isExpression) return;

              const parsed = parseTagPath(value);
              const base = parsed?.base ?? baseTagName(value);
              if (base === "") return;
              const scope = parsed ? scopeForPath(parsed) : { types: tagTypes, dims: tagDims, alias: tagAlias };
              if (parsed?.program && !scope) {
                findings.push({
                  ruleId: "undefined-tag",
                  severity: "error",
                  message: `Unknown program "${parsed.program}" referenced by model-only ${node.instructionType} operand "${operandDef.name}".`,
                  target,
                });
                return;
              }
              if (!scope?.types.has(base) && !scope?.alias.has(base)) {
                findings.push({
                  ruleId: "undefined-tag",
                  severity: "error",
                  message: `Undefined tag "${base}" referenced by model-only ${node.instructionType} operand "${operandDef.name}" in routine "${routine.name}".`,
                  target,
                });
                return;
              }

              const resolvedType = typeOfResolvedPath(value);
              if (
                operandDef.allowedTypes &&
                resolvedType &&
                !operandAllowsDataType(operandDef.allowedTypes, resolvedType)
              ) {
                findings.push({
                  ruleId: "operand-type-mismatch",
                  severity: "error",
                  message: `${node.instructionType} operand "${operandDef.name}" expects ${operandDef.allowedTypes.join("/")}, but tag "${value}" is ${resolvedType}.`,
                  target,
                });
              }
            };

            // Model-only instructions are recognized but not simulated. Most
            // still skip operand tag-validation because their operands are often
            // keywords/structures, but concrete review operands can opt in.
            if (definition.modelOnly) {
              const fidelity = instructionFidelity(definition);
              findings.push({
                ruleId: "model-only-instruction",
                severity: "info",
                message: `Instruction "${node.instructionType}" is recognized but ${fidelity.status} (fidelity: ${instructionFidelityLabel(fidelity.status)}; preserved and displayed, not simulated).`,
                target,
              });
              definition.operands.forEach((operandDef, index) => {
                checkModelOnlyReviewOperand(node.operands[index]?.value?.trim() ?? "", operandDef);
              });
              continue;
            }

            for (const message of definition.validate(node)) {
              if (isMissingOperandValidation(message)) continue;
              findings.push({
                ruleId: "instruction-validation",
                severity: "error",
                message: `${node.instructionType}: ${message}`,
                target,
              });
            }

            // Validate a single tag/member/array reference (undefined tag, array
            // bounds, member path, and type). Reused for a plain operand and for
            // each tag a CPT/CMP expression references.
            const checkTagReference = (value: string, operandDef: InstructionOperandDefinition): void => {
              const initialPath = parseTagPath(value);
              // Resolve the base tag of a member/array path (e.g. Timer1.DN -> Timer1).
              const base = initialPath?.base ?? baseTagName(value);
              if (base === "") return; // unparseable (literal/expression fragment) - skip
              const initialScope = initialPath ? scopeForPath(initialPath) : { types: tagTypes, dims: tagDims, alias: tagAlias };
              const label = initialPath ? tagPathLabel(initialPath) : base;

              if (initialPath?.program && !initialScope) {
                findings.push({
                  ruleId: "undefined-tag",
                  severity: "error",
                  message: `Program-scoped reference "${label}" targets unknown program "${initialPath.program}" in routine "${routine.name}".`,
                  target,
                });
                return;
              }

              // A name is "known" if it is a tag or an alias (even if the alias
              // target is missing — alias-target-missing reports that separately).
              if (!initialScope || (!initialScope.types.has(base) && !initialScope.alias.has(base))) {
                findings.push({
                  ruleId: "undefined-tag",
                  severity: "error",
                  message: `Undefined tag "${label}" referenced in routine "${routine.name}".`,
                  target,
                });
                return;
              }
              const resolvedValue = resolveAliasPath(value);
              if (!resolvedValue) return; // alias cycle — covered elsewhere
              const resolvedPath = parseTagPath(resolvedValue);
              const resolvedBase = resolvedPath?.base ?? baseTagName(resolvedValue);
              const resolvedScope = resolvedPath ? scopeForPath(resolvedPath) : { types: tagTypes, dims: tagDims, alias: tagAlias };
              const dataType = resolvedScope?.types.get(resolvedBase);
              if (dataType === undefined) return; // unresolved alias — covered elsewhere

              const tagPath = parseTagPath(resolvedValue);
              function validateDynamicIndex(path: string, index: ArrayIndexToken): void {
                const indexPath = index.path;
                const checkReadPath = (refPath: string): void => {
                  checkTagReference(refPath, {
                    name: "array index",
                    label: "Array index",
                    required: false,
                    direction: "read",
                  });
                  const indexType = typeOfResolvedPath(refPath);
                  if (indexType && !isIntegerIndexType(indexType)) {
                    findings.push({
                      ruleId: "array-index-type-mismatch",
                      severity: "error",
                      message: `Array subscript "${index.raw}" for "${path}" references "${refPath}" as ${indexType}; an integer tag/member is required.`,
                      target,
                    });
                  }
                };
                if (indexPath) {
                  checkReadPath(indexPath);
                  return;
                }
                for (const refPath of referencedPaths(index.expression ?? "")) checkReadPath(refPath);
              }

              const checkArrayIndices = (
                path: string,
                indices: ArrayIndexToken[],
                dimensions: number[] | undefined,
                scalarMessage: string,
              ): void => {
                if (!dimensions || dimensions.length === 0) {
                  findings.push({
                    ruleId: "array-index-on-scalar",
                    severity: "error",
                    message: scalarMessage,
                    target,
                  });
                  return;
                }
                if (indices.length !== dimensions.length) {
                  findings.push({
                    ruleId: "array-dimension-mismatch",
                    severity: "error",
                    message: `Array reference "${path}" supplies ${indices.length} subscript(s), but the declaration has ${dimensions.length} dimension(s).`,
                    target,
                  });
                  return;
                }
                indices.forEach((index, dimensionIndex) => {
                  validateDynamicIndex(path, index);
                  if (index.literal === undefined) return;
                  const size = dimensions[dimensionIndex]!;
                  if (index.literal < 0) {
                    // Logix array subscripts are zero-based; a negative constant
                    // is never valid and Studio 5000 rejects it at verify time.
                    findings.push({
                      ruleId: "array-index-out-of-range",
                      severity: "error",
                      message: `Array index ${index.literal} is negative for "${path}" dimension ${dimensionIndex}; subscripts must be 0 or greater.`,
                      target,
                    });
                  } else if (index.literal >= size) {
                    findings.push({
                      ruleId: "array-index-out-of-range",
                      severity: "error",
                      message: `Array index ${index.literal} is out of range for "${path}" dimension ${dimensionIndex} (size ${size}).`,
                      target,
                    });
                  }
                });
              };
              // Array bounds: an element index must be within the tag/member's dimension.
              if (tagPath?.indices !== undefined) {
                checkArrayIndices(
                  tagPath.base,
                  tagPath.indices,
                  scopeForPath(tagPath)?.dims.get(tagPath.base),
                  `Tag "${tagPathLabel(tagPath)}" is not an array but is indexed as "${tagPathLabel(tagPath)}[${indexListText(tagPath.indices)}]".`,
                );
              }

              // Member path: validate nested structured/UDT members and member-array bounds.
              if (tagPath?.members) {
                let currentType = dataType;
                let currentPath = tagPathLabel(tagPath);
                for (const segment of tagPath.members.split(".")) {
                  const parsed = parseIndexedSegment(segment);
                  if (!parsed) {
                    // A purely numeric segment is a bit reference (e.g. DintTag.5),
                    // not a member. Logix allows bit access only on integer atomic
                    // types, and the bit number must be within the type's width.
                    if (/^\d+$/.test(segment)) {
                      const width = integerBitWidth(currentType);
                      if (width === undefined) {
                        findings.push({
                          ruleId: "invalid-bit-reference",
                          severity: "error",
                          message: `Bit reference ".${segment}" is not valid because "${currentPath}" is ${currentType} (bit access requires an integer type).`,
                          target,
                        });
                      } else if (Number(segment) >= width) {
                        findings.push({
                          ruleId: "bit-index-out-of-range",
                          severity: "error",
                          message: `Bit ${segment} is out of range for "${currentPath}" (${currentType} has bits 0–${width - 1}).`,
                          target,
                        });
                      }
                    }
                    break;
                  }
                  const members = memberInfo.get(currentType);
                  if (!members) {
                    findings.push({
                      ruleId: "unknown-member",
                      severity: "warning",
                      message: `Member "${parsed.name}" cannot be used because "${currentPath}" is ${currentType}.`,
                      target,
                    });
                    break;
                  }
                  const member = members.get(parsed.name);
                  if (!member) {
                    findings.push({
                      ruleId: "unknown-member",
                      severity: "warning",
                      message: `Member "${parsed.name}" does not exist on ${currentType} tag "${base}".`,
                      target,
                    });
                    break;
                  }
                  if (parsed.indices !== undefined) {
                    checkArrayIndices(
                      `${currentPath}.${parsed.name}`,
                      parsed.indices,
                      member.dimensions,
                      `Member "${parsed.name}" is not an array on ${currentType} tag "${label}".`,
                    );
                  }
                  currentPath = `${currentPath}.${segment}`;
                  currentType = member.dataType;
                }
              }

              if (
                tagPath &&
                !tagPath.indices &&
                !tagPath.members &&
                operandDef.allowedTypes &&
                !operandAllowsDataType(operandDef.allowedTypes, typeOfResolvedPath(value) ?? dataType)
              ) {
                // Only type-check simple tag references; member/array paths can be any atomic type.
                findings.push({
                  ruleId: "operand-type-mismatch",
                  severity: "error",
                  message: `${node.instructionType} operand "${operandDef.name}" expects ${operandDef.allowedTypes.join("/")}, but tag "${value}" is ${typeOfResolvedPath(value) ?? dataType}.`,
                  target,
                });
              }
            };

            const checkOperand = (value: string, operandDef: InstructionOperandDefinition): void => {
              if (value === "") {
                if (operandDef.required) {
                  findings.push({
                    ruleId: "missing-operand",
                    severity: "warning",
                    message: `${node.instructionType} is missing required operand "${operandDef.name}".`,
                    target,
                  });
                }
                return;
              }

              if (isNumericLiteral(value)) {
                // A write destination must name a tag — a result cannot be stored
                // into a constant. (Read operands legitimately take literals.)
                if (operandDef.direction === "write") {
                  findings.push({
                    ruleId: "invalid-write-target",
                    severity: "error",
                    message: `${node.instructionType} operand "${operandDef.name}" must be a writable tag, not the literal "${value}".`,
                    target,
                  });
                }
                return; // a constant, not a tag reference
              }

              if (
                (node.instructionType === "FAL" || node.instructionType === "FSC") &&
                operandDef.name === "mode"
              ) {
                const mode = value.trim().toUpperCase();
                if (mode === "ALL" || mode === "INC") return;
                checkTagReference(value, {
                  ...operandDef,
                  isLabelRef: false,
                  allowedTypes: ["DINT", "REAL"],
                  direction: "read",
                });
                return;
              }

              // A rung label or keyword (e.g. JMP/LBL) is not a tag — skip validation.
              if (operandDef.isLabelRef) return;

              // A routine reference (e.g. JSR) is not a tag — check it resolves instead.
              if (operandDef.isRoutineRef) {
                if (!routineNames.has(value)) {
                  findings.push({
                    ruleId: "unknown-routine",
                    severity: "warning",
                    message: `${node.instructionType} references unknown routine "${value}".`,
                    target,
                  });
                }
                return;
              }

              // A CPT/CMP expression: check every tag it references (literals and
              // functions are skipped), not the whole string as one tag path.
              if (operandDef.isExpression) {
                for (const path of referencedPaths(value)) checkTagReference(path, operandDef);
                if (node.instructionType === "CMP" || node.instructionType === "FSC") {
                  const stringComparison = parseStringComparisonExpression(value);
                  if (stringComparison) {
                    const leftType = typeOfResolvedPath(stringComparison.left);
                    const rightType = typeOfResolvedPath(stringComparison.right);
                    const leftIsString = isStringDataType(leftType);
                    const rightIsString = isStringDataType(rightType);
                    if (leftType && rightType && (leftIsString || rightIsString) && !(leftIsString && rightIsString)) {
                      const badPath = leftIsString ? stringComparison.right : stringComparison.left;
                      const badType = leftIsString ? rightType : leftType;
                      findings.push({
                        ruleId: "operand-type-mismatch",
                        severity: "error",
                        message: `${node.instructionType} operand "${operandDef.name}" compares STRING tags only with other STRING tags; "${badPath}" is ${badType}.`,
                        target,
                      });
                    }
                  } else {
                    const stringPaths = referencedPaths(value).filter((path) => isStringDataType(typeOfResolvedPath(path)));
                    if (stringPaths.length > 0) {
                      findings.push({
                        ruleId: "instruction-validation",
                        severity: "error",
                        message: `${node.instructionType}: STRING tags in expression operands must be compared directly with another STRING tag.`,
                        target,
                      });
                    }
                  }
                }
                return;
              }

              checkTagReference(value, operandDef);
            };

            definition.operands.forEach((operandDef, index) => {
              checkOperand(node.operands[index]?.value?.trim() ?? "", operandDef);
            });

            const checkParameter = (value: string, name: string, direction: "read" | "write"): void => {
              checkOperand(value, { name, label: name, required: false, direction });
            };

            if (node.instructionType === "JSR") {
              const routineName = node.operands[0]?.value?.trim() ?? "";
              const targetLadder = programLaddersByName.get(routineName);
              const sbrParameters = targetLadder ? routineInstructionOperands(targetLadder, "SBR")[0] ?? [] : [];
              const layout = parseJsrParameterLayout(operandValues(node, 1), sbrParameters.length);
              if (layout.inputParameters.length > MAX_ROUTINE_PARAMETERS) {
                findings.push({
                  ruleId: "instruction-validation",
                  severity: "error",
                  message: `JSR input parameter count must be ${MAX_ROUTINE_PARAMETERS} or fewer.`,
                  target,
                });
              }
              if (layout.returnParameters.length > MAX_ROUTINE_PARAMETERS) {
                findings.push({
                  ruleId: "instruction-validation",
                  severity: "error",
                  message: `JSR return parameter count must be ${MAX_ROUTINE_PARAMETERS} or fewer.`,
                  target,
                });
              }
              if (targetLadder && layout.inputCount !== sbrParameters.length) {
                findings.push({
                  ruleId: "instruction-validation",
                  severity: "error",
                  message: `JSR supplies ${layout.inputCount} input parameter(s), but routine "${routineName}" SBR accepts ${sbrParameters.length}.`,
                  target,
                });
              }

              layout.inputParameters.forEach((value, index) => checkParameter(value, `input${index}`, "read"));
              layout.returnParameters.forEach((value, index) => checkParameter(value, `return${index}`, "write"));

              if (targetLadder && layout.returnParameters.length > 0) {
                const retOperands = routineInstructionOperands(targetLadder, "RET");
                if (retOperands.length === 0) {
                  findings.push({
                    ruleId: "instruction-validation",
                    severity: "error",
                    message: `JSR has return parameter(s), but routine "${routineName}" has no RET instruction.`,
                    target,
                  });
                }
                for (const operands of retOperands) {
                  if (operands.length !== layout.returnParameters.length) {
                    findings.push({
                      ruleId: "instruction-validation",
                      severity: "error",
                      message: `JSR expects ${layout.returnParameters.length} return parameter(s), but routine "${routineName}" RET provides ${operands.length}.`,
                      target,
                    });
                  }
                }
              }
            } else if (node.instructionType === "SBR") {
              operandValues(node).forEach((value, index) => checkParameter(value, `input${index}`, "write"));
            } else if (node.instructionType === "RET") {
              operandValues(node).forEach((value, index) => checkParameter(value, `return${index}`, "read"));
            }
          }
        }
      }
    }
    return findings;
  },
};

/** Tag names must be unique within a program scope. */
export const duplicateProgramTag: ValidationRule = {
  id: "duplicate-program-tag",
  name: "Duplicate program tag",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const program of controller.programs) {
        const seen = new Set<string>();
        for (const tag of program.programTags) {
          if (seen.has(tag.name)) {
            findings.push({
              ruleId: "duplicate-program-tag",
              severity: "error",
              message: `Duplicate program tag "${tag.name}" in "${program.name}".`,
              target: `${controller.name}/${program.name}/${tag.name}`,
            });
          }
          seen.add(tag.name);
        }
      }
    }
    return findings;
  },
};

/** An alias tag should resolve to an existing base tag (in any scope of the controller). */
export const aliasTargetMissing: ValidationRule = {
  id: "alias-target-missing",
  name: "Alias target missing",
  category: "syntax",
  severity: "warning",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const names = new Set<string>();
      for (const tag of controller.controllerTags) names.add(tag.name);
      for (const program of controller.programs) {
        for (const tag of program.programTags) names.add(tag.name);
      }
      const check = (tag: { name: string; aliasFor?: string }, target: string) => {
        if (tag.aliasFor && !names.has(baseTagName(tag.aliasFor))) {
          findings.push({
            ruleId: "alias-target-missing",
            severity: "warning",
            message: `Alias "${tag.name}" targets missing tag "${tag.aliasFor}".`,
            target,
          });
        }
      };
      for (const tag of controller.controllerTags) check(tag, `${controller.name}/${tag.name}`);
      for (const program of controller.programs) {
        for (const tag of program.programTags) check(tag, `${controller.name}/${program.name}/${tag.name}`);
      }
    }
    return findings;
  },
};

/**
 * Alias chains must not form a cycle. An alias points at a base tag (or a
 * member/element path of one); following the targets repeatedly must reach a
 * non-alias tag. A chain that returns to a tag already on it (`A → B → A`, or a
 * tag aliased to itself) never resolves, and Studio 5000 rejects such a circular
 * alias reference at verify time. The offline alias resolver also bails out on
 * one (see `ladder-operands`), so an unreferenced cycle would otherwise go
 * unreported. `setTagAlias` already blocks creating a cycle interactively; this
 * is the verification counterpart for projects built another way (e.g. imported
 * from L5X), and mirrors that guard's flat base-name resolution so the editor and
 * verifier agree on what a cycle is. It is the alias-level companion to
 * `circular-data-type` and `alias-target-missing`, reported once per cycle.
 */
export const circularAlias: ValidationRule = {
  id: "circular-alias",
  name: "Circular alias",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      // Flat name -> alias-target-base map across controller and program scope,
      // matching setTagAlias so the editor and verifier resolve aliases the same way.
      const aliasTarget = new Map<string, string>();
      const record = (tag: { name: string; aliasFor?: string }) => {
        if (!tag.aliasFor) return;
        const base = baseTagName(tag.aliasFor);
        if (base) aliasTarget.set(tag.name, base);
      };
      for (const tag of controller.controllerTags) record(tag);
      for (const program of controller.programs) {
        for (const tag of program.programTags) record(tag);
      }

      // The alias graph is functional (each alias has one target), so walking the
      // chain and revisiting a name closes its cycle. Dedupe by the cycle's members
      // so a cycle is reported once, not once per node that reaches it.
      const reported = new Set<string>();
      for (const start of aliasTarget.keys()) {
        const order: string[] = [];
        const seenAt = new Map<string, number>();
        let cursor: string | undefined = start;
        while (cursor !== undefined && aliasTarget.has(cursor)) {
          const at = seenAt.get(cursor);
          if (at !== undefined) {
            const cycle = order.slice(at);
            const key = [...cycle].sort().join("\u0000");
            if (!reported.has(key)) {
              reported.add(key);
              findings.push({
                ruleId: "circular-alias",
                severity: "error",
                message: `Alias "${cycle[0]}" is part of a circular alias chain (${[...cycle, cycle[0]!].join(" → ")}); an alias cannot reference itself directly or indirectly.`,
                target: controller.name,
              });
            }
            break;
          }
          seenAt.set(cursor, order.length);
          order.push(cursor);
          cursor = aliasTarget.get(cursor);
        }
      }
    }
    return findings;
  },
};

/**
 * A tag name must be a legal Logix identifier. Studio 5000 will not create a tag
 * whose name breaks these rules, so flagging them keeps offline projects importable.
 */
export const invalidTagName: ValidationRule = {
  id: "invalid-tag-name",
  name: "Invalid tag name",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    const check = (tag: { name: string }, target: string) => {
      const reason = invalidNameReason(tag.name);
      if (reason) {
        findings.push({
          ruleId: "invalid-tag-name",
          severity: "error",
          message: `Tag "${tag.name}" is not a valid controller-compatible name: ${reason}.`,
          target,
        });
      }
    };
    for (const controller of project.controllers) {
      for (const tag of controller.controllerTags) check(tag, `${controller.name}/${tag.name}`);
      for (const program of controller.programs) {
        for (const tag of program.programTags) check(tag, `${controller.name}/${program.name}/${tag.name}`);
      }
    }
    return findings;
  },
};

/**
 * UDT member names and AOI parameter/local-tag names obey the same Logix
 * identifier rules as tags (1–40 chars, begin with a letter or underscore,
 * letters/digits/underscores only, no consecutive or trailing underscores).
 * Studio 5000 enforces these when a member or parameter is created, and rejects
 * a malformed one on import. This became reachable offline once UDT members and
 * AOI parameters/local tags were made editable, so it is checked here — the
 * member-level companion to `invalid-tag-name` — to keep edited projects
 * importable.
 */
export const invalidMemberName: ValidationRule = {
  id: "invalid-member-name",
  name: "Invalid member name",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    const check = (name: string, kind: string, owner: string, target: string) => {
      const reason = invalidNameReason(name);
      if (reason) {
        findings.push({
          ruleId: "invalid-member-name",
          severity: "error",
          message: `${kind} "${name}" of ${owner} is not a valid controller-compatible name: ${reason}.`,
          target,
        });
      }
    };
    for (const controller of project.controllers) {
      for (const udt of controller.dataTypes) {
        const target = `${controller.name}/${udt.name}`;
        for (const member of udt.members) check(member.name, "Member", `data type "${udt.name}"`, target);
      }
      for (const aoi of controller.addOnInstructions) {
        const target = `${controller.name}/${aoi.name}`;
        const owner = `Add-On Instruction "${aoi.name}"`;
        for (const parameter of aoi.parameters) check(parameter.name, "Parameter", owner, target);
        for (const localTag of aoi.localTags) check(localTag.name, "Local tag", owner, target);
      }
    }
    return findings;
  },
};

/**
 * Container names — tasks, programs, routines, user-defined types, and Add-On
 * Instructions — obey the same Logix identifier rules as tags and members (1–40
 * chars, begin with a letter or underscore, letters/digits/underscores only, no
 * consecutive or trailing underscores). Studio 5000 enforces these when the
 * object is created or renamed and rejects a malformed one on import/verify.
 *
 * `invalid-tag-name` and `invalid-member-name` already guard tag and
 * member/parameter names; this rule is their container-level companion, covering
 * the names that became editable offline as project structure, UDTs, and AOIs
 * were made editable. It checks **format only** — collisions with predefined
 * names are left to `reserved-name` and duplicate names to the various
 * `duplicate-*-name` rules — so a single malformed name is reported exactly once.
 */
export const invalidDefinitionName: ValidationRule = {
  id: "invalid-definition-name",
  name: "Invalid definition name",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    const check = (kind: string, name: string, target: string) => {
      const reason = invalidNameReason(name);
      if (reason) {
        findings.push({
          ruleId: "invalid-definition-name",
          severity: "error",
          message: `${kind} "${name}" is not a valid controller-compatible name: ${reason}.`,
          target,
        });
      }
    };
    for (const controller of project.controllers) {
      for (const task of controller.tasks) {
        check("Task", task.name, `${controller.name}/${task.name}`);
      }
      for (const program of controller.programs) {
        const programTarget = `${controller.name}/${program.name}`;
        check("Program", program.name, programTarget);
        for (const routine of program.routines) {
          check("Routine", routine.name, `${programTarget}/${routine.name}`);
        }
      }
      for (const udt of controller.dataTypes) {
        check("Data type", udt.name, `${controller.name}/${udt.name}`);
      }
      for (const aoi of controller.addOnInstructions) {
        check("Add-On Instruction", aoi.name, `${controller.name}/${aoi.name}`);
      }
    }
    return findings;
  },
};

/**
 * Double-coil: a BOOL driven by more than one OTE across the controller. Legal in
 * Logix but a common mistake — the last coil to scan wins each scan.
 */
export const doubleCoil: ValidationRule = {
  id: "double-coil",
  name: "Duplicate output coil",
  category: "best-practice",
  severity: "warning",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const count = new Map<string, number>();
      const where = new Map<string, string>();
      for (const program of controller.programs) {
        for (const routine of program.routines) {
          const ladder = asLadderRoutine(routine.ladder);
          if (!ladder) continue;
          for (const node of routineNodes(ladder)) {
            if (node.instructionType !== "OTE") continue;
            const base = baseTagName(node.operands[0]?.value ?? "");
            if (!base) continue;
            count.set(base, (count.get(base) ?? 0) + 1);
            where.set(base, `${controller.name}/${program.name}/${routine.name}`);
          }
        }
      }
      for (const [tag, n] of count) {
        if (n >= 2) {
          findings.push({
            ruleId: "double-coil",
            severity: "warning",
            message: `Tag "${tag}" is driven by ${n} OTE coils (the last coil scanned wins each scan).`,
            target: where.get(tag)!,
          });
        }
      }
    }
    return findings;
  },
};

/**
 * A JMP must target an LBL defined in the same routine. Logix resolves JMP/LBL
 * within a single routine, so a JMP whose label has no matching LBL fails to
 * verify on download — flag it offline. This is the JMP/LBL analogue of the
 * `unknown-routine` check for JSR, and is reported as a warning for consistency
 * with that rule. JMP/LBL are executable offline, so this catches unresolved
 * jumps before they silently fall through during simulation.
 */
export const unresolvedJumpLabel: ValidationRule = {
  id: "unresolved-jump-label",
  name: "Unresolved jump label",
  category: "syntax",
  severity: "warning",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const program of controller.programs) {
        for (const routine of program.routines) {
          const ladder = asLadderRoutine(routine.ladder);
          if (!ladder) continue;
          // Labels are routine-local: collect this routine's LBL targets, then
          // confirm every JMP resolves to one of them.
          const labels = new Set<string>();
          const jumps: string[] = [];
          for (const node of routineNodes(ladder)) {
            const label = node.operands[0]?.value?.trim();
            if (!label) continue;
            if (node.instructionType === "LBL") labels.add(label);
            else if (node.instructionType === "JMP") jumps.push(label);
          }
          for (const label of jumps) {
            if (!labels.has(label)) {
              findings.push({
                ruleId: "unresolved-jump-label",
                severity: "warning",
                message: `JMP targets label "${label}", which has no matching LBL in routine "${routine.name}".`,
                target: `${controller.name}/${program.name}/${routine.name}`,
              });
            }
          }
        }
      }
    }
    return findings;
  },
};

/**
 * A label name may be defined by only one LBL within a routine. Logix resolves
 * JMP/JSR labels by name inside a single routine, so two LBLs sharing a name is
 * ambiguous and fails to verify on download ("label already defined"). This is
 * the definition-side companion to `unresolved-jump-label`, which checks the
 * reference side (a JMP with no matching LBL); together they cover both halves
 * of routine-local label integrity. Reported as an error because the routine
 * will not verify until the collision is resolved.
 */
export const duplicateJumpLabel: ValidationRule = {
  id: "duplicate-jump-label",
  name: "Duplicate jump label",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const program of controller.programs) {
        for (const routine of program.routines) {
          const ladder = asLadderRoutine(routine.ladder);
          if (!ladder) continue;
          // Labels are routine-local; count how many LBLs define each name and
          // flag any defined more than once (reported once per duplicated name).
          const labelCounts = new Map<string, number>();
          for (const node of routineNodes(ladder)) {
            if (node.instructionType !== "LBL") continue;
            const label = node.operands[0]?.value?.trim();
            if (!label) continue;
            labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
          }
          for (const [label, count] of labelCounts) {
            if (count >= 2) {
              findings.push({
                ruleId: "duplicate-jump-label",
                severity: "error",
                message: `Label "${label}" is defined by ${count} LBL instructions in routine "${routine.name}" (a label name must be unique within a routine).`,
                target: `${controller.name}/${program.name}/${routine.name}`,
              });
            }
          }
        }
      }
    }
    return findings;
  },
};

/**
 * A tag whose Constant attribute is set cannot be modified by logic. Studio 5000
 * rejects any instruction that writes a constant tag on download ("Cannot modify
 * a constant tag"), so flag it offline. Constant tags are collected per scope
 * (controller scope overlaid with the program's own tags) and every
 * write-direction operand is checked against them. Writing to a member or
 * element of a constant tag (e.g. `Limits[0]` or `Config.Setpoint`) still
 * modifies the constant, so the operand's base tag is what matters; aliases are
 * resolved to their underlying tag because writing through an alias of a
 * constant modifies the constant just the same.
 */
export const constantTagModified: ValidationRule = {
  id: "constant-tag-modified",
  name: "Constant tag modified",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const controllerConstants = new Set<string>();
      const controllerAlias = new Map<string, string>();
      for (const tag of controller.controllerTags) {
        if (tag.constant) controllerConstants.add(tag.name);
        if (tag.aliasFor) controllerAlias.set(tag.name, tag.aliasFor.trim());
      }
      for (const program of controller.programs) {
        // Program tags shadow controller tags of the same name in this scope.
        const constants = new Set(controllerConstants);
        const alias = new Map(controllerAlias);
        for (const tag of program.programTags) {
          if (tag.constant) constants.add(tag.name);
          else constants.delete(tag.name);
          if (tag.aliasFor) alias.set(tag.name, tag.aliasFor.trim());
          else alias.delete(tag.name);
        }
        // Follow an alias chain to the underlying base tag (cycles are reported
        // by alias-target-missing's companion checks, so bail out on revisit).
        const resolveBase = (name: string, seen = new Set<string>()): string => {
          const targetPath = alias.get(name);
          if (!targetPath || seen.has(name)) return name;
          seen.add(name);
          return resolveBase(baseTagName(targetPath), seen);
        };
        for (const routine of program.routines) {
          const ladder = asLadderRoutine(routine.ladder);
          if (!ladder) continue;
          const target = `${controller.name}/${program.name}/${routine.name}`;
          for (const node of routineNodes(ladder)) {
            const definition = registry.get(node.instructionType);
            // Model-only and unsupported instructions are not simulated and may
            // carry non-tag operands, so only registered, executable ones count.
            if (!definition || definition.modelOnly) continue;
            definition.operands.forEach((operandDef, index) => {
              if (operandDef.direction !== "write") return;
              const value = node.operands[index]?.value?.trim() ?? "";
              if (value === "" || isNumericLiteral(value)) return;
              const base = baseTagName(value);
              if (base === "") return;
              const resolved = resolveBase(base);
              if (!constants.has(resolved)) return;
              const detail =
                resolved === base
                  ? `constant tag "${base}"`
                  : `"${base}", an alias of constant tag "${resolved}"`;
              findings.push({
                ruleId: "constant-tag-modified",
                severity: "error",
                message: `${node.instructionType} writes to ${detail}, which cannot be modified by logic.`,
                target,
              });
            });
          }
        }
      }
    }
    return findings;
  },
};

/**
 * Member and parameter names must be unique within a UDT or Add-On Instruction.
 * Studio 5000 rejects a data type with two members of the same name, and an AOI
 * whose parameters and local tags collide, on import/verification ("name already
 * in use"). Logix identifiers are case-insensitive, so members differing only in
 * case (`Status` vs `status`) collide too. This became reachable offline once UDT
 * members and AOI parameters/local tags were made editable, so it is checked here
 * to keep edited projects importable. An AOI's parameters and local tags share a
 * single namespace (both become members of the AOI's backing type), so they are
 * checked together.
 */
export const duplicateMember: ValidationRule = {
  id: "duplicate-member",
  name: "Duplicate member name",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    // Names that appear more than once, each reported once in first-seen order.
    const duplicateNames = (names: string[]): string[] => {
      const seen = new Set<string>();
      const reported = new Set<string>();
      const duplicates: string[] = [];
      for (const name of names) {
        const key = name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
        } else if (!reported.has(key)) {
          reported.add(key);
          duplicates.push(name);
        }
      }
      return duplicates;
    };
    for (const controller of project.controllers) {
      for (const udt of controller.dataTypes) {
        for (const name of duplicateNames(udt.members.map((m) => m.name))) {
          findings.push({
            ruleId: "duplicate-member",
            severity: "error",
            message: `Data type "${udt.name}" declares more than one member named "${name}".`,
            target: `${controller.name}/${udt.name}`,
          });
        }
      }
      for (const aoi of controller.addOnInstructions) {
        const names = [
          ...aoi.parameters.map((parameter) => parameter.name),
          ...aoi.localTags.map((localTag) => localTag.name),
        ];
        for (const name of duplicateNames(names)) {
          findings.push({
            ruleId: "duplicate-member",
            severity: "error",
            message: `Add-On Instruction "${aoi.name}" declares more than one parameter or local tag named "${name}".`,
            target: `${controller.name}/${aoi.name}`,
          });
        }
      }
    }
    return findings;
  },
};

/**
 * A user-defined data type must not contain itself, directly or transitively.
 * Studio 5000 rejects a recursive UDT on import/verification ("a data type cannot
 * be a member of itself") because such a type would have infinite size — there is
 * no layout for a structure that embeds a copy of itself. A direct cycle is a
 * member declared as the UDT's own type (`Node.Next : Node`); an indirect cycle
 * runs through one or more intermediary UDTs (`A` has a `B` member and `B` has an
 * `A` member). Member arrays do not break the cycle — a member declared
 * `Self[4] : Node` still embeds `Node` — so only the element type (`member.dataType`)
 * is followed. Type names are matched case-insensitively, as Logix identifiers are.
 * This is the type-graph companion to `duplicate-member`; reported as an error
 * because the data type will not verify until the cycle is removed.
 */
export const circularDataType: ValidationRule = {
  id: "circular-data-type",
  name: "Circular data type",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      // Map an upper-cased UDT name to its authored spelling, and the directed
      // edges A -> B for every member of A whose type B is also a UDT here.
      const displayName = new Map<string, string>();
      for (const udt of controller.dataTypes) {
        const key = udt.name.toUpperCase();
        if (!displayName.has(key)) displayName.set(key, udt.name);
      }
      const edges = new Map<string, Set<string>>();
      for (const udt of controller.dataTypes) {
        const from = udt.name.toUpperCase();
        const targets = edges.get(from) ?? new Set<string>();
        for (const member of udt.members) {
          const to = member.dataType.trim().toUpperCase();
          if (displayName.has(to)) targets.add(to);
        }
        edges.set(from, targets);
      }

      // Find a path start -> ... -> start through the type graph, or undefined if
      // `start` is not reachable from itself. A globally-visited DFS is sound for
      // reachability: a fully-explored node that cannot reach `start` will never
      // reach it on a later route either.
      const findCycleThrough = (start: string): string[] | undefined => {
        const visited = new Set<string>();
        const stack: string[] = [];
        const dfs = (node: string): boolean => {
          for (const next of edges.get(node) ?? []) {
            if (next === start) {
              stack.push(start);
              return true;
            }
            if (visited.has(next)) continue;
            visited.add(next);
            stack.push(next);
            if (dfs(next)) return true;
            stack.pop();
          }
          return false;
        };
        return dfs(start) ? [start, ...stack] : undefined;
      };

      for (const udt of controller.dataTypes) {
        const upper = udt.name.toUpperCase();
        const target = `${controller.name}/${udt.name}`;
        const selfMember = udt.members.find((m) => m.dataType.trim().toUpperCase() === upper);
        if (selfMember) {
          findings.push({
            ruleId: "circular-data-type",
            severity: "error",
            message: `Data type "${udt.name}" has a member "${selfMember.name}" of its own type; a data type cannot contain itself.`,
            target,
          });
          continue;
        }
        const cycle = findCycleThrough(upper);
        if (cycle) {
          const path = cycle.map((u) => displayName.get(u) ?? u).join(" → ");
          findings.push({
            ruleId: "circular-data-type",
            severity: "error",
            message: `Data type "${udt.name}" is part of a circular data-type definition (${path}); a data type cannot contain itself directly or indirectly.`,
            target,
          });
        }
      }
    }
    return findings;
  },
};

/**
 * Routine names must be unique within a program. Studio 5000 rejects a second
 * routine of the same name in a program on import/verification ("name already in
 * use"), and a duplicate makes routine references ambiguous offline: JSR resolves
 * its target routine by name (see `unknown-routine`), and a program's main/fault
 * routine is exported by name, so two routines sharing a name leave no single
 * routine for either to bind to. Logix identifiers are case-insensitive, so
 * routines differing only in case (`Main` vs `main`) collide too. This is the
 * routine-level companion to `duplicate-program-tag` and `duplicate-member`;
 * reported as an error because the program will not verify until it is resolved.
 */
export const duplicateRoutineName: ValidationRule = {
  id: "duplicate-routine-name",
  name: "Duplicate routine name",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const program of controller.programs) {
        // Routine names are case-insensitive; report each duplicated name once,
        // in first-seen order, using the spelling of its first occurrence.
        const seen = new Map<string, string>();
        const reported = new Set<string>();
        for (const routine of program.routines) {
          const key = routine.name.toLowerCase();
          const first = seen.get(key);
          if (first === undefined) {
            seen.set(key, routine.name);
          } else if (!reported.has(key)) {
            reported.add(key);
            findings.push({
              ruleId: "duplicate-routine-name",
              severity: "error",
              message: `Program "${program.name}" declares more than one routine named "${first}".`,
              target: `${controller.name}/${program.name}/${first}`,
            });
          }
        }
      }
    }
    return findings;
  },
};

/**
 * Program names must be unique within a controller. Studio 5000 rejects a second
 * program of the same name in a controller on import/verification ("name already
 * in use"), and a duplicate makes program references ambiguous offline: a
 * program-scoped tag reference resolves its owning program by name
 * (`Program:Name.Tag`), and the controller's task schedule lists programs by
 * name, so two programs sharing a name leave no single program for either to bind
 * to. Logix identifiers are case-insensitive, so programs differing only in case
 * (`MainProgram` vs `mainprogram`) collide too. This is the program-level
 * companion to `duplicate-routine-name`, `duplicate-program-tag`, and
 * `duplicate-member`; reported as an error because the controller will not verify
 * until it is resolved.
 */
export const duplicateProgramName: ValidationRule = {
  id: "duplicate-program-name",
  name: "Duplicate program name",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      // Program names are case-insensitive; report each duplicated name once, in
      // first-seen order, using the spelling of its first occurrence.
      const seen = new Map<string, string>();
      const reported = new Set<string>();
      for (const program of controller.programs) {
        const key = program.name.toLowerCase();
        const first = seen.get(key);
        if (first === undefined) {
          seen.set(key, program.name);
        } else if (!reported.has(key)) {
          reported.add(key);
          findings.push({
            ruleId: "duplicate-program-name",
            severity: "error",
            message: `Controller "${controller.name}" declares more than one program named "${first}".`,
            target: `${controller.name}/${first}`,
          });
        }
      }
    }
    return findings;
  },
};

/**
 * Task names must be unique within a controller. Studio 5000 rejects a second
 * task of the same name on import/verification ("name already in use"), and a
 * duplicate makes the schedule ambiguous offline: the L5X exporter writes one
 * `<Task Name=…>` element per task, so two tasks sharing a name collide on
 * round-trip. Logix identifiers are case-insensitive, so tasks differing only in
 * case (`MainTask` vs `maintask`) collide too. This is the task-level companion
 * to `duplicate-program-name` and `duplicate-routine-name`, and complements the
 * scheduling checks in `task-scheduling`/`dangling-scheduled-program` (which
 * assume each task is itself a distinct, well-named object). Reported as an error
 * because the controller will not verify until it is resolved.
 */
export const duplicateTaskName: ValidationRule = {
  id: "duplicate-task-name",
  name: "Duplicate task name",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      // Task names are case-insensitive; report each duplicated name once, in
      // first-seen order, using the spelling of its first occurrence.
      const seen = new Map<string, string>();
      const reported = new Set<string>();
      for (const task of controller.tasks) {
        const key = task.name.toLowerCase();
        const first = seen.get(key);
        if (first === undefined) {
          seen.set(key, task.name);
        } else if (!reported.has(key)) {
          reported.add(key);
          findings.push({
            ruleId: "duplicate-task-name",
            severity: "error",
            message: `Controller "${controller.name}" declares more than one task named "${first}".`,
            target: `${controller.name}/${first}`,
          });
        }
      }
    }
    return findings;
  },
};

/**
 * Predefined Logix data-type names that a user definition may not reuse. Covers
 * the atomic types plus the predefined structured types this offline model knows
 * about (TIMER/COUNTER/CONTROL/MESSAGE/PID/PIDE/ALARM_*). Compared case-insensitively.
 */
const RESERVED_DATA_TYPE_NAMES = new Set<string>([
  "BOOL", "SINT", "INT", "DINT", "LINT",
  "USINT", "UINT", "UDINT", "ULINT",
  "REAL", "LREAL", "STRING",
  ...Object.keys(STRUCTURED_TYPES).map((name) => name.toUpperCase()),
]);

/**
 * Add-On Instruction and user-defined type names must not reuse a reserved Logix
 * identifier. An AOI shares the instruction namespace with the built-in
 * instructions and also introduces a data type of its own name, so its name may
 * not match a built-in instruction mnemonic (e.g. naming an AOI "TON") nor a
 * predefined data type (e.g. "TIMER"). A UDT introduces a data type, so its name
 * may not match a predefined data type. Studio 5000 rejects these collisions on
 * import/verification ("name is already in use"/reserved word), so a generated or
 * offline-edited project carrying one will not import — this flags it early. Logix
 * identifiers are case-insensitive, so the comparison is case-folded. This is the
 * definition-name companion to `duplicate-member` and `circular-data-type`;
 * reported as an error because the controller will not verify until it is resolved.
 */
export const reservedDefinitionName: ValidationRule = {
  id: "reserved-name",
  name: "Reserved definition name",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    // Built-in instruction mnemonics are registered in canonical (upper) case.
    const builtInInstructions = new Set(registry.all().map((def) => def.type.toUpperCase()));
    for (const controller of project.controllers) {
      for (const aoi of controller.addOnInstructions) {
        const upper = aoi.name.toUpperCase();
        const target = `${controller.name}/${aoi.name}`;
        if (builtInInstructions.has(upper)) {
          findings.push({
            ruleId: "reserved-name",
            severity: "error",
            message: `Add-On Instruction "${aoi.name}" reuses the name of the built-in instruction ${upper}; an AOI may not share a built-in instruction's mnemonic.`,
            target,
          });
        } else if (RESERVED_DATA_TYPE_NAMES.has(upper)) {
          findings.push({
            ruleId: "reserved-name",
            severity: "error",
            message: `Add-On Instruction "${aoi.name}" reuses the predefined data type ${upper}; an AOI name may not match a predefined data type.`,
            target,
          });
        }
      }
      for (const udt of controller.dataTypes) {
        const upper = udt.name.toUpperCase();
        if (RESERVED_DATA_TYPE_NAMES.has(upper)) {
          findings.push({
            ruleId: "reserved-name",
            severity: "error",
            message: `Data type "${udt.name}" reuses the predefined data type ${upper}; a user-defined type may not match a predefined data type.`,
            target: `${controller.name}/${udt.name}`,
          });
        }
      }
    }
    return findings;
  },
};

/**
 * User-defined type names must be unique across the controller's single
 * data-type namespace. In Logix every UDT and every Add-On Instruction
 * introduces a data type of its own name, and all data types — predefined,
 * user-defined, and AOI — live in one namespace. Two UDTs, two AOIs, or a UDT
 * and an AOI that share a name therefore collide: Studio 5000 rejects the second
 * definition on import/verification ("name is already in use"), and offline a
 * member or tag declared with the shared type name has no single definition to
 * bind to. Logix identifiers are case-insensitive, so definitions differing only
 * in case (`Motor` vs `motor`) collide too. This is the type-namespace companion
 * to `reserved-name` (which guards collisions with predefined names) and
 * `duplicate-program-name`; reported as an error because the controller will not
 * verify until it is resolved. Collisions with predefined names are left to
 * `reserved-name`, so the two rules do not double-report.
 */
export const duplicateDataTypeName: ValidationRule = {
  id: "duplicate-data-type-name",
  name: "Duplicate data type name",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      // UDTs and AOIs both introduce data types into one shared namespace.
      const definitions: { name: string; kind: "data type" | "Add-On Instruction" }[] = [
        ...controller.dataTypes.map((udt) => ({ name: udt.name, kind: "data type" as const })),
        ...controller.addOnInstructions.map((aoi) => ({ name: aoi.name, kind: "Add-On Instruction" as const })),
      ];
      // Type names are case-insensitive; report each duplicated name once, in
      // first-seen order, using the spelling of its first occurrence.
      const seen = new Map<string, { name: string; kind: string }>();
      const reported = new Set<string>();
      for (const definition of definitions) {
        const key = definition.name.toLowerCase();
        const first = seen.get(key);
        if (first === undefined) {
          seen.set(key, definition);
        } else if (!reported.has(key)) {
          reported.add(key);
          const message =
            first.kind === definition.kind
              ? `Controller "${controller.name}" declares more than one ${first.kind} named "${first.name}".`
              : `Controller "${controller.name}" declares a ${first.kind} and an ${definition.kind} both named "${first.name}"; UDT and Add-On Instruction names share one data-type namespace.`;
          findings.push({
            ruleId: "duplicate-data-type-name",
            severity: "error",
            message,
            target: `${controller.name}/${first.name}`,
          });
        }
      }
    }
    return findings;
  },
};

/**
 * Task scheduling integrity. Logix schedules execution through tasks, and the
 * Task Manager enforces three constraints that Studio 5000 also re-checks on
 * verify/download:
 *
 *  - A controller may have at most **one continuous task**. The Logix scheduler
 *    runs the continuous task in the time left between periodic/event tasks, so
 *    a second one cannot be created; a project carrying two will not verify.
 *  - A program may be scheduled under **at most one task** — a program belongs
 *    to a single task (or is unscheduled). The same program in two tasks is
 *    rejected.
 *  - A program scheduled under **no task** is an *unscheduled program*: it is
 *    downloaded but never executes. That is legal but almost always a mistake,
 *    so it is surfaced as a warning.
 *
 * Continuous/single-task membership are reported as errors (the controller will
 * not verify until resolved); an unscheduled program is a warning. Inhibited
 * tasks still own their scheduled programs, so a program scheduled only under an
 * inhibited task counts as scheduled (it has a home) and is not flagged here.
 */
export const taskScheduling: ValidationRule = {
  id: "task-scheduling",
  name: "Task scheduling",
  category: "project-structure",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      // At most one continuous task; flag each one beyond the first.
      const continuousTasks = controller.tasks.filter((task) => task.type === "continuous");
      const firstContinuous = continuousTasks[0];
      for (const task of continuousTasks.slice(1)) {
        findings.push({
          ruleId: "task-scheduling",
          severity: "error",
          message: `Controller "${controller.name}" has more than one continuous task ("${firstContinuous!.name}" and "${task.name}"); controller task rules permit only one.`,
          target: `${controller.name}/${task.name}`,
        });
      }

      // Map each scheduled program to the distinct tasks that schedule it.
      const tasksByProgramId = new Map<string, Set<string>>();
      for (const task of controller.tasks) {
        for (const programId of task.scheduledProgramIds) {
          let owners = tasksByProgramId.get(programId);
          if (!owners) {
            owners = new Set<string>();
            tasksByProgramId.set(programId, owners);
          }
          owners.add(task.name);
        }
      }

      for (const program of controller.programs) {
        const owners = tasksByProgramId.get(program.id);
        if (!owners || owners.size === 0) {
          findings.push({
            ruleId: "task-scheduling",
            severity: "warning",
            message: `Program "${program.name}" is not scheduled under any task and will not execute.`,
            target: `${controller.name}/${program.name}`,
          });
        } else if (owners.size > 1) {
          const taskList = [...owners].map((name) => `"${name}"`).join(", ");
          findings.push({
            ruleId: "task-scheduling",
            severity: "error",
            message: `Program "${program.name}" is scheduled under more than one task (${taskList}); a program may belong to only one task.`,
            target: `${controller.name}/${program.name}`,
          });
        }
      }
    }
    return findings;
  },
};

/**
 * A task's scheduled-program list must reference programs that still exist.
 * `Task.scheduledProgramIds` binds a program by id; an offline edit that deletes
 * or recreates a program can leave a task pointing at an id that no longer
 * resolves. The L5X exporter writes `<ScheduledProgram Name=…>` by mapping each
 * id back to a program name and **silently drops** any id that no longer
 * resolves (see `writeTasks` in exportL5X.ts), so the dangling entry vanishes on
 * round-trip and the orphaned program quietly stops being scheduled. This is the
 * scheduling analogue of `dangling-routine-reference`, and is reported as an
 * error because the schedule the engineer sees will not match what exports.
 *
 * Import never produces this: `extractTasks` resolves each `<ScheduledProgram>`
 * through the program-name map and filters out unresolved entries, so a dangling
 * id can only arise from an in-app edit — exactly what this rule guards.
 */
export const danglingScheduledProgram: ValidationRule = {
  id: "dangling-scheduled-program",
  name: "Dangling scheduled program",
  category: "project-structure",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      const programIds = new Set(controller.programs.map((program) => program.id));
      for (const task of controller.tasks) {
        for (const programId of task.scheduledProgramIds) {
          if (!programIds.has(programId)) {
            findings.push({
              ruleId: "dangling-scheduled-program",
              severity: "error",
              message: `Task "${task.name}" schedules a program that does not exist; the schedule entry will be dropped on export.`,
              target: `${controller.name}/${task.name}`,
            });
          }
        }
      }
    }
    return findings;
  },
};

/**
 * Logix task period (Rate) and priority must fall in the ranges Studio 5000
 * enforces at verify time. A PERIODIC task must specify a scan rate; without one
 * the task has nothing to fire it and verify reports an invalid rate. The rate
 * (for periodic and any rate-bearing event task) must lie between 0.1 ms and
 * 2,000,000 ms, and task priority must be between 1 and 15 (1 = highest).
 *
 * The importer (`toDomainProject.ts`) keeps `Rate`/`Priority`/`Watchdog` only
 * when they parse as a finite, positive number, so a freshly imported project
 * never carries a zero/negative value — but it does *not* bound the upper end,
 * and a periodic task whose `Rate` attribute was missing or unparsable imports
 * with no `periodMs` at all. The matching exporter writes `Rate`/`Priority` only
 * when positive, so an out-of-range or absent value survives a round-trip and
 * reaches Studio 5000 unchanged. This rule is the scheduling analogue of the
 * declaration-time `array-dimension-limit` check: it guards the task header the
 * way `task-scheduling` guards the program assignments. Continuous tasks are
 * exempt from the rate requirement (they free-run) but still have their priority
 * range checked when one is set.
 */
export const taskRate: ValidationRule = {
  id: "task-rate",
  name: "Task rate and priority",
  category: "project-structure",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    const MIN_RATE_MS = 0.1;
    const MAX_RATE_MS = 2_000_000;
    const MIN_PRIORITY = 1;
    const MAX_PRIORITY = 15;
    for (const controller of project.controllers) {
      for (const task of controller.tasks) {
        const target = `${controller.name}/${task.name}`;
        if (task.type === "periodic" && (task.periodMs == null || task.periodMs <= 0)) {
          findings.push({
            ruleId: "task-rate",
            severity: "error",
            message: `Periodic task "${task.name}" has no scan rate; periodic controller tasks require a rate between ${MIN_RATE_MS} and ${MAX_RATE_MS} ms.`,
            target,
          });
        } else if (
          task.periodMs != null &&
          task.periodMs > 0 &&
          (task.periodMs < MIN_RATE_MS || task.periodMs > MAX_RATE_MS)
        ) {
          findings.push({
            ruleId: "task-rate",
            severity: "error",
            message: `Task "${task.name}" has a scan rate of ${task.periodMs} ms; controller task rules require a rate between ${MIN_RATE_MS} and ${MAX_RATE_MS} ms.`,
            target,
          });
        }
        if (task.priority != null && (task.priority < MIN_PRIORITY || task.priority > MAX_PRIORITY)) {
          findings.push({
            ruleId: "task-rate",
            severity: "error",
            message: `Task "${task.name}" has priority ${task.priority}; controller task priority must be between ${MIN_PRIORITY} and ${MAX_PRIORITY}.`,
            target,
          });
        }
      }
    }
    return findings;
  },
};

/**
 * Logix arrays may have at most three dimensions. Studio 5000 rejects a tag,
 * UDT member, or AOI local tag declared with four or more dimensions at verify
 * time ("the array exceeds the maximum number of dimensions"), because the
 * controller's tag-memory layout only supports rank 1, 2, or 3. The existing
 * array rules in `ladder-operands` validate subscript bounds and that a
 * reference supplies as many subscripts as the declaration has dimensions; this
 * rule guards the declaration itself, the companion declaration-time check those
 * runtime rules assume. Dimensions are read through `arrayDimensionsOf`, which
 * already drops non-positive/empty entries, so only genuinely over-rank
 * declarations are reported. Reported as an error because the type/tag will not
 * verify until a dimension is removed.
 */
export const arrayDimensionLimit: ValidationRule = {
  id: "array-dimension-limit",
  name: "Array dimension limit",
  category: "syntax",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    const MAX_DIMENSIONS = 3;
    const check = (
      kind: string,
      name: string,
      value: { dimension?: number; dimensions?: readonly number[] },
      target: string,
    ): void => {
      const dimensions = arrayDimensionsOf(value);
      if (dimensions.length > MAX_DIMENSIONS) {
        findings.push({
          ruleId: "array-dimension-limit",
          severity: "error",
          message: `${kind} "${name}" is declared with ${dimensions.length} dimensions (${arrayDimensionSuffix(value)}); controller arrays support at most ${MAX_DIMENSIONS} dimensions.`,
          target,
        });
      }
    };
    for (const controller of project.controllers) {
      for (const tag of controller.controllerTags) {
        check("Controller tag", tag.name, tag, controller.name);
      }
      for (const program of controller.programs) {
        for (const tag of program.programTags) {
          check("Program tag", tag.name, tag, `${controller.name}/${program.name}`);
        }
      }
      for (const udt of controller.dataTypes) {
        for (const member of udt.members) {
          check(`Member of "${udt.name}"`, member.name, member, `${controller.name}/${udt.name}`);
        }
      }
      for (const aoi of controller.addOnInstructions) {
        for (const localTag of aoi.localTags) {
          check(`Local tag of "${aoi.name}"`, localTag.name, localTag, `${controller.name}/${aoi.name}`);
        }
      }
    }
    return findings;
  },
};

/** Logix atomic (scalar) data types this offline model recognizes by name. */
const ATOMIC_DATA_TYPES = new Set<string>([
  "BOOL", "SINT", "INT", "DINT", "LINT",
  "USINT", "UINT", "UDINT", "ULINT",
  "REAL", "LREAL", "STRING",
]);

/**
 * Predefined Logix structured types that are legal in Studio 5000 but whose
 * member layout this offline core does not expand (the ones it does expand are
 * the keys of `STRUCTURED_TYPES`). Recognizing them here keeps
 * `unresolved-data-type` from warning about a member or parameter declared with
 * a perfectly valid predefined type the offline model simply does not model
 * field-by-field. Compared case-insensitively.
 */
const PREDEFINED_STRUCTURE_TYPES = new Set<string>([
  // Motion
  "AXIS_GENERIC", "AXIS_GENERIC_DRIVE", "AXIS_SERVO", "AXIS_SERVO_DRIVE",
  "AXIS_VIRTUAL", "AXIS_CIP_DRIVE", "AXIS_CONSUMED",
  "MOTION_GROUP", "COORDINATE_SYSTEM",
  "CAM", "CAM_PROFILE", "OUTPUT_CAM", "OUTPUT_COMPENSATION",
  // Module / connection
  "MODULE", "CONNECTION",
  // Misc predefined controls / legacy alarm
  "SERIAL_PORT_CONTROL", "ALARM",
]);

/**
 * Every data type a tag, UDT member, AOI parameter, or AOI local tag is declared
 * with must resolve to a type that exists. In Logix all data types — atomic,
 * predefined structured, user-defined (UDT), and AOI-introduced — share one
 * controller-wide namespace, and Studio 5000 rejects a definition whose member
 * (or a tag whose type) references a type that is not in it ("data type … does
 * not exist") at verify time. Such a dangling type reference does not arise from
 * import (the parser preserves whatever `DataType` the L5X carried), but an
 * offline edit that deletes or renames a UDT/AOI while a member or tag still names
 * the old type leaves the declaration pointing at a type that no longer resolves —
 * the declaration-time analogue of `dangling-routine-reference` and
 * `dangling-scheduled-program`. Tag data types are checked at both controller and
 * program scope, the declaration-side companion to `undefined-tag` (which only
 * confirms the tag exists, not that its declared type still resolves).
 *
 * A type resolves if it is an atomic type, a modeled predefined structured type
 * (`STRUCTURED_TYPES`), a recognized-but-unmodeled predefined type
 * (`PREDEFINED_STRUCTURE_TYPES`, e.g. an AXIS_ or MODULE type), or the name of a UDT or AOI
 * defined on the controller. Names are matched case-insensitively, as Logix
 * identifiers are. Custom STRING types round-trip as UDTs (family "StringFamily")
 * and so resolve through the UDT set. This is the type-resolution companion to
 * `circular-data-type` (which assumes the member types it follows exist) and
 * `duplicate-member`; reported as a warning rather than an error because the
 * offline predefined-type set may be incomplete, and the same unmodeled-type
 * situation is already surfaced as a warning by `unknown-member` when such a tag
 * is referenced in logic.
 */
export const unresolvedDataType: ValidationRule = {
  id: "unresolved-data-type",
  name: "Unresolved data type",
  category: "syntax",
  severity: "warning",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    const structuredTypeNames = new Set(
      Object.keys(STRUCTURED_TYPES).map((name) => name.toUpperCase()),
    );
    for (const controller of project.controllers) {
      // The user half of the controller's single data-type namespace.
      const userTypes = new Set<string>();
      for (const udt of controller.dataTypes) userTypes.add(udt.name.toUpperCase());
      for (const aoi of controller.addOnInstructions) userTypes.add(aoi.name.toUpperCase());

      const resolves = (dataType: string): boolean => {
        const upper = dataType.trim().toUpperCase();
        if (upper === "") return true; // empty/defaulted type — not this rule's concern
        return (
          ATOMIC_DATA_TYPES.has(upper) ||
          structuredTypeNames.has(upper) ||
          PREDEFINED_STRUCTURE_TYPES.has(upper) ||
          userTypes.has(upper)
        );
      };

      const check = (label: string, dataType: string, target: string): void => {
        if (resolves(dataType)) return;
        findings.push({
          ruleId: "unresolved-data-type",
          severity: "warning",
          message: `${label} is declared with data type "${dataType.trim()}", which is not defined in this project and is not a recognized predefined controller type.`,
          target,
        });
      };

      for (const tag of controller.controllerTags) {
        check(`Tag "${tag.name}"`, tag.dataType, `${controller.name}/${tag.name}`);
      }
      for (const program of controller.programs) {
        for (const tag of program.programTags) {
          check(
            `Tag "${tag.name}" of program "${program.name}"`,
            tag.dataType,
            `${controller.name}/${program.name}/${tag.name}`,
          );
        }
      }
      for (const udt of controller.dataTypes) {
        const target = `${controller.name}/${udt.name}`;
        for (const member of udt.members) {
          check(`Member "${member.name}" of "${udt.name}"`, member.dataType, target);
        }
      }
      for (const aoi of controller.addOnInstructions) {
        const target = `${controller.name}/${aoi.name}`;
        for (const parameter of aoi.parameters) {
          check(`Parameter "${parameter.name}" of "${aoi.name}"`, parameter.dataType, target);
        }
        for (const localTag of aoi.localTags) {
          check(`Local tag "${localTag.name}" of "${aoi.name}"`, localTag.dataType, target);
        }
      }
    }
    return findings;
  },
};

/**
 * Produced and consumed tags carry connection metadata Studio 5000 verifies
 * before the project will build. This offline model never opens a controller
 * connection — the produced/consumed roles and their `<ProduceInfo>` /
 * `<ConsumeInfo>` are imported strictly as read-only metadata — but the tag
 * *declaration* still has to be internally consistent or Studio 5000 rejects it
 * at verify time. This rule checks the constraints that hold without any
 * network:
 *
 *  - **Controller scope.** Produced and consumed tags must live at controller
 *    scope; Logix does not allow them inside a program. Import only ever sets
 *    these roles on controller tags (`extractTags` reads `<Tag>` under the
 *    controller's `<Tags>`), so a program-scoped produced/consumed tag can only
 *    arise from an offline edit — the edit-time hazard the `dangling-*` and
 *    `constant-tag-modified` rules also guard.
 *  - **Mutually exclusive roles.** A tag's L5X `TagType` is exactly one of
 *    `Produced` or `Consumed`; a tag flagged as both cannot be expressed in L5X
 *    and will not verify.
 *  - **Consumed producer binding.** A consumed tag must name the producing
 *    controller (`<ConsumeInfo Producer>`) and the remote tag it consumes
 *    (`RemoteTag`); without them the consumed connection is unconfigured and
 *    fails verification. The exporter writes `<ConsumeInfo>` from this metadata,
 *    so a missing producer survives a round-trip and reaches Studio 5000 as-is.
 *  - **Produce count range.** A produced tag's max-consumers count
 *    (`<ProduceInfo ProduceCount>`) must be between 1 and 256 when present; 0 or
 *    an out-of-range value fails verification.
 *
 * Reported as errors because each blocks the project from verifying. This is the
 * connection-tag companion to the declaration-time `array-dimension-limit` and
 * `task-rate` header checks, and to `alias-target-missing` for ordinary tags.
 */
export const producedConsumedTag: ValidationRule = {
  id: "produced-consumed-tag",
  name: "Produced/consumed tag",
  category: "project-structure",
  severity: "error",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    const MIN_PRODUCE_COUNT = 1;
    const MAX_PRODUCE_COUNT = 256;
    const isBlank = (value: string | undefined): boolean => value == null || value.trim() === "";

    const check = (tag: Tag, controllerName: string, programName: string | undefined): void => {
      if (!tag.produced && !tag.consumed) return;
      const target = programName
        ? `${controllerName}/${programName}/${tag.name}`
        : `${controllerName}/${tag.name}`;
      const role = tag.produced && tag.consumed ? "Produced/consumed" : tag.produced ? "Produced" : "Consumed";

      if (programName) {
        findings.push({
          ruleId: "produced-consumed-tag",
          severity: "error",
          message: `${role} tag "${tag.name}" is program-scoped under "${programName}"; produced and consumed tags must be controller-scoped.`,
          target,
        });
      }

      if (tag.produced && tag.consumed) {
        findings.push({
          ruleId: "produced-consumed-tag",
          severity: "error",
          message: `Tag "${tag.name}" is marked both produced and consumed; a tag may be one or the other, not both.`,
          target,
        });
      }

      if (tag.consumed) {
        if (isBlank(tag.consumeInfo?.producer)) {
          findings.push({
            ruleId: "produced-consumed-tag",
            severity: "error",
            message: `Consumed tag "${tag.name}" does not name a producing controller; the consumed connection is unconfigured.`,
            target,
          });
        }
        if (isBlank(tag.consumeInfo?.remoteTag)) {
          findings.push({
            ruleId: "produced-consumed-tag",
            severity: "error",
            message: `Consumed tag "${tag.name}" does not name a remote tag on the producing controller; the consumed connection is unconfigured.`,
            target,
          });
        }
      }

      if (tag.produced) {
        const produceCount = tag.produceInfo?.produceCount;
        if (
          produceCount != null &&
          (!Number.isInteger(produceCount) ||
            produceCount < MIN_PRODUCE_COUNT ||
            produceCount > MAX_PRODUCE_COUNT)
        ) {
          findings.push({
            ruleId: "produced-consumed-tag",
            severity: "error",
            message: `Produced tag "${tag.name}" allows ${produceCount} consumers; controller tag rules permit between ${MIN_PRODUCE_COUNT} and ${MAX_PRODUCE_COUNT}.`,
            target,
          });
        }
      }
    };

    for (const controller of project.controllers) {
      for (const tag of controller.controllerTags) {
        check(tag, controller.name, undefined);
      }
      for (const program of controller.programs) {
        for (const tag of program.programTags) {
          check(tag, controller.name, program.name);
        }
      }
    }
    return findings;
  },
};

export const defaultRules: ValidationRule[] = [
  missingMainRoutine,
  danglingRoutineReference,
  duplicateControllerTag,
  duplicateProgramTag,
  invalidTagName,
  invalidMemberName,
  invalidDefinitionName,
  aliasTargetMissing,
  circularAlias,
  doubleCoil,
  unresolvedJumpLabel,
  duplicateJumpLabel,
  constantTagModified,
  duplicateMember,
  circularDataType,
  duplicateRoutineName,
  duplicateProgramName,
  duplicateTaskName,
  reservedDefinitionName,
  duplicateDataTypeName,
  taskScheduling,
  danglingScheduledProgram,
  taskRate,
  arrayDimensionLimit,
  unresolvedDataType,
  producedConsumedTag,
  ladderOperands,
];
