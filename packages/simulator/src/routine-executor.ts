import { parseJsrParameterLayout, parseNumericLiteral, type InstructionRegistry } from "@esco/instructions";
import type { AddOnInstruction, Routine } from "@esco/core";
import { rungNodes, type LadderRoutine, type LadderRung } from "@esco/ladder";
import { RungExecutor, type ExecControl, type TraceEntry } from "./rung-executor";
import type { PlcValue, TagMemory } from "./tag-memory";

/** Maximum JSR call depth — guards against infinite/recursive routine calls. */
const MAX_CALL_DEPTH = 32;
/** Maximum taken JMP instructions in one routine scan — guards imported loops. */
const MAX_JUMPS_PER_SCAN = 1024;
/** Maximum FOR loop iterations in one instruction execution. */
const MAX_FOR_ITERATIONS = 1024;

export interface FlowStatus {
  returned: boolean;
  returnParameters: string[];
  breakRequested: boolean;
}

/**
 * Executes a ladder routine in rung-number order (top to bottom), the order
 * Logix scans a routine. Sibling routines (by name) can be registered so a JSR
 * runs them against the same tag memory; a call-depth limit prevents runaway
 * recursion, and RET ends the current routine's scan early.
 */
export class RoutineExecutor {
  private readonly rungExecutor: RungExecutor;
  private routines = new Map<string, LadderRoutine>();
  private addOnInstructions = new Map<string, AddOnInstruction>();
  private depth = 0;
  private trace?: TraceEntry[];

  constructor(registry: InstructionRegistry) {
    this.rungExecutor = new RungExecutor(registry);
  }

  /** Register the program's routines by name so JSR can resolve subroutines. */
  setRoutines(routines: Map<string, LadderRoutine>): void {
    this.routines = routines;
  }

  /** Register Add-On Instructions so project-defined AOI calls can run their imported RLL logic. */
  setAddOnInstructions(aois: AddOnInstruction[]): void {
    this.addOnInstructions = new Map(aois.map((aoi) => [aoi.name.toUpperCase(), aoi]));
  }

  /** Execute the routine; pass a `trace` array to record per-instruction evaluation. */
  execute(
    routine: LadderRoutine,
    memory: TagMemory,
    deltaMs = 0,
    trace?: TraceEntry[],
    arrayDimension?: (source: string, dimension: number) => number | undefined,
  ): void {
    this.depth = 0;
    this.trace = trace;
    try {
      this.runRoutine(routine, memory, deltaMs, arrayDimension);
    } finally {
      this.trace = undefined;
    }
  }

  /** Run a named sibling routine (JSR), respecting the call-depth limit. */
  callRoutine(
    name: string,
    memory: TagMemory,
    deltaMs: number,
    rawParameters: string[] = [],
    trace?: TraceEntry[],
    arrayDimension?: (source: string, dimension: number) => number | undefined,
  ): FlowStatus {
    const previousTrace = this.trace;
    this.trace = trace;
    try {
      return this.callRoutineInternal(name, memory, deltaMs, rawParameters, arrayDimension);
    } finally {
      this.trace = previousTrace;
    }
  }

  private callRoutineInternal(
    name: string,
    memory: TagMemory,
    deltaMs: number,
    rawParameters: string[] = [],
    arrayDimension?: (source: string, dimension: number) => number | undefined,
    routines: Map<string, LadderRoutine> = this.routines,
  ): FlowStatus {
    const target = routines.get(name);
    if (!target || this.depth >= MAX_CALL_DEPTH) return emptyFlowStatus();
    const sbrParameters = firstInstructionOperands(target, "SBR");
    const layout = parseJsrParameterLayout(rawParameters, sbrParameters.length);
    copyInputs(memory, layout.inputParameters, sbrParameters);
    this.depth += 1;
    try {
      const status = this.runRoutine(target, memory, deltaMs, arrayDimension, routines);
      copyReturns(memory, status.returnParameters, layout.returnParameters);
      return status;
    } finally {
      this.depth -= 1;
    }
  }

