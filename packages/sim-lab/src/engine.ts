/**
 * SimEngine — the deterministic, offline SoftController simulation core.
 *
 * Each scan: apply operator inputs/forces → simulate device dynamics into
 * virtual input tags → run all logic blocks against the virtual tag database via
 * @esco/simulator's PlcRuntime → evaluate alarms → sample the historian →
 * record a timeline frame. Everything is virtual; nothing here communicates with
 * hardware. Replays are identical run-to-run (logical time only, no wall clock).
 */

import { PlcRuntime, type PlcValue, type TagDescriptor } from "@esco/simulator";
import type { LadderRoutine } from "@esco/ladder";
import { TAG } from "./catalog";
import { devicePvSuffix } from "./devices";
import { acknowledgeAlarm, initialAlarmRecord, stepAlarm } from "./alarm-engine";
import { deviceSupportsFault } from "./fault-injection";
import { evalSignal, rampToward } from "./signal-generator";
import { collectAllTags, euToRaw } from "./tags";
import type {
  SimAlarmRecord,
  SimAlarmRef,
  SimDevice,
  SimEvidenceCategory,
  SimEvidenceEntry,
  SimFaultKind,
  SimHistorianSeries,
  SimInterlock,
  SimLiveTag,
  SimProject,
  SimTimelineFrame,
  SimVirtualTag,
} from "./types";

export interface SimEngineOptions {
  scanRateMs?: number;
  maxHistoryPoints?: number;
}

export class SimEngine {
  readonly project: SimProject;
  private readonly runtime = new PlcRuntime();
  private readonly scanRateMs: number;
  private readonly maxHistoryPoints: number;
  private readonly allTags: SimVirtualTag[];
  private readonly analogTags: string[];
  private readonly alarmDefs: SimAlarmRef[];
  private readonly interlocks: SimInterlock[];

  private alarmRecords = new Map<string, SimAlarmRecord>();
  private eventLog: SimEvidenceEntry[] = [];
  private seq = 0;
  private timelineFrames: SimTimelineFrame[] = [];
  private history = new Map<string, { timeMs: number; value: number | null }[]>();
  private forced = new Set<string>();
  private injectedFaults = new Map<string, SimFaultKind>();
  private pendingHmiEvents: string[] = [];
  private prev: Record<string, PlcValue> = {};
  private _scan = 0;
  private _timeMs = 0;
  private running = false;
  private pendingScenarioStep?: string;

  constructor(project: SimProject, options: SimEngineOptions = {}) {
    this.project = project;
    this.scanRateMs = options.scanRateMs ?? project.controller.scanRateMs;
    this.maxHistoryPoints = options.maxHistoryPoints ?? 5000;
    this.allTags = collectAllTags(project);
    this.analogTags = this.allTags.filter((t) => t.dataType !== "BOOL").map((t) => t.name);
    this.alarmDefs = project.devices.flatMap((d) => d.alarms);
    this.interlocks = project.devices.flatMap((d) => d.interlocks);

    for (const tag of this.allTags) {
      const descriptor: TagDescriptor = {
        name: tag.name,
        dataType: tag.dataType,
        role: tag.direction,
        initialValue: tag.initial,
      };
      this.runtime.defineTag(descriptor);
    }
    this.runtime.loadRoutine(this.buildMasterRoutine());
    this.runtime.start();
    this.reset();
  }

  // --- lifecycle ---------------------------------------------------------

  private buildMasterRoutine(): LadderRoutine {
    const rungs = this.project.logicBlocks.flatMap((b) => b.routine.rungs);
    return { id: "sim_master", rungs: rungs.map((r, i) => ({ ...r, number: i })) };
  }

  reset(): void {
    this.runtime.reset();
    this.forced.clear();
    this.injectedFaults.clear();
    this._scan = 0;
    this._timeMs = 0;
    this.seq = 0;
    this.eventLog = [];
    this.timelineFrames = [];
    this.pendingHmiEvents = [];
    this.pendingScenarioStep = undefined;
    this.history = new Map(this.analogTags.map((t) => [t, []]));
    this.alarmRecords = new Map(this.alarmDefs.map((d) => [d.id, initialAlarmRecord(d)]));
    this.prev = this.snapshotTags();
    this.log("system", "Simulation reset to power-up state.");
  }

