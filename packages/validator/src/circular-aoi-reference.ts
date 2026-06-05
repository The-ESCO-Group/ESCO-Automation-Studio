import type { AddOnInstruction, PlcProject } from "@esco/core";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * An Add-On Instruction must not call itself, directly or transitively. Studio
 * 5000 rejects a recursive AOI on import/verification ("a recursive call was
 * detected" / an AOI may not reference itself) because an AOI body is inlined at
 * each call site — a definition that invoked itself would expand without bound
 * and has no finite scan. A direct cycle is an AOI whose logic places its own
 * instruction (`Foo` calls `Foo`); an indirect cycle runs through one or more
 * intermediary AOIs (`A` calls `B` and `B` calls `A`).
 *
 * The offline simulator only survives a recursive AOI because its executor caps
 * call depth at runtime (see `add-on-instruction.test.ts`, "terminates a
 * self-referential (recursive) AOI via the call-depth guard"); nothing flags the
 * definition as the verify error it is. AOI logic became reachable offline once
 * imported RLL bodies were executed and AOI parameters/local tags were made
 * editable, so a cycle introduced by an offline edit (or present on an L5X
 * assembled elsewhere) round-trips through export untouched and reaches Studio
 * 5000 as a verify failure. This is the AOI-call-graph companion to
 * `circular-data-type` (the UDT type-graph cycle check) and `circular-alias`
 * (the alias-chain cycle check); reported as an error because the controller
 * will not verify until the cycle is removed.
 *
 * Call edges are read from the instruction types in each AOI's ladder routines:
 * an AOI call node carries the called AOI's name as its `instructionType`
 * (matched case-insensitively, as Logix identifiers are), exactly as
 * `ladder-operands` resolves AOI calls. A **source-protected** AOI exposes no
 * inspectable logic, so it contributes no outgoing edges and cannot anchor a
 * detectable cycle — the same blind spot the simulator has for protected bodies;
 * a cycle that must route through a protected AOI is therefore left to Studio
 * 5000 to catch.
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

/** Upper-cased names of the AOIs this one calls (its outgoing call-graph edges). */
function calledAoiNames(aoi: AddOnInstruction, aoiNames: ReadonlySet<string>): Set<string> {
  const called = new Set<string>();
  // A protected AOI's logic is not available to inspect; treat it as opaque.
  if (aoi.protected) return called;
  for (const routine of aoi.routines ?? []) {
    const ladder = asLadderRoutine(routine.ladder);
    if (!ladder) continue;
    for (const node of routineNodes(ladder)) {
      const target = node.instructionType.toUpperCase();
      if (aoiNames.has(target)) called.add(target);
    }
  }
  return called;
}

export const circularAoiReference: ValidationRule = {
  id: "circular-aoi-reference",
  name: "Circular Add-On Instruction reference",
  category: "syntax",
  severity: "error",
  run({ project }: { project: PlcProject }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      // Map an upper-cased AOI name to its authored spelling, and the directed
      // call edges A -> B for every AOI B that A's logic invokes.
      const displayName = new Map<string, string>();
      for (const aoi of controller.addOnInstructions) {
        const key = aoi.name.toUpperCase();
        if (!displayName.has(key)) displayName.set(key, aoi.name);
      }
      const aoiNames = new Set(displayName.keys());
      const edges = new Map<string, Set<string>>();
      for (const aoi of controller.addOnInstructions) {
        edges.set(aoi.name.toUpperCase(), calledAoiNames(aoi, aoiNames));
      }

      // Find a path start -> ... -> start through the call graph, or undefined if
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

      for (const aoi of controller.addOnInstructions) {
        const upper = aoi.name.toUpperCase();
        const target = `${controller.name}/${aoi.name}`;
        if (edges.get(upper)?.has(upper)) {
          findings.push({
            ruleId: "circular-aoi-reference",
            severity: "error",
            message: `Add-On Instruction "${aoi.name}" calls itself; an Add-On Instruction cannot reference itself directly or indirectly.`,
            target,
          });
          continue;
        }
        const cycle = findCycleThrough(upper);
        if (cycle) {
          const path = cycle.map((u) => displayName.get(u) ?? u).join(" → ");
          findings.push({
            ruleId: "circular-aoi-reference",
            severity: "error",
            message: `Add-On Instruction "${aoi.name}" is part of a circular Add-On Instruction reference (${path}); an Add-On Instruction cannot reference itself directly or indirectly.`,
            target,
          });
        }
      }
    }
    return findings;
  },
};
