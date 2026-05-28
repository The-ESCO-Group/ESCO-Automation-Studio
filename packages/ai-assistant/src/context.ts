import type { PlcProject, Routine } from "@esco/core";
import { baseTagName, createDefaultRegistry, isNumericLiteral } from "@esco/instructions";
import { routineNodes, type LadderNode, type LadderRoutine } from "@esco/ladder";
import { defaultRoutineId, findRoutine, getLadder, tagExists } from "@esco/project-actions";
import type { AssistantSelection } from "./types";

export const registry = createDefaultRegistry();

/** The routine the assistant should act on: the selected one, or the default main. */
export function resolveRoutineId(
  project: PlcProject,
  selection?: AssistantSelection,
): string | undefined {
  return selection?.routineId ?? defaultRoutineId(project);
}

export function resolveRoutine(
  project: PlcProject,
  selection?: AssistantSelection,
): { routine?: Routine; ladder?: LadderRoutine; routineId?: string } {
  const routineId = resolveRoutineId(project, selection);
  const routine = routineId ? findRoutine(project, routineId) : undefined;
  return { routine, ladder: getLadder(routine), routineId };
}

export interface UndefinedTagInfo {
  name: string;
  /** Inferred data type to create (from the operand's allowed types). */
  type: string;
}

/** Tag references with no matching tag, with the type they should most likely be. */
export function undefinedTags(project: PlcProject): UndefinedTagInfo[] {
  const found = new Map<string, string>();
  for (const controller of project.controllers) {
    for (const program of controller.programs) {
      for (const routine of program.routines) {
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const node of routineNodes(ladder)) {
          const definition = registry.get(node.instructionType);
          node.operands.forEach((operand, index) => {
            const value = operand.value.trim();
            if (!value || isNumericLiteral(value)) return;
            const base = baseTagName(value);
            if (!base || tagExists(project, base) || found.has(base)) return;
            found.set(base, definition?.operands[index]?.allowedTypes?.[0] ?? "BOOL");
          });
        }
      }
    }
  }
  return [...found].map(([name, type]) => ({ name, type }));
}

/** One readable line describing an instruction node. */
export function describeNode(node: LadderNode): string {
  const definition = registry.get(node.instructionType);
  const args = node.operands.map((operand) => operand.value || "?");
  const a = (i: number) => args[i] ?? "?";
  if (!definition) {
    return `${node.instructionType}(${args.join(", ")}) — unsupported instruction (preserved, not simulated)`;
  }
  switch (node.instructionType) {
    case "XIC":
      return `XIC(${a(0)}) — passes when ${a(0)} is TRUE`;
    case "XIO":
      return `XIO(${a(0)}) — passes when ${a(0)} is FALSE`;
    case "OTE":
      return `OTE(${a(0)}) — sets ${a(0)} to the rung-in condition`;
    case "TON":
      return `TON(${a(0)}, ${a(1)}) — on-delay timer; ${a(0)}.DN turns on after ${a(1)} ms while the rung is true`;
    case "CTU":
      return `CTU(${a(0)}, ${a(1)}) — counts up on each false→true edge; ${a(0)}.DN turns on at ${a(1)}`;
    case "MOV":
      return `MOV(${a(0)}, ${a(1)}) — copies ${a(0)} into ${a(1)} while the rung is true`;
    case "EQU":
      return `EQU(${a(0)}, ${a(1)}) — passes when ${a(0)} == ${a(1)}`;
    case "GRT":
      return `GRT(${a(0)}, ${a(1)}) — passes when ${a(0)} > ${a(1)}`;
    case "LES":
      return `LES(${a(0)}, ${a(1)}) — passes when ${a(0)} < ${a(1)}`;
    default:
      return `${node.instructionType}(${args.join(", ")}) — ${definition.displayName}`;
  }
}

/** Split a node's operand tags into reads and writes (using operand direction). */
export function readsAndWrites(node: LadderNode): { reads: string[]; writes: string[] } {
  const definition = registry.get(node.instructionType);
  const reads: string[] = [];
  const writes: string[] = [];
  node.operands.forEach((operand, index) => {
    const value = operand.value.trim();
    if (!value || isNumericLiteral(value)) return;
    const direction = definition?.operands[index]?.direction ?? "read";
    (direction === "write" ? writes : reads).push(value);
  });
  return { reads, writes };
}

/** Distinct values across a list (preserves order). */
export function distinct(values: string[]): string[] {
  return [...new Set(values)];
}
