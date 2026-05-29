import { describe, expect, it } from "vitest";
import { createController, createProject, createTag } from "@esco/core";
import { getHmiProject } from "@esco/hmi-model";
import {
  addHmiElement,
  addHmiEventCommand,
  createHmiPopup,
  createHmiScreen,
  deleteHmiElement,
  deleteHmiPopup,
  deleteHmiScreen,
  ensureHmiProject,
  removeHmiElementBinding,
  removeHmiEventCommand,
  renameHmiSurface,
  setHmiElementBinding,
  setHmiHomeScreen,
  updateHmiElement,
} from "./index";

describe("HMI project actions", () => {
  it("enables an empty persisted HMI project", () => {
    const project = createProject("Cell");
    const result = ensureHmiProject(project);

    expect(result.ok).toBe(true);
    expect(getHmiProject(result.project)?.screens).toEqual([]);
    expect(result.project).not.toBe(project);
  });

  it("creates screens and sets the first screen as home", () => {
    const project = createProject("Cell");
    const result = createHmiScreen(project, { name: "Overview" });
    const hmi = getHmiProject(result.project);

    expect(result.ok).toBe(true);
    expect(hmi?.screens[0]?.name).toBe("Overview");
    expect(hmi?.homeScreenId).toBe(result.data?.screenId);
  });

  it("honors reviewed stable ids for HMI screens and elements", () => {
    const screenResult = createHmiScreen(createProject("Cell"), {
      name: "Overview",
      screenId: "screen_reviewed",
    });
    const elementResult = addHmiElement(screenResult.project, {
      surfaceKind: "screen",
      surfaceId: "screen_reviewed",
      typeId: "common.button",
      elementId: "button_reviewed",
    });

    const screen = getHmiProject(elementResult.project)?.screens[0];
    expect(screenResult.data?.screenId).toBe("screen_reviewed");
    expect(elementResult.data?.elementId).toBe("button_reviewed");
    expect(screen?.elements[0]?.id).toBe("button_reviewed");
  });

  it("adds registered and unsupported elements through the action layer", () => {
    const screenResult = createHmiScreen(createProject("Cell"), { name: "Overview" });
    const screenId = screenResult.data!.screenId;
    const buttonResult = addHmiElement(screenResult.project, {
      surfaceKind: "screen",
      surfaceId: screenId,
      typeId: "common.button",
    });
    const unknownResult = addHmiElement(buttonResult.project, {
      surfaceKind: "screen",
      surfaceId: screenId,
      typeId: "UNSUPPORTED_VENDOR_BLOCK",
    });

    const elements = getHmiProject(unknownResult.project)?.screens[0]?.elements ?? [];
    expect(buttonResult.ok).toBe(true);
    expect(unknownResult.ok).toBe(true);
    expect(elements).toHaveLength(2);
    expect(elements[1]?.unsupported?.originalType).toBe("UNSUPPORTED_VENDOR_BLOCK");
  });

  it("validates tag bindings while preserving the project mutation", () => {
    const project = createProject("Cell");
    const controller = createController(project.id, "Controller_1");
    controller.controllerTags.push(createTag(controller.id, "SpeedActual", "DINT"));
    const withController = { ...project, controllers: [controller] };
    const screenResult = createHmiScreen(withController, { name: "Overview" });
    const elementResult = addHmiElement(screenResult.project, {
      surfaceKind: "screen",
      surfaceId: screenResult.data!.screenId,
      typeId: "common.numeric-display",
    });
    const bindingResult = setHmiElementBinding(elementResult.project, {
      surfaceKind: "screen",
      surfaceId: screenResult.data!.screenId,
      elementId: elementResult.data!.elementId,
      binding: {
        id: "binding_value",
        targetProperty: "value",
        source: { kind: "tag", path: "SpeedActual", dataType: "DINT" },
        mode: "read",
      },
    });

    expect(bindingResult.ok).toBe(true);
    expect(bindingResult.warnings?.some((warning) => warning.includes("missing tag"))).toBe(false);
  });
});

/** Build a project with one screen holding one button element; returns ids. */
function screenWithButton() {
  const screenResult = createHmiScreen(createProject("Cell"), { name: "Overview", screenId: "screen_a" });
  const elementResult = addHmiElement(screenResult.project, {
    surfaceKind: "screen",
    surfaceId: "screen_a",
    typeId: "common.button",
    elementId: "el_button",
  });
  return { project: elementResult.project, screenId: "screen_a", elementId: "el_button" };
}

