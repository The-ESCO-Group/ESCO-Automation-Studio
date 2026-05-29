import { getHmiElementDefinition } from "./registry";
import type {
  HmiCommand,
  HmiGraphicElement,
  HmiProject,
  HmiSurfaceBase,
  HmiValidationContext,
  HmiValidationFinding,
} from "./types";

function finding(
  ruleId: string,
  severity: HmiValidationFinding["severity"],
  message: string,
  target?: string,
): HmiValidationFinding {
  return { ruleId, severity, message, target };
}

function surfaces(project: HmiProject): HmiSurfaceBase[] {
  return [...project.screens, ...project.popups, project.systemBanner];
}

function knownTargets(project: HmiProject) {
  return {
    screens: new Set(project.screens.map((screen) => screen.id)),
    popups: new Set(project.popups.map((popup) => popup.id)),
    languages: new Set(project.languagePacks.map((language) => language.languageId)),
    dataLogs: new Set(project.dataLogs.map((log) => log.id)),
  };
}

function validateCommand(
  command: HmiCommand,
  project: HmiProject,
  target: string,
  findings: HmiValidationFinding[],
) {
  const targets = knownTargets(project);
  if (command.type === "navigate") {
    const screenId = command.args.screenId;
    if (typeof screenId !== "string" || !targets.screens.has(screenId)) {
      findings.push(finding("hmi-event-missing-screen", "error", "Navigate command targets a missing screen.", target));
    }
  }
  if (command.type === "open-popup") {
    const popupId = command.args.popupId;
    if (typeof popupId !== "string" || !targets.popups.has(popupId)) {
      findings.push(finding("hmi-event-missing-popup", "error", "Open popup command targets a missing popup.", target));
    }
  }
  if (command.type === "change-language") {
    const languageId = command.args.languageId;
    if (typeof languageId !== "string" || !targets.languages.has(languageId)) {
      findings.push(finding("hmi-event-missing-language", "warning", "Change language command targets a missing language pack.", target));
    }
  }
  if ((command.type === "export-data-log" || command.type === "clear-data-log") && typeof command.args.dataLogId === "string") {
    if (!targets.dataLogs.has(command.args.dataLogId)) {
      findings.push(finding("hmi-event-missing-data-log", "warning", "Data log command targets a missing data log.", target));
    }
  }
  if (command.safety === "hardware-only") {
    findings.push(finding("hmi-command-model-only", "info", "Hardware command is preserved model-only; no device action will run.", target));
  }
  if (command.safety === "unsupported" || command.type === "unknown") {
    findings.push(finding("hmi-command-unsupported", "warning", "Unknown HMI command is preserved read-only.", target));
  }
}

function validateElement(
  element: HmiGraphicElement,
  project: HmiProject,
  context: HmiValidationContext,
  surfaceTarget: string,
  findings: HmiValidationFinding[],
) {
  const elementTarget = `${surfaceTarget}/element:${element.id}`;
  const definition = getHmiElementDefinition(element.typeId);
  if (!element.name.trim()) {
    findings.push(finding("hmi-element-name-required", "error", "Graphic element name is required.", elementTarget));
  }
  if (!definition || element.unsupported) {
    findings.push(finding("hmi-element-unsupported", "warning", `Unsupported HMI element "${element.typeId}" is preserved read-only.`, elementTarget));
  } else if (definition.runtimeSupport === "model-only") {
    findings.push(finding("hmi-element-model-only", "info", `${definition.displayName} is modeled but not simulated yet.`, elementTarget));
  }
  if (element.geometry.width <= 0 || element.geometry.height <= 0) {
    findings.push(finding("hmi-element-invalid-geometry", "error", "Graphic element width and height must be greater than zero.", elementTarget));
  }

  const knownTags = new Set(context.knownTagPaths ?? []);
  for (const binding of element.bindings) {
    const bindingTarget = `${elementTarget}/binding:${binding.id}`;
    if (!binding.targetProperty.trim()) {
      findings.push(finding("hmi-binding-target-required", "error", "Binding target property is required.", bindingTarget));
    }
    if (!binding.source.path.trim()) {
      findings.push(finding("hmi-binding-source-required", "error", "Binding source path is required.", bindingTarget));
    }
    if (binding.source.kind === "tag" && context.knownTagPaths && !knownTags.has(binding.source.path)) {
      findings.push(finding("hmi-binding-missing-tag", "error", `Binding references missing tag "${binding.source.path}".`, bindingTarget));
    }
  }

  for (const event of element.events) {
    if (event.commands.length === 0) {
      findings.push(finding("hmi-event-empty", "warning", "Event handler has no commands.", `${elementTarget}/event:${event.id}`));
    }
    for (const command of event.commands) {
      validateCommand(command, project, `${elementTarget}/event:${event.id}/command:${command.id}`, findings);
    }
  }
}

