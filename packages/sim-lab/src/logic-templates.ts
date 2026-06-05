/**
 * ESCO-owned logic templates. Each template generates original ESCO ladder data
 * (the semantic AST from @esco/ladder) plus inspectable metadata. No vendor
 * instruction graphics, faceplates, or proprietary routines are used or cloned —
 * the templates are built from neutral boolean/math primitives and run against
 * virtual tags only.
 */

import type {
  InstructionOperand,
  LadderBranch,
  LadderNode,
  LadderRoutine,
  LadderRung,
} from "@esco/ladder";
import { nextSimId, slugTag, type SimIdCounter } from "./ids";
import type {
  SimDataType,
  SimLogicBlock,
  SimLogicMetadata,
  SimLogicTagSpec,
  SimLogicTemplateKind,
  SimTagDirection,
} from "./types";

// ---------------------------------------------------------------------------
// Template catalog (for UI palettes)
// ---------------------------------------------------------------------------

export type SimLogicParamType =
  | "bool-tag"
  | "real-tag"
  | "dint-tag"
  | "number"
  | "bool-tag-list"
  | "choice";

export interface SimLogicParamSpec {
  name: string;
  label: string;
  type: SimLogicParamType;
  required: boolean;
  default?: string;
  choices?: string[];
  help?: string;
}

export interface SimLogicTemplateInfo {
  kind: SimLogicTemplateKind;
  label: string;
  description: string;
  params: SimLogicParamSpec[];
}

export const LOGIC_TEMPLATES: readonly SimLogicTemplateInfo[] = [
  {
    kind: "debounce-input",
    label: "Debounce Input",
    description: "Holds an output true only after the input is stable for N consecutive scans.",
    params: [
      { name: "input", label: "Input tag", type: "bool-tag", required: true },
      { name: "output", label: "Debounced output tag", type: "bool-tag", required: true },
      { name: "stableScans", label: "Stable scans", type: "number", required: false, default: "3" },
    ],
  },
  {
    kind: "motor-holding-interlocks",
    label: "Motor Holding Circuit (Interlocks)",
    description: "Seal-in start/stop with permissive and interlock/trip terms.",
    params: [
      { name: "start", label: "Start tag", type: "bool-tag", required: true },
      { name: "stop", label: "Stop tag", type: "bool-tag", required: true },
      { name: "runCmd", label: "Run command tag", type: "bool-tag", required: true },
      { name: "permissives", label: "Permissive tags (comma-separated)", type: "bool-tag-list", required: false },
      { name: "trips", label: "Trip/interlock tags (comma-separated)", type: "bool-tag-list", required: false },
    ],
  },
  {
    kind: "motor-start-counter",
    label: "Motor Start Counter",
    description: "Counts rising edges of a run feedback into a DINT accumulator.",
    params: [
      { name: "run", label: "Run feedback tag", type: "bool-tag", required: true },
      { name: "starts", label: "Starts accumulator tag", type: "dint-tag", required: true },
    ],
  },
  {
    kind: "c-to-f",
    label: "Celsius to Fahrenheit",
    description: "F = C × 1.8 + 32.",
    params: [
      { name: "celsius", label: "Celsius tag", type: "real-tag", required: true },
      { name: "fahrenheit", label: "Fahrenheit tag", type: "real-tag", required: true },
    ],
  },
  {
    kind: "f-to-c",
    label: "Fahrenheit to Celsius",
    description: "C = (F − 32) ÷ 1.8.",
    params: [
      { name: "fahrenheit", label: "Fahrenheit tag", type: "real-tag", required: true },
      { name: "celsius", label: "Celsius tag", type: "real-tag", required: true },
    ],
  },
  {
    kind: "permissive-chain",
    label: "Permissive Chain",
    description: "ANDs a list of permissive tags into a single ready output.",
    params: [
      { name: "permissives", label: "Permissive tags (comma-separated)", type: "bool-tag-list", required: true },
      { name: "output", label: "Ready output tag", type: "bool-tag", required: true },
    ],
  },
  {
    kind: "alarm-trigger",
    label: "Alarm Trigger",
    description: "Drives an alarm bit from a digital input or an analog high/low limit.",
    params: [
      { name: "source", label: "Source tag", type: "real-tag", required: true },
      { name: "mode", label: "Mode", type: "choice", required: true, default: "high", choices: ["digital", "high", "low"] },
      { name: "limit", label: "Limit", type: "number", required: false, default: "0" },
      { name: "alarm", label: "Alarm output tag", type: "bool-tag", required: true },
    ],
  },
] as const;

