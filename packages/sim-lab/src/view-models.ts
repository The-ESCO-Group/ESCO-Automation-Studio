/**
 * Pure, engine-driven view-models for the onsite-grade Simulation Lab screens.
 *
 * Every selector here is a pure function of the ESCO-native project plus the
 * live engine snapshot (tags, alarms, timeline, events, historian). Screens read
 * these — they never invent UI-only state — so the process mimic, I/O cabinet,
 * device detail, P&ID, logic debug, alarm console, historian, and reports all
 * reflect the real offline simulation.
 */

import type { PlcValue } from "@esco/simulator";
import { deviceBlueprint, TAG } from "./catalog";
import { deviceStatusTag, devicePvSuffix } from "./devices";
import { deviceFaults, FAULT_INFO } from "./fault-injection";
import { collectAllTags, euToRaw } from "./tags";
import type {
  SimAlarmRecord,
  SimDevice,
  SimDeviceKind,
  SimEvidenceEntry,
  SimFaultKind,
  SimHistorianSeries,
  SimInterlock,
  SimLiveTag,
  SimProject,
  SimTimelineFrame,
  SimVirtualTag,
} from "./types";

// ---------------------------------------------------------------------------
// Snapshot + tag helpers
// ---------------------------------------------------------------------------

/** The live engine snapshot the screens render from. */
export interface SimViewSource {
  project: SimProject;
  liveTags: SimLiveTag[];
  alarms: SimAlarmRecord[];
  timeline: SimTimelineFrame[];
  events: SimEvidenceEntry[];
  historian: SimHistorianSeries[];
  scan: number;
  timeMs: number;
}

export type SimVisualTone = "good" | "idle" | "warning" | "fault" | "disabled";

export function buildTagMap(liveTags: SimLiveTag[]): Map<string, SimLiveTag> {
  return new Map(liveTags.map((t) => [t.name, t]));
}

function bool(tags: Map<string, SimLiveTag>, name: string): boolean {
  const v = tags.get(name)?.value;
  return typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : v === "true";
}
function num(tags: Map<string, SimLiveTag>, name: string): number {
  const v = tags.get(name)?.value;
  return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : Number(v) || 0;
}

function deviceLabel(kind: SimDeviceKind): string {
  return deviceBlueprint(kind).label;
}

/** Deterministic, offline-synthetic seed from a string (for baselines). */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Device → visual state (the core tested mapping)
// ---------------------------------------------------------------------------

export type SimVisualState =
  | "running"
  | "starting"
  | "stopped"
  | "tripped"
  | "open"
  | "closed"
  | "traveling"
  | "normal"
  | "high"
  | "low"
  | "comm-fail"
  | "healthy"
  | "faulted";

export interface DeviceVisual {
  deviceId: string;
  tag: string;
  name: string;
  kind: SimDeviceKind;
  state: SimVisualState;
  tone: SimVisualTone;
  label: string;
  running: boolean;
  faulted: boolean;
  /** Primary process value (current, speed, position, PV, or status). */
  value: number | boolean | null;
  units?: string;
}

