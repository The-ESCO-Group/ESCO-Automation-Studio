import { describe, expect, it } from "vitest";
import { createController, createProject, createTag } from "@esco/core";
import { getHmiProject } from "@esco/hmi-model";
import {
  addHmiElement,
  createHmiScreen,
  ensureHmiProject,
  setHmiElementBinding,
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