describe("HMI editing actions", () => {
  it("updates element name, properties (merged), and visibility", () => {
    const { project, screenId, elementId } = screenWithButton();
    const result = updateHmiElement(project, {
      surfaceKind: "screen",
      surfaceId: screenId,
      elementId,
      name: "Start Button",
      properties: { label: "Start" },
      visible: false,
    });
    const element = getHmiProject(result.project)?.screens[0]?.elements[0];

    expect(result.ok).toBe(true);
    expect(element?.name).toBe("Start Button");
    expect(element?.properties.label).toBe("Start");
    // "enabled" default property is preserved through the shallow merge.
    expect(element?.properties.enabled).toBe(true);
    expect(element?.visible).toBe(false);
  });

  it("rejects a blank element name and editing read-only unsupported content", () => {
    const { project, screenId, elementId } = screenWithButton();
    expect(updateHmiElement(project, { surfaceKind: "screen", surfaceId: screenId, elementId, name: "  " }).ok).toBe(false);

    const unsupported = addHmiElement(project, {
      surfaceKind: "screen",
      surfaceId: screenId,
      typeId: "VENDOR_BLOCK",
      elementId: "el_unsupported",
    });
    const result = updateHmiElement(unsupported.project, {
      surfaceKind: "screen",
      surfaceId: screenId,
      elementId: "el_unsupported",
      name: "Hacked",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/read-only/i);
  });

  it("deletes an element", () => {
    const { project, screenId, elementId } = screenWithButton();
    const result = deleteHmiElement(project, { surfaceKind: "screen", surfaceId: screenId, elementId });
    expect(result.ok).toBe(true);
    expect(getHmiProject(result.project)?.screens[0]?.elements).toHaveLength(0);
    expect(deleteHmiElement(result.project, { surfaceKind: "screen", surfaceId: screenId, elementId }).ok).toBe(false);
  });

  it("removes a binding", () => {
    const { project, screenId, elementId } = screenWithButton();
    const bound = setHmiElementBinding(project, {
      surfaceKind: "screen",
      surfaceId: screenId,
      elementId,
      binding: { id: "b1", targetProperty: "enabled", source: { kind: "tag", path: "MotorRun" }, mode: "read" },
    });
    const result = removeHmiElementBinding(bound.project, { surfaceKind: "screen", surfaceId: screenId, elementId, bindingId: "b1" });
    expect(result.ok).toBe(true);
    expect(getHmiProject(result.project)?.screens[0]?.elements[0]?.bindings).toHaveLength(0);
  });

  it("removes an event command and drops the now-empty event handler", () => {
    const { project, screenId, elementId } = screenWithButton();
    const withEvent = addHmiEventCommand(project, {
      surfaceKind: "screen",
      surfaceId: screenId,
      elementId,
      eventType: "press",
      command: { id: "cmd1", type: "navigate", safety: "runtime-preview", args: { screenId } },
    });
    const eventId = getHmiProject(withEvent.project)?.screens[0]?.elements[0]?.events[0]?.id ?? "";
    const result = removeHmiEventCommand(withEvent.project, {
      surfaceKind: "screen",
      surfaceId: screenId,
      elementId,
      eventId,
      commandId: "cmd1",
    });
    expect(result.ok).toBe(true);
    expect(getHmiProject(result.project)?.screens[0]?.elements[0]?.events).toHaveLength(0);
  });

  it("sets and clears the home screen, rejecting missing screens", () => {
    const { project, screenId } = screenWithButton();
    expect(setHmiHomeScreen(project, { screenId: "nope" }).ok).toBe(false);

    const set = setHmiHomeScreen(project, { screenId });
    expect(getHmiProject(set.project)?.homeScreenId).toBe(screenId);

    const cleared = setHmiHomeScreen(set.project, { screenId: null });
    expect(getHmiProject(cleared.project)?.homeScreenId).toBeUndefined();
  });

  it("renames a screen and rejects duplicate names", () => {
    const { project, screenId } = screenWithButton();
    const second = createHmiScreen(project, { name: "Detail" });
    const duplicate = renameHmiSurface(second.project, { surfaceKind: "screen", surfaceId: screenId, name: "Detail" });
    expect(duplicate.ok).toBe(false);

    const renamed = renameHmiSurface(second.project, { surfaceKind: "screen", surfaceId: screenId, name: "Home" });
    expect(renamed.ok).toBe(true);
    expect(getHmiProject(renamed.project)?.screens.find((s) => s.id === screenId)?.name).toBe("Home");
  });

  it("deletes a screen and reassigns the home screen to a remaining screen", () => {
    const first = createHmiScreen(createProject("Cell"), { name: "Overview", screenId: "screen_1" });
    const second = createHmiScreen(first.project, { name: "Detail", screenId: "screen_2" });
    expect(getHmiProject(second.project)?.homeScreenId).toBe("screen_1");

    const result = deleteHmiScreen(second.project, { screenId: "screen_1" });
    const hmi = getHmiProject(result.project);
    expect(result.ok).toBe(true);
    expect(hmi?.screens).toHaveLength(1);
    expect(hmi?.homeScreenId).toBe("screen_2");
  });

  it("deletes a popup", () => {
    const screen = createHmiScreen(createProject("Cell"), { name: "Overview" });
    const popup = createHmiPopup(screen.project, { name: "Details", popupId: "popup_1" });
    const result = deleteHmiPopup(popup.project, { popupId: "popup_1" });
    expect(result.ok).toBe(true);
    expect(getHmiProject(result.project)?.popups).toHaveLength(0);
  });
});
