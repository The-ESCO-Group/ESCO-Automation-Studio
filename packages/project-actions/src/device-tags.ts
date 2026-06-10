import type { PlcProject } from "@esco/core";
import { collectTagReferences, type TagReference } from "./cross-reference";
import { fail, ok } from "./helpers";
import { createTag } from "./tag-actions";
import type { ProjectActionResult } from "./types";

/**
 * Vendor-neutral device → tag bridge for the engineering project model.
 *
 * The Simulation Lab already models field devices (motors, VFDs, valves,
 * meters, …), but that lives inside the sim engine. This module brings the same
 * vendor-neutral device concept to the *project* layer so that adding a device
 * can auto-generate its controller tags, and so a device can be cross-referenced
 * down to the ladder logic that uses its tags. Nothing here is tied to any PLC
 * vendor or proprietary catalog — signal sets are generic ESCO-native defaults
 * that callers can override per device.
 */

export type DeviceKind =
  | "motor"
  | "vfd"
  | "valve"
  | "flow-meter"
  | "level-transmitter"
  | "temperature-sensor"
  | "discrete-sensor"
  | "analog-sensor";

export type DeviceSignalDirection = "input" | "output" | "internal";

export interface DeviceSignal {
  /** Tag-name suffix appended to the device prefix (e.g. "Run" → "P101_Run"). */
  suffix: string;
  dataType: string;
  direction: DeviceSignalDirection;
  description?: string;
  units?: string;
}

export interface DeviceProfile {
  kind: DeviceKind;
  /** Device tag prefix / equipment id, e.g. "P101". */
  prefix: string;
  name?: string;
  /** Replace the catalog signal set for this device. Omit to use the defaults. */
  signals?: DeviceSignal[];
}

const bool = (suffix: string, direction: DeviceSignalDirection, description: string): DeviceSignal => ({
  suffix,
  dataType: "BOOL",
  direction,
  description,
});

const real = (suffix: string, direction: DeviceSignalDirection, description: string, units?: string): DeviceSignal => ({
  suffix,
  dataType: "REAL",
  direction,
  description,
  ...(units ? { units } : {}),
});

/** Vendor-neutral default signal sets per device kind. */
const DEVICE_CATALOG: Record<DeviceKind, { name: string; signals: DeviceSignal[] }> = {
  motor: {
    name: "Motor",
    signals: [
      bool("StartPB", "input", "Start pushbutton"),
      bool("StopPB", "input", "Stop pushbutton"),
      bool("RunCmd", "output", "Run command to starter"),
      bool("Run", "input", "Run feedback / auxiliary contact"),
      bool("Overload", "input", "Overload / motor protection trip"),
      bool("Fault", "internal", "Latched fault"),
    ],
  },
  vfd: {
    name: "Variable Frequency Drive",
    signals: [
      bool("RunCmd", "output", "Run command"),
      real("SpeedCmd", "output", "Speed reference", "%"),
      real("SpeedFb", "input", "Speed feedback", "%"),
      bool("Run", "input", "Running feedback"),
      bool("Fault", "input", "Drive fault"),
    ],
  },
  valve: {
    name: "Valve",
    signals: [
      bool("OpenCmd", "output", "Open command"),
      bool("CloseCmd", "output", "Close command"),
      bool("Open", "input", "Open limit feedback"),
      bool("Closed", "input", "Closed limit feedback"),
      bool("Fault", "internal", "Travel/torque fault"),
    ],
  },
  "flow-meter": {
    name: "Flow Meter",
    signals: [
      real("PV", "input", "Flow process value", "gpm"),
      bool("Low", "internal", "Low-flow status"),
      bool("CommFail", "input", "Communication fault"),
    ],
  },
  "level-transmitter": {
    name: "Level Transmitter",
    signals: [
      real("PV", "input", "Level process value", "%"),
      bool("High", "internal", "High-level status"),
      bool("Low", "internal", "Low-level status"),
      bool("CommFail", "input", "Communication fault"),
    ],
  },
  "temperature-sensor": {
    name: "Temperature Sensor",
    signals: [
      real("PV", "input", "Temperature process value", "degF"),
      bool("High", "internal", "High-temperature status"),
      bool("CommFail", "input", "Communication fault"),
    ],
  },
  "discrete-sensor": {
    name: "Discrete Sensor",
    signals: [bool("State", "input", "Discrete sensor state")],
  },
  "analog-sensor": {
    name: "Analog Sensor",
    signals: [
      real("PV", "input", "Analog process value"),
      bool("CommFail", "input", "Communication fault"),
    ],
  },
};

/** The default human label for a device kind. */
export function deviceKindLabel(kind: DeviceKind): string {
  return DEVICE_CATALOG[kind]?.name ?? kind;
}

