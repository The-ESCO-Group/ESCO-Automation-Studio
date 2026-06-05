/**
 * Simulation project factory and ESCO-native state actions.
 *
 * All actions are immutable: they clone the project, mutate the clone (allocating
 * deterministic ids from the project's own counter), bump `updatedAtLabel`, and
 * return a fresh object. This is the single source of truth — device, logic,
 * scenario, and HMI edits flow through here, never through ephemeral UI state.
 */

import {
  CONTROLLER_MODELS,
  type SimControllerModelInfo,
  type SimDeviceCounts,
  DEVICE_KINDS,
  deviceBlueprint,
  EMPTY_DEVICE_COUNTS,
  processTypeInfo,
  TAG,
} from "./catalog";
import { SIM_LAB_OFFLINE_BOUNDARY } from "./boundary";
import { createDevice } from "./devices";
import { nextSimId } from "./ids";
import { createLogicBlock } from "./logic-templates";
import type {
  SimActionResult,
  SimControllerModel,
  SimDevice,
  SimDeviceKind,
  SimHmiScreen,
  SimHmiWidget,
  SimIoRack,
  SimLogicBlock,
  SimProcessType,
  SimProject,
  SimScenario,
  SimVirtualTag,
} from "./types";

const SCHEMA = "esco-sim-lab/v1" as const;

function defaultNow(): string {
  return new Date().toISOString();
}

export interface CreateSimProjectOptions {
  name: string;
  processType: SimProcessType;
  controller?: SimControllerModelInfo;
  scanRateMs?: number;
  rackCount?: number;
  rackSlots?: number;
  deviceCounts?: Partial<SimDeviceCounts>;
  /** Seed devices from the process-type defaults (or `deviceCounts`). Default true. */
  seedDefaults?: boolean;
  now?: () => string;
}

const COUNT_TO_KIND: Record<keyof SimDeviceCounts, SimDeviceKind> = {
  motors: "motor",
  vfds: "vfd",
  valves: "valve",
  flowMeters: "flow-meter",
  levelTransmitters: "level-transmitter",
  temperatureSensors: "temperature-sensor",
  safetyInputs: "safety-input",
};

export function defaultDeviceTag(kind: SimDeviceKind, index: number): string {
  return `${deviceBlueprint(kind).prefixHint}${101 + index}`;
}

function clone(project: SimProject): SimProject {
  return structuredClone(project);
}

/** Clone, run a mutator that may allocate ids, then stamp the update label. */
function mutate(
  project: SimProject,
  mutator: (draft: SimProject) => void,
  now: () => string = defaultNow,
): SimProject {
  const draft = clone(project);
  mutator(draft);
  draft.updatedAtLabel = now();
  return draft;
}

export function createSimProject(options: CreateSimProjectOptions): SimProject {
  const now = options.now ?? defaultNow;
  const stamp = now();
  const model = options.controller ?? CONTROLLER_MODELS[0]!;
  const scanRateMs = options.scanRateMs ?? model.scanRateMs;
  const controller: SimControllerModel = {
    id: "ctrl_1",
    name: model.name,
    catalog: model.catalog,
    scanRateMs,
    description: model.description,
    offlineOnly: true,
  };

  const project: SimProject = {
    schema: SCHEMA,
    id: "simproj_1",
    name: options.name,
    processType: options.processType,
    controller,
    racks: [],
    devices: [],
    logicBlocks: [],
    hmiScreens: [],
    scenarios: [],
    reports: [],
    boundary: SIM_LAB_OFFLINE_BOUNDARY,
    offlineOnly: true,
    createdAtLabel: stamp,
    updatedAtLabel: stamp,
    _idSeq: 0,
  };

  const rackCount = Math.max(1, options.rackCount ?? 1);
  const rackSlots = options.rackSlots ?? 8;
  for (let i = 0; i < rackCount; i += 1) {
    project.racks.push({
      id: nextSimId(project, "rack"),
      name: `Rack ${String.fromCharCode(65 + i)}`,
      slots: rackSlots,
      description: `Virtual I/O rack with ${rackSlots} slots.`,
    });
  }

  const seedDefaults = options.seedDefaults ?? true;
  if (seedDefaults) {
    const base = processTypeInfo(options.processType).defaults;
    const counts: SimDeviceCounts = { ...EMPTY_DEVICE_COUNTS, ...base, ...options.deviceCounts };
    const rackId = project.racks[0]?.id;
    for (const key of Object.keys(COUNT_TO_KIND) as (keyof SimDeviceCounts)[]) {
      const kind = COUNT_TO_KIND[key];
      const n = counts[key];
      for (let i = 0; i < n; i += 1) {
        const tag = defaultDeviceTag(kind, project.devices.filter((d) => d.kind === kind).length);
        const device = createDevice(project, { kind, tag, rackId });
        project.devices.push(device);
      }
    }
    seedDefaultLogic(project);
  }

  return project;
}

