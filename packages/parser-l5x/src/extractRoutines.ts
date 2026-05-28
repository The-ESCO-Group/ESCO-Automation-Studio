import { createRoutine, type Routine } from "@esco/core";
import type { InstructionRegistry } from "@esco/instructions";
import { createLadderRoutine, createRung } from "@esco/ladder";
import { attr, child, text, toArray, type L5XNode } from "./parseL5X";
import { parseRungText } from "./parseRungText";

export interface ExtractedRoutines {
  routines: Routine[];
  warnings: string[];
}

/**
 * Extract `<Routine>` elements for a program. Ladder (RLL) routines get their
 * rungs parsed into the semantic AST; the original rung text is preserved on
 * each rung's `sourceText`. Non-ladder routines are created without ladder.
 */
export function extractRoutines(
  programNode: L5XNode,
  programName: string,
  programId: string,
  registry: InstructionRegistry,
): ExtractedRoutines {
  const warnings: string[] = [];
  const routines = toArray<L5XNode>(child(child(programNode, "Routines"), "Routine")).flatMap(
    (routineNode) => {
      const name = attr(routineNode, "Name");
      if (!name) return [];
      const routine = createRoutine(programId, name, "ladder");

      const rllContent = child(routineNode, "RLLContent");
      if (rllContent) {
        const ladder = createLadderRoutine();
        toArray<L5XNode>(child(rllContent, "Rung")).forEach((rungNode, index) => {
          const number = Number(attr(rungNode, "Number") ?? index);
          const rungText = text(child(rungNode, "Text"));
          const comment = child(rungNode, "Comment");
          const parsed = parseRungText(rungText, registry);

          const rung = createRung(
            ladder.id,
            Number.isFinite(number) ? number : index,
            [],
            comment ? text(comment) : undefined,
          );
          rung.root = parsed.root;
          rung.sourceText = rungText;
          ladder.rungs.push(rung);

          const where = `${programName}/${name} rung ${rung.number}`;
          for (const type of parsed.unsupportedTypes) {
            warnings.push(`${where}: unsupported instruction "${type}" (preserved, not simulated).`);
          }
          if (parsed.hasBranches) {
            warnings.push(`${where}: branch logic imported as a series (simulation may differ).`);
          }
        });
        routine.ladder = ladder;
      }

      return [routine];
    },
  );

  return { routines, warnings };
}