  start(): void {
    this.running = true;
  }
  pause(): void {
    this.running = false;
  }
  isRunning(): boolean {
    return this.running;
  }

  get scan(): number {
    return this._scan;
  }
  get timeMs(): number {
    return this._timeMs;
  }

  // --- inputs / forces ---------------------------------------------------

  /** Write a tag. By default the value is held (forced) so it persists across scans. */
  setTag(name: string, value: PlcValue, options: { force?: boolean } = {}): void {
    const force = options.force ?? true;
    if (force) {
      this.runtime.forceTag(name, value);
      this.forced.add(name);
    } else {
      this.runtime.writeTag(name, value);
    }
  }

  clearForce(name: string): void {
    this.runtime.clearForce(name);
    this.forced.delete(name);
  }

  readTag(name: string): PlcValue {
    return this.runtime.readTag(name);
  }

  injectFault(deviceId: string, fault: SimFaultKind): { ok: boolean; error?: string } {
    const device = this.project.devices.find((d) => d.id === deviceId);
    if (!device) return { ok: false, error: "Device not found." };
    if (!deviceSupportsFault(device, fault)) {
      return { ok: false, error: `${device.name} does not support the "${fault}" fault.` };
    }
    this.injectedFaults.set(deviceId, fault);
    this.log("fault", `Injected ${fault} on ${device.name} (${device.tag}).`, { deviceId, fault });
    this.queueHmi(`FAULT ${device.tag}: ${fault}`);
    return { ok: true };
  }

  clearFault(deviceId: string): void {
    const device = this.project.devices.find((d) => d.id === deviceId);
    if (this.injectedFaults.delete(deviceId)) {
      this.log("fault", `Cleared injected fault on ${device?.name ?? deviceId}.`, { deviceId });
    }
  }

  activeFault(deviceId: string): SimFaultKind | undefined {
    return this.injectedFaults.get(deviceId);
  }

  // --- operator actions --------------------------------------------------

  operatorLogin(user = "operator"): void {
    this.log("operator", `Operator "${user}" logged in.`);
    this.queueHmi(`LOGIN ${user}`);
  }

  operatorAck(alarmId?: string): void {
    if (alarmId) {
      const record = this.alarmRecords.get(alarmId);
      if (record) {
        this.alarmRecords.set(alarmId, acknowledgeAlarm(record, this._timeMs));
        this.log("operator", `Acknowledged alarm ${record.name}.`, { alarmId });
        this.queueHmi(`ACK ${record.name}`);
      }
      return;
    }
    for (const [id, record] of this.alarmRecords) {
      this.alarmRecords.set(id, acknowledgeAlarm(record, this._timeMs));
    }
    this.log("operator", "Acknowledged all alarms.");
    this.queueHmi("ACK ALL");
  }

  operatorReset(): void {
    // Clear latched device fault/trip bits; conditions re-latch next scan if present.
    for (const device of this.project.devices) {
      if (device.kind === "safety-input") this.runtime.writeTag(`${device.tag}_${TAG.tripped}`, false);
      if (device.kind === "motor" || device.kind === "valve" || device.kind === "vfd") {
        this.runtime.writeTag(`${device.tag}_${TAG.fault}`, false);
      }
    }
    this.log("operator", "Operator reset issued (latched faults cleared).");
    this.queueHmi("RESET");
  }

  /** Record an HMI interaction (e.g. a button press) for the next timeline frame. */
  recordHmiEvent(text: string): void {
    this.queueHmi(text);
    this.log("event", `HMI: ${text}`);
  }

  /** Tag the next timeline frame with a scenario step label. */
  markScenarioStep(label: string): void {
    this.pendingScenarioStep = label;
    this.log("scenario", label);
  }

  // --- scan --------------------------------------------------------------

