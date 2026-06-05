/**
 * ESCO-owned catalog of process types, offline controller models, and device
 * blueprints. All names, catalog tokens, and behaviors are original ESCO
 * content — no vendor catalog data, naming, or profiles are reproduced.
 */

import type {
  SimAlarmSeverity,
  SimAlarmTrigger,
  SimComparison,
  SimDataType,
  SimDeviceKind,
  SimFaultKind,
  SimInterlockKind,
  SimProcessLimits,
  SimProcessType,
  SimScaling,
  SimSignalBehavior,
  SimTagDirection,
} from "./types";

// ---------------------------------------------------------------------------
// Process types
// ---------------------------------------------------------------------------

export interface SimProcessTypeInfo {
  id: SimProcessType;
  label: string;
  description: string;
  /** Default device counts seeded for a fresh project of this process type. */
  defaults: SimDeviceCounts;
}

export interface SimDeviceCounts {
  motors: number;
  vfds: number;
  valves: number;
  flowMeters: number;
  levelTransmitters: number;
  temperatureSensors: number;
  safetyInputs: number;
}

export const EMPTY_DEVICE_COUNTS: SimDeviceCounts = {
  motors: 0,
  vfds: 0,
  valves: 0,
  flowMeters: 0,
  levelTransmitters: 0,
  temperatureSensors: 0,
  safetyInputs: 0,
};

export const PROCESS_TYPES: readonly SimProcessTypeInfo[] = [
  {
    id: "pump-station",
    label: "Pump Station",
    description: "Lift/transfer pumps with flow and level instrumentation.",
    defaults: { motors: 2, vfds: 1, valves: 1, flowMeters: 1, levelTransmitters: 1, temperatureSensors: 0, safetyInputs: 1 },
  },
  {
    id: "conveyor",
    label: "Conveyor",
    description: "Belt/roller conveyor segments with motor drives and safety inputs.",
    defaults: { motors: 2, vfds: 1, valves: 0, flowMeters: 0, levelTransmitters: 0, temperatureSensors: 1, safetyInputs: 2 },
  },
  {
    id: "tank-farm",
    label: "Tank Farm",
    description: "Storage tanks with level, valves, and transfer pumps.",
    defaults: { motors: 1, vfds: 0, valves: 2, flowMeters: 1, levelTransmitters: 2, temperatureSensors: 1, safetyInputs: 1 },
  },
  {
    id: "skid",
    label: "Skid",
    description: "Packaged process skid with mixed instrumentation.",
    defaults: { motors: 1, vfds: 1, valves: 2, flowMeters: 1, levelTransmitters: 1, temperatureSensors: 1, safetyInputs: 1 },
  },
  {
    id: "packaging-line",
    label: "Packaging Line",
    description: "Sequenced packaging stations with drives and sensors.",
    defaults: { motors: 3, vfds: 2, valves: 1, flowMeters: 0, levelTransmitters: 0, temperatureSensors: 1, safetyInputs: 2 },
  },
  {
    id: "utilities",
    label: "Utilities",
    description: "Plant utilities (air, water, steam) with metering.",
    defaults: { motors: 1, vfds: 1, valves: 2, flowMeters: 2, levelTransmitters: 1, temperatureSensors: 2, safetyInputs: 1 },
  },
] as const;

export function processTypeInfo(id: SimProcessType): SimProcessTypeInfo {
  return PROCESS_TYPES.find((p) => p.id === id) ?? PROCESS_TYPES[0]!;
}

// ---------------------------------------------------------------------------
// Offline controller models (ESCO-owned, virtual only)
// ---------------------------------------------------------------------------

export interface SimControllerModelInfo {
  name: string;
  catalog: string;
  scanRateMs: number;
  description: string;
}

export const CONTROLLER_MODELS: readonly SimControllerModelInfo[] = [
  { name: "ESCO SoftLogix S1 (Offline Model)", catalog: "ESCO-SIM-CTRL-S1", scanRateMs: 10, description: "Compact offline soft controller model." },
  { name: "ESCO SoftLogix S2 (Offline Model)", catalog: "ESCO-SIM-CTRL-S2", scanRateMs: 5, description: "Mid-range offline soft controller model." },
  { name: "ESCO SoftLogix S3 (Offline Model)", catalog: "ESCO-SIM-CTRL-S3", scanRateMs: 2, description: "High-rate offline soft controller model." },
] as const;

export const SCAN_RATE_OPTIONS_MS = [2, 5, 10, 20, 50, 100] as const;

