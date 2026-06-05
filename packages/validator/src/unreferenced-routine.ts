import type { PlcProject } from "@esco/core";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * Every routine in a program should be reachable, exactly as Studio 5000 checks
 * at verify time. A Logix routine executes only when it is the program's main
 * routine, its fault routine, or the target of a routine-calling instruction —
 * `JSR` (Jump to Subroutine) or `FOR` (which executes a named routine as a
 * bounded loop) — somewhere in the program. A routine that is none of these is
 * downloaded but never scanned, and Studio 5000 reports it as a verify warning
 * ("Routine … is not referenced by any JSR instruction"). This is the
 * routine-reachability
 * companion to `dangling-routine-reference` (which catches a main/fault routine
 * that points at a routine that does not exist) and `unknown-routine` (which
 * catches a JSR that targets a routine that does not exist): this rule catches
 * the inverse — a routine that exists but nothing reaches.
 *
 * Such a stranded routine does not arise from import (an exported program only
 * carries routines the engineer authored), but an offline edit that deletes the
 * JSR that called a helper routine — or renames the routine without updating its
 * callers — leaves the routine present yet unreachable. It is reported as a
 * warning, not an error: the controller still verifies, and an intentionally
 * staged routine (kept for a later edit) is legal, so this surfaces the likely
 * mistake without blocking.
 *
 * JSR targets are gathered from ladder routines (the executed model) and, as a
 * best effort, from imported Structured Text source so a routine called only
 * from an ST `JSR(…)` is not falsely flagged. Routine names are matched
 * case-insensitively, as Logix identifiers are.
 *
 * Scope is deliberately conservative to avoid false positives: the rule runs
 * only for programs whose main routine is configured and resolves to a real
 * routine. When a program has no (resolvable) main routine, JSR reachability has
 * no defined entry point, and the structural problem is already surfaced by
 * `missing-main-routine` / `dangling-routine-reference` — flagging every routine
 * as unreferenced there would be redundant noise.
 */

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

/** Routine names targeted by `JSR(<routine>, …)` calls in imported Structured Text. */
function structuredTextJsrTargets(source: string): string[] {
  const targets: string[] = [];
  const pattern = /\bJSR\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    targets.push(match[1]!);
  }
  return targets;
}

export const unreferencedRoutine: ValidationRule = {
  id: "unreferenced-routine",
  name: "Unreferenced routine",
  category: "project-structure",
  severity: "warning",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const program of controller.programs) {
        const routineIds = new Set(program.routines.map((routine) => routine.id));
        // Only evaluate programs with a real entry point; otherwise the absent
        // main routine is the finding (left to missing-main-routine).
        if (!program.mainRoutineId || !routineIds.has(program.mainRoutineId)) continue;

        // Every routine name reached by a routine-calling instruction (JSR or
        // FOR — both name the target routine in operand 0) anywhere in the
        // program, folded to lower case for the case-insensitive comparison
        // Logix identifiers use.
        const jsrTargets = new Set<string>();
        const addTarget = (name: string): void => {
          const trimmed = name.trim();
          if (trimmed) jsrTargets.add(trimmed.toLowerCase());
        };
        for (const routine of program.routines) {
          const ladder = asLadderRoutine(routine.ladder);
          if (ladder) {
            for (const node of routineNodes(ladder)) {
              if (node.instructionType === "JSR" || node.instructionType === "FOR") {
                addTarget(node.operands[0]?.value ?? "");
              }
            }
          }
          if (routine.structuredText) {
            for (const target of structuredTextJsrTargets(routine.structuredText)) addTarget(target);
          }
        }

        for (const routine of program.routines) {
          const isEntryPoint =
            routine.id === program.mainRoutineId || routine.id === program.faultRoutineId;
          if (isEntryPoint) continue;
          if (jsrTargets.has(routine.name.trim().toLowerCase())) continue;
          findings.push({
            ruleId: "unreferenced-routine",
            severity: "warning",
            message: `Routine "${routine.name}" in program "${program.name}" is not the main or fault routine and is not called by any JSR; it will not execute.`,
            target: `${controller.name}/${program.name}/${routine.name}`,
          });
        }
      }
    }
    return findings;
  },
};
