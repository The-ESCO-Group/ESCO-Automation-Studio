import { baseTagName, createDefaultRegistry } from "@esco/instructions";
import type { LadderBranch, LadderNode, LadderRoutine, LadderRung } from "@esco/ladder";
import type { ValidationFinding, ValidationRule } from "./types";

/**
 * Structural ladder checks that produce engineer-friendly messages for problems
 * the operand-level rules cannot see:
 *  - a condition placed after an action anywhere on the same execution path;
 *  - multiple actions chained on one path instead of separated deliberately;
 *  - an empty parallel leg that permanently shorts its branch group.
 *
 * Logix output instructions pass rung-condition-out to the next instruction, so
 * chained actions are legal controller syntax. They are still flagged here as a
 * training/readability warning because independent actions belong on separate
 * rungs or explicit output branches.
 */

const registry = createDefaultRegistry();

/** Recognise a populated ladder routine stored in the loosely-typed `Routine.ladder`. */
function asLadderRoutine(ladder: unknown): LadderRoutine | undefined {
  if (ladder && typeof ladder === "object" && Array.isArray((ladder as { rungs?: unknown }).rungs)) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

type InstructionRole = "condition" | "action" | "unknown";

const CONDITION_BOXES = new Set(["ONS", "AFI", "SQI", "SQC"]);

function roleOf(instructionType: string): InstructionRole {
  const type = instructionType.toUpperCase();
  const definition = registry.get(type);
  if (!definition) return "unknown";
  if (definition.render.style === "contact") return "condition";
  if (definition.category === "compare" || CONDITION_BOXES.has(type)) return "condition";
  return "action";
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

const MAX_EXECUTION_PATHS = 256;

/**
 * Expand the branch AST into the instruction sequences that can actually be
 * scanned from the left rail to the right rail. This catches ordering problems
 * across a parallel merge and its `next` continuation, not just within one
 * branch object's local `nodes` array.
 */
function executionPaths(
  branch: LadderBranch,
  stack = new Set<LadderBranch>(),
): LadderNode[][] {
  if (stack.has(branch)) return [[]];
  stack.add(branch);

  const alternatives: LadderNode[][] = [branch.nodes];
  for (const leg of branch.parallelBranches ?? []) {
    alternatives.push(...executionPaths(leg, stack));
    if (alternatives.length >= MAX_EXECUTION_PATHS) break;
  }
  const continuation = branch.next ? executionPaths(branch.next, stack) : [[]];
  stack.delete(branch);

  const paths: LadderNode[][] = [];
  for (const alternative of alternatives) {
    for (const suffix of continuation) {
      paths.push([...alternative, ...suffix]);
      if (paths.length >= MAX_EXECUTION_PATHS) return paths;
    }
  }
  return paths;
}

function checkRung(
  rung: LadderRung,
  target: string,
  findings: ValidationFinding[],
): void {
  let reportedConditionAfterAction = false;
  let reportedChainedActions = false;

  for (const path of executionPaths(rung.root)) {
    let firstAction: LadderNode | undefined;
    for (const node of path) {
      const role = roleOf(node.instructionType);
      if (role === "action") {
        if (firstAction && !reportedChainedActions) {
          findings.push({
            ruleId: "ladder-structure",
            severity: "warning",
            message: `Rung ${rung.number}: action instruction "${node.instructionType.toUpperCase()}" follows action instruction "${firstAction.instructionType.toUpperCase()}" on the same execution path. Use a separate rung or an explicit parallel output branch for independent actions.`,
            target,
          });
          reportedChainedActions = true;
        }
        firstAction ??= node;
        continue;
      }
      if (role === "condition" && firstAction && !reportedConditionAfterAction) {
        const tag = firstOperandTag(node.operands);
        const tagNote = tag ? ` ("${tag}")` : "";
        findings.push({
          ruleId: "ladder-structure",
          severity: "warning",
          message: `Rung ${rung.number}: condition instruction "${node.instructionType.toUpperCase()}"${tagNote} comes after action instruction "${firstAction.instructionType.toUpperCase()}"; conditions should precede actions on each execution path.`,
          target,
        });
        reportedConditionAfterAction = true;
      }
    }
  }

  const seen = new WeakSet<object>();
  forEachSeries(
    rung.root,
    (branch) => {
      // An empty main leg or parallel leg permanently bypasses its branch group.
      if (branch.parallelBranches?.length && branch.nodes.length === 0) {
        findings.push({
          ruleId: "ladder-structure",
          severity: "info",
          message: `Rung ${rung.number} has an empty primary branch leg; it permanently passes power and bypasses the other legs. Add instructions to the leg or remove the branch group.`,
          target,
        });
      }
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