/** Resolve the signal set for a profile (its own override, else the catalog default). */
export function deviceSignals(profile: DeviceProfile): DeviceSignal[] {
  return profile.signals ?? DEVICE_CATALOG[profile.kind]?.signals ?? [];
}

/** Compose a device tag name from its prefix and a signal suffix. */
export function deviceTagName(prefix: string, suffix: string): string {
  return `${prefix}_${suffix}`;
}

export interface DeviceTagPlan {
  tagName: string;
  suffix: string;
  dataType: string;
  direction: DeviceSignalDirection;
  description?: string;
  units?: string;
}

/** The controller tags a device profile maps to — no project mutation. */
export function planDeviceTags(profile: DeviceProfile): DeviceTagPlan[] {
  const prefix = profile.prefix?.trim() ?? "";
  return deviceSignals(profile).map((signal) => ({
    tagName: deviceTagName(prefix, signal.suffix),
    suffix: signal.suffix,
    dataType: signal.dataType,
    direction: signal.direction,
    description: signal.description,
    units: signal.units,
  }));
}

export interface GenerateDeviceTagsInput {
  profile: DeviceProfile;
  scope?: "controller" | "program";
  programId?: string;
}

export interface GenerateDeviceTagsData {
  created: string[];
  skipped: { tagName: string; reason: string }[];
}

/**
 * Generate the controller (or program) tags for a device profile. Each tag goes
 * through the standard {@link createTag} action, so name validation and
 * duplicate detection are reused — an existing tag is reported as `skipped`
 * rather than overwritten (user work is preserved). Fails only if nothing could
 * be created at all.
 */
export function generateDeviceTags(
  project: PlcProject,
  input: GenerateDeviceTagsInput,
): ProjectActionResult<GenerateDeviceTagsData> {
  const profile = input.profile;
  if (!profile || !profile.prefix?.trim()) return fail(project, "Device prefix is required.");
  const plan = planDeviceTags(profile);
  if (plan.length === 0) return fail(project, `No signals defined for device kind "${profile.kind}".`);

  let current = project;
  const created: string[] = [];
  const skipped: { tagName: string; reason: string }[] = [];
  for (const item of plan) {
    const result = createTag(current, {
      name: item.tagName,
      dataType: item.dataType,
      scope: input.scope ?? "controller",
      programId: input.programId,
      description: item.description ?? `${profile.name ?? deviceKindLabel(profile.kind)} ${item.suffix}`,
    });
    if (result.ok) {
      current = result.project;
      created.push(item.tagName);
    } else {
      skipped.push({ tagName: item.tagName, reason: result.error ?? "rejected" });
    }
  }

  if (created.length === 0) {
    return fail(project, `No device tags were created for "${profile.prefix}": ${skipped.map((s) => s.reason).join("; ")}`);
  }
  const warnings = skipped.length > 0 ? skipped.map((s) => `Skipped "${s.tagName}": ${s.reason}`) : undefined;
  return ok(current, { created, skipped }, warnings);
}

export interface DeviceTagUsage {
  tagName: string;
  suffix: string;
  direction: DeviceSignalDirection;
  references: TagReference[];
}

export interface DeviceConnectionView {
  prefix: string;
  kind: DeviceKind;
  name?: string;
  tags: DeviceTagUsage[];
  /** Total ladder references across all of the device's tags. */
  referenceCount: number;
  /** Device tags that are defined by the profile but never referenced in logic. */
  unusedTags: string[];
}

/**
 * Build the device → tag → logic connection view: for each tag a device profile
 * owns, every place that tag is referenced in ladder logic (reusing
 * {@link collectTagReferences}). This is the data structure behind a
 * "what logic uses this device?" view and surfaces device tags wired up but
 * never used.
 */
export function deviceConnectionView(project: PlcProject, profile: DeviceProfile): DeviceConnectionView {
  const byTag = new Map<string, TagReference[]>();
  for (const reference of collectTagReferences(project)) {
    const list = byTag.get(reference.tag);
    if (list) list.push(reference);
    else byTag.set(reference.tag, [reference]);
  }

  const tags: DeviceTagUsage[] = planDeviceTags(profile).map((item) => ({
    tagName: item.tagName,
    suffix: item.suffix,
    direction: item.direction,
    references: byTag.get(item.tagName) ?? [],
  }));
  const referenceCount = tags.reduce((sum, tag) => sum + tag.references.length, 0);
  const unusedTags = tags.filter((tag) => tag.references.length === 0).map((tag) => tag.tagName);
  return { prefix: profile.prefix, kind: profile.kind, name: profile.name, tags, referenceCount, unusedTags };
}
