/**
 * FAT/SAT scenario templates and the deterministic scenario runner.
 *
 * A scenario sets initial conditions, fires timed actions, runs the SimEngine
 * for a bounded window, then checks expected tag/alarm/event results — producing
 * pass/fail status plus a full evidence log and timeline. Everything is offline
 * and reproducible.
 */

import type { PlcValue } from "@esco/simulator";
import { TAG } from "./catalog";
import { SimEngine } from "./engine";
import { nextSimId, type SimIdCounter } from "./ids";
import type {
  SimActionResult,
  SimAlarmExpectation,
  SimComparison,
  SimDevice,
  SimDeviceKind,
  SimEventExpectation,
  SimExpectationCheck,
  SimProject,
  SimScenario,
  SimScenarioResult,
  SimScenarioTemplateKind,
  SimTagExpectation,
  SimTimedAction,
} from "./types";

// ---------------------------------------------------------------------------
// Template catalog
// ---------------------------------------------------------------------------

export interface SimScenarioTemplateInfo {
  kind: SimScenarioTemplateKind;
  label: string;
  description: string;
  /** Device kinds the template needs in the project to be usable. */
  requires: SimDeviceKind[];
}

export const SCENARIO_TEMPLATES: readonly SimScenarioTemplateInfo[] = [
  { kind: "start-motor", label: "Start Motor", description: "Press start and confirm the motor seals in and runs.", requires: ["motor"] },
  { kind: "trip-overload", label: "Trip Overload", description: "Run a motor, inject an overload, confirm it trips.", requires: ["motor"] },
  { kind: "sensor-failure", label: "Sensor Failure", description: "Fail an instrument and confirm the reading and alarms.", requires: [] },
  { kind: "low-flow", label: "Low Flow", description: "Confirm a low-flow alarm with the pump stopped.", requires: ["flow-meter"] },
  { kind: "high-tank-level", label: "High Tank Level", description: "Drive a level transmitter over range and confirm the high alarm.", requires: ["level-transmitter"] },
  { kind: "estop-input", label: "E-Stop Input", description: "Trip a safety input and confirm the stop and alarm.", requires: ["safety-input"] },
  { kind: "operator-login-ack-reset", label: "Operator Login / Ack / Reset", description: "Acknowledge and reset an alarm through operator actions.", requires: ["motor"] },
] as const;

export function scenarioTemplateInfo(kind: SimScenarioTemplateKind): SimScenarioTemplateInfo {
  return SCENARIO_TEMPLATES.find((t) => t.kind === kind)!;
}

/** Templates whose required devices are present in the project. */
export function availableScenarioTemplates(project: SimProject): SimScenarioTemplateInfo[] {
  return SCENARIO_TEMPLATES.filter((t) =>
    t.requires.every((kind) => project.devices.some((d) => d.kind === kind)),
  );
}

// ---------------------------------------------------------------------------
// Template builder helpers
// ---------------------------------------------------------------------------

function find(project: SimProject, kind: SimDeviceKind): SimDevice | undefined {
  return project.devices.find((d) => d.kind === kind);
}

function alarmName(device: SimDevice, suffix: string): string {
  return device.alarms.find((a) => a.name === `${device.tag}_${suffix}`)?.name ?? `${device.tag}_${suffix}`;
}

interface ScenarioParts {
  name: string;
  description: string;
  durationMs: number;
  initialConditions?: { tag: string; value: PlcValue }[];
  actions: Omit<SimTimedAction, "id">[];
  expectedTags: Omit<SimTagExpectation, "id">[];
  expectedAlarms: Omit<SimAlarmExpectation, "id">[];
  expectedEvents: Omit<SimEventExpectation, "id">[];
}

