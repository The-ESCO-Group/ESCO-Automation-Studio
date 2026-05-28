import { STRUCTURED_TYPES, memberDefs, parseArrayIndex } from "@esco/core";
import { baseTagName, createDefaultRegistry, isNumericLiteral, isPlainTag } from "@esco/instructions";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
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
      // Controller-scope tag types/dimensions/aliases (overlaid per program below).
      const controllerTypes = new Map<string, string>();
      const controllerDims = new Map<string, number>();
      const controllerAlias = new Map<string, string>();
      for (const tag of controller.controllerTags) {
        controllerTypes.set(tag.name, tag.dataType);
        if (tag.dimension && tag.dimension > 0) controllerDims.set(tag.name, tag.dimension);
        if (tag.aliasFor) controllerAlias.set(tag.name, baseTagName(tag.aliasFor));
      }
      const routineNames = new Set<string>();
      for (const program of controller.programs) {
        for (const routine of program.routines) routineNames.add(routine.name);
      }

      // Known member names by structured/UDT type, for member-path validation.
      const memberNames = new Map<string, Set<string>>();
      for (const structured of Object.keys(STRUCTURED_TYPES)) {
        memberNames.set(structured, new Set(memberDefs(structured).map((m) => m.name)));
      }
      for (const udt of controller.dataTypes) {
        memberNames.set(udt.name, new Set(udt.members.map((m) => m.name)));
      }

      for (const program of controller.programs) {
        // Effective tags inside this program: controller scope overlaid with
        // (shadowed by) the program's own tags.
        const tagTypes = new Map(controllerTypes);
        const tagDims = new Map(controllerDims);
        const tagAlias = new Map(controllerAlias);
        for (const tag of program.programTags) {
          tagTypes.set(tag.name, tag.dataType);
          if (tag.dimension && tag.dimension > 0) tagDims.set(tag.name, tag.dimension);
          if (tag.aliasFor) tagAlias.set(tag.name, baseTagName(tag.aliasFor));
        }
        // Resolve a name to its effective data type, following alias chains.
        const resolveType = (name: string, seen = new Set<string>()): string | undefined => {
          if (seen.has(name)) return undefined; // alias cycle
          if (tagAlias.has(name)) {
            seen.add(name);
            return resolveType(tagAlias.get(name)!, seen);
          }
          return tagTypes.get(name);
        };

        for (const routine of program.routines) {
          const ladder = asLadderRoutine(routine.ladder);
          if (!ladder) continue;
          const target = `${controller.name}/${program.name}/${routine.name}`;

          for (const node of routineNodes(ladder)) {
            const definition = registry.get(node.instructionType);
            if (!definition) {
              findings.push({
                ruleId: "unsupported-instruction",
                severity: "info",
                message: `Instruction "${node.instructionType}" is not supported and will not be simulated.`,
                target,
              });
              continue;
            }

            definition.operands.forEach((operandDef, index) => {
              const value = node.operands[index]?.value?.trim() ?? "";

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

              if (isNumericLiteral(value)) return; // a constant, not a tag reference

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

              // Resolve the base tag of a member/array path (e.g. Timer1.DN -> Timer1).
              const base = baseTagName(value);
              if (base === "") return; // unparseable (expression) — skip

              // A name is "known" if it is a tag or an alias (even if the alias
              // target is missing — alias-target-missing reports that separately).
              if (!tagTypes.has(base) && !tagAlias.has(base)) {
                findings.push({
                  ruleId: "undefined-tag",
                  severity: "error",
                  message: `Undefined tag "${base}" referenced in routine "${routine.name}".`,
                  target,
                });
                return;
              }
              // Effective type after alias resolution (undefined if alias target missing).
              const dataType = resolveType(base);
              if (dataType === undefined) return; // unresolved alias — covered elsewhere

              // Array bounds: an element index must be within the tag's dimension.
              const arrayRef = parseArrayIndex(value);
              if (arrayRef) {
                const dim = tagDims.get(arrayRef.base);
                if (dim !== undefined && arrayRef.index >= dim) {
                  findings.push({
                    ruleId: "array-index-out-of-range",
                    severity: "error",
                    message: `Array index ${arrayRef.index} is out of range for "${arrayRef.base}" (size ${dim}).`,
                    target,
                  });
                }
              }

              // Member path: validate the first member against the tag's structure/UDT.
              const dotAt = value.indexOf(".");
              if (dotAt >= 0 && !arrayRef) {
                const members = memberNames.get(dataType);
                if (members) {
                  const firstMember = value.slice(dotAt + 1).split(/[.[]/)[0];
                  if (firstMember && !members.has(firstMember)) {
                    findings.push({
                      ruleId: "unknown-member",
                      severity: "warning",
                      message: `Member "${firstMember}" does not exist on ${dataType} tag "${base}".`,
                      target,
                    });
                  }
                }
              }

              if (
                isPlainTag(value) &&
                operandDef.allowedTypes &&
                !operandDef.allowedTypes.includes(dataType)
              ) {
                // Only type-check plain tags; member/array paths can be any atomic type.
                findings.push({
                  ruleId: "operand-type-mismatch",
                  severity: "error",
                  message: `${node.instructionType} operand "${operandDef.name}" expects ${operandDef.allowedTypes.join("/")}, but tag "${value}" is ${dataType}.`,
                  target,
                });
              }
            });
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

export const defaultRules: ValidationRule[] = [
  missingMainRoutine,
  duplicateControllerTag,
  duplicateProgramTag,
  aliasTargetMissing,
  doubleCoil,
  ladderOperands,
];
