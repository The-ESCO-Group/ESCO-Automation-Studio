/**
 * ESCO-native data model for the Simulation Lab. Everything here is an original
 * ESCO model — no vendor file formats, schemas, or assets are reproduced.
 *
 * The model is serializable plain data (no class instances) so a project can be
 * saved as `.escosim.json`, replayed deterministically, and round-tripped.
 */

import type { PlcValue } from "@esco/simulator";
import type { LadderRoutine } from "@esco/ladder";

// ---------------------------------------------------------------------------
// Process + controller selection
// ---------------------------------------------------------------------------

export type SimProcessType =
  | "pump-station"
  | "conveyor"
  | "tank-farm"
  | "skid"
  | "packaging-line"
  | "utilities";

/** An offline-only, ESCO-owned virtual controller model (never a real PLC). */
export interface SimControllerModel {
  id: string;
  /** ESCO-owned model name, e.g. "ESCO SoftLogix S1 (Offline Model)". */
  name: string;
  /** ESCO-owned catalog token, e.g. "ESCO-SIM-CTRL-S1". */
  catalog: string;
  scanRateMs: number;
  description: string;
  offlineOnly: true;
}

export interface SimIoRack {
  id: string;
  name: string;
  slots: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Virtual tags, scaling, alarms, interlocks
// ---------------------------------------------------------------------------

export type SimDataType = "BOOL" | "REAL" | "DINT";
export type SimTagDirection = "input" | "output" | "internal";

/** Raw-to-engineering-unit scaling for analog signals. */
export interface SimScaling {
  rawMin: number;
  rawMax: number;
  euMin: number;
  euMax: number;
}

export interface SimVirtualTag {
  id: string;
  /** Fully-qualified virtual tag name, e.g. "P101_Run". */
  name: string;
  deviceId?: string;
  dataType: SimDataType;
  direction: SimTagDirection;
  /** Engineering units (e.g. "gpm", "degF", "%"). */
  units?: string;
  description?: string;
  scaling?: SimScaling;
  initial: PlcValue;
  /** Ids of alarm definitions that reference this tag. */
  alarmRefs?: string[];
}

export type SimComparison = "==" | "!=" | ">" | "<" | ">=" | "<=";

export type SimAlarmSeverity = "critical" | "high" | "medium" | "low" | "info";

export type SimAlarmTrigger =
  | { kind: "digital"; activeValue: boolean }
  | { kind: "high"; limit: number; deadband?: number }
  | { kind: "low"; limit: number; deadband?: number };

export interface SimAlarmRef {
  id: string;
  name: string;
  tag: string;
  severity: SimAlarmSeverity;
  trigger: SimAlarmTrigger;
  message: string;
}

export type SimInterlockKind = "permissive" | "interlock";

export interface SimInterlock {
  id: string;
  name: string;
  /** A permissive must be satisfied to allow start; an interlock trips on satisfy. */
  kind: SimInterlockKind;
  tag: string;
  comparison: SimComparison;
  value: number | boolean;
  description?: string;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export type SimDeviceKind =
  | "motor"
  | "vfd"
  | "valve"
  | "flow-meter"
  | "level-transmitter"
  | "temperature-sensor"
  | "safety-input";

/** Fault models a device supports having injected (virtual only). */
export type SimFaultKind =
  | "overload"
  | "comm-loss"
  | "stuck"
  | "sensor-fail"
  | "out-of-range"
  | "estop";

/**
 * How a device's primary analog value evolves each scan. All behaviors are pure
 * functions of logical sim time (deterministic) or of a bound command tag.
 */
export type SimSignalBehavior =
  | { kind: "constant"; value: number }
  | { kind: "ramp"; from: number; to: number; periodMs: number }
  | { kind: "sine"; mean: number; amplitude: number; periodMs: number }
  | { kind: "square"; low: number; high: number; periodMs: number }
  | { kind: "triangle"; low: number; high: number; periodMs: number }
  | { kind: "step"; before: number; after: number; atMs: number }
  | { kind: "noise"; mean: number; amplitude: number; seed: number }
  /** Follows a BOOL command tag: ramps toward `high` when true, `low` when false. */
  | { kind: "follow-command"; commandTag: string; low: number; high: number; ratePerSec: number };

export interface SimProcessLimits {
  lowLow?: number;
  low?: number;
  high?: number;
  highHigh?: number;
}

export interface SimDevice {
  id: string;
  kind: SimDeviceKind;
  /** Device tag prefix, e.g. "P101". */
  tag: string;
  /** Friendly name, e.g. "Transfer Pump 101". */
  name: string;
  rackId?: string;
  units?: string;
  scaling?: SimScaling;
  limits?: SimProcessLimits;
  signalBehavior: SimSignalBehavior;
  faultStates: SimFaultKind[];
  interlocks: SimInterlock[];
  alarms: SimAlarmRef[];
  tags: SimVirtualTag[];
  testExpectations: SimTagExpectation[];
}

// ---------------------------------------------------------------------------
// Logic templates
// ---------------------------------------------------------------------------

export type SimLogicTemplateKind =
  | "debounce-input"
  | "motor-holding-interlocks"
  | "motor-start-counter"
  | "c-to-f"
  | "f-to-c"
  | "permissive-chain"
  | "alarm-trigger";

export interface SimLogicTagSpec {
  name: string;
  dataType: SimDataType;
  role: SimTagDirection;
  initial: PlcValue;
  units?: string;
}

export interface SimLogicMetadata {
  templateKind: SimLogicTemplateKind;
  title: string;
  summary: string;
  inputs: { name: string; tag: string; role: string }[];
  outputs: { name: string; tag: string; role: string }[];
  parameters: { name: string; value: string | number }[];
  /** Plain-language, ESCO-owned description of each generated rung. */
  rungs: { number: number; text: string; comment?: string }[];
}

export interface SimLogicBlock {
  id: string;
  templateKind: SimLogicTemplateKind;
  name: string;
  description: string;
  /** Parameter name -> bound tag/value. */
  params: Record<string, string>;
  metadata: SimLogicMetadata;
  /** ESCO-native ladder data the block contributes to the scan. */
  routine: LadderRoutine;
  requiredTags: SimLogicTagSpec[];
}

// ---------------------------------------------------------------------------
// HMI layer
// ---------------------------------------------------------------------------

export type SimHmiWidgetKind =
  | "value"
  | "indicator"
  | "button"
  | "gauge"
  | "trend"
  | "alarm-banner";

export interface SimHmiWidget {
  id: string;
  kind: SimHmiWidgetKind;
  label: string;
  tag?: string;
  units?: string;
  /** For buttons: the value written to `tag` when pressed. */
  command?: PlcValue;
}

export interface SimHmiScreen {
  id: string;
  name: string;
  widgets: SimHmiWidget[];
}

// ---------------------------------------------------------------------------
// Scenarios (FAT/SAT)
// ---------------------------------------------------------------------------

export type SimScenarioTemplateKind =
  | "start-motor"
  | "trip-overload"
  | "sensor-failure"
  | "low-flow"
  | "high-tank-level"
  | "estop-input"
  | "operator-login-ack-reset";

export interface SimTagAssignment {
  tag: string;
  value: PlcValue;
}

export type SimTimedActionKind =
  | "set-tag"
  | "inject-fault"
  | "clear-fault"
  | "operator-login"
  | "operator-ack"
  | "operator-reset"
  | "wait";

export interface SimTimedAction {
  id: string;
  atMs: number;
  kind: SimTimedActionKind;
  tag?: string;
  value?: PlcValue;
  deviceId?: string;
  fault?: SimFaultKind;
  note?: string;
}

export interface SimTagExpectation {
  id: string;
  tag: string;
  /** When to check (defaults to end of run). */
  atMs?: number;
  comparison: SimComparison;
  value: PlcValue;
  /** Tolerance for REAL comparisons. */
  tolerance?: number;
  description?: string;
}

export interface SimAlarmExpectation {
  id: string;
  alarm: string;
  expectActive: boolean;
  atMs?: number;
  description?: string;
}

export interface SimEventExpectation {
  id: string;
  /** Substring the evidence log must (or must not) contain. */
  contains: string;
  expectPresent?: boolean;
  atMs?: number;
  description?: string;
}

export interface SimScenario {
  id: string;
  name: string;
  templateKind?: SimScenarioTemplateKind;
  description: string;
  initialConditions: SimTagAssignment[];
  actions: SimTimedAction[];
  expectedTags: SimTagExpectation[];
  expectedAlarms: SimAlarmExpectation[];
  expectedEvents: SimEventExpectation[];
  durationMs: number;
  scanRateMs?: number;
}

// ---------------------------------------------------------------------------
// Runtime: timeline, evidence, results
// ---------------------------------------------------------------------------

export interface SimTagChange {
  tag: string;
  from: PlcValue;
  to: PlcValue;
}

export interface SimTimelineFrame {
  scan: number;
  timeMs: number;
  tagChanges: SimTagChange[];
  alarms: { alarm: string; state: SimAlarmState }[];
  interlocks: { name: string; satisfied: boolean }[];
  hmiEvents: string[];
  dataLog: Record<string, PlcValue>;
  scenarioStep?: string;
}

export type SimEvidenceCategory =
  | "system"
  | "tag"
  | "alarm"
  | "event"
  | "fault"
  | "interlock"
  | "operator"
  | "scenario";

export interface SimEvidenceEntry {
  seq: number;
  scan: number;
  timeMs: number;
  category: SimEvidenceCategory;
  message: string;
  detail?: Record<string, unknown>;
}

export type SimAlarmState =
  | "normal"
  | "active-unacknowledged"
  | "active-acknowledged"
  | "returned-unacknowledged";

export interface SimAlarmRecord {
  alarmId: string;
  name: string;
  tag: string;
  severity: SimAlarmSeverity;
  message: string;
  state: SimAlarmState;
  active: boolean;
  acknowledged: boolean;
  value: PlcValue;
  activeSinceMs?: number;
  lastTransitionMs?: number;
}

export interface SimLiveTag {
  name: string;
  dataType: SimDataType;
  direction: SimTagDirection;
  units?: string;
  value: PlcValue;
  forced: boolean;
  deviceId?: string;
}

export interface SimHistorianPoint {
  timeMs: number;
  value: number | null;
}

export interface SimHistorianSeries {
  tag: string;
  units?: string;
  points: SimHistorianPoint[];
}

export interface SimExpectationCheck {
  id: string;
  kind: "tag" | "alarm" | "event";
  description: string;
  expected: string;
  actual: string;
  passed: boolean;
  atMs?: number;
}

export type SimScenarioStatus = "pass" | "fail" | "error";

export interface SimScenarioResult {
  scenarioId: string;
  scenarioName: string;
  status: SimScenarioStatus;
  scans: number;
  durationMs: number;
  checks: SimExpectationCheck[];
  evidence: SimEvidenceEntry[];
  timeline: SimTimelineFrame[];
  alarms: SimAlarmRecord[];
  error?: string;
  summary: { total: number; passed: number; failed: number };
}

// ---------------------------------------------------------------------------
// Project + actions
// ---------------------------------------------------------------------------

export interface SimReportRef {
  id: string;
  name: string;
  createdAtLabel: string;
  status: SimScenarioStatus | "draft";
  scenariosPassed: number;
  scenariosTotal: number;
}

export interface SimProject {
  schema: "esco-sim-lab/v1";
  id: string;
  name: string;
  processType: SimProcessType;
  controller: SimControllerModel;
  racks: SimIoRack[];
  devices: SimDevice[];
  logicBlocks: SimLogicBlock[];
  hmiScreens: SimHmiScreen[];
  scenarios: SimScenario[];
  reports: SimReportRef[];
  boundary: string;
  offlineOnly: true;
  createdAtLabel: string;
  updatedAtLabel: string;
  /** Deterministic id counter (see ids.ts). */
  _idSeq: number;
}

/** Standard action result, mirroring the repo's ProjectActionResult shape. */
export type SimActionResult<T = undefined> =
  | { ok: true; project: SimProject; data?: T }
  | { ok: false; project: SimProject; error: string };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type SimValidationSeverity = "error" | "warning" | "info";

export interface SimValidationFinding {
  ruleId: string;
  severity: SimValidationSeverity;
  message: string;
  target?: string;
}