function buildParts(project: SimProject, kind: SimScenarioTemplateKind): ScenarioParts {
  const motor = find(project, "motor");
  const safety = find(project, "safety-input");
  const flow = find(project, "flow-meter");
  const level = find(project, "level-transmitter");
  const temp = find(project, "temperature-sensor");

  switch (kind) {
    case "start-motor": {
      if (!motor) throw new Error("Start Motor requires a motor.");
      return {
        name: "Start Motor",
        description: "Operator starts the motor; the holding circuit seals in and the motor runs.",
        durationMs: 800,
        actions: [
          { atMs: 0, kind: "operator-login", note: "Operator login" },
          { atMs: 100, kind: "set-tag", tag: `${motor.tag}_${TAG.startPb}`, value: true, note: "Press Start" },
          { atMs: 300, kind: "set-tag", tag: `${motor.tag}_${TAG.startPb}`, value: false, note: "Release Start" },
        ],
        expectedTags: [
          { tag: `${motor.tag}_${TAG.runCmd}`, comparison: "==", value: true, description: "Run command seals in." },
          { tag: `${motor.tag}_${TAG.run}`, comparison: "==", value: true, description: "Run feedback is on." },
        ],
        expectedAlarms: [],
        expectedEvents: [{ contains: "logged in", description: "Operator login is logged." }],
      };
    }
    case "trip-overload": {
      if (!motor) throw new Error("Trip Overload requires a motor.");
      return {
        name: "Trip Overload",
        description: "A running motor trips when an overload is injected.",
        durationMs: 1000,
        actions: [
          { atMs: 100, kind: "set-tag", tag: `${motor.tag}_${TAG.startPb}`, value: true, note: "Press Start" },
          { atMs: 300, kind: "set-tag", tag: `${motor.tag}_${TAG.startPb}`, value: false, note: "Release Start" },
          { atMs: 500, kind: "inject-fault", deviceId: motor.id, fault: "overload", note: "Inject overload" },
        ],
        expectedTags: [
          { tag: `${motor.tag}_${TAG.runCmd}`, comparison: "==", value: false, description: "Run command drops on overload." },
          { tag: `${motor.tag}_${TAG.run}`, comparison: "==", value: false, description: "Motor stops." },
        ],
        expectedAlarms: [{ alarm: alarmName(motor, "Overload"), expectActive: true, description: "Overload alarm active." }],
        expectedEvents: [{ contains: "Injected overload", description: "Overload injection is logged." }],
      };
    }
    case "sensor-failure": {
      const sensor = flow ?? temp ?? level;
      if (!sensor) throw new Error("Sensor Failure requires an instrument.");
      const expectedAlarms: Omit<SimAlarmExpectation, "id">[] = [];
      if (sensor.kind === "flow-meter") {
        expectedAlarms.push({ alarm: alarmName(sensor, "LowFlow"), expectActive: true, description: "Failed flow reads low." });
      }
      return {
        name: "Sensor Failure",
        description: `Instrument ${sensor.tag} fails; its reading drops to zero.`,
        durationMs: 600,
        actions: [{ atMs: 200, kind: "inject-fault", deviceId: sensor.id, fault: "sensor-fail", note: "Fail sensor" }],
        expectedTags: [
          { tag: `${sensor.tag}_${TAG.pv}`, comparison: "==", value: 0, tolerance: 0.5, atMs: 500, description: "Reading is zero after failure." },
        ],
        expectedAlarms,
        expectedEvents: [{ contains: "sensor-fail", description: "Sensor failure is logged." }],
      };
    }
    case "low-flow": {
      if (!flow) throw new Error("Low Flow requires a flow meter.");
      return {
        name: "Low Flow",
        description: "With the pump stopped, the flow stays below the low limit and alarms.",
        durationMs: 600,
        actions: [{ atMs: 0, kind: "wait", note: "Pump remains stopped" }],
        expectedTags: [{ tag: `${flow.tag}_${TAG.pv}`, comparison: "<", value: flow.limits?.low ?? 50, description: "Flow is below the low limit." }],
        expectedAlarms: [{ alarm: alarmName(flow, "LowFlow"), expectActive: true, description: "Low-flow alarm active." }],
        expectedEvents: [],
      };
    }
    case "high-tank-level": {
      if (!level) throw new Error("High Tank Level requires a level transmitter.");
      return {
        name: "High Tank Level",
        description: "The level transmitter is driven over range and the high alarm asserts.",
        durationMs: 600,
        actions: [{ atMs: 200, kind: "inject-fault", deviceId: level.id, fault: "out-of-range", note: "Drive level over range" }],
        expectedTags: [{ tag: `${level.tag}_${TAG.pv}`, comparison: ">", value: level.limits?.high ?? 85, description: "Level is over the high limit." }],
        expectedAlarms: [{ alarm: alarmName(level, "HighLevel"), expectActive: true, description: "High-level alarm active." }],
        expectedEvents: [{ contains: "out-of-range", description: "Over-range injection is logged." }],
      };
    }
    case "estop-input": {
      if (!safety) throw new Error("E-Stop Input requires a safety input.");
      const actions: Omit<SimTimedAction, "id">[] = [];
      const expectedTags: Omit<SimTagExpectation, "id">[] = [
        { tag: `${safety.tag}_${TAG.ok}`, comparison: "==", value: false, description: "Safety circuit opens." },
      ];
      if (motor) {
        actions.push({ atMs: 100, kind: "set-tag", tag: `${motor.tag}_${TAG.startPb}`, value: true, note: "Press Start" });
        actions.push({ atMs: 300, kind: "set-tag", tag: `${motor.tag}_${TAG.startPb}`, value: false, note: "Release Start" });
        expectedTags.push({ tag: `${motor.tag}_${TAG.runCmd}`, comparison: "==", value: false, description: "Motor stops on E-Stop." });
      }
      actions.push({ atMs: 500, kind: "inject-fault", deviceId: safety.id, fault: "estop", note: "Press E-Stop" });
      return {
        name: "E-Stop Input",
        description: "An E-Stop opens the safety circuit, stopping equipment and raising a critical alarm.",
        durationMs: 1000,
        actions,
        expectedTags,
        expectedAlarms: [{ alarm: alarmName(safety, "Tripped"), expectActive: true, description: "Safety alarm active." }],
        expectedEvents: [{ contains: "estop", description: "E-Stop is logged." }],
      };
    }
    case "operator-login-ack-reset": {
      if (!motor) throw new Error("Operator Login/Ack/Reset requires a motor.");
      return {
        name: "Operator Login / Ack / Reset",
        description: "An overload alarm is acknowledged, cleared, and reset through operator actions.",
        durationMs: 1200,
        actions: [
          { atMs: 100, kind: "inject-fault", deviceId: motor.id, fault: "overload", note: "Inject overload" },
          { atMs: 300, kind: "operator-login", note: "Operator login" },
          { atMs: 500, kind: "operator-ack", note: "Acknowledge alarms" },
          { atMs: 700, kind: "clear-fault", deviceId: motor.id, note: "Clear overload" },
          { atMs: 900, kind: "operator-reset", note: "Reset" },
        ],
        expectedTags: [],
        expectedAlarms: [{ alarm: alarmName(motor, "Overload"), expectActive: false, description: "Overload returns to normal." }],
        expectedEvents: [
          { contains: "logged in", description: "Login logged." },
          { contains: "Acknowledged", description: "Ack logged." },
          { contains: "reset", description: "Reset logged." },
        ],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Scenario factory (allocates deterministic ids from the project counter)
// ---------------------------------------------------------------------------

export function buildScenarioFromTemplate(
  counter: SimIdCounter,
  kind: SimScenarioTemplateKind,
  project: SimProject,
): SimScenario {
  const parts = buildParts(project, kind);
  return {
    id: nextSimId(counter, "scn"),
    name: parts.name,
    templateKind: kind,
    description: parts.description,
    initialConditions: parts.initialConditions ?? [],
    actions: parts.actions.map((a) => ({ ...a, id: nextSimId(counter, "act") })),
    expectedTags: parts.expectedTags.map((e) => ({ ...e, id: nextSimId(counter, "exp") })),
    expectedAlarms: parts.expectedAlarms.map((e) => ({ ...e, id: nextSimId(counter, "exp") })),
    expectedEvents: parts.expectedEvents.map((e) => ({ ...e, id: nextSimId(counter, "exp") })),
    durationMs: parts.durationMs,
    scanRateMs: project.controller.scanRateMs,
  };
}

/** Action that clones the project, builds the scenario, and appends it. */
export function addScenarioFromTemplate(
  project: SimProject,
  kind: SimScenarioTemplateKind,
  now: () => string = () => new Date().toISOString(),
): SimActionResult<SimScenario> {
  try {
    const draft = structuredClone(project);
    const scenario = buildScenarioFromTemplate(draft, kind, draft);
    draft.scenarios.push(scenario);
    draft.updatedAtLabel = now();
    return { ok: true, project: draft, data: scenario };
  } catch (error) {
    return { ok: false, project, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface Snapshot {
  timeMs: number;
  values: Record<string, PlcValue>;
  alarmActive: Record<string, boolean>;
}

function coerceBool(value: PlcValue): boolean {
  return typeof value === "boolean" ? value : typeof value === "number" ? value !== 0 : value === "true";
}
function coerceNum(value: PlcValue): number {
  return typeof value === "number" ? value : typeof value === "boolean" ? (value ? 1 : 0) : Number(value) || 0;
}

function compareValue(actual: PlcValue, comparison: SimComparison, expected: PlcValue, tolerance = 0): boolean {
  if (typeof expected === "boolean") {
    const a = coerceBool(actual);
    return comparison === "!=" ? a !== expected : a === expected;
  }
  const a = coerceNum(actual);
  const e = coerceNum(expected);
  switch (comparison) {
    case "==":
      return Math.abs(a - e) <= tolerance;
    case "!=":
      return Math.abs(a - e) > tolerance;
    case ">":
      return a > e;
    case "<":
      return a < e;
    case ">=":
      return a >= e;
    case "<=":
      return a <= e;
  }
}

function snapshotAt(snapshots: Snapshot[], atMs?: number): Snapshot | undefined {
  if (snapshots.length === 0) return undefined;
  if (atMs == null) return snapshots[snapshots.length - 1];
  return snapshots.find((s) => s.timeMs >= atMs) ?? snapshots[snapshots.length - 1];
}

export function runScenario(project: SimProject, scenario: SimScenario): SimScenarioResult {
  const scanRateMs = scenario.scanRateMs ?? project.controller.scanRateMs;
  try {
    const engine = new SimEngine(project, { scanRateMs });
    for (const init of scenario.initialConditions) engine.setTag(init.tag, init.value);

    const actions = [...scenario.actions].sort((a, b) => a.atMs - b.atMs);
    let actionIndex = 0;
    const totalScans = Math.max(1, Math.round(scenario.durationMs / scanRateMs));
    const snapshots: Snapshot[] = [];

    for (let i = 0; i < totalScans; i += 1) {
      const nextTime = engine.timeMs + scanRateMs;
      while (actionIndex < actions.length && actions[actionIndex]!.atMs <= nextTime) {
        applyAction(engine, actions[actionIndex]!);
        actionIndex += 1;
      }
      engine.stepScan();
      snapshots.push(captureSnapshot(engine));
    }

    const checks = evaluateExpectations(scenario, snapshots, engine);
    const passed = checks.filter((c) => c.passed).length;
    const status = passed === checks.length ? "pass" : "fail";
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      status,
      scans: totalScans,
      durationMs: scenario.durationMs,
      checks,
      evidence: engine.events(),
      timeline: engine.timeline(),
      alarms: engine.alarms(),
      summary: { total: checks.length, passed, failed: checks.length - passed },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      status: "error",
      scans: 0,
      durationMs: scenario.durationMs,
      checks: [],
      evidence: [],
      timeline: [],
      alarms: [],
      error: message,
      summary: { total: 0, passed: 0, failed: 0 },
    };
  }
}

function applyAction(engine: SimEngine, action: SimTimedAction): void {
  const label = action.note ?? action.kind;
  engine.markScenarioStep(`${action.kind}: ${label}`);
  switch (action.kind) {
    case "set-tag":
      if (action.tag !== undefined && action.value !== undefined) engine.setTag(action.tag, action.value);
      break;
    case "inject-fault":
      if (action.deviceId && action.fault) engine.injectFault(action.deviceId, action.fault);
      break;
    case "clear-fault":
      if (action.deviceId) engine.clearFault(action.deviceId);
      break;
    case "operator-login":
      engine.operatorLogin();
      break;
    case "operator-ack":
      engine.operatorAck();
      break;
    case "operator-reset":
      engine.operatorReset();
      break;
    case "wait":
      break;
  }
}

function captureSnapshot(engine: SimEngine): Snapshot {
  const values: Record<string, PlcValue> = {};
  for (const tag of engine.liveTags()) values[tag.name] = tag.value;
  const alarmActive: Record<string, boolean> = {};
  for (const a of engine.alarms()) alarmActive[a.name] = a.active;
  return { timeMs: engine.timeMs, values, alarmActive };
}

function evaluateExpectations(scenario: SimScenario, snapshots: Snapshot[], engine: SimEngine): SimExpectationCheck[] {
  const checks: SimExpectationCheck[] = [];

  for (const exp of scenario.expectedTags) {
    const snap = snapshotAt(snapshots, exp.atMs);
    const actual = snap?.values[exp.tag];
    const passed = actual !== undefined && compareValue(actual, exp.comparison, exp.value, exp.tolerance);
    checks.push({
      id: exp.id,
      kind: "tag",
      description: exp.description ?? `${exp.tag} ${exp.comparison} ${String(exp.value)}`,
      expected: `${exp.tag} ${exp.comparison} ${String(exp.value)}`,
      actual: actual === undefined ? "(missing)" : String(actual),
      passed,
      atMs: exp.atMs,
    });
  }

  for (const exp of scenario.expectedAlarms) {
    const snap = snapshotAt(snapshots, exp.atMs);
    const active = snap?.alarmActive[exp.alarm] ?? false;
    const passed = active === exp.expectActive;
    checks.push({
      id: exp.id,
      kind: "alarm",
      description: exp.description ?? `${exp.alarm} ${exp.expectActive ? "active" : "clear"}`,
      expected: `${exp.alarm} ${exp.expectActive ? "active" : "clear"}`,
      actual: `${exp.alarm} ${active ? "active" : "clear"}`,
      passed,
      atMs: exp.atMs,
    });
  }

  const events = engine.events();
  for (const exp of scenario.expectedEvents) {
    const pool = exp.atMs == null ? events : events.filter((e) => e.timeMs <= exp.atMs!);
    const present = pool.some((e) => e.message.toLowerCase().includes(exp.contains.toLowerCase()));
    const expectPresent = exp.expectPresent ?? true;
    checks.push({
      id: exp.id,
      kind: "event",
      description: exp.description ?? `evidence contains "${exp.contains}"`,
      expected: `${expectPresent ? "contains" : "excludes"} "${exp.contains}"`,
      actual: present ? "present" : "absent",
      passed: present === expectPresent,
      atMs: exp.atMs,
    });
  }

  return checks;
}
