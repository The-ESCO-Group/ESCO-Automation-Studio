import type { PlcProject } from "@esco/core";
import {
  createHmiElement,
  createHmiPopup as makeHmiPopup,
  createHmiScreen as makeHmiScreen,
  ensureHmiProject as ensureHmiModelProject,
  getHmiProject,
  touchHmiProject,
  validateHmiProject,
  withHmiProject,
  type HmiCommand,
  type HmiGraphicElement,
  type HmiProject,
  type HmiPropertyBinding,
  type HmiSurfaceKind,
} from "@esco/hmi-model";
import { fail, getAllTags, ok } from "./helpers";
import type { ProjectActionResult } from "./types";

export interface CreateHmiScreenInput {
  name: string;
  width?: number;
  height?: number;
}

export interface CreateHmiPopupInput {
  name: string;
  width?: number;
  height?: number;
}

export interface AddHmiElementInput {
  surfaceKind: HmiSurfaceKind;
  surfaceId: string;
  typeId: string;
  name?: string;
  preservedPayload?: unknown;
}

export interface UpdateHmiElementGeometryInput {
  surfaceKind: HmiSurfaceKind;
  surfaceId: string;
  elementId: string;
  geometry: HmiGraphicElement["geometry"];
}

export interface SetHmiElementBindingInput {
  surfaceKind: HmiSurfaceKind;
  surfaceId: string;
  elementId: string;
  binding: HmiPropertyBinding;
}

export interface AddHmiEventCommandInput {
  surfaceKind: HmiSurfaceKind;
  surfaceId: string;
  elementId: string;
  eventType: "press" | "release" | "state-enter" | "state-exit" | "value-change" | "load" | "unload";
  command: HmiCommand;
}

function knownTagPaths(project: PlcProject): string[] {
  return getAllTags(project).map((tag) => tag.name);
}

function hmiWarnings(project: PlcProject, hmi: HmiProject): string[] {
  return validateHmiProject(hmi, { knownTagPaths: knownTagPaths(project) })
    .filter((finding) => finding.severity !== "info")
    .map((finding) => finding.message);
}

function commitHmi<T>(
  project: PlcProject,
  hmi: HmiProject,
  data: T,
  warnings: string[] = [],
): ProjectActionResult<T> {
  const touched = touchHmiProject(hmi);
  const next = withHmiProject(project, touched) as PlcProject;
  return ok(next, data, [...warnings, ...hmiWarnings(next, touched)]);
}

function surfaceLabel(kind: HmiSurfaceKind): string {
  if (kind === "system-banner") return "system banner";
  if (kind === "add-on-graphic") return "add-on graphic";
  return kind;
}

function mapSurfaceElements(
  hmi: HmiProject,
  kind: HmiSurfaceKind,
  surfaceId: string,
  mapper: (elements: HmiGraphicElement[]) => HmiGraphicElement[],
): HmiProject | undefined {
  if (kind === "screen") {
    let found = false;
    const screens = hmi.screens.map((screen) => {
      if (screen.id !== surfaceId) return screen;
      found = true;
      return { ...screen, elements: mapper(screen.elements) };
    });
    return found ? { ...hmi, screens } : undefined;
  }
  if (kind === "popup") {
    let found = false;
    const popups = hmi.popups.map((popup) => {
      if (popup.id !== surfaceId) return popup;
      found = true;
      return { ...popup, elements: mapper(popup.elements) };
    });
    return found ? { ...hmi, popups } : undefined;
  }
  if (kind === "system-banner") {
    if (hmi.systemBanner.id !== surfaceId) return undefined;
    return { ...hmi, systemBanner: { ...hmi.systemBanner, elements: mapper(hmi.systemBanner.elements) } };
  }
  if (kind === "add-on-graphic") {
    let found = false;
    const addOnGraphics = hmi.addOnGraphics.map((definition) => {
      if (definition.id !== surfaceId) return definition;
      found = true;
      return { ...definition, elements: mapper(definition.elements) };
    });
    return found ? { ...hmi, addOnGraphics } : undefined;
  }
  return undefined;
}

export function ensureHmiProject(project: PlcProject): ProjectActionResult<{ hmiProjectId: string }> {
  const existing = getHmiProject(project);
  if (existing) return ok(project, { hmiProjectId: existing.id });

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  return commitHmi(project, hmi, { hmiProjectId: hmi.id });
}