export function logicTemplateInfo(kind: SimLogicTemplateKind): SimLogicTemplateInfo {
  return LOGIC_TEMPLATES.find((t) => t.kind === kind)!;
}

// ---------------------------------------------------------------------------
// Deterministic ladder builders
// ---------------------------------------------------------------------------

function tagOp(name: string, value: string): InstructionOperand {
  return { name, kind: "tag", value };
}

function litOp(name: string, value: string | number): InstructionOperand {
  return { name, kind: "literal", value: String(value) };
}

function mkNode(counter: SimIdCounter, type: string, operands: InstructionOperand[]): LadderNode {
  return { id: nextSimId(counter, "node"), instructionType: type, operands };
}

function mkBranch(
  counter: SimIdCounter,
  nodes: LadderNode[],
  options: { parallelBranches?: LadderBranch[]; next?: LadderBranch } = {},
): LadderBranch {
  const branch: LadderBranch = { id: nextSimId(counter, "branch"), nodes };
  if (options.parallelBranches) branch.parallelBranches = options.parallelBranches;
  if (options.next) branch.next = options.next;
  return branch;
}

function mkRung(counter: SimIdCounter, routineId: string, number: number, root: LadderBranch, comment?: string): LadderRung {
  return { id: nextSimId(counter, "rung"), routineId, number, comment, root };
}

// ---------------------------------------------------------------------------
// Parameter helpers
// ---------------------------------------------------------------------------

type Params = Record<string, string>;

function str(params: Params, name: string, fallback = ""): string {
  return (params[name] ?? fallback).trim();
}

function num(params: Params, name: string, fallback: number): number {
  const value = Number(params[name]);
  return Number.isFinite(value) ? value : fallback;
}