export function validateHmiProject(
  project: HmiProject | undefined,
  context: HmiValidationContext = {},
): HmiValidationFinding[] {
  if (!project) {
    return [finding("hmi-project-missing", "info", "No HMI project is configured.")];
  }

  const findings: HmiValidationFinding[] = [];
  if (!project.name.trim()) {
    findings.push(finding("hmi-project-name-required", "error", "HMI project name is required.", "hmi"));
  }
  if (project.targetDevice.width <= 0 || project.targetDevice.height <= 0) {
    findings.push(finding("hmi-device-invalid-size", "error", "Target HMI device must have a valid display size.", "hmi/device"));
  }
  if (project.screens.length === 0) {
    findings.push(finding("hmi-no-screens", "info", "No HMI screens have been created yet.", "hmi/screens"));
  }
  if (project.homeScreenId && !project.screens.some((screen) => screen.id === project.homeScreenId)) {
    findings.push(finding("hmi-home-screen-missing", "error", "Home screen points to a missing screen.", "hmi/homeScreenId"));
  }
  if (!project.homeScreenId && project.screens.length > 0) {
    findings.push(finding("hmi-home-screen-unset", "warning", "HMI project has screens but no home screen is selected.", "hmi/homeScreenId"));
  }

  const screenNames = new Set<string>();
  for (const screen of project.screens) {
    if (!screen.name.trim()) {
      findings.push(finding("hmi-screen-name-required", "error", "Screen name is required.", `hmi/screen:${screen.id}`));
    }
    if (screenNames.has(screen.name.toLowerCase())) {
      findings.push(finding("hmi-screen-name-duplicate", "error", `Duplicate screen name "${screen.name}".`, `hmi/screen:${screen.id}`));
    }
    screenNames.add(screen.name.toLowerCase());
  }

  for (const surface of surfaces(project)) {
    const surfaceTarget = `hmi/${surface.kind}:${surface.id}`;
    if (surface.width <= 0 || surface.height <= 0) {
      findings.push(finding("hmi-surface-invalid-size", "error", "HMI surface width and height must be greater than zero.", surfaceTarget));
    }
    for (const element of surface.elements) {
      validateElement(element, project, context, surfaceTarget, findings);
    }
  }

  for (const shortcut of project.shortcuts) {
    const valid =
      shortcut.targetKind === "screen"
        ? project.screens.some((screen) => screen.id === shortcut.targetId)
        : project.popups.some((popup) => popup.id === shortcut.targetId);
    if (!valid) {
      findings.push(finding("hmi-shortcut-target-missing", "error", `Shortcut "${shortcut.name}" targets missing content.`, `hmi/shortcut:${shortcut.id}`));
    }
  }

  for (const trend of project.trends) {
    if (trend.traces.length === 0) {
      findings.push(finding("hmi-trend-no-traces", "warning", `Trend "${trend.name}" has no traces.`, `hmi/trend:${trend.id}`));
    }
  }

  for (const log of project.dataLogs) {
    if (log.tagPaths.length === 0) {
      findings.push(finding("hmi-data-log-no-tags", "warning", `Data log "${log.name}" has no tag paths.`, `hmi/data-log:${log.id}`));
    }
  }

  for (const item of project.unsupportedContent) {
    findings.push(finding("hmi-unsupported-content", "warning", `Unsupported HMI content "${item.displayName}" is preserved read-only.`, `hmi/unsupported:${item.id}`));
  }

  return findings;
}
