/**
 * Virtual fault-injection descriptors. Faults are entirely simulated — they
 * never reach hardware. The engine applies a fault's effect to a device's
 * virtual tags during its pre-logic step (see engine.ts `stepDevice`).
 */

import type { SimDevice, SimFaultKind } from "./types";

export interface SimFaultInfo {
  id: SimFaultKind;
  label: string;
  description: string;
}

export const FAULT_INFO: Record<SimFaultKind, SimFaultInfo> = {
  overload: { id: "overload", label: "Overload Trip", description: "Drives the device's overload/fault input true." },
  "comm-loss": { id: "comm-loss", label: "Comm Loss", description: "Simulates loss of feedback/communication from the device." },
  stuck: { id: "stuck", label: "Stuck", description: "Freezes a moving element (e.g. valve travel) in place." },
  "sensor-fail": { id: "sensor-fail", label: "Sensor Failure", description: "Holds an instrument reading at zero/last value." },
  "out-of-range": { id: "out-of-range", label: "Out of Range", description: "Drives an instrument above its high-high limit." },
  estop: { id: "estop", label: "E-Stop", description: "Opens a safety circuit (healthy input goes false)." },
};

export function faultInfo(kind: SimFaultKind): SimFaultInfo {
  return FAULT_INFO[kind];
}

/** Whether a device supports having the given fault injected. */
export function deviceSupportsFault(device: SimDevice, fault: SimFaultKind): boolean {
  return device.faultStates.includes(fault);
}

/** Fault kinds a device supports, with display metadata. */
export function deviceFaults(device: SimDevice): SimFaultInfo[] {
  return device.faultStates.map(faultInfo);
}
