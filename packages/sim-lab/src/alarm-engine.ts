/**
 * Native, deterministic alarm evaluation for the Simulation Lab. Models the
 * standard active/acknowledged/returned lifecycle with analog deadbands. This is
 * an original ESCO implementation (no vendor alarm-server behavior is copied).
 */

import type { PlcValue } from "@esco/simulator";
import type { SimAlarmRecord, SimAlarmRef, SimAlarmState } from "./types";

export function initialAlarmRecord(def: SimAlarmRef): SimAlarmRecord {
  return {
    alarmId: def.id,
    name: def.name,
    tag: def.tag,
    severity: def.severity,
    message: def.message,
    state: "normal",
    active: false,
    acknowledged: false,
    value: false,
  };
}

function toNumber(value: PlcValue): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toBool(value: PlcValue): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value === "true" || value === "1";
}

/** Returns whether the alarm condition is met, honoring deadband hysteresis. */
function conditionActive(def: SimAlarmRef, value: PlcValue, wasActive: boolean): boolean {
  switch (def.trigger.kind) {
    case "digital":
      return toBool(value) === def.trigger.activeValue;
    case "high": {
      const v = toNumber(value);
      const db = def.trigger.deadband ?? 0;
      return wasActive ? v > def.trigger.limit - db : v >= def.trigger.limit;
    }
    case "low": {
      const v = toNumber(value);
      const db = def.trigger.deadband ?? 0;
      return wasActive ? v < def.trigger.limit + db : v <= def.trigger.limit;
    }
  }
}

export interface AlarmTransition {
  alarmId: string;
  name: string;
  severity: SimAlarmRecord["severity"];
  from: SimAlarmState;
  to: SimAlarmState;
  message: string;
  value: PlcValue;
}

/**
 * Advance one alarm record given the latest tag value. Returns the next record
 * and an optional transition (when the lifecycle state changed).
 */
export function stepAlarm(
  def: SimAlarmRef,
  record: SimAlarmRecord,
  value: PlcValue,
  timeMs: number,
): { record: SimAlarmRecord; transition?: AlarmTransition } {
  const active = conditionActive(def, value, record.active);
  const next: SimAlarmRecord = { ...record, value };
  let nextState: SimAlarmState = record.state;

  if (active && !record.active) {
    // Newly active.
    nextState = "active-unacknowledged";
    next.active = true;
    next.acknowledged = false;
    next.activeSinceMs = timeMs;
  } else if (!active && record.active) {
    // Returned to normal.
    next.active = false;
    nextState = record.acknowledged ? "normal" : "returned-unacknowledged";
  } else if (active && record.active) {
    nextState = record.acknowledged ? "active-acknowledged" : "active-unacknowledged";
  } else {
    // Inactive and was inactive: an unacknowledged return clears once acknowledged.
    nextState = record.state === "returned-unacknowledged" && record.acknowledged ? "normal" : record.state;
  }

  next.state = nextState;
  if (nextState !== record.state) next.lastTransitionMs = timeMs;

  let transition: AlarmTransition | undefined;
  if (nextState !== record.state) {
    transition = {
      alarmId: def.id,
      name: def.name,
      severity: def.severity,
      from: record.state,
      to: nextState,
      message: def.message,
      value,
    };
  }
  return { record: next, transition };
}

/** Acknowledge an alarm record (operator action). */
export function acknowledgeAlarm(record: SimAlarmRecord, timeMs: number): SimAlarmRecord {
  if (record.acknowledged) return record;
  let state: SimAlarmState = record.state;
  if (record.state === "active-unacknowledged") state = "active-acknowledged";
  else if (record.state === "returned-unacknowledged") state = "normal";
  return { ...record, acknowledged: true, state, lastTransitionMs: timeMs };
}