export function createHmiScreen(
  project: PlcProject,
  input: CreateHmiScreenInput,
): ProjectActionResult<{ screenId: string }> {
  const name = input.name.trim();
  if (!name) return fail(project, "HMI screen name is required.");

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  if (hmi.screens.some((screen) => screen.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI screen "${name}" already exists.`);
  }

  const screen = makeHmiScreen(name, hmi.targetDevice);
  const sized = {
    ...screen,
    width: input.width ?? screen.width,
    height: input.height ?? screen.height,
  };
  const next: HmiProject = {
    ...hmi,
    homeScreenId: hmi.homeScreenId ?? sized.id,
    screens: [...hmi.screens, sized],
  };
  return commitHmi(project, next, { screenId: sized.id });
}

export function createHmiPopup(
  project: PlcProject,
  input: CreateHmiPopupInput,
): ProjectActionResult<{ popupId: string }> {
  const name = input.name.trim();
  if (!name) return fail(project, "HMI popup name is required.");

  const hmi = ensureHmiModelProject(project, `${project.name} HMI`);
  if (hmi.popups.some((popup) => popup.name.toLowerCase() === name.toLowerCase())) {
    return fail(project, `HMI popup "${name}" already exists.`);
  }
  const popup = makeHmiPopup(name, input.width, input.height);
  const next = { ...hmi, popups: [...hmi.popups, popup] };
  return commitHmi(project, next, { popupId: popup.id });
}

export function addHmiElement(
  project: PlcProject,
  input: AddHmiElementInput,
): ProjectActionResult<{ elementId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "Create or enable an HMI project before adding graphic elements.");

  const element = createHmiElement(input.typeId, input.name, input.preservedPayload);
  const next = mapSurfaceElements(hmi, input.surfaceKind, input.surfaceId, (elements) => [
    ...elements,
    { ...element, zIndex: elements.length },
  ]);
  if (!next) return fail(project, `HMI ${surfaceLabel(input.surfaceKind)} was not found.`);

  const readonlyWarning = element.unsupported ? [`${element.typeId} was added as read-only unsupported content.`] : [];
  return commitHmi(project, next, { elementId: element.id }, readonlyWarning);
}

export function updateHmiElementGeometry(
  project: PlcProject,
  input: UpdateHmiElementGeometryInput,
): ProjectActionResult<{ elementId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");
  if (input.geometry.width <= 0 || input.geometry.height <= 0) {
    return fail(project, "HMI element width and height must be greater than zero.");
  }

  let updated = false;
  const next = mapSurfaceElements(hmi, input.surfaceKind, input.surfaceId, (elements) =>
    elements.map((element) => {
      if (element.id !== input.elementId) return element;
      if (element.unsupported) return element;
      updated = true;
      return { ...element, geometry: { ...input.geometry } };
    }),
  );
  if (!next) return fail(project, `HMI ${surfaceLabel(input.surfaceKind)} was not found.`);
  if (!updated) return fail(project, "HMI element was not found or is read-only unsupported content.");
  return commitHmi(project, next, { elementId: input.elementId });
}

export function setHmiElementBinding(
  project: PlcProject,
  input: SetHmiElementBindingInput,
): ProjectActionResult<{ elementId: string; bindingId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");

  let updated = false;
  const next = mapSurfaceElements(hmi, input.surfaceKind, input.surfaceId, (elements) =>
    elements.map((element) => {
      if (element.id !== input.elementId) return element;
      if (element.unsupported) return element;
      updated = true;
      const others = element.bindings.filter((binding) => binding.id !== input.binding.id);
      return { ...element, bindings: [...others, input.binding] };
    }),
  );
  if (!next) return fail(project, `HMI ${surfaceLabel(input.surfaceKind)} was not found.`);
  if (!updated) return fail(project, "HMI element was not found or is read-only unsupported content.");
  return commitHmi(project, next, { elementId: input.elementId, bindingId: input.binding.id });
}

export function addHmiEventCommand(
  project: PlcProject,
  input: AddHmiEventCommandInput,
): ProjectActionResult<{ elementId: string; commandId: string }> {
  const hmi = getHmiProject(project);
  if (!hmi) return fail(project, "No HMI project is configured.");

  let updated = false;
  const next = mapSurfaceElements(hmi, input.surfaceKind, input.surfaceId, (elements) =>
    elements.map((element) => {
      if (element.id !== input.elementId) return element;
      if (element.unsupported) return element;
      updated = true;
      const existing = element.events.find((event) => event.eventType === input.eventType);
      if (!existing) {
        return {
          ...element,
          events: [...element.events, { id: `event_${input.eventType}`, eventType: input.eventType, commands: [input.command] }],
        };
      }
      return {
        ...element,
        events: element.events.map((event) =>
          event.id === existing.id ? { ...event, commands: [...event.commands, input.command] } : event,
        ),
      };
    }),
  );
  if (!next) return fail(project, `HMI ${surfaceLabel(input.surfaceKind)} was not found.`);
  if (!updated) return fail(project, "HMI element was not found or is read-only unsupported content.");
  return commitHmi(project, next, { elementId: input.elementId, commandId: input.command.id });
}
