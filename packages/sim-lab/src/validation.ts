/**
 * Diagnostics for the Simulation Lab model: bad device maps, missing tags,
 * invalid units/scaling, and impossible scenario expectations. Mirrors the
 * @esco/validator finding shape (ruleId/severity/message/target).
 */

import type { LadderBranch } from "@esco/ladder";
import { isValidScaling, KNOWN_UNITS, tagIndex } from "./tags";
import type { SimProject, SimValidationFinding } from "./types";

function walkTagOperands(branch: LadderBranch, sink: (tag: string) => void): void {
  for (const node of branch.nodes) {
    for (const op of node.operands) {
      if (op.kind === "tag" && op.value) sink(op.value);
    }
  }
  for (const parallel of branch.parallelBranches ?? []) walkTagOperands(parallel, sink);
  if (branch.next) walkTagOperands(branch.next, sink);
}

export function validateSimProject(project: SimProject): SimValidationFinding[] {
  const findings: SimValidationFinding[] = [];
  const tags = tagIndex(project);
  const add = (ruleId: string, severity: SimValidationFinding["severity"], message: string, target?: string): void => {
    const finding: SimValidationFinding = { ruleId, severity, message };
    if (target) finding.target = target;
    findings.push(finding);
  };

  // --- device map -------------------------------------------------------
  if (project.devices.length === 0) {
    add("device-map-empty", "warning", "The device map is empty; add devices before simulating.", "devices");
  }
  const seenTags = new Map<string, string>();
  for (const device of project.devices) {
    if (!device.tag.trim()) add("device-tag-blank", "error", `Device "${device.name}" has no tag.`, device.id);
    const existing = seenTags.get(device.tag);
    if (existing) add("device-tag-duplicate", "error", `Duplicate device tag "${device.tag}".`, device.id);
    else seenTags.set(device.tag, device.id);
    if (device.tags.length === 0) add("device-no-tags", "warning", `Device "${device.tag}" generated no virtual tags.`, device.id);

    for (const tag of device.tags) {
      if (tag.units && !KNOWN_UNITS.has(tag.units)) {
        add("tag-unit-unknown", "info", `Tag "${tag.name}" uses unrecognized units "${tag.units}".`, tag.name);
      }
      if (tag.scaling && !isValidScaling(tag.scaling)) {
        add("tag-scaling-invalid", "error", `Tag "${tag.name}" has invalid scaling (zero span or non-finite bounds).`, tag.name);
      }
    }

    for (const alarm of device.alarms) {
      if (!tags.has(alarm.tag)) add("alarm-missing-tag", "error", `Alarm "${alarm.name}" references missing tag "${alarm.tag}".`, alarm.id);
    }
    for (const interlock of device.interlocks) {
      if (!tags.has(interlock.tag)) add("interlock-missing-tag", "warning", `Interlock "${interlock.name}" references missing tag "${interlock.tag}".`, interlock.id);
    }
    if (device.limits) {
      const { low, high, lowLow, highHigh } = device.limits;
      if (low != null && high != null && low >= high) add("limits-inverted", "warning", `Device "${device.tag}" has low limit ≥ high limit.`, device.id);
      if (lowLow != null && low != null && lowLow > low) add("limits-order", "warning", `Device "${device.tag}" has low-low above low.`, device.id);
      if (highHigh != null && high != null && highHigh < high) add("limits-order", "warning", `Device "${device.tag}" has high-high below high.`, device.id);
    }
  }

  // --- logic ------------------------------------------------------------
  for (const block of project.logicBlocks) {
    const referenced = new Set<string>();
    for (const rung of block.routine.rungs) walkTagOperands(rung.root, (t) => referenced.add(t));
    for (const tag of referenced) {
      if (!tags.has(tag)) add("logic-missing-tag", "error", `Logic "${block.name}" references missing tag "${tag}".`, block.id);
    }
    if (block.routine.rungs.length === 0) add("logic-empty", "warning", `Logic "${block.name}" has no rungs.`, block.id);
  }

  // --- scenarios --------------------------------------------------------
  for (const scenario of project.scenarios) {
    const checkCount = scenario.expectedTags.length + scenario.expectedAlarms.length + scenario.expectedEvents.length;
    if (checkCount === 0) add("scenario-no-checks", "warning", `Scenario "${scenario.name}" has no expectations.`, scenario.id);

    const alarmNames = new Set(project.devices.flatMap((d) => d.alarms.map((a) => a.name)));
    for (const exp of scenario.expectedTags) {
      if (!tags.has(exp.tag)) add("scenario-expectation-impossible", "error", `Scenario "${scenario.name}" expects unknown tag "${exp.tag}".`, scenario.id);
      const tagInfo = tags.get(exp.tag);
      if (tagInfo?.dataType === "BOOL" && typeof exp.value === "number") {
        add("scenario-expectation-type", "warning", `Scenario "${scenario.name}" compares BOOL tag "${exp.tag}" to a number.`, scenario.id);
      }
      if (exp.atMs != null && exp.atMs > scenario.durationMs) {
        add("scenario-expectation-time", "warning", `Scenario "${scenario.name}" checks "${exp.tag}" after the run window ends.`, scenario.id);
      }
    }
    for (const exp of scenario.expectedAlarms) {
      if (!alarmNames.has(exp.alarm)) add("scenario-expectation-impossible", "error", `Scenario "${scenario.name}" expects unknown alarm "${exp.alarm}".`, scenario.id);
    }
    for (const action of scenario.actions) {
      if (action.kind === "set-tag" && action.tag && !tags.has(action.tag)) {
        add("scenario-action-missing-tag", "error", `Scenario "${scenario.name}" sets unknown tag "${action.tag}".`, scenario.id);
      }
      if (action.kind === "inject-fault" && action.deviceId && !project.devices.some((d) => d.id === action.deviceId)) {
        add("scenario-action-missing-device", "error", `Scenario "${scenario.name}" injects a fault on a missing device.`, scenario.id);
      }
    }
  }

  // --- HMI --------------------------------------------------------------
  for (const screen of project.hmiScreens) {
    for (const widget of screen.widgets) {
      const tag = widget.tag?.trim();
      if (!tag) continue;
      if (!tags.has(tag)) {
        add(
          "hmi-widget-missing-tag",
          "error",
          `HMI widget "${widget.label}" on screen "${screen.name}" references missing tag "${tag}".`,
          widget.id,
        );
      }
    }
  }

  return findings;
}

export function summarizeFindings(findings: SimValidationFinding[]): { errors: number; warnings: number; info: number } {
  return {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
}