// ---------------------------------------------------------------------------
// Device blueprints
// ---------------------------------------------------------------------------

/** Suffixes appended to a device tag prefix to form virtual tag names. */
export const TAG = {
  startPb: "StartPB",
  stopPb: "StopPB",
  runCmd: "RunCmd",
  run: "Run",
  overload: "Overload",
  current: "Current",
  starts: "Starts",
  fault: "Fault",
  speedCmd: "SpeedCmd",
  speedFb: "SpeedFb",
  openCmd: "OpenCmd",
  closeCmd: "CloseCmd",
  open: "Open",
  closed: "Closed",
  position: "Position",
  pv: "PV",
  raw: "Raw",
  high: "High",
  low: "Low",
  commFail: "CommFail",
  ok: "OK",
  tripped: "Tripped",
} as const;

export interface SimDeviceTagSpec {
  suffix: string;
  dataType: SimDataType;
  direction: SimTagDirection;
  units?: string;
  scaling?: SimScaling;
  initial: boolean | number | string;
  description: string;
}

export interface SimDeviceAlarmSpec {
  nameSuffix: string;
  tagSuffix: string;
  severity: SimAlarmSeverity;
  trigger: SimAlarmTrigger;
  message: string;
}

export interface SimDeviceInterlockSpec {
  name: string;
  kind: SimInterlockKind;
  tagSuffix: string;
  comparison: SimComparison;
  value: number | boolean;
  description: string;
}

export interface SimDeviceBlueprint {
  kind: SimDeviceKind;
  label: string;
  /** Default device tag prefix letter group, e.g. "P" for pumps. */
  prefixHint: string;
  units?: string;
  scaling?: SimScaling;
  limits?: SimProcessLimits;
  /** Suffix of the device's primary analog process value (if any). */
  pvSuffix?: string;
  signalBehavior: (deviceTag: string) => SimSignalBehavior;
  tags: SimDeviceTagSpec[];
  alarms: SimDeviceAlarmSpec[];
  interlocks: SimDeviceInterlockSpec[];
  faultStates: SimDeviceBlueprintFaults;
}

export type SimDeviceBlueprintFaults = readonly SimFaultKind[];

const ANALOG_RAW: SimScaling = { rawMin: 0, rawMax: 32767, euMin: 0, euMax: 100 };

function currentScaling(maxAmps: number): SimScaling {
  return { rawMin: 0, rawMax: 32767, euMin: 0, euMax: maxAmps };
}

