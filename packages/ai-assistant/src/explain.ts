import { rungNodes, type LadderRung } from "@esco/ladder";
import { getAllTags, validate } from "@esco/project-actions";
import { getHmiProject, validateHmiProject, type HmiProject, type HmiSurfaceBase } from "@esco/hmi-model";
import { describeNode, distinct, readsAndWrites, registry, resolveRoutine } from "./context";
import type { AssistantInput } from "./types";

const TIMER_TYPES = new Set(["TON"]);
const COUNTER_TYPES = new Set(["CTU"]);

function pickRung(rungs: LadderRung[], rungId?: string): LadderRung | undefined {
  if (rungId) return rungs.find((rung) => rung.id === rungId) ?? rungs[0];
  return rungs[0];
}

function knownTagPaths(input: AssistantInput): string[] {
  return getAllTags(input.project).map((tag) => tag.name);
}

function hmiSurfaces(hmi: HmiProject): HmiSurfaceBase[] {
  return [...hmi.screens, ...hmi.popups, hmi.systemBanner];
}

/** Explain a single rung: instructions, tags read/written, timers/counters, behaviour. */
export function explainRung(input: AssistantInput): string {
  const { routine, ladder } = resolveRoutine(input.project, input.selection);
  if (!routine || !ladder || ladder.rungs.length === 0) {
    return "There is no rung to explain. Open a routine that has at least one rung.";
  }
  const rung = pickRung(ladder.rungs, input.selection?.rungId);
  if (!rung) return "There is no rung to explain.";

  const nodes = rungNodes(rung);
  const reads: string[] = [];
  const writes: string[] = [];
  const timers: string[] = [];
  const counters: string[] = [];
  const unsupported: string[] = [];

  const lines = [`Rung ${rung.number}${rung.comment ? ` — ${rung.comment}` : ""} in routine "${routine.name}":`];
  if (rung.sourceText) lines.push(`Source: ${rung.sourceText}`);
  lines.push("");
  for (const node of nodes) {
    lines.push(`  • ${describeNode(node)}`);
    const rw = readsAndWrites(node);
    reads.push(...rw.reads);
    writes.push(...rw.writes);
    if (!registry.get(node.instructionType)) unsupported.push(node.instructionType);
    if (TIMER_TYPES.has(node.instructionType)) timers.push(node.operands[0]?.value ?? "?");
    if (COUNTER_TYPES.has(node.instructionType)) counters.push(node.operands[0]?.value ?? "?");
  }

  lines.push("");
  lines.push(`Tags read: ${distinct(reads).join(", ") || "(none)"}`);
  lines.push(`Tags written: ${distinct(writes).join(", ") || "(none)"}`);
  if (timers.length) lines.push(`Timers: ${distinct(timers).join(", ")}`);
  if (counters.length) lines.push(`Counters: ${distinct(counters).join(", ")}`);
  if (unsupported.length) lines.push(`Unsupported instructions: ${distinct(unsupported).join(", ")}`);

  const outs = distinct(writes);
  if (outs.length) {
    lines.push("");
    lines.push(`Behaviour: ${outs.join(", ")} ${outs.length === 1 ? "is" : "are"} driven by the rung conditions above.`);
  }
  return lines.join("\n");
}

/** Summarize a whole routine: rungs, tags, outputs, timers/counters, findings. */
export function explainRoutine(input: AssistantInput): string {
  const { routine, ladder } = resolveRoutine(input.project, input.selection);
  if (!routine) return "No routine is selected. Open MainRoutine (or another routine) first.";
  if (!ladder || ladder.rungs.length === 0) {
    return `Routine "${routine.name}" has no rungs yet.`;
  }

  const reads: string[] = [];
  const writes: string[] = [];
  const timers: string[] = [];
  const counters: string[] = [];
  const unsupported: string[] = [];
  for (const rung of ladder.rungs) {
    for (const node of rungNodes(rung)) {
      const rw = readsAndWrites(node);
      reads.push(...rw.reads);
      writes.push(...rw.writes);
      if (!registry.get(node.instructionType)) unsupported.push(node.instructionType);
      if (TIMER_TYPES.has(node.instructionType)) timers.push(node.operands[0]?.value ?? "?");
      if (COUNTER_TYPES.has(node.instructionType)) counters.push(node.operands[0]?.value ?? "?");
    }
  }

  const findings = validate(input.project);
  const lines = [
    `Routine "${routine.name}" — ${ladder.rungs.length} rung(s).`,
    `Tags read: ${distinct(reads).join(", ") || "(none)"}`,
    `Outputs written: ${distinct(writes).join(", ") || "(none)"}`,
  ];
  if (timers.length) lines.push(`Timers: ${distinct(timers).join(", ")}`);
  if (counters.length) lines.push(`Counters: ${distinct(counters).join(", ")}`);
  if (unsupported.length) lines.push(`Unsupported instructions: ${distinct(unsupported).join(", ")}`);
  lines.push(
    findings.length
      ? `Validation: ${findings.length} finding(s) — ask me to "explain validation errors".`
      : "Validation: clean.",
  );
  return lines.join("\n");
}