function list(params: Params, name: string): string[] {
  return str(params, name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface TagBag {
  specs: SimLogicTagSpec[];
  seen: Set<string>;
}

function addTag(bag: TagBag, name: string, dataType: SimDataType, role: SimTagDirection, initial: boolean | number | string, units?: string): void {
  if (!name || bag.seen.has(name)) return;
  bag.seen.add(name);
  const spec: SimLogicTagSpec = { name, dataType, role, initial };
  if (units) spec.units = units;
  bag.specs.push(spec);
}

// ---------------------------------------------------------------------------
// Block factory
// ---------------------------------------------------------------------------

interface BuiltLogic {
  rungs: LadderRung[];
  metadata: Omit<SimLogicMetadata, "templateKind">;
  requiredTags: SimLogicTagSpec[];
}

export function createLogicBlock(
  counter: SimIdCounter,
  kind: SimLogicTemplateKind,
  params: Params,
  name?: string,
): SimLogicBlock {
  const id = nextSimId(counter, "logic");
  const routineId = `lad_${id}`;
  const built = buildTemplate(counter, kind, routineId, params);
  const routine: LadderRoutine = { id: routineId, rungs: built.rungs };
  const info = logicTemplateInfo(kind);
  return {
    id,
    templateKind: kind,
    name: name?.trim() || info.label,
    description: info.description,
    params: { ...params },
    metadata: { templateKind: kind, ...built.metadata },
    routine,
    requiredTags: built.requiredTags,
  };
}

function buildTemplate(counter: SimIdCounter, kind: SimLogicTemplateKind, routineId: string, params: Params): BuiltLogic {
  const bag: TagBag = { specs: [], seen: new Set() };
  switch (kind) {
    case "debounce-input":
      return buildDebounce(counter, routineId, params, bag);
    case "motor-holding-interlocks":
      return buildMotorHolding(counter, routineId, params, bag);
    case "motor-start-counter":
      return buildStartCounter(counter, routineId, params, bag);
    case "c-to-f":
      return buildCtoF(counter, routineId, params, bag);
    case "f-to-c":
      return buildFtoC(counter, routineId, params, bag);
    case "permissive-chain":
      return buildPermissiveChain(counter, routineId, params, bag);
    case "alarm-trigger":
      return buildAlarmTrigger(counter, routineId, params, bag);
  }
}

function buildDebounce(counter: SimIdCounter, routineId: string, params: Params, bag: TagBag): BuiltLogic {
  const input = str(params, "input", "Input");
  const output = str(params, "output", "Output");
  const stable = Math.max(1, Math.round(num(params, "stableScans", 3)));
  const count = `${slugTag(output)}_Cnt`;
  addTag(bag, input, "BOOL", "input", false);
  addTag(bag, output, "BOOL", "output", false);
  addTag(bag, count, "DINT", "internal", 0);
  const rungs = [
    mkRung(counter, routineId, 0, mkBranch(counter, [
      mkNode(counter, "XIC", [tagOp("tag", input)]),
      mkNode(counter, "ADD", [tagOp("sourceA", count), litOp("sourceB", 1), tagOp("dest", count)]),
    ]), "Increment the stable-scan counter while the input is held."),
    mkRung(counter, routineId, 1, mkBranch(counter, [
      mkNode(counter, "XIO", [tagOp("tag", input)]),
      mkNode(counter, "MOV", [litOp("source", 0), tagOp("dest", count)]),
    ]), "Reset the counter whenever the input drops."),
    mkRung(counter, routineId, 2, mkBranch(counter, [
      mkNode(counter, "GEQ", [tagOp("sourceA", count), litOp("sourceB", stable)]),
      mkNode(counter, "OTE", [tagOp("tag", output)]),
    ]), "Energize the debounced output once the counter reaches the stable-scan threshold."),
  ];
  return {
    rungs,
    requiredTags: bag.specs,
    metadata: {
      title: "Debounce Input",
      summary: `Output "${output}" follows "${input}" only after ${stable} consecutive stable scans.`,
      inputs: [{ name: "Input", tag: input, role: "discrete" }],
      outputs: [{ name: "Debounced", tag: output, role: "discrete" }],
      parameters: [{ name: "stableScans", value: stable }],
      rungs: rungs.map((r) => ({ number: r.number, text: rungText(r), comment: r.comment })),
    },
  };
}

function buildMotorHolding(counter: SimIdCounter, routineId: string, params: Params, bag: TagBag): BuiltLogic {
  const start = str(params, "start", "StartPB");
  const stop = str(params, "stop", "StopPB");
  const runCmd = str(params, "runCmd", "RunCmd");
  const permissives = list(params, "permissives");
  const trips = list(params, "trips");
  addTag(bag, start, "BOOL", "input", false);
  addTag(bag, stop, "BOOL", "input", false);
  addTag(bag, runCmd, "BOOL", "output", false);
  for (const p of permissives) addTag(bag, p, "BOOL", "input", true);
  for (const t of trips) addTag(bag, t, "BOOL", "input", false);

  const sealNodes: LadderNode[] = [
    mkNode(counter, "XIO", [tagOp("tag", stop)]),
    ...permissives.map((p) => mkNode(counter, "XIC", [tagOp("tag", p)])),
    ...trips.map((t) => mkNode(counter, "XIO", [tagOp("tag", t)])),
    mkNode(counter, "OTE", [tagOp("tag", runCmd)]),
  ];
  const root = mkBranch(counter, [mkNode(counter, "XIC", [tagOp("tag", start)])], {
    parallelBranches: [mkBranch(counter, [mkNode(counter, "XIC", [tagOp("tag", runCmd)])])],
    next: mkBranch(counter, sealNodes),
  });
  const rungs = [mkRung(counter, routineId, 0, root, "Seal-in start/stop with permissive and interlock terms.")];
  return {
    rungs,
    requiredTags: bag.specs,
    metadata: {
      title: "Motor Holding Circuit (Interlocks)",
      summary: `"${runCmd}" seals in on "${start}", drops on "${stop}"${permissives.length ? `, requires permissives ${permissives.join(", ")}` : ""}${trips.length ? `, trips on ${trips.join(", ")}` : ""}.`,
      inputs: [
        { name: "Start", tag: start, role: "discrete" },
        { name: "Stop", tag: stop, role: "discrete" },
        ...permissives.map((p) => ({ name: "Permissive", tag: p, role: "permissive" })),
        ...trips.map((t) => ({ name: "Trip", tag: t, role: "interlock" })),
      ],
      outputs: [{ name: "Run", tag: runCmd, role: "discrete" }],
      parameters: [
        { name: "permissives", value: permissives.join(", ") || "(none)" },
        { name: "trips", value: trips.join(", ") || "(none)" },
      ],
      rungs: rungs.map((r) => ({ number: r.number, text: rungText(r), comment: r.comment })),
    },
  };
}

function buildStartCounter(counter: SimIdCounter, routineId: string, params: Params, bag: TagBag): BuiltLogic {
  const run = str(params, "run", "Run");
  const starts = str(params, "starts", "Starts");
  const oneShot = `${slugTag(starts)}_OS`;
  addTag(bag, run, "BOOL", "input", false);
  addTag(bag, starts, "DINT", "output", 0);
  addTag(bag, oneShot, "BOOL", "internal", false);
  const rungs = [
    mkRung(counter, routineId, 0, mkBranch(counter, [
      mkNode(counter, "XIC", [tagOp("tag", run)]),
      mkNode(counter, "ONS", [tagOp("storage", oneShot)]),
      mkNode(counter, "ADD", [tagOp("sourceA", starts), litOp("sourceB", 1), tagOp("dest", starts)]),
    ]), "Increment the start accumulator on each rising edge of the run feedback."),
  ];
  return {
    rungs,
    requiredTags: bag.specs,
    metadata: {
      title: "Motor Start Counter",
      summary: `Each false→true edge of "${run}" increments "${starts}".`,
      inputs: [{ name: "Run", tag: run, role: "discrete" }],
      outputs: [{ name: "Starts", tag: starts, role: "count" }],
      parameters: [],
      rungs: rungs.map((r) => ({ number: r.number, text: rungText(r), comment: r.comment })),
    },
  };
}

function buildCtoF(counter: SimIdCounter, routineId: string, params: Params, bag: TagBag): BuiltLogic {
  const celsius = str(params, "celsius", "TempC");
  const fahrenheit = str(params, "fahrenheit", "TempF");
  const tmp = `${slugTag(fahrenheit)}_T`;
  addTag(bag, celsius, "REAL", "input", 0, "degC");
  addTag(bag, fahrenheit, "REAL", "output", 32, "degF");
  addTag(bag, tmp, "REAL", "internal", 0);
  const rungs = [
    mkRung(counter, routineId, 0, mkBranch(counter, [
      mkNode(counter, "MUL", [tagOp("sourceA", celsius), litOp("sourceB", 1.8), tagOp("dest", tmp)]),
    ]), "Scale Celsius by 1.8."),
    mkRung(counter, routineId, 1, mkBranch(counter, [
      mkNode(counter, "ADD", [tagOp("sourceA", tmp), litOp("sourceB", 32), tagOp("dest", fahrenheit)]),
    ]), "Add the 32-degree offset to produce Fahrenheit."),
  ];
  return {
    rungs,
    requiredTags: bag.specs,
    metadata: {
      title: "Celsius to Fahrenheit",
      summary: `"${fahrenheit}" = "${celsius}" × 1.8 + 32.`,
      inputs: [{ name: "Celsius", tag: celsius, role: "analog" }],
      outputs: [{ name: "Fahrenheit", tag: fahrenheit, role: "analog" }],
      parameters: [],
      rungs: rungs.map((r) => ({ number: r.number, text: rungText(r), comment: r.comment })),
    },
  };
}

function buildFtoC(counter: SimIdCounter, routineId: string, params: Params, bag: TagBag): BuiltLogic {
  const fahrenheit = str(params, "fahrenheit", "TempF");
  const celsius = str(params, "celsius", "TempC");
  const tmp = `${slugTag(celsius)}_T`;
  addTag(bag, fahrenheit, "REAL", "input", 32, "degF");
  addTag(bag, celsius, "REAL", "output", 0, "degC");
  addTag(bag, tmp, "REAL", "internal", 0);
  const rungs = [
    mkRung(counter, routineId, 0, mkBranch(counter, [
      mkNode(counter, "SUB", [tagOp("sourceA", fahrenheit), litOp("sourceB", 32), tagOp("dest", tmp)]),
    ]), "Subtract the 32-degree offset."),
    mkRung(counter, routineId, 1, mkBranch(counter, [
      mkNode(counter, "DIV", [tagOp("sourceA", tmp), litOp("sourceB", 1.8), tagOp("dest", celsius)]),
    ]), "Divide by 1.8 to produce Celsius."),
  ];
  return {
    rungs,
    requiredTags: bag.specs,
    metadata: {
      title: "Fahrenheit to Celsius",
      summary: `"${celsius}" = ("${fahrenheit}" − 32) ÷ 1.8.`,
      inputs: [{ name: "Fahrenheit", tag: fahrenheit, role: "analog" }],
      outputs: [{ name: "Celsius", tag: celsius, role: "analog" }],
      parameters: [],
      rungs: rungs.map((r) => ({ number: r.number, text: rungText(r), comment: r.comment })),
    },
  };
}

function buildPermissiveChain(counter: SimIdCounter, routineId: string, params: Params, bag: TagBag): BuiltLogic {
  const permissives = list(params, "permissives");
  const output = str(params, "output", "Ready");
  const terms = permissives.length ? permissives : ["Permissive1"];
  for (const p of terms) addTag(bag, p, "BOOL", "input", true);
  addTag(bag, output, "BOOL", "output", false);
  const nodes = [
    ...terms.map((p) => mkNode(counter, "XIC", [tagOp("tag", p)])),
    mkNode(counter, "OTE", [tagOp("tag", output)]),
  ];
  const rungs = [mkRung(counter, routineId, 0, mkBranch(counter, nodes), "All permissives must be true to set the ready output.")];
  return {
    rungs,
    requiredTags: bag.specs,
    metadata: {
      title: "Permissive Chain",
      summary: `"${output}" is true only when all of ${terms.join(", ")} are true.`,
      inputs: terms.map((p) => ({ name: "Permissive", tag: p, role: "permissive" })),
      outputs: [{ name: "Ready", tag: output, role: "discrete" }],
      parameters: [{ name: "count", value: terms.length }],
      rungs: rungs.map((r) => ({ number: r.number, text: rungText(r), comment: r.comment })),
    },
  };
}

function buildAlarmTrigger(counter: SimIdCounter, routineId: string, params: Params, bag: TagBag): BuiltLogic {
  const source = str(params, "source", "PV");
  const mode = str(params, "mode", "high");
  const limit = num(params, "limit", 0);
  const alarm = str(params, "alarm", "Alarm");
  addTag(bag, alarm, "BOOL", "output", false);
  let inputNode: LadderNode;
  let summary: string;
  if (mode === "digital") {
    addTag(bag, source, "BOOL", "input", false);
    inputNode = mkNode(counter, "XIC", [tagOp("tag", source)]);
    summary = `"${alarm}" follows the digital state of "${source}".`;
  } else if (mode === "low") {
    addTag(bag, source, "REAL", "input", 0);
    inputNode = mkNode(counter, "LES", [tagOp("sourceA", source), litOp("sourceB", limit)]);
    summary = `"${alarm}" sets when "${source}" < ${limit}.`;
  } else {
    addTag(bag, source, "REAL", "input", 0);
    inputNode = mkNode(counter, "GRT", [tagOp("sourceA", source), litOp("sourceB", limit)]);
    summary = `"${alarm}" sets when "${source}" > ${limit}.`;
  }
  const rungs = [
    mkRung(counter, routineId, 0, mkBranch(counter, [inputNode, mkNode(counter, "OTE", [tagOp("tag", alarm)])]),
      "Drive the alarm bit from the configured condition."),
  ];
  return {
    rungs,
    requiredTags: bag.specs,
    metadata: {
      title: "Alarm Trigger",
      summary,
      inputs: [{ name: "Source", tag: source, role: mode === "digital" ? "discrete" : "analog" }],
      outputs: [{ name: "Alarm", tag: alarm, role: "alarm" }],
      parameters: [
        { name: "mode", value: mode },
        { name: "limit", value: limit },
      ],
      rungs: rungs.map((r) => ({ number: r.number, text: rungText(r), comment: r.comment })),
    },
  };
}

// ---------------------------------------------------------------------------
// Neutral rung text (ESCO-owned, plain text — not vendor instruction graphics)
// ---------------------------------------------------------------------------

function nodeText(node: LadderNode): string {
  const ops = node.operands.map((o) => o.value).join(", ");
  return `${node.instructionType}(${ops})`;
}

function branchText(branch: LadderBranch): string {
  const series = branch.nodes.map(nodeText);
  let text = series.join(" ");
  if (branch.parallelBranches?.length) {
    const parallels = [text, ...branch.parallelBranches.map(branchText)].filter(Boolean);
    text = `[ ${parallels.join(" | ")} ]`;
  }
  if (branch.next) {
    text = `${text} ${branchText(branch.next)}`.trim();
  }
  return text.trim();
}

/** Plain-language rung representation for inspection/reports. */
export function rungText(rung: LadderRung): string {
  return branchText(rung.root);
}