  private runForRoutine(
    name: string,
    memory: TagMemory,
    deltaMs: number,
    indexPath: string,
    initial: number,
    terminal: number,
    step: number,
    arrayDimension?: (source: string, dimension: number) => number | undefined,
    routines: Map<string, LadderRoutine> = this.routines,
  ): void {
    if (!indexPath || step === 0 || !Number.isFinite(step)) return;
    const target = routines.get(name);
    if (!target || this.depth >= MAX_CALL_DEPTH) return;

    const forward = step > 0;
    let index = initial;
    let iterations = 0;
    while (
      Number.isFinite(index) &&
      iterations < MAX_FOR_ITERATIONS &&
      (forward ? index <= terminal : index >= terminal)
    ) {
      memory.write(indexPath, index);
      this.depth += 1;
      let status: FlowStatus;
      try {
        status = this.runRoutine(target, memory, deltaMs, arrayDimension, routines);
      } finally {
        this.depth -= 1;
      }
      if (status.breakRequested) break;
      iterations += 1;
      index += step;
    }
  }

  private runRoutine(
    routine: LadderRoutine,
    memory: TagMemory,
    deltaMs: number,
    arrayDimension?: (source: string, dimension: number) => number | undefined,
    routines: Map<string, LadderRoutine> = this.routines,
  ): FlowStatus {
    const rungs = [...routine.rungs].sort((a, b) => a.number - b.number);
    const labels = labelTargets(rungs);
    const control: ExecControl = {
      callRoutine: (name, parameters) => this.callRoutineInternal(name, memory, deltaMs, parameters, arrayDimension, routines),
      callAoi: (instructionType, operands) =>
        this.callAddOnInstruction(instructionType, operands, memory, deltaMs, arrayDimension),
      runForRoutine: (name, index, initial, terminal, step) =>
        this.runForRoutine(name, memory, deltaMs, index, initial, terminal, step, arrayDimension, routines),
      arrayDimension,
      returned: false,
      returnParameters: [],
      breakRequested: false,
      rungNumber: 0,
      trace: this.trace,
      mcrActive: false,
      mcrEnabled: true,
    };

    let index = 0;
    let jumps = 0;
    while (index < rungs.length) {
      const rung = rungs[index]!;
      control.rungNumber = rung.number;
      control.jumpToLabel = undefined;
      this.rungExecutor.execute(rung, memory, deltaMs, control);
      if (control.returned) break; // RET ends this routine's scan
      if (control.breakRequested) break; // BRK exits the active FOR routine

      if (control.jumpToLabel) {
        const target = labels.get(control.jumpToLabel);
        if (target !== undefined) {
          jumps += 1;
          if (jumps > MAX_JUMPS_PER_SCAN) break;
          index = target;
          continue;
        }
      }

      index += 1;
    }
    return {
      returned: control.returned,
      returnParameters: control.returnParameters ?? [],
      breakRequested: control.breakRequested,
    };
  }

  private callAddOnInstruction(
    instructionType: string,
    operands: string[],
    memory: TagMemory,
    deltaMs: number,
    arrayDimension?: (source: string, dimension: number) => number | undefined,
  ): boolean {
    const aoi = this.addOnInstructions.get(instructionType.toUpperCase());
    const instance = operands[0]?.trim();
    if (!aoi || aoi.protected || !instance || this.depth >= MAX_CALL_DEPTH) return !!aoi;
    const routines = aoiRoutineMap(aoi.routines);
    const target = selectAoiLogicRoutine(routines);
    if (!target) return true;

    for (const parameter of aoi.parameters) {
      copyParameter(memory, `${instance}.${parameter.name}`, parameter.name);
    }
    for (const localTag of aoi.localTags) {
      copyParameter(memory, `${instance}.${localTag.name}`, localTag.name);
    }

    this.depth += 1;
    try {
      this.runRoutine(target, memory, deltaMs, arrayDimension, routines);
    } finally {
      this.depth -= 1;
    }

    for (const parameter of aoi.parameters) {
      const usage = (parameter.usage ?? "").toLowerCase();
      if (usage === "output" || usage === "inout") {
        copyParameter(memory, parameter.name, `${instance}.${parameter.name}`);
      }
    }
    for (const localTag of aoi.localTags) {
      copyParameter(memory, localTag.name, `${instance}.${localTag.name}`);
    }
    return true;
  }
}

