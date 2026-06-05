/** Device factory: turns a blueprint into a fully-tagged ESCO-native device. */

import { deviceBlueprint, type SimDeviceBlueprint, TAG } from "./catalog";
import { nextSimId, type SimIdCounter } from "./ids";
import type {
  SimAlarmRef,
  SimDevice,
  SimDeviceKind,
  SimInterlock,
  SimVirtualTag,
} from "./types";

export interface CreateDeviceOptions {
  kind: SimDeviceKind;
  tag: string;
  name?: string;
  rackId?: string;
}

/** Build the virtual tags for a device from its blueprint. */
export function generateDeviceTags(
  counter: SimIdCounter,
  deviceId: string,
  deviceTag: string,
  blueprint: SimDeviceBlueprint,
): SimVirtualTag[] {
  return blueprint.tags.map((spec) => {
    const tag: SimVirtualTag = {
      id: nextSimId(counter, "tag"),
      name: `${deviceTag}_${spec.suffix}`,
      deviceId,
      dataType: spec.dataType,
      direction: spec.direction,
      initial: spec.initial,
      description: spec.description,
    };
    if (spec.units) tag.units = spec.units;
    if (spec.scaling) tag.scaling = spec.scaling;
    return tag;
  });
}

function generateDeviceAlarms(
  counter: SimIdCounter,
  deviceTag: string,
  blueprint: SimDeviceBlueprint,
  tags: SimVirtualTag[],
): SimAlarmRef[] {
  return blueprint.alarms.map((spec) => {
    const tagName = `${deviceTag}_${spec.tagSuffix}`;
    const alarm: SimAlarmRef = {
      id: nextSimId(counter, "alm"),
      name: `${deviceTag}_${spec.nameSuffix}`,
      tag: tagName,
      severity: spec.severity,
      trigger: spec.trigger,
      message: spec.message,
    };
    const target = tags.find((t) => t.name === tagName);
    if (target) target.alarmRefs = [...(target.alarmRefs ?? []), alarm.id];
    return alarm;
  });
}

function generateDeviceInterlocks(
  counter: SimIdCounter,
  deviceTag: string,
  blueprint: SimDeviceBlueprint,
): SimInterlock[] {
  return blueprint.interlocks.map((spec) => ({
    id: nextSimId(counter, "ilk"),
    name: `${deviceTag} ${spec.name}`,
    kind: spec.kind,
    tag: `${deviceTag}_${spec.tagSuffix}`,
    comparison: spec.comparison,
    value: spec.value,
    description: spec.description,
  }));
}

/** Create a complete device (tags, alarms, interlocks) with deterministic ids. */
export function createDevice(counter: SimIdCounter, options: CreateDeviceOptions): SimDevice {
  const blueprint = deviceBlueprint(options.kind);
  const id = nextSimId(counter, "dev");
  const deviceTag = options.tag;
  const tags = generateDeviceTags(counter, id, deviceTag, blueprint);
  const alarms = generateDeviceAlarms(counter, deviceTag, blueprint, tags);
  const interlocks = generateDeviceInterlocks(counter, deviceTag, blueprint);
  const device: SimDevice = {
    id,
    kind: options.kind,
    tag: deviceTag,
    name: options.name ?? `${blueprint.label} ${deviceTag}`,
    signalBehavior: blueprint.signalBehavior(deviceTag),
    faultStates: [...blueprint.faultStates],
    interlocks,
    alarms,
    tags,
    testExpectations: [],
  };
  if (options.rackId) device.rackId = options.rackId;
  if (blueprint.units) device.units = blueprint.units;
  if (blueprint.scaling) device.scaling = blueprint.scaling;
  if (blueprint.limits) device.limits = blueprint.limits;
  return device;
}

/** Suffix of a device's primary analog process value, if any. */
export function devicePvSuffix(kind: SimDeviceKind): string | undefined {
  return deviceBlueprint(kind).pvSuffix;
}

/** The run/feedback tag used to summarise a device's running state on the mimic. */
export function deviceStatusTag(device: SimDevice): string | undefined {
  switch (device.kind) {
    case "motor":
    case "vfd":
      return `${device.tag}_${TAG.run}`;
    case "valve":
      return `${device.tag}_${TAG.open}`;
    case "safety-input":
      return `${device.tag}_${TAG.ok}`;
    default:
      return device.tag + "_" + TAG.pv;
  }
}
