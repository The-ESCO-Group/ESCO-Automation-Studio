import type { PlcProject } from "@esco/core";
import {
  baseTagName,
  createDefaultRegistry,
  isNumericLiteral,
  parseJsrParameterLayout,
  referencedPaths,
} from "@esco/instructions";
import { rungNodes, type LadderNode, type LadderRoutine } from "@esco/ladder";
import { getLadder } from "./helpers";

const registry = createDefaultRegistry();

function referenceTagName(value: string): string {
  const qualified = value.trim().match(/^Program:([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/);
  if (qualified) return `Program:${qualified[1]}.${qualified[2]}`;
  return baseTagName(value);
}

/** A single place a tag is used in ladder logic. */
export interface TagReference {
  /** Base tag name (e.g. "Timer1" for an operand "Timer1.DN"). */
  tag: string;
  controllerName: string;
  programName: string;
  routineId: string;
  routineName: string;
  rungId: string;
  rungNumber: number;
  instructionType: string;
  /** Full operand text, which may include a member/array path. */
  operand: string;
  direction: "read" | "write";
}

/**
 * Collect every tag reference across all routines. Optionally filter to a single
 * tag (by base name, or `Program:ProgramName.Tag` for a qualified program-scope
 * reference). Numeric literals are ignored; member/array paths resolve to their
 * base tag. Read/write direction comes from the instruction registry.
 */
export function collectTagReferences(project: PlcProject, tagName?: string): TagReference[] {
  const references: TagReference[] = [];
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      const laddersByName = new Map<string, LadderRoutine>();
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (ladder) laddersByName.set(routine.name, ladder);
      }
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const rung of ladder.rungs) {
          for (const node of rungNodes(rung)) {
            const definition = registry.get(node.instructionType);
            node.operands.forEach((operand, index) => {
              const direction = operandDirection(node, index, laddersByName);
              if (!direction) return;
              const value = operand.value.trim();
              if (!value || isNumericLiteral(value)) return;
              const operandDef = definition?.operands[index];
              const values = operandDef?.isExpression ? referencedPaths(value) : [value];
              for (const referenceValue of values) {
                const base = referenceTagName(referenceValue);
                if (!base) continue;
                if (tagName && base !== tagName) continue;
                references.push({
                  tag: base,
                  controllerName: controller.name,
                  programName: program.name,
                  routineId: routine.id,
                  routineName: routine.name,
                  rungId: rung.id,
                  rungNumber: rung.number,
                  instructionType: node.instructionType,
                  operand: value,
                  direction: direction ?? operandDef?.direction ?? "read",
                });
              }
            });
          }
        }
      }
    }
  }
  return references;
}

function operandDirection(
  node: LadderNode,
  index: number,
  laddersByName: Map<string, LadderRoutine>,
): "read" | "write" | undefined {
  const definition = registry.get(node.instructionType);
  const operandDef = definition?.operands[index];
  if (operandDef?.isRoutineRef || operandDef?.isLabelRef) return undefined;

  if (node.instructionType === "JSR") {
    if (index === 0) return undefined;
    const routineName = node.operands[0]?.value.trim() ?? "";
    const target = laddersByName.get(routineName);
    const sbrCount = target ? firstInstructionOperandCount(target, "SBR") : 0;
    const raw = node.operands.slice(1).map((operand) => operand.value.trim());
    const layout = parseJsrParameterLayout(raw, sbrCount);
    const parameterIndex = index - 1 - (layout.explicitInputCount ? 1 : 0);
    if (parameterIndex < 0) return undefined; // Studio's JSR input-count field.
    return parameterIndex < layout.inputCount ? "read" : "write";
  }

  if (node.instructionType === "SBR") return "write";
  if (node.instructionType === "RET") return "read";
  return operandDef?.direction ?? "read";
}

function firstInstructionOperandCount(ladder: LadderRoutine, instructionType: string): number {
  const rungs = [...ladder.rungs].sort((a, b) => a.number - b.number);
  for (const rung of rungs) {
    const node = rungNodes(rung).find((candidate) => candidate.instructionType === instructionType);
    if (node) return node.operands.length;
  }
  return 0;
}