/**
 * Seed default logic and process coupling so the built-in scenarios are
 * self-consistent: every motor gets a holding circuit (with a safety permissive
 * if present, and an overload interlock) plus a start counter, and flow meters
 * follow the first motor's run feedback.
 */
function seedDefaultLogic(project: SimProject): void {
  const motors = project.devices.filter((d) => d.kind === "motor");
  const safety = project.devices.find((d) => d.kind === "safety-input");
  for (const m of motors) {
    const permissives = safety ? [`${safety.tag}_${TAG.ok}`] : [];
    project.logicBlocks.push(
      createLogicBlock(
        project,
        "motor-holding-interlocks",
        {
          start: `${m.tag}_${TAG.startPb}`,
          stop: `${m.tag}_${TAG.stopPb}`,
          runCmd: `${m.tag}_${TAG.runCmd}`,
          permissives: permissives.join(","),
          trips: `${m.tag}_${TAG.overload}`,
        },
        `${m.tag} Holding Circuit`,
      ),
    );
    project.logicBlocks.push(
      createLogicBlock(
        project,
        "motor-start-counter",
        { run: `${m.tag}_${TAG.run}`, starts: `${m.tag}_${TAG.starts}` },
        `${m.tag} Start Counter`,
      ),
    );
  }

  const firstMotor = motors[0];
  if (firstMotor) {
    for (const fm of project.devices.filter((d) => d.kind === "flow-meter")) {
      fm.signalBehavior = {
        kind: "follow-command",
        commandTag: `${firstMotor.tag}_${TAG.run}`,
        low: 5,
        high: 350,
        ratePerSec: 300,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Device actions
// ---------------------------------------------------------------------------

export interface AddDeviceInput {
  kind: SimDeviceKind;
  tag?: string;
  name?: string;
  rackId?: string;
}

export function addDevice(
  project: SimProject,
  input: AddDeviceInput,
  now?: () => string,
): SimActionResult<SimDevice> {
  // A blank/whitespace tag means "use the next default tag for this kind".
  const provided = input.tag?.trim();
  const tag = provided && provided.length > 0
    ? provided
    : defaultDeviceTag(input.kind, project.devices.filter((d) => d.kind === input.kind).length);
  if (project.devices.some((d) => d.tag === tag)) {
    return { ok: false, project, error: `A device with tag "${tag}" already exists.` };
  }
  let created: SimDevice | undefined;
  const next = mutate(
    project,
    (draft) => {
      const device = createDevice(draft, {
        kind: input.kind,
        tag,
        name: input.name?.trim() || undefined,
        rackId: input.rackId ?? draft.racks[0]?.id,
      });
      draft.devices.push(device);
      created = device;
    },
    now,
  );
  return { ok: true, project: next, data: created };
}

export function removeDevice(project: SimProject, deviceId: string, now?: () => string): SimActionResult {
  if (!project.devices.some((d) => d.id === deviceId)) {
    return { ok: false, project, error: "Device not found." };
  }
  const next = mutate(
    project,
    (draft) => {
      draft.devices = draft.devices.filter((d) => d.id !== deviceId);
    },
    now,
  );
  return { ok: true, project: next };
}

export type DevicePatch = Partial<Pick<SimDevice, "name" | "units" | "scaling" | "limits" | "rackId" | "signalBehavior">>;

export function updateDevice(
  project: SimProject,
  deviceId: string,
  patch: DevicePatch,
  now?: () => string,
): SimActionResult {
  const device = project.devices.find((d) => d.id === deviceId);
  if (!device) return { ok: false, project, error: "Device not found." };
  const next = mutate(
    project,
    (draft) => {
      const target = draft.devices.find((d) => d.id === deviceId)!;
      Object.assign(target, patch);
    },
    now,
  );
  return { ok: true, project: next };
}

export type TagPatch = Partial<Pick<SimVirtualTag, "units" | "scaling" | "description" | "initial">>;

export function updateDeviceTag(
  project: SimProject,
  deviceId: string,
  tagId: string,
  patch: TagPatch,
  now?: () => string,
): SimActionResult {
  const device = project.devices.find((d) => d.id === deviceId);
  if (!device) return { ok: false, project, error: "Device not found." };
  if (!device.tags.some((t) => t.id === tagId)) {
    return { ok: false, project, error: "Tag not found on device." };
  }
  const next = mutate(
    project,
    (draft) => {
      const target = draft.devices.find((d) => d.id === deviceId)!.tags.find((t) => t.id === tagId)!;
      Object.assign(target, patch);
    },
    now,
  );
  return { ok: true, project: next };
}

// ---------------------------------------------------------------------------
// Rack actions
// ---------------------------------------------------------------------------

export function addRack(project: SimProject, name?: string, slots = 8, now?: () => string): SimActionResult<SimIoRack> {
  let created: SimIoRack | undefined;
  const next = mutate(
    project,
    (draft) => {
      const rack: SimIoRack = {
        id: nextSimId(draft, "rack"),
        name: name?.trim() || `Rack ${String.fromCharCode(65 + draft.racks.length)}`,
        slots,
        description: `Virtual I/O rack with ${slots} slots.`,
      };
      draft.racks.push(rack);
      created = rack;
    },
    now,
  );
  return { ok: true, project: next, data: created };
}

// ---------------------------------------------------------------------------
// Logic actions
// ---------------------------------------------------------------------------

export function addLogicBlock(project: SimProject, block: SimLogicBlock, now?: () => string): SimActionResult<SimLogicBlock> {
  const next = mutate(
    project,
    (draft) => {
      draft.logicBlocks.push(block);
    },
    now,
  );
  return { ok: true, project: next, data: block };
}

export function removeLogicBlock(project: SimProject, blockId: string, now?: () => string): SimActionResult {
  if (!project.logicBlocks.some((b) => b.id === blockId)) {
    return { ok: false, project, error: "Logic block not found." };
  }
  const next = mutate(
    project,
    (draft) => {
      draft.logicBlocks = draft.logicBlocks.filter((b) => b.id !== blockId);
    },
    now,
  );
  return { ok: true, project: next };
}

// ---------------------------------------------------------------------------
// Scenario actions
// ---------------------------------------------------------------------------

export function addScenario(project: SimProject, scenario: SimScenario, now?: () => string): SimActionResult<SimScenario> {
  const next = mutate(
    project,
    (draft) => {
      draft.scenarios.push(scenario);
    },
    now,
  );
  return { ok: true, project: next, data: scenario };
}

export function removeScenario(project: SimProject, scenarioId: string, now?: () => string): SimActionResult {
  if (!project.scenarios.some((s) => s.id === scenarioId)) {
    return { ok: false, project, error: "Scenario not found." };
  }
  const next = mutate(
    project,
    (draft) => {
      draft.scenarios = draft.scenarios.filter((s) => s.id !== scenarioId);
    },
    now,
  );
  return { ok: true, project: next };
}

// ---------------------------------------------------------------------------
// HMI actions
// ---------------------------------------------------------------------------

export function addHmiScreen(project: SimProject, name: string, now?: () => string): SimActionResult<SimHmiScreen> {
  let created: SimHmiScreen | undefined;
  const next = mutate(
    project,
    (draft) => {
      const screen: SimHmiScreen = { id: nextSimId(draft, "screen"), name: name.trim() || "Screen", widgets: [] };
      draft.hmiScreens.push(screen);
      created = screen;
    },
    now,
  );
  return { ok: true, project: next, data: created };
}

export function addHmiWidget(
  project: SimProject,
  screenId: string,
  widget: Omit<SimHmiWidget, "id">,
  now?: () => string,
): SimActionResult<SimHmiWidget> {
  const screen = project.hmiScreens.find((s) => s.id === screenId);
  if (!screen) return { ok: false, project, error: "HMI screen not found." };
  let created: SimHmiWidget | undefined;
  const next = mutate(
    project,
    (draft) => {
      const target = draft.hmiScreens.find((s) => s.id === screenId)!;
      const full: SimHmiWidget = { ...widget, id: nextSimId(draft, "widget") };
      target.widgets.push(full);
      created = full;
    },
    now,
  );
  return { ok: true, project: next, data: created };
}

// ---------------------------------------------------------------------------
// Controller / project settings
// ---------------------------------------------------------------------------

export function setScanRate(project: SimProject, scanRateMs: number, now?: () => string): SimActionResult {
  if (!(scanRateMs > 0)) return { ok: false, project, error: "Scan rate must be greater than zero." };
  const next = mutate(
    project,
    (draft) => {
      draft.controller.scanRateMs = scanRateMs;
    },
    now,
  );
  return { ok: true, project: next };
}

export function renameProject(project: SimProject, name: string, now?: () => string): SimActionResult {
  if (!name.trim()) return { ok: false, project, error: "Project name is required." };
  const next = mutate(
    project,
    (draft) => {
      draft.name = name.trim();
    },
    now,
  );
  return { ok: true, project: next };
}

// ---------------------------------------------------------------------------
// Serialization (ESCO-native .escosim.json)
// ---------------------------------------------------------------------------

export const SIM_PROJECT_EXTENSION = ".escosim.json";

export function serializeSimProject(project: SimProject): string {
  return JSON.stringify(project, null, 2);
}

export function deserializeSimProject(text: string): SimProject {
  const data = JSON.parse(text) as SimProject;
  if (data.schema !== SCHEMA) {
    throw new Error(`Unsupported Simulation Lab project schema: ${String((data as { schema?: string }).schema)}`);
  }
  return data;
}

/** All device-kind keys, for UI palettes. */
export { DEVICE_KINDS };
