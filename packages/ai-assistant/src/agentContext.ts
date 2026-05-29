import type { PlcProject } from "@esco/core";
import { getHmiProject, validateHmiProject } from "@esco/hmi-model";
import { findRoutine, getAllTags, getLadder, validate } from "@esco/project-actions";
import { rungNodes } from "@esco/ladder";
import { LARGE_PROJECT_RUNG_THRESHOLD } from "./agentConfig";
import type { AssistantSelection } from "./types";

function totalRungs(project: PlcProject): number {
  let n = 0;
  for (const c of project.controllers)
    for (const p of c.programs) for (const r of p.routines) n += getLadder(r)?.rungs.length ?? 0;
  return n;
}

export interface AgentContextResult {
  /** Compact context header prepended to the user's prompt. */
  text: string;
  /** True when the project was large enough that only a summary is inlined. */
  summarized: boolean;
}

/**
 * Build a compact context packet for the live agent. Deliberately small: it
 * inlines a summary + the selected routine (when small), and relies on the
 * read tools for any deeper detail, so we never ship the whole project by
 * default. Large projects are summarized (size guard).
 */
export function buildAgentContext(
  project: PlcProject,
  selection?: AssistantSelection,
): AgentContextResult {
  const rungs = totalRungs(project);
  const large = rungs > LARGE_PROJECT_RUNG_THRESHOLD;

  const programCount = project.controllers.reduce((n, c) => n + c.programs.length, 0);
  const routineCount = project.controllers.reduce(
    (n, c) => n + c.programs.reduce((m, p) => m + p.routines.length, 0),
    0,
  );
  const findings = validate(project);
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const hmi = getHmiProject(project);
  const hmiFindings = validateHmiProject(hmi, { knownTagPaths: getAllTags(project).map((tag) => tag.name) });
  const hmiErrorCount = hmiFindings.filter((finding) => finding.severity === "error").length;

  const lines = [
    `Project "${project.name}": ${programCount} program(s), ${routineCount} routine(s), ${rungs} rung(s).`,
    `Validation: ${findings.length} finding(s)${errorCount ? `, ${errorCount} error(s)` : ""}.`,
    hmi
      ? `HMI "${hmi.name}": ${hmi.screens.length} screen(s), ${hmi.popups.length} popup(s), ${hmiFindings.length} HMI finding(s)${hmiErrorCount ? `, ${hmiErrorCount} error(s)` : ""}.`
      : "HMI: not configured.",
  ];

  const routine = selection?.routineId ? findRoutine(project, selection.routineId) : undefined;
  if (routine) {
    const ladder = getLadder(routine);
    lines.push(`Selected routine: ${routine.name} [${routine.id}] — ${ladder?.rungs.length ?? 0} rung(s).`);
    if (ladder && !large && ladder.rungs.length <= 40) {
      for (const rung of [...ladder.rungs].sort((a, b) => a.number - b.number)) {
        const body = rungNodes(rung)
          .map((n) => `${n.instructionType}(${n.operands.map((o) => o.value).join(",")})`)
          .join("");
        lines.push(`  rung ${rung.number} [${rung.id}]: ${body || "(empty)"}`);
      }
    }
  }

  if (large) {
    lines.push(
      "(Large project — only a summary is inlined. Use the read tools, especially get_routine, to inspect what you need.)",
    );
  } else {
    lines.push("(Use the read tools — get_project_overview, list_routines, get_routine, list_tags, get_validation_findings — to inspect further.)");
  }

  return { text: lines.join("\n"), summarized: large };
}