function emptyFlowStatus(): FlowStatus {
  return { returned: false, returnParameters: [], breakRequested: false };
}

function labelTargets(rungs: LadderRung[]): Map<string, number> {
  const labels = new Map<string, number>();
  rungs.forEach((rung, index) => {
    for (const node of rungNodes(rung)) {
      if (node.instructionType !== "LBL") continue;
      const label = node.operands[0]?.value?.trim();
      if (label && !labels.has(label)) labels.set(label, index);
    }
  });
  return labels;
}

function firstInstructionOperands(routine: LadderRoutine, instructionType: string): string[] {
  const rungs = [...routine.rungs].sort((a, b) => a.number - b.number);
  for (const rung of rungs) {
    const node = rungNodes(rung).find((candidate) => candidate.instructionType === instructionType);
    if (node) return node.operands.map((operand) => operand.value.trim());
  }
  return [];
}

/**
 * An AOI's executable body is its routine named "Logic" — the scan routine that
 * runs every scan. Prescan, Postscan, and EnableInFalseRoutine are scan-phase
 * helpers the offline engine never executes, so they must not be mistaken for
 * the main body. Studio names the scan routine "Logic" regardless of the order
 * routines appear in the L5X, so select it by name and fall back to the first
 * ladder routine only when an AOI has no routine called "Logic".
 */
function selectAoiLogicRoutine(
  routines: Map<string, LadderRoutine>,
): LadderRoutine | undefined {
  for (const [name, routine] of routines) {
    if (name.toLowerCase() === "logic") return routine;
  }
  return routines.values().next().value as LadderRoutine | undefined;
}

function aoiRoutineMap(routines: Routine[] | undefined): Map<string, LadderRoutine> {
  const map = new Map<string, LadderRoutine>();
  for (const routine of routines ?? []) {
    const ladder = asLadderRoutine(routine.ladder);
    if (ladder) map.set(routine.name, ladder);
  }
  return map;
}

function asLadderRoutine(ladder: unknown): LadderRoutine | undefined {
  if (ladder && typeof ladder === "object" && Array.isArray((ladder as { rungs?: unknown }).rungs)) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

function copyInputs(memory: TagMemory, sources: string[], destinations: string[]): void {
  destinations.forEach((destination, index) => {
    const source = sources[index];
    if (source) copyParameter(memory, source, destination);
  });
}

function copyReturns(memory: TagMemory, sources: string[], destinations: string[]): void {
  destinations.forEach((destination, index) => {
    const source = sources[index];
    if (source) copyParameter(memory, source, destination);
  });
}

function copyParameter(memory: TagMemory, source: string, destination: string): void {
  const target = destination.trim();
  if (!target || literalValue(target) !== undefined) return;
  const value = literalValue(source);
  if (value !== undefined) {
    memory.write(target, value);
    return;
  }

  const snapshot = memory.snapshot();
  let copied = false;
  for (const [path, current] of Object.entries(snapshot)) {
    const suffix = parameterSuffix(path, source);
    if (suffix === undefined) continue;
    memory.write(`${target}${suffix}`, current);
    copied = true;
  }
  if (!copied) memory.write(target, memory.read(source.trim()));
}

function parameterSuffix(path: string, source: string): string | undefined {
  const base = source.trim();
  if (!base) return undefined;
  if (path === base) return "";
  if (path.startsWith(`${base}.`) || path.startsWith(`${base}[`)) return path.slice(base.length);
  return undefined;
}

function literalValue(operand: string): PlcValue | undefined {
  const text = operand.trim();
  const numeric = parseNumericLiteral(text);
  if (numeric !== undefined) return numeric;
  if (/^true$/i.test(text)) return true;
  if (/^false$/i.test(text)) return false;
  const quoted = text.match(/^"(.*)"$/) ?? text.match(/^'(.*)'$/);
  if (quoted) return quoted[1] ?? "";
  return undefined;
}
