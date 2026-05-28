// Offline project search for the Find / Search Results feature. Pure function
// over the project model — searches tag names/descriptions, routine names, and
// neutral rung text. No mutation, no network.
import type { PlcProject } from "@esco/core";
import { getLadder } from "@esco/project-actions";
import { rungNodes } from "@esco/ladder";

export interface SearchHit {
  kind: "tag" | "routine" | "rung";
  label: string;
  detail: string;
  /** Routine to open when the hit is activated (routine/rung hits). */
  routineId?: string;
}

const MAX_HITS = 200;

function rungText(nodes: { instructionType: string; operands: { value: string }[] }[]): string {
  return nodes.map((n) => `${n.instructionType}(${n.operands.map((o) => o.value).join(",")})`).join("");
}

/** Search tags, routines, and rung text for `query` (case-insensitive). */
export function searchProject(project: PlcProject, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  const add = (hit: SearchHit) => {
    if (hits.length < MAX_HITS) hits.push(hit);
  };

  for (const controller of project.controllers) {
    const tags = [
      ...controller.controllerTags.map((t) => ({ tag: t, scope: "controller" })),
      ...controller.programs.flatMap((p) => p.programTags.map((t) => ({ tag: t, scope: p.name }))),
    ];
    for (const { tag, scope } of tags) {
      if (tag.name.toLowerCase().includes(q) || (tag.description ?? "").toLowerCase().includes(q)) {
        add({ kind: "tag", label: tag.name, detail: `${tag.dataType} · ${scope}` });
      }
    }

    for (const program of controller.programs) {
      for (const routine of program.routines) {
        if (routine.name.toLowerCase().includes(q)) {
          add({ kind: "routine", label: `${program.name} / ${routine.name}`, detail: "routine", routineId: routine.id });
        }
        const ladder = getLadder(routine);
        if (!ladder) continue;
        for (const rung of ladder.rungs) {
          const text = rungText(rungNodes(rung));
          const comment = rung.comment ?? "";
          if (text.toLowerCase().includes(q) || comment.toLowerCase().includes(q)) {
            add({
              kind: "rung",
              label: `${program.name} / ${routine.name} · rung ${rung.number}`,
              detail: text || comment || "(empty rung)",
              routineId: routine.id,
            });
          }
        }
      }
    }
  }
  return hits;
}