  stepScan(): SimTimelineFrame {
    this._scan += 1;
    this._timeMs += this.scanRateMs;

    for (const device of this.project.devices) this.stepDevice(device, this.scanRateMs);
    this.runtime.scanOnce(this.scanRateMs);
    this.evaluateAlarms();
    this.sampleHistorian();

    const frame = this.buildFrame();
    this.timelineFrames.push(frame);
    this.prev = this.snapshotTags();
    return frame;
  }

  run(scans: number): SimTimelineFrame[] {
    const frames: SimTimelineFrame[] = [];
    for (let i = 0; i < scans; i += 1) frames.push(this.stepScan());
    return frames;
  }

  runFor(durationMs: number): SimTimelineFrame[] {
    const scans = Math.max(1, Math.round(durationMs / this.scanRateMs));
    return this.run(scans);
  }

  // --- device dynamics ---------------------------------------------------

  private rb(name: string): boolean {
    const v = this.runtime.readTag(name);
    return typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : v === "true";
  }
  private rn(name: string): number {
    const v = this.runtime.readTag(name);
    return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : Number(v) || 0;
  }
  private wb(name: string, value: boolean): void {
    if (!this.forced.has(name)) this.runtime.writeTag(name, value);
  }
  private wn(name: string, value: number): void {
    if (!this.forced.has(name)) this.runtime.writeTag(name, value);
  }