export function deviceVisualState(device: SimDevice, tags: Map<string, SimLiveTag>): DeviceVisual {
  const t = device.tag;
  const base = { deviceId: device.id, tag: t, name: device.name, kind: device.kind };
  switch (device.kind) {
    case "motor":
    case "vfd": {
      const faultBit = device.kind === "motor" ? bool(tags, `${t}_${TAG.overload}`) : bool(tags, `${t}_${TAG.fault}`);
      const run = bool(tags, `${t}_${TAG.run}`);
      const cmd = bool(tags, `${t}_${TAG.runCmd}`);
      const value = device.kind === "vfd" ? num(tags, `${t}_${TAG.speedFb}`) : num(tags, `${t}_${TAG.current}`);
      const units = device.kind === "vfd" ? "%" : "A";
      if (faultBit) return { ...base, state: "tripped", tone: "fault", label: "Tripped", running: false, faulted: true, value, units };
      if (run) return { ...base, state: "running", tone: "good", label: "Running", running: true, faulted: false, value, units };
      if (cmd && !run) return { ...base, state: "starting", tone: "warning", label: "Starting", running: false, faulted: false, value, units };
      return { ...base, state: "stopped", tone: "idle", label: "Stopped", running: false, faulted: false, value, units };
    }
    case "valve": {
      const pos = num(tags, `${t}_${TAG.position}`);
      const faultBit = bool(tags, `${t}_${TAG.fault}`);
      if (faultBit) return { ...base, state: "faulted", tone: "fault", label: "Travel fault", running: false, faulted: true, value: pos, units: "%" };
      if (pos >= 99) return { ...base, state: "open", tone: "good", label: "Open", running: true, faulted: false, value: pos, units: "%" };
      if (pos <= 1) return { ...base, state: "closed", tone: "idle", label: "Closed", running: false, faulted: false, value: pos, units: "%" };
      return { ...base, state: "traveling", tone: "warning", label: "Traveling", running: false, faulted: false, value: pos, units: "%" };
    }
    case "flow-meter":
    case "level-transmitter":
    case "temperature-sensor": {
      const pvSuffix = devicePvSuffix(device.kind)!;
      const pv = num(tags, `${t}_${pvSuffix}`);
      const comm = bool(tags, `${t}_${TAG.commFail}`);
      const high = bool(tags, `${t}_${TAG.high}`);
      const low = bool(tags, `${t}_${TAG.low}`);
      if (comm) return { ...base, state: "comm-fail", tone: "fault", label: "Comm fail", running: false, faulted: true, value: pv, units: device.units };
      if (high) return { ...base, state: "high", tone: "fault", label: "High", running: true, faulted: false, value: pv, units: device.units };
      if (low) return { ...base, state: "low", tone: "warning", label: "Low", running: true, faulted: false, value: pv, units: device.units };
      return { ...base, state: "normal", tone: "good", label: "Normal", running: true, faulted: false, value: pv, units: device.units };
    }
    case "safety-input": {
      const ok = bool(tags, `${t}_${TAG.ok}`);
      const tripped = bool(tags, `${t}_${TAG.tripped}`);
      if (tripped || !ok) return { ...base, state: "tripped", tone: "fault", label: "Tripped", running: false, faulted: true, value: false };
      return { ...base, state: "healthy", tone: "good", label: "Healthy", running: true, faulted: false, value: true };
    }
    case "batch-system": {
      const level = num(tags, `${t}_${TAG.pv}`);
      const faultBit = bool(tags, `${t}_${TAG.fault}`);
      const high = bool(tags, `${t}_${TAG.high}`);
      const run = bool(tags, `${t}_${TAG.run}`);
      const done = bool(tags, `${t}_${TAG.done}`);
      if (faultBit) return { ...base, state: "comm-fail", tone: "fault", label: "Comm fail", running: false, faulted: true, value: level, units: "%" };
      if (high) return { ...base, state: "high", tone: "fault", label: "Overfill", running: run, faulted: false, value: level, units: "%" };
      if (run) return { ...base, state: "running", tone: "good", label: "Filling", running: true, faulted: false, value: level, units: "%" };
      if (done) return { ...base, state: "normal", tone: "good", label: "Batch done", running: false, faulted: false, value: level, units: "%" };
      return { ...base, state: "stopped", tone: "idle", label: "Idle", running: false, faulted: false, value: level, units: "%" };
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Process Overview
// ---------------------------------------------------------------------------

export interface ProcessEquipmentVM extends DeviceVisual {
  alarms: string[];
  levelPercent?: number;
}

export interface ProcessOverviewVM {
  processType: string;
  equipment: ProcessEquipmentVM[];
  metrics: { total: number; running: number; faulted: number; alarmsActive: number };
}

function activeAlarmNamesForDevice(device: SimDevice, alarms: SimAlarmRecord[]): string[] {
  const ids = new Set(device.alarms.map((a) => a.name));
  return alarms.filter((a) => ids.has(a.name) && a.active).map((a) => a.name);
}

export function processOverviewModel(src: SimViewSource): ProcessOverviewVM {
  const tags = buildTagMap(src.liveTags);
  const equipment: ProcessEquipmentVM[] = src.project.devices.map((device) => {
    const visual = deviceVisualState(device, tags);
    const vm: ProcessEquipmentVM = { ...visual, alarms: activeAlarmNamesForDevice(device, src.alarms) };
    if (device.kind === "level-transmitter") vm.levelPercent = Math.max(0, Math.min(100, num(tags, `${device.tag}_${TAG.pv}`)));
    return vm;
  });
  return {
    processType: src.project.processType,
    equipment,
    metrics: {
      total: equipment.length,
      running: equipment.filter((e) => e.running).length,
      faulted: equipment.filter((e) => e.faulted).length,
      alarmsActive: src.alarms.filter((a) => a.active).length,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Electrical / I/O Cabinet
// ---------------------------------------------------------------------------

export type IoModuleKind = "controller" | "power" | "comm" | "DI" | "DO" | "AI" | "AO" | "safety";

export interface IoChannelVM {
  channel: number;
  tag: string;
  raw: number;
  scaled: number;
  units?: string;
  quality: "good" | "bad" | "forced";
  forced: boolean;
  value: PlcValue;
  active: boolean;
  lastUpdateMs: number;
}

export interface IoModuleVM {
  id: string;
  name: string;
  slot: number;
  kind: IoModuleKind;
  channelCount: number;
  activeCount: number;
  fault: boolean;
  led: SimVisualTone;
  status: string;
  channels: IoChannelVM[];
}

const CHANNELS_PER_MODULE = 16;

function channelFor(tag: SimVirtualTag, live: Map<string, SimLiveTag>, channel: number, timeMs: number): IoChannelVM {
  const lt = live.get(tag.name);
  const value = lt?.value ?? tag.initial;
  const numeric = typeof value === "number" ? value : typeof value === "boolean" ? (value ? 1 : 0) : Number(value) || 0;
  const raw = tag.scaling ? euToRaw(tag.scaling, numeric) : Math.round(numeric);
  const forced = lt?.forced ?? false;
  const active = typeof value === "boolean" ? value : numeric !== 0;
  return {
    channel,
    tag: tag.name,
    raw,
    scaled: Math.round(numeric * 100) / 100,
    units: tag.units,
    quality: forced ? "forced" : "good",
    forced,
    value,
    active,
    lastUpdateMs: timeMs,
  };
}

function packModule(
  id: string,
  name: string,
  kind: IoModuleKind,
  slot: number,
  tags: SimVirtualTag[],
  live: Map<string, SimLiveTag>,
  timeMs: number,
): IoModuleVM {
  const channels = tags.slice(0, CHANNELS_PER_MODULE).map((t, i) => channelFor(t, live, i, timeMs));
  const activeCount = channels.filter((c) => c.active).length;
  const fault = channels.some((c) => c.quality === "bad");
  return {
    id,
    name,
    slot,
    kind,
    channelCount: CHANNELS_PER_MODULE,
    activeCount,
    fault,
    led: fault ? "fault" : activeCount > 0 ? "good" : "idle",
    status: kind === "safety" ? "Safety I/O (offline)" : "Offline I/O simulation",
    channels,
  };
}

export interface IoCabinetVM {
  controller: { name: string; catalog: string; status: string; led: SimVisualTone };
  power: { status: string; led: SimVisualTone };
  comm: { status: string; led: SimVisualTone };
  modules: IoModuleVM[];
  offlineNotice: string;
}

export function ioCabinetModel(src: SimViewSource): IoCabinetVM {
  const live = buildTagMap(src.liveTags);
  const allTags = src.project.devices.flatMap((d) => d.tags.map((t) => ({ device: d, tag: t })));
  const di = allTags.filter((x) => x.tag.dataType === "BOOL" && x.tag.direction === "input" && x.device.kind !== "safety-input");
  const dop = allTags.filter((x) => x.tag.dataType === "BOOL" && x.tag.direction === "output");
  const ai = allTags.filter((x) => x.tag.dataType !== "BOOL" && x.tag.direction === "input");
  const ao = allTags.filter((x) => x.tag.dataType !== "BOOL" && x.tag.direction === "output");
  const safety = allTags.filter((x) => x.device.kind === "safety-input");

  let slot = 1;
  const modules: IoModuleVM[] = [];
  const add = (name: string, kind: IoModuleKind, items: { tag: SimVirtualTag }[]) => {
    for (let i = 0; i < Math.max(1, Math.ceil(items.length / CHANNELS_PER_MODULE)); i += 1) {
      const chunk = items.slice(i * CHANNELS_PER_MODULE, (i + 1) * CHANNELS_PER_MODULE).map((x) => x.tag);
      if (chunk.length === 0 && i > 0) break;
      modules.push(packModule(`mod_${kind}_${i}`, `${name}${i > 0 ? ` (${i + 1})` : ""}`, kind, slot, chunk, live, src.timeMs));
      slot += 1;
    }
  };
  add("Digital Input", "DI", di);
  add("Digital Output", "DO", dop);
  add("Analog Input", "AI", ai);
  add("Analog Output", "AO", ao);
  if (safety.length) add("Safety Input", "safety", safety);

  return {
    controller: { name: src.project.controller.name, catalog: src.project.controller.catalog, status: "Program / Offline", led: "good" },
    power: { status: "24 VDC OK (simulated)", led: "good" },
    comm: { status: "Offline simulation — no network browse", led: "idle" },
    modules,
    offlineNotice: "Offline I/O simulation. No real hardware browse, no controller communication.",
  };
}

// ---------------------------------------------------------------------------
// 3. Device Detail (incl. VFD specifics)
// ---------------------------------------------------------------------------

export interface DeviceRelatedTag {
  name: string;
  dataType: string;
  direction: string;
  units?: string;
  value: PlcValue;
  forced: boolean;
}

export interface DeviceDetailVM {
  device: { id: string; tag: string; name: string; kind: SimDeviceKind; kindLabel: string };
  visual: DeviceVisual;
  command: { label: string; value: PlcValue }[];
  feedback: { label: string; value: PlcValue }[];
  permissives: { name: string; satisfied: boolean; tag: string }[];
  interlocks: { name: string; satisfied: boolean; tag: string }[];
  faults: { id: SimFaultKind; label: string; active: boolean }[];
  runtimeHours: number;
  startCount: number;
  lastFault: string | null;
  alarmState: { name: string; state: string; active: boolean; severity: string }[];
  signalQuality: "good" | "bad" | "forced";
  scaling?: { rawMin: number; rawMax: number; euMin: number; euMax: number; units?: string };
  maintenanceNotes: string;
  relatedTags: DeviceRelatedTag[];
  relatedAlarms: string[];
  scenarioEvidence: { timeMs: number; message: string }[];
  vfd?: {
    speedCommand: number;
    speedFeedback: number;
    current: number;
    torque: number;
    faultCode: string;
    ready: boolean;
    running: boolean;
    faulted: boolean;
    localRemote: "Local" | "Remote";
    accelDecel: "Accelerating" | "Decelerating" | "At speed" | "Stopped";
  };
}

function evalInterlock(interlock: SimInterlock, tags: Map<string, SimLiveTag>): boolean {
  const v = num(tags, interlock.tag);
  const cmp = typeof interlock.value === "boolean" ? (interlock.value ? 1 : 0) : interlock.value;
  switch (interlock.comparison) {
    case "==": return v === cmp;
    case "!=": return v !== cmp;
    case ">": return v > cmp;
    case "<": return v < cmp;
    case ">=": return v >= cmp;
    case "<=": return v <= cmp;
  }
}

function runningFramesForTag(timeline: SimTimelineFrame[], runTag: string): number {
  let running = false;
  let frames = 0;
  for (const frame of timeline) {
    const change = frame.tagChanges.find((c) => c.tag === runTag);
    if (change) running = change.to === true || change.to === 1;
    if (running) frames += 1;
  }
  return frames;
}

export function deviceDetailModel(src: SimViewSource, deviceId: string): DeviceDetailVM | null {
  const device = src.project.devices.find((d) => d.id === deviceId);
  if (!device) return null;
  const tags = buildTagMap(src.liveTags);
  const t = device.tag;
  const visual = deviceVisualState(device, tags);
  const related: DeviceRelatedTag[] = device.tags.map((tag) => {
    const lt = tags.get(tag.name);
    return { name: tag.name, dataType: tag.dataType, direction: tag.direction, units: tag.units, value: lt?.value ?? tag.initial, forced: lt?.forced ?? false };
  });

  const command = device.tags.filter((x) => x.direction === "output").map((x) => ({ label: x.name.replace(`${t}_`, ""), value: tags.get(x.name)?.value ?? x.initial }));
  const feedback = device.tags.filter((x) => x.direction === "input").map((x) => ({ label: x.name.replace(`${t}_`, ""), value: tags.get(x.name)?.value ?? x.initial }));

  const permissives = device.interlocks.filter((i) => i.kind === "permissive").map((i) => ({ name: i.name, satisfied: evalInterlock(i, tags), tag: i.tag }));
  const interlocks = device.interlocks.filter((i) => i.kind === "interlock").map((i) => ({ name: i.name, satisfied: evalInterlock(i, tags), tag: i.tag }));

  const faultEvents = src.events.filter((e) => e.category === "fault" && typeof e.detail?.deviceId === "string" && e.detail.deviceId === deviceId);
  const lastFault = faultEvents.length ? faultEvents[faultEvents.length - 1]!.message : null;
  let activeFaultKind: string | null = null;
  for (const e of faultEvents) {
    if (e.message.startsWith("Injected") && e.detail?.fault) activeFaultKind = String(e.detail.fault);
    else if (e.message.startsWith("Cleared")) activeFaultKind = null;
  }
  const faults = deviceFaults(device).map((f) => ({ id: f.id, label: f.label, active: activeFaultKind === f.id }));

  const startCount = device.tags.some((x) => x.name === `${t}_${TAG.starts}`) ? num(tags, `${t}_${TAG.starts}`) : runEdges(src.timeline, `${t}_${TAG.run}`);
  const runFrames = runningFramesForTag(src.timeline, deviceStatusTag(device) ?? `${t}_${TAG.run}`);
  const baselineHours = device.kind === "safety-input" ? 0 : 200 + (hashSeed(t) % 8000);
  const liveHours = (runFrames * src.project.controller.scanRateMs) / 3_600_000;
  const runtimeHours = Math.round((baselineHours + liveHours) * 10) / 10;

  const relatedAlarmNames = device.alarms.map((a) => a.name);
  const alarmState = src.alarms.filter((a) => relatedAlarmNames.includes(a.name)).map((a) => ({ name: a.name, state: a.state, active: a.active, severity: a.severity }));
  const signalQuality: DeviceDetailVM["signalQuality"] = related.some((r) => r.forced) ? "forced" : visual.faulted ? "bad" : "good";

  const detail: DeviceDetailVM = {
    device: { id: device.id, tag: t, name: device.name, kind: device.kind, kindLabel: deviceLabel(device.kind) },
    visual,
    command,
    feedback,
    permissives,
    interlocks,
    faults,
    runtimeHours,
    startCount,
    lastFault,
    alarmState,
    signalQuality,
    maintenanceNotes: maintenanceNote(device),
    relatedTags: related,
    relatedAlarms: relatedAlarmNames,
    scenarioEvidence: src.events
      .filter((e) => e.message.includes(t) || (typeof e.detail?.deviceId === "string" && e.detail.deviceId === deviceId))
      .slice(-12)
      .map((e) => ({ timeMs: e.timeMs, message: e.message })),
  };
  if (device.scaling) detail.scaling = { ...device.scaling, units: device.units };

  if (device.kind === "vfd") {
    const speedFb = num(tags, `${t}_${TAG.speedFb}`);
    const speedCmd = num(tags, `${t}_${TAG.speedCmd}`);
    const current = num(tags, `${t}_${TAG.current}`);
    const running = bool(tags, `${t}_${TAG.run}`);
    const faulted = bool(tags, `${t}_${TAG.fault}`);
    detail.vfd = {
      speedCommand: Math.round(speedCmd * 10) / 10,
      speedFeedback: Math.round(speedFb * 10) / 10,
      current: Math.round(current * 10) / 10,
      torque: Math.round(current * 1.2 * 10) / 10,
      faultCode: faulted ? "F-OL (simulated overload)" : "None",
      ready: !faulted,
      running,
      faulted,
      localRemote: "Remote",
      accelDecel: !running ? "Stopped" : speedFb < speedCmd - 1 ? "Accelerating" : speedFb > speedCmd + 1 ? "Decelerating" : "At speed",
    };
  }
  return detail;
}

function runEdges(timeline: SimTimelineFrame[], runTag: string): number {
  let edges = 0;
  for (const frame of timeline) {
    const change = frame.tagChanges.find((c) => c.tag === runTag);
    if (change && (change.to === true || change.to === 1) && !(change.from === true || change.from === 1)) edges += 1;
  }
  return edges;
}

function maintenanceNote(device: SimDevice): string {
  const notes: Record<SimDeviceKind, string> = {
    motor: "Lubricate bearings per schedule; verify overload setting matches FLA.",
    vfd: "Check drive cooling fan and verify accel/decel ramps against load.",
    valve: "Stroke valve and confirm limit switches; inspect actuator air supply.",
    "flow-meter": "Verify zero/span and confirm process units after calibration.",
    "level-transmitter": "Confirm high/low setpoints and check for sensor drift.",
    "temperature-sensor": "Verify sensor type and confirm scaling matches range.",
    "safety-input": "Function-test the safety circuit and confirm reset behavior.",
    "batch-system": "Calibrate level transmitter; verify fill/drain valves and overfill interlock.",
  };
  return notes[device.kind];
}

// ---------------------------------------------------------------------------
// 4. P&ID / Engineering view
// ---------------------------------------------------------------------------

export interface PidSymbolVM {
  deviceId: string;
  tag: string;
  kind: SimDeviceKind;
  visual: DeviceVisual;
  instrument: boolean;
  bubbleText: string;
  alarmSetpoints: { label: string; value: number; units?: string }[];
  interlocks: string[];
  failed: boolean;
}

export interface PidViewVM {
  symbols: PidSymbolVM[];
  signalLines: { from: string; to: string }[];
}

export function pidViewModel(src: SimViewSource): PidViewVM {
  const tags = buildTagMap(src.liveTags);
  const symbols: PidSymbolVM[] = src.project.devices.map((device) => {
    const visual = deviceVisualState(device, tags);
    const instrument = ["flow-meter", "level-transmitter", "temperature-sensor", "batch-system"].includes(device.kind);
    const setpoints: { label: string; value: number; units?: string }[] = [];
    if (device.limits) {
      if (device.limits.high != null) setpoints.push({ label: "Hi", value: device.limits.high, units: device.units });
      if (device.limits.low != null) setpoints.push({ label: "Lo", value: device.limits.low, units: device.units });
    }
    return {
      deviceId: device.id,
      tag: device.tag,
      kind: device.kind,
      visual,
      instrument,
      bubbleText: device.tag,
      alarmSetpoints: setpoints,
      interlocks: device.interlocks.map((i) => i.name),
      failed: visual.faulted,
    };
  });
  // Signal lines: chain instruments to the first motor/driver as a simple bus.
  const driver = src.project.devices.find((d) => d.kind === "motor" || d.kind === "vfd");
  const signalLines = driver
    ? src.project.devices.filter((d) => d.id !== driver.id).map((d) => ({ from: driver.tag, to: d.tag }))
    : [];
  return { symbols, signalLines };
}

// ---------------------------------------------------------------------------
// 5. Logic Debug
// ---------------------------------------------------------------------------

export type LogicNodeRole = "contact" | "coil" | "box";
export interface LogicNodeVM {
  instruction: string;
  role: LogicNodeRole;
  operands: { tag: string; value: PlcValue }[];
  active: boolean;
}
export interface LogicRungVM {
  number: number;
  text: string;
  energized: boolean;
  nodes: LogicNodeVM[];
}
export interface LogicBlockVM {
  id: string;
  name: string;
  templateKind: string;
  rungs: LogicRungVM[];
}

const COIL_INSTR = new Set(["OTE", "OTL", "OTU"]);
const CONTACT_INSTR = new Set(["XIC", "XIO"]);

export function logicDebugModel(src: SimViewSource): LogicBlockVM[] {
  const tags = buildTagMap(src.liveTags);
  return src.project.logicBlocks.map((block) => ({
    id: block.id,
    name: block.name,
    templateKind: block.templateKind,
    rungs: block.routine.rungs.map((rung) => {
      const nodes: LogicNodeVM[] = [];
      let coilEnergized = false;
      const walk = (branch: typeof rung.root): void => {
        for (const node of branch.nodes) {
          const operands = node.operands.filter((o) => o.kind === "tag").map((o) => ({ tag: o.value, value: tags.get(o.value)?.value ?? false }));
          let role: LogicNodeRole = "box";
          let active = false;
          if (CONTACT_INSTR.has(node.instructionType)) {
            role = "contact";
            const v = bool(tags, node.operands[0]?.value ?? "");
            active = node.instructionType === "XIC" ? v : !v;
          } else if (COIL_INSTR.has(node.instructionType)) {
            role = "coil";
            active = bool(tags, node.operands[0]?.value ?? "");
            coilEnergized = coilEnergized || active;
          } else {
            active = true;
          }
          nodes.push({ instruction: node.instructionType, role, operands, active });
        }
        for (const p of branch.parallelBranches ?? []) walk(p);
        if (branch.next) walk(branch.next);
      };
      walk(rung.root);
      const coil = nodes.find((n) => n.role === "coil");
      return { number: rung.number, text: textForRung(block, rung.number), energized: coil ? coil.active : nodes.every((n) => n.role !== "contact" || n.active), nodes };
    }),
  }));
}

function textForRung(block: SimProject["logicBlocks"][number], number: number): string {
  return block.metadata.rungs.find((r) => r.number === number)?.text ?? `Rung ${number}`;
}

// ---------------------------------------------------------------------------
// 6. Alarm / Event console
// ---------------------------------------------------------------------------

export interface AlarmRowVM extends SimAlarmRecord {
  area: string;
  deviceTag: string;
}

export interface AlarmConsoleVM {
  rows: AlarmRowVM[];
  active: AlarmRowVM[];
  acknowledged: AlarmRowVM[];
  returnedUnacked: AlarmRowVM[];
  events: SimEvidenceEntry[];
  areas: string[];
  severities: string[];
  counts: { active: number; unacked: number; returned: number; total: number };
}

function deviceForAlarmTag(project: SimProject, alarmTag: string): SimDevice | undefined {
  return project.devices.find((d) => d.tags.some((t) => t.name === alarmTag) || alarmTag.startsWith(`${d.tag}_`));
}

export function alarmConsoleModel(src: SimViewSource): AlarmConsoleVM {
  const rows: AlarmRowVM[] = src.alarms.map((a) => {
    const device = deviceForAlarmTag(src.project, a.tag);
    return { ...a, area: device ? deviceLabel(device.kind) : "General", deviceTag: device?.tag ?? "—" };
  });
  const active = rows.filter((r) => r.active);
  const acknowledged = rows.filter((r) => r.acknowledged && r.active);
  const returnedUnacked = rows.filter((r) => r.state === "returned-unacknowledged");
  return {
    rows,
    active,
    acknowledged,
    returnedUnacked,
    events: src.events.filter((e) => ["alarm", "fault", "operator", "scenario", "event"].includes(e.category)),
    areas: [...new Set(rows.map((r) => r.area))],
    severities: [...new Set(rows.map((r) => r.severity))],
    counts: {
      active: active.length,
      unacked: rows.filter((r) => r.active && !r.acknowledged).length,
      returned: returnedUnacked.length,
      total: rows.length,
    },
  };
}

// ---------------------------------------------------------------------------
// 7. Trend / Historian
// ---------------------------------------------------------------------------

export type TrendMarkerKind = "scenario" | "alarm" | "operator" | "fault";
export interface TrendMarkerVM {
  timeMs: number;
  kind: TrendMarkerKind;
  label: string;
}
export interface TrendSeriesVM {
  tag: string;
  units?: string;
  points: { timeMs: number; value: number | null }[];
  min: number;
  max: number;
  current: number;
}
export interface HistorianVM {
  series: TrendSeriesVM[];
  markers: TrendMarkerVM[];
  timeSpanMs: number;
}

export function historianModel(src: SimViewSource): HistorianVM {
  const series: TrendSeriesVM[] = src.historian
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const values = s.points.map((p) => p.value ?? 0);
      const vm: TrendSeriesVM = {
        tag: s.tag,
        points: s.points.map((p) => ({ timeMs: p.timeMs, value: p.value })),
        min: Math.min(...values),
        max: Math.max(...values),
        current: values.at(-1) ?? 0,
      };
      if (s.units) vm.units = s.units;
      return vm;
    });
  const markers: TrendMarkerVM[] = [];
  for (const frame of src.timeline) {
    if (frame.scenarioStep) markers.push({ timeMs: frame.timeMs, kind: "scenario", label: frame.scenarioStep });
  }
  for (const e of src.events) {
    if (e.category === "alarm") markers.push({ timeMs: e.timeMs, kind: "alarm", label: e.message });
    else if (e.category === "operator") markers.push({ timeMs: e.timeMs, kind: "operator", label: e.message });
    else if (e.category === "fault") markers.push({ timeMs: e.timeMs, kind: "fault", label: e.message });
  }
  return { series, markers, timeSpanMs: src.timeMs };
}

// ---------------------------------------------------------------------------
// 8. Field technician loop check
// ---------------------------------------------------------------------------

export interface LoopCheckPointVM {
  label: string;
  percent: number;
  eu: number;
  raw: number;
}
export interface FieldCheckoutVM {
  device: { id: string; tag: string; name: string; kind: SimDeviceKind };
  analog: boolean;
  pvTag?: string;
  units?: string;
  scaling?: { rawMin: number; rawMax: number; euMin: number; euMax: number };
  loopPoints: LoopCheckPointVM[];
  discreteTags: string[];
  commandTag?: string;
  feedbackTag?: string;
  currentValue: number | boolean;
  checklist: { label: string; done: boolean }[];
}

export function fieldCheckoutModel(src: SimViewSource, deviceId: string): FieldCheckoutVM | null {
  const device = src.project.devices.find((d) => d.id === deviceId);
  if (!device) return null;
  const tags = buildTagMap(src.liveTags);
  const t = device.tag;
  const pvSuffix = devicePvSuffix(device.kind);
  const analog = pvSuffix != null && device.scaling != null && ["flow-meter", "level-transmitter", "temperature-sensor"].includes(device.kind);
  const vm: FieldCheckoutVM = {
    device: { id: device.id, tag: t, name: device.name, kind: device.kind },
    analog,
    loopPoints: [],
    discreteTags: device.tags.filter((x) => x.dataType === "BOOL" && x.direction === "input").map((x) => x.name),
    currentValue: analog ? num(tags, `${t}_${pvSuffix}`) : bool(tags, deviceStatusTag(device) ?? ""),
    checklist: [],
  };
  if (analog && device.scaling) {
    const pvTag = `${t}_${pvSuffix}`;
    vm.pvTag = pvTag;
    vm.units = device.units;
    vm.scaling = { ...device.scaling };
    vm.loopPoints = [0, 50, 100].map((percent) => {
      const eu = device.scaling!.euMin + (percent / 100) * (device.scaling!.euMax - device.scaling!.euMin);
      return { label: percent === 0 ? "4 mA" : percent === 50 ? "12 mA" : "20 mA", percent, eu: Math.round(eu * 100) / 100, raw: euToRaw(device.scaling!, eu) };
    });
  }
  if (device.kind === "motor" || device.kind === "vfd") {
    vm.commandTag = `${t}_${TAG.runCmd}`;
    vm.feedbackTag = `${t}_${TAG.run}`;
  }
  return vm;
}

// ---------------------------------------------------------------------------
// 10. Report preview enrichment helpers
// ---------------------------------------------------------------------------

export interface IoChannelCoverage {
  channelsTotal: number;
  channelsExercised: number;
}

/** Distinct device tags that changed across the given scenario timelines. */
export function ioChannelCoverage(project: SimProject, timelines: SimTimelineFrame[][]): IoChannelCoverage {
  const all = new Set(project.devices.flatMap((d) => d.tags.map((t) => t.name)));
  const exercised = new Set<string>();
  for (const timeline of timelines) for (const frame of timeline) for (const change of frame.tagChanges) {
    if (all.has(change.tag)) exercised.add(change.tag);
  }
  return { channelsTotal: all.size, channelsExercised: exercised.size };
}

/** Tags that produced trend data across the given scenario timelines. */
export function trendsCaptured(project: SimProject, timelines: SimTimelineFrame[][]): { tag: string; samples: number }[] {
  const analog = new Set(
    project.devices.flatMap((d) => d.tags.filter((t) => t.dataType !== "BOOL").map((t) => t.name)),
  );
  const counts = new Map<string, number>();
  for (const timeline of timelines) for (const frame of timeline) for (const change of frame.tagChanges) {
    if (analog.has(change.tag)) counts.set(change.tag, (counts.get(change.tag) ?? 0) + 1);
  }
  return [...counts.entries()].map(([tag, samples]) => ({ tag, samples })).sort((a, b) => b.samples - a.samples);
}

export interface HmiWidgetCoverage {
  screens: number;
  widgets: number;
  boundWidgets: number;
  liveBoundWidgets: number;
  scenarioCoveredWidgets: number;
  missingBindings: { screen: string; widget: string; label: string; tag: string }[];
}

/** HMI widget binding coverage against virtual tags and scenario timelines. */
export function hmiWidgetCoverage(project: SimProject, timelines: SimTimelineFrame[][]): HmiWidgetCoverage {
  const knownTags = new Set(collectAllTags(project).map((tag) => tag.name));
  const exercised = new Set<string>();
  for (const timeline of timelines) {
    for (const frame of timeline) {
      for (const change of frame.tagChanges) exercised.add(change.tag);
      for (const tag of Object.keys(frame.dataLog)) exercised.add(tag);
    }
  }

  const missingBindings: HmiWidgetCoverage["missingBindings"] = [];
  let widgets = 0;
  let boundWidgets = 0;
  let liveBoundWidgets = 0;
  let scenarioCoveredWidgets = 0;
  for (const screen of project.hmiScreens) {
    for (const widget of screen.widgets) {
      widgets += 1;
      const tag = widget.tag?.trim();
      if (!tag) continue;
      boundWidgets += 1;
      if (knownTags.has(tag)) {
        liveBoundWidgets += 1;
        if (exercised.has(tag)) scenarioCoveredWidgets += 1;
      } else {
        missingBindings.push({ screen: screen.name, widget: widget.id, label: widget.label, tag });
      }
    }
  }

  return {
    screens: project.hmiScreens.length,
    widgets,
    boundWidgets,
    liveBoundWidgets,
    scenarioCoveredWidgets,
    missingBindings,
  };
}

/** Severity → visual tone, for state colors. */
export function severityTone(severity: string): SimVisualTone {
  switch (severity) {
    case "critical":
    case "high":
      return "fault";
    case "medium":
      return "warning";
    default:
      return "idle";
  }
}

export { FAULT_INFO };