/** Summarize validation findings grouped by severity, with safe fix suggestions. */
export function explainValidation(input: AssistantInput): string {
  const findings = validate(input.project);
  if (findings.length === 0) return "Validation is clean — no findings.";

  const bySeverity = { error: [] as string[], warning: [] as string[], info: [] as string[] };
  for (const finding of findings) {
    (bySeverity[finding.severity] ?? bySeverity.info).push(
      `${finding.message}${finding.target ? ` (${finding.target})` : ""}`,
    );
  }

  const lines = [`Validation has ${findings.length} finding(s):`];
  for (const severity of ["error", "warning", "info"] as const) {
    const items = bySeverity[severity];
    if (items.length === 0) continue;
    lines.push("", `${severity.toUpperCase()} (${items.length}):`);
    for (const item of items) lines.push(`  • ${item}`);
  }
  lines.push("");
  lines.push(
    'Suggested fix: undefined tags can be created with "fix undefined tags" (preview first). Review all suggestions before applying.',
  );
  return lines.join("\n");
}

/** Summarize HMI tag bindings and the related validation state. */
export function explainHmiBindings(input: AssistantInput): string {
  const hmi = getHmiProject(input.project);
  if (!hmi) return "No HMI project is configured yet. Ask me to create an HMI screen to start one.";

  const bindings = hmiSurfaces(hmi).flatMap((surface) =>
    surface.elements.flatMap((element) =>
      element.bindings.map((binding) => ({
        surface,
        element,
        binding,
      })),
    ),
  );

  const findings = validateHmiProject(hmi, { knownTagPaths: knownTagPaths(input) });
  const bindingFindings = findings.filter((finding) => finding.ruleId.includes("hmi-binding"));
  const lines = [
    `HMI "${hmi.name}" — ${hmi.screens.length} screen(s), ${hmi.popups.length} popup(s).`,
    bindings.length ? `Bindings (${bindings.length}):` : "No HMI element bindings are configured yet.",
  ];

  for (const { surface, element, binding } of bindings) {
    lines.push(
      `  • ${surface.name}/${element.name}: ${binding.targetProperty} <- ${binding.source.path || "(blank)"} (${binding.mode})`,
    );
  }

  lines.push("");
  if (bindingFindings.length) {
    lines.push(`Binding validation findings (${bindingFindings.length}):`);
    for (const finding of bindingFindings) {
      lines.push(`  • [${finding.severity}] ${finding.message}${finding.target ? ` (${finding.target})` : ""}`);
    }
  } else {
    lines.push("Binding validation: clean.");
  }
  return lines.join("\n");
}

/** Summarize HMI validation findings only. */
export function explainHmiValidation(input: AssistantInput): string {
  const hmi = getHmiProject(input.project);
  const findings = validateHmiProject(hmi, { knownTagPaths: knownTagPaths(input) });
  if (findings.length === 0) return "HMI validation is clean — no findings.";

  const lines = [`HMI validation has ${findings.length} finding(s):`];
  for (const finding of findings) {
    lines.push(`  • [${finding.severity}] ${finding.message}${finding.target ? ` (${finding.target})` : ""}`);
  }
  lines.push("");
  lines.push("Suggested fix: bind only known project tags and use reviewed HMI actions for screens, registered elements, and navigation events.");
  return lines.join("\n");
}