  private stepDevice(device: SimDevice, deltaMs: number): void {
    const t = device.tag;
    const fault = this.injectedFaults.get(device.id);
    switch (device.kind) {
      case "motor": {
        const overloadTag = `${t}_${TAG.overload}`;
        if (fault === "overload") this.wb(overloadTag, true);
        else if (!this.forced.has(overloadTag)) this.wb(overloadTag, false);
        const commLoss = fault === "comm-loss";
        const overloaded = this.rb(overloadTag);
        const run = this.rb(`${t}_${TAG.runCmd}`) && !overloaded && !commLoss;
        this.wb(`${t}_${TAG.run}`, run);
        this.wb(`${t}_${TAG.fault}`, overloaded);
        const target = commLoss ? 0 : run ? 24 : 0.4;
        this.wn(`${t}_${TAG.current}`, rampToward(this.rn(`${t}_${TAG.current}`), target, 80, deltaMs));
        break;
      }
      case "vfd": {
        const faultTag = `${t}_${TAG.fault}`;
        if (fault === "overload") this.wb(faultTag, true);
        else if (!this.forced.has(faultTag)) this.wb(faultTag, false);
        const commLoss = fault === "comm-loss";
        const run = this.rb(`${t}_${TAG.runCmd}`) && !this.rb(faultTag) && !commLoss;
        this.wb(`${t}_${TAG.run}`, run);
        const speedTarget = run ? this.rn(`${t}_${TAG.speedCmd}`) : 0;
        const sf = rampToward(this.rn(`${t}_${TAG.speedFb}`), commLoss ? 0 : speedTarget, 60, deltaMs);
        this.wn(`${t}_${TAG.speedFb}`, sf);
        this.wn(`${t}_${TAG.current}`, sf * 0.8);
        break;
      }
      case "valve": {
        const stuck = fault === "stuck" || fault === "comm-loss";
        let pos = this.rn(`${t}_${TAG.position}`);
        if (!stuck) {
          const openCmd = this.rb(`${t}_${TAG.openCmd}`);
          const closeCmd = this.rb(`${t}_${TAG.closeCmd}`);
          const target = openCmd ? 100 : closeCmd ? 0 : pos;
          pos = rampToward(pos, target, 50, deltaMs);
          this.wn(`${t}_${TAG.position}`, pos);
        }
        this.wb(`${t}_${TAG.open}`, pos >= 99);
        this.wb(`${t}_${TAG.closed}`, pos <= 1);
        this.wb(`${t}_${TAG.fault}`, stuck && (this.rb(`${t}_${TAG.openCmd}`) || this.rb(`${t}_${TAG.closeCmd}`)));
        break;
      }
      case "flow-meter":
      case "level-transmitter":
      case "temperature-sensor": {
        const pvSuffix = devicePvSuffix(device.kind);
        if (!pvSuffix) break;
        const pvTag = `${t}_${pvSuffix}`;
        const commTag = `${t}_${TAG.commFail}`;
        const commLoss = fault === "comm-loss";
        this.wb(commTag, commLoss);
        if (!this.forced.has(pvTag)) {
          let pv: number;
          if (fault === "sensor-fail") pv = 0;
          else if (fault === "out-of-range") pv = (device.scaling?.euMax ?? 100) * 1.1;
          else {
            const b = device.signalBehavior;
            if (b.kind === "follow-command") {
              const cmd = this.rb(b.commandTag);
              pv = rampToward(this.rn(pvTag), cmd ? b.high : b.low, b.ratePerSec, deltaMs);
            } else {
              pv = evalSignal(b, this._timeMs);
            }
          }
          this.wn(pvTag, pv);
        }
        const pv = this.rn(pvTag);
        if (device.scaling) this.wn(`${t}_${TAG.raw}`, euToRaw(device.scaling, pv));
        if (device.kind === "flow-meter") this.wb(`${t}_${TAG.low}`, pv < (device.limits?.low ?? 50));
        if (device.kind === "level-transmitter") {
          this.wb(`${t}_${TAG.high}`, pv > (device.limits?.high ?? 85));
          this.wb(`${t}_${TAG.low}`, pv < (device.limits?.low ?? 15));
        }
        if (device.kind === "temperature-sensor") this.wb(`${t}_${TAG.high}`, pv > (device.limits?.high ?? 200));
        break;
      }
      case "safety-input": {
        const okTag = `${t}_${TAG.ok}`;
        const tripped = fault === "estop";
        if (!this.forced.has(okTag)) this.wb(okTag, !tripped);
        const latched = tripped || this.rb(`${t}_${TAG.tripped}`);
        this.wb(`${t}_${TAG.tripped}`, latched);
        break;
      }
      case "batch-system": {
        const faultTag = `${t}_${TAG.fault}`;
        const commLoss = fault === "comm-loss";
        if (commLoss) this.wb(faultTag, true);
        else if (!this.forced.has(faultTag)) this.wb(faultTag, false);
        const pvTag = `${t}_${TAG.pv}`;
        const highLimit = device.limits?.high ?? 95;
        const startCmd = this.rb(`${t}_${TAG.startCmd}`);
        const drainCmd = this.rb(`${t}_${TAG.drainCmd}`);
        const prevDone = this.rb(`${t}_${TAG.done}`);
        let level = this.rn(pvTag);
        if (!this.forced.has(pvTag)) {
          if (fault === "sensor-fail") level = 0;
          else if (commLoss) {
            // Comm loss freezes the vessel level (no fresh feedback).
          } else if (drainCmd) level = rampToward(level, 0, 200, deltaMs);
          else if (startCmd) level = rampToward(level, 100, 200, deltaMs);
          this.wn(pvTag, level);
        }
        const filling = startCmd && !drainCmd && !commLoss && level < 99;
        this.wb(`${t}_${TAG.run}`, filling);
        const done = level >= 99;
        this.wb(`${t}_${TAG.done}`, done);
        this.wb(`${t}_${TAG.high}`, level > highLimit);
        // Count a completed batch on the rising edge of Done.
        if (done && !prevDone) this.wn(`${t}_${TAG.batchCount}`, this.rn(`${t}_${TAG.batchCount}`) + 1);
        break;
      }
    }
  }

  // --- alarms / historian / frame ---------------------------------------

  private evaluateAlarms(): void {
    for (const def of this.alarmDefs) {
      const record = this.alarmRecords.get(def.id);
      if (!record) continue;
      const value = this.runtime.readTag(def.tag);
      const { record: next, transition } = stepAlarm(def, record, value, this._timeMs);
      this.alarmRecords.set(def.id, next);
      if (transition) {
        this.log("alarm", `Alarm ${transition.name}: ${transition.from} → ${transition.to}`, {
          severity: transition.severity,
          value: transition.value,
        });
        this.queueHmi(`ALARM ${transition.name} ${transition.to}`);
      }
    }
  }

