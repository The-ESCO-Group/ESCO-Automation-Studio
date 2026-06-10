import { baseTagName, createDefaultRegistry } from "@esco/instructions";
import type { LadderBranch, LadderRoutine, LadderRung } from "@esco/ladder";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * Structural ladder checks that produce engineer-friendly messages for the kinds
 * of malformed rungs the operand-level rules miss:
 *  - a condition (contact) placed *after* an output coil in the same series, and
 *  - an empty parallel branch leg that permanently shorts its group.
 *
 * These are intentionally narrow (only contact-after-coil; only truly empty
 * legs) so correct logic never trips them — the rule is silent on well-formed
 * rungs and never blocks an edit.
 */

const registry = createDefaultRegistry();

/** Recognise a populated ladder routine stored in the loosely-typed `Routine.ladder`. */
function asLadderRoutine(ladder: unknown): LadderRoutine | undefined {
  if (ladder && typeof ladder === "object" && Array.isArray((ladder as { rungs?: unknown }).rungs)) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

type RenderStyle = "contact" | "coil" | "box" | "function";

function styleOf(instructionType: string): RenderStyle | undefined {
  return registry.get(instructionType.toUpperCase())?.render.style;
}

function firstOperandTag(operands: { value?: string }[]): string {
  return baseTagName(operands[0]?.value ?? "") || operands[0]?.value || "";
}

/** Visit every series segment (a branch's ordered `nodes`) in a rung's tree. */
function forEachSeries(
  branch: LadderBranch,
  visit: (branch: LadderBranch) => void,
  seen: WeakSet<object>,
): void {
  if (!branch || typeof branch !== "object" || seen.has(branch)) return;
  seen.add(branch);
  visit(branch);
  for (const leg of branch.parallelBranches ?? []) forEachSeries(leg, visit, seen);
  if (branch.next) forEachSeries(branch.next, visit, seen);
}

function checkRung(
  rung: LadderRung,
  target: string,
  findings: ValidationFinding[],
): void {
  const seen = new WeakSet<object>();
  forEachSeries(
    rung.root,
    (branch) => {
      // 1) Input (contact) after an output (coil) within the same series segment.
      let coilType: string | undefined;
      for (const node of branch.nodes) {
        const style = styleOf(node.instructionType);
        if (style === "coil") {
          coilType ??= node.instructionType.toUpperCase();
          continue;
        }
        if (style === "contact" && coilType) {
          const tag = firstOperandTag(node.operands);
          const tagNote = tag ? ` ("${tag}")` : "";
          findings.push({
            ruleId: "ladder-structure",
            severity: "warning",
            message: `Rung ${rung.number}: input instruction "${node.instructionType.toUpperCase()}"${tagNote} comes after output coil "${coilType}"; conditions must precede outputs on a rung.`,
            target,
          });
          break; // one report per series segment is enough to flag the problem
        }
      }

      // 2) Empty parallel leg — a leg with no instructions and no further structure
      //    permanently shorts (bypasses) the parallel group it belongs to.
      for (const leg of branch.parallelBranches ?? []) {
        const empty = leg.nodes.length === 0 && !leg.parallelBranches?.length && !leg.next;
        if (empty) {
          findings.push({
            ruleId: "ladder-structure",
            severity: "info",
            message: `Rung ${rung.number} has an empty parallel branch leg; an empty leg permanently passes power and bypasses the parallel group. Add instructions to the leg or remove it.`,
            target,
          });
        }
      }
    },
    seen,
  );
}

export const ladderStructure: ValidationRule = {
  id: "ladder-structure",
  name: "Ladder rung structure",
  category: "best-practice",
  severity: "warning",
  run({ project }) {
    const findings: ValidationFinding[] = [];
    for (const controller of project.controllers) {
      for (const program of controller.programs) {
        for (const routine of program.routines) {
          const ladder = asLadderRoutine(routine.ladder);
          if (!ladder) continue;
          const target = `${controller.name}/${program.name}/${routine.name}`;
          for (const rung of ladder.rungs) checkRung(rung, target, findings);
        }
      }
    }
    return findings;
  },
};