export const DEVICE_BLUEPRINTS: Record<SimDeviceKind, SimDeviceBlueprint> = {
  motor: {
    kind: "motor",
    label: "Motor",
    prefixHint: "M",
    units: "A",
    scaling: currentScaling(50),
    limits: { high: 40, highHigh: 48 },
    pvSuffix: TAG.current,
    signalBehavior: (t) => ({ kind: "follow-command", commandTag: `${t}_${TAG.run}`, low: 0.4, high: 24, ratePerSec: 80 }),
    tags: [
      { suffix: TAG.startPb, dataType: "BOOL", direction: "input", initial: false, description: "Operator start pushbutton." },
      { suffix: TAG.stopPb, dataType: "BOOL", direction: "input", initial: false, description: "Operator stop pushbutton (normally clear)." },
      { suffix: TAG.runCmd, dataType: "BOOL", direction: "output", initial: false, description: "Run command from holding-circuit logic." },
      { suffix: TAG.run, dataType: "BOOL", direction: "input", initial: false, description: "Run feedback (auxiliary contact)." },
      { suffix: TAG.overload, dataType: "BOOL", direction: "input", initial: false, description: "Overload trip input (true = tripped)." },
      { suffix: TAG.current, dataType: "REAL", direction: "input", units: "A", scaling: currentScaling(50), initial: 0, description: "Motor current." },
      { suffix: TAG.starts, dataType: "DINT", direction: "internal", initial: 0, description: "Accumulated motor starts." },
      { suffix: TAG.fault, dataType: "BOOL", direction: "internal", initial: false, description: "Latched device fault." },
    ],
    alarms: [
      { nameSuffix: "Overload", tagSuffix: TAG.overload, severity: "high", trigger: { kind: "digital", activeValue: true }, message: "Motor overload tripped." },
      { nameSuffix: "HighCurrent", tagSuffix: TAG.current, severity: "medium", trigger: { kind: "high", limit: 40, deadband: 2 }, message: "Motor current high." },
    ],
    interlocks: [
      { name: "Overload Trip", kind: "interlock", tagSuffix: TAG.overload, comparison: "==", value: true, description: "Trips the run command when the overload is active." },
    ],
    faultStates: ["overload", "comm-loss"] as const,
  },
  vfd: {
    kind: "vfd",
    label: "VFD / Drive",
    prefixHint: "D",
    units: "%",
    scaling: ANALOG_RAW,
    limits: { high: 95 },
    pvSuffix: TAG.speedFb,
    signalBehavior: (t) => ({ kind: "follow-command", commandTag: `${t}_${TAG.runCmd}`, low: 0, high: 60, ratePerSec: 25 }),
    tags: [
      { suffix: TAG.runCmd, dataType: "BOOL", direction: "output", initial: false, description: "Drive run command." },
      { suffix: TAG.speedCmd, dataType: "REAL", direction: "output", units: "%", initial: 0, description: "Speed reference (0-100%)." },
      { suffix: TAG.speedFb, dataType: "REAL", direction: "input", units: "%", scaling: ANALOG_RAW, initial: 0, description: "Speed feedback (0-100%)." },
      { suffix: TAG.run, dataType: "BOOL", direction: "input", initial: false, description: "Drive running feedback." },
      { suffix: TAG.current, dataType: "REAL", direction: "input", units: "A", scaling: currentScaling(80), initial: 0, description: "Drive output current." },
      { suffix: TAG.fault, dataType: "BOOL", direction: "input", initial: false, description: "Drive fault input." },
    ],
    alarms: [
      { nameSuffix: "DriveFault", tagSuffix: TAG.fault, severity: "high", trigger: { kind: "digital", activeValue: true }, message: "Drive fault active." },
    ],
    interlocks: [
      { name: "Drive Fault", kind: "interlock", tagSuffix: TAG.fault, comparison: "==", value: true, description: "Trips the run command on a drive fault." },
    ],
    faultStates: ["overload", "comm-loss"] as const,
  },
  valve: {
    kind: "valve",
    label: "Valve",
    prefixHint: "V",
    units: "%",
    scaling: ANALOG_RAW,
    pvSuffix: TAG.position,
    signalBehavior: (t) => ({ kind: "follow-command", commandTag: `${t}_${TAG.openCmd}`, low: 0, high: 100, ratePerSec: 50 }),
    tags: [
      { suffix: TAG.openCmd, dataType: "BOOL", direction: "output", initial: false, description: "Open command." },
      { suffix: TAG.closeCmd, dataType: "BOOL", direction: "output", initial: false, description: "Close command." },
      { suffix: TAG.open, dataType: "BOOL", direction: "input", initial: false, description: "Open limit switch." },
      { suffix: TAG.closed, dataType: "BOOL", direction: "input", initial: true, description: "Closed limit switch." },
      { suffix: TAG.position, dataType: "REAL", direction: "input", units: "%", scaling: ANALOG_RAW, initial: 0, description: "Valve position (0-100%)." },
      { suffix: TAG.fault, dataType: "BOOL", direction: "internal", initial: false, description: "Valve travel fault." },
    ],
    alarms: [
      { nameSuffix: "TravelFault", tagSuffix: TAG.fault, severity: "medium", trigger: { kind: "digital", activeValue: true }, message: "Valve failed to reach commanded position." },
    ],
    interlocks: [],
    faultStates: ["stuck", "comm-loss"] as const,
  },
  "flow-meter": {
    kind: "flow-meter",
    label: "Flow Meter",
    prefixHint: "FT",
    units: "gpm",
    scaling: { rawMin: 0, rawMax: 32767, euMin: 0, euMax: 500 },
    limits: { lowLow: 20, low: 50 },
    pvSuffix: TAG.pv,
    signalBehavior: () => ({ kind: "constant", value: 0 }),
    tags: [
      { suffix: TAG.pv, dataType: "REAL", direction: "input", units: "gpm", scaling: { rawMin: 0, rawMax: 32767, euMin: 0, euMax: 500 }, initial: 0, description: "Flow process value." },
      { suffix: TAG.raw, dataType: "DINT", direction: "internal", initial: 0, description: "Raw scaled counts." },
      { suffix: TAG.low, dataType: "BOOL", direction: "internal", initial: false, description: "Low-flow status." },
      { suffix: TAG.commFail, dataType: "BOOL", direction: "input", initial: false, description: "Instrument comm fail." },
    ],
    alarms: [
      { nameSuffix: "LowFlow", tagSuffix: TAG.pv, severity: "medium", trigger: { kind: "low", limit: 50, deadband: 5 }, message: "Flow below low limit." },
      { nameSuffix: "CommFail", tagSuffix: TAG.commFail, severity: "high", trigger: { kind: "digital", activeValue: true }, message: "Flow instrument communication failure." },
    ],
    interlocks: [],
    faultStates: ["comm-loss", "sensor-fail", "out-of-range"] as const,
  },
  "level-transmitter": {
    kind: "level-transmitter",
    label: "Level Transmitter",
    prefixHint: "LT",
    units: "%",
    scaling: ANALOG_RAW,
    limits: { low: 15, lowLow: 5, high: 85, highHigh: 95 },
    pvSuffix: TAG.pv,
    signalBehavior: () => ({ kind: "constant", value: 40 }),
    tags: [
      { suffix: TAG.pv, dataType: "REAL", direction: "input", units: "%", scaling: ANALOG_RAW, initial: 40, description: "Level process value." },
      { suffix: TAG.raw, dataType: "DINT", direction: "internal", initial: 0, description: "Raw scaled counts." },
      { suffix: TAG.high, dataType: "BOOL", direction: "internal", initial: false, description: "High-level status." },
      { suffix: TAG.low, dataType: "BOOL", direction: "internal", initial: false, description: "Low-level status." },
      { suffix: TAG.commFail, dataType: "BOOL", direction: "input", initial: false, description: "Instrument comm fail." },
    ],
    alarms: [
      { nameSuffix: "HighLevel", tagSuffix: TAG.pv, severity: "high", trigger: { kind: "high", limit: 85, deadband: 2 }, message: "Tank level high." },
      { nameSuffix: "LowLevel", tagSuffix: TAG.pv, severity: "medium", trigger: { kind: "low", limit: 15, deadband: 2 }, message: "Tank level low." },
    ],
    interlocks: [],
    faultStates: ["comm-loss", "sensor-fail", "out-of-range"] as const,
  },
  "temperature-sensor": {
    kind: "temperature-sensor",
    label: "Temperature Sensor",
    prefixHint: "TT",
    units: "degF",
    scaling: { rawMin: 0, rawMax: 32767, euMin: -40, euMax: 300 },
    limits: { high: 200, highHigh: 250 },
    pvSuffix: TAG.pv,
    signalBehavior: () => ({ kind: "constant", value: 72 }),
    tags: [
      { suffix: TAG.pv, dataType: "REAL", direction: "input", units: "degF", scaling: { rawMin: 0, rawMax: 32767, euMin: -40, euMax: 300 }, initial: 72, description: "Temperature process value." },
      { suffix: TAG.raw, dataType: "DINT", direction: "internal", initial: 0, description: "Raw scaled counts." },
      { suffix: TAG.high, dataType: "BOOL", direction: "internal", initial: false, description: "High-temp status." },
      { suffix: TAG.commFail, dataType: "BOOL", direction: "input", initial: false, description: "Instrument comm fail." },
    ],
    alarms: [
      { nameSuffix: "HighTemp", tagSuffix: TAG.pv, severity: "high", trigger: { kind: "high", limit: 200, deadband: 3 }, message: "Temperature high." },
    ],
    interlocks: [],
    faultStates: ["comm-loss", "sensor-fail", "out-of-range"] as const,
  },
  "safety-input": {
    kind: "safety-input",
    label: "Safety Input",
    prefixHint: "ES",
    pvSuffix: undefined,
    signalBehavior: () => ({ kind: "constant", value: 1 }),
    tags: [
      { suffix: TAG.ok, dataType: "BOOL", direction: "input", initial: true, description: "Safety circuit healthy (true = OK)." },
      { suffix: TAG.tripped, dataType: "BOOL", direction: "internal", initial: false, description: "Latched trip status." },
    ],
    alarms: [
      { nameSuffix: "Tripped", tagSuffix: TAG.tripped, severity: "critical", trigger: { kind: "digital", activeValue: true }, message: "Safety input tripped." },
    ],
    interlocks: [
      { name: "Safety Healthy", kind: "permissive", tagSuffix: TAG.ok, comparison: "==", value: true, description: "Must be healthy to permit equipment start." },
    ],
    faultStates: ["estop"] as const,
  },
};

export function deviceBlueprint(kind: SimDeviceKind): SimDeviceBlueprint {
  return DEVICE_BLUEPRINTS[kind];
}

/** All device kinds in stable display order. */
export const DEVICE_KINDS: readonly SimDeviceKind[] = [
  "motor",
  "vfd",
  "valve",
  "flow-meter",
  "level-transmitter",
  "temperature-sensor",
  "safety-input",
];
