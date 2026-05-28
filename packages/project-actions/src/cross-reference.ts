import type { PlcProject } from "@esco/core";
import { baseTagName, createDefaultRegistry, isNumericLiteral } from "@esco/instructions";
import { rungNodes } from "@esco/ladder";
import { getLadder } from "./helpers";

const registry = createDefaultRegistry();

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
 * tag (by base name). Numeric literals are ignored; member/array paths resolve to
 * their base tag. Read/write direction comes from the instruction registry.
 */
export function collectTagReferences(project: PlcProject, tagName?: string): TagReference[] {
  const references: TagReference[] = [];
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const rung of ladder.rungs) {
          for (const node of rungNodes(rung)) {
            const definition = registry.get(node.instructionType);
            node.operands.forEach((operand, index) => {
              const value = operand.value.trim();
              if (!value || isNumericLiteral(value)) return;
              const base = baseTagName(value);
              if (!base) return;
              if (tagName && base !== tagName) return;
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
                direction: definition?.operands[index]?.direction ?? "read",
              });
            });
          }
        }
      }
    }
  }
  return references;
}