  private sampleHistorian(): void {
    for (const name of this.analogTags) {
      const points = this.history.get(name)!;
      points.push({ timeMs: this._timeMs, value: this.rn(name) });
      if (points.length > this.maxHistoryPoints) points.shift();
    }
  }

  private interlockSatisfied(interlock: SimInterlock): boolean {
    const value = this.runtime.readTag(interlock.tag);
    const num = typeof value === "number" ? value : typeof value === "boolean" ? (value ? 1 : 0) : Number(value) || 0;
    const cmp = typeof interlock.value === "boolean" ? (interlock.value ? 1 : 0) : interlock.value;
    switch (interlock.comparison) {
      case "==":
        return num === cmp;
      case "!=":
        return num !== cmp;
      case ">":
        return num > cmp;
      case "<":
        return num < cmp;
      case ">=":
        return num >= cmp;
      case "<=":
        return num <= cmp;
    }
  }

  private buildFrame(): SimTimelineFrame {
    const current = this.snapshotTags();
    const tagChanges = [];
    for (const tag of this.allTags) {
      const before = this.prev[tag.name];
      const after = current[tag.name];
      if (before !== after) tagChanges.push({ tag: tag.name, from: before!, to: after! });
    }
    const alarms = [...this.alarmRecords.values()]
      .filter((a) => a.state !== "normal")
      .map((a) => ({ alarm: a.name, state: a.state }));
    const interlocks = this.interlocks.map((i) => ({ name: i.name, satisfied: this.interlockSatisfied(i) }));
    const hmiEvents = this.pendingHmiEvents;
    this.pendingHmiEvents = [];

    const dataLog: Record<string, PlcValue> = {};
    for (const device of this.project.devices) {
      const pvSuffix = devicePvSuffix(device.kind);
      if (pvSuffix) dataLog[`${device.tag}_${pvSuffix}`] = current[`${device.tag}_${pvSuffix}`]!;
    }

    const frame: SimTimelineFrame = {
      scan: this._scan,
      timeMs: this._timeMs,
      tagChanges,
      alarms,
      interlocks,
      hmiEvents,
      dataLog,
    };
    if (this.pendingScenarioStep) {
      frame.scenarioStep = this.pendingScenarioStep;
      this.pendingScenarioStep = undefined;
    }
    return frame;
  }

  // --- accessors ---------------------------------------------------------

  liveTags(): SimLiveTag[] {
    return this.allTags.map((tag) => {
      const live: SimLiveTag = {
        name: tag.name,
        dataType: tag.dataType,
        direction: tag.direction,
        value: this.runtime.readTag(tag.name),
        forced: this.forced.has(tag.name),
      };
      if (tag.units) live.units = tag.units;
      if (tag.deviceId) live.deviceId = tag.deviceId;
      return live;
    });
  }

  alarms(): SimAlarmRecord[] {
    return [...this.alarmRecords.values()];
  }

  events(): SimEvidenceEntry[] {
    return this.eventLog;
  }

  timeline(): SimTimelineFrame[] {
    return this.timelineFrames;
  }

  historian(): SimHistorianSeries[] {
    const byName = new Map(this.allTags.map((t) => [t.name, t]));
    return this.analogTags.map((name) => {
      const tag = byName.get(name);
      const series: SimHistorianSeries = { tag: name, points: this.history.get(name) ?? [] };
      if (tag?.units) series.units = tag.units;
      return series;
    });
  }

  // --- internals ---------------------------------------------------------

  private snapshotTags(): Record<string, PlcValue> {
    const snap: Record<string, PlcValue> = {};
    for (const tag of this.allTags) snap[tag.name] = this.runtime.readTag(tag.name);
    return snap;
  }

  private queueHmi(text: string): void {
    this.pendingHmiEvents.push(text);
  }

  private log(category: SimEvidenceCategory, message: string, detail?: Record<string, unknown>): void {
    this.seq += 1;
    const entry: SimEvidenceEntry = { seq: this.seq, scan: this._scan, timeMs: this._timeMs, category, message };
    if (detail) entry.detail = detail;
    this.eventLog.push(entry);
  }
}
