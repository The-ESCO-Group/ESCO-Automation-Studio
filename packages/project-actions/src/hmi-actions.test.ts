import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createTag } from "@esco/core";
import {
  createHmiRuntimeSession,
  executeHmiRuntimeCommands,
  getHmiProject,
  hmiControllerReferenceBrowserRows,
} from "@esco/hmi-model";
import {
  addHmiControllerReference,
  addHmiElement,
  addHmiEventCommand,
  addHmiRecipeItem,
  createHmiDataLogDefinition,
  createHmiAddOnGraphic,
  createHmiLanguagePack,
  createHmiPopup,
  createHmiRecipe,
  createHmiScreen,
  createHmiSecurityRole,
  createHmiSecurityUser,
  deleteHmiAddOnGraphic,
  deleteHmiElement,
  deleteHmiPopup,
  deleteHmiRecipe,
  deleteHmiScreen,
  ensureHmiProject,
  removeHmiElementBinding,
  removeHmiEventCommand,
  removeHmiRecipeItem,
  renameHmiSurface,
  removeHmiControllerReference,
  setHmiElementBinding,
  setHmiHomeScreen,
  setHmiSurfaceSecurityRoles,
  updateHmiControllerReferenceStatus,
  updateHmiAddOnGraphic,
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

  it("adds, updates, browses, and removes offline HMI controller references", () => {
    const project = createProject("Cell");
    const controller = createController(project.id, "CLX_01");
    const program = createProgram(controller.id, "Mix");
    controller.controllerTags.push(createTag(controller.id, "RunCmd", "BOOL"));
    controller.controllerTags.push(createTag(controller.id, "HighSpeed", "ALARM_DIGITAL"));
    controller.dataTypes.push({
      id: "udt_motor",
      name: "MotorUDT",
      members: [{ name: "Running", dataType: "BOOL" }],
    });
    program.programTags.push(createTag(controller.id, "SpeedSP", "REAL", { scope: "program", programId: program.id }));
    controller.programs.push(program);
    const withController = { ...project, controllers: [controller] };

    const added = addHmiControllerReference(withController, {
      controllerId: controller.id,
      referenceId: "ref_clx_01",
      sourceKind: "xml-review",
      sourcePath: "Line1.L5X",
      sourceHash: "abc123",
      lastSyncedAt: "2026-05-30T12:00:00.000Z",
    });
    const hmi = getHmiProject(added.project);

    expect(added.ok).toBe(true);
    expect(hmi?.controllerReferences[0]?.snapshot).toEqual({
      controllerTagCount: 2,
      programTagCount: 1,
      dataTypeCount: 1,
      alarmCount: 1,
    });
    expect(hmiControllerReferenceBrowserRows(hmi!).map((row) => `${row.kind}:${row.path}`)).toEqual([
      "alarm:HighSpeed",
      "data-type:MotorUDT",
      "tag:HighSpeed",
      "tag:Program:Mix.SpeedSP",
      "tag:RunCmd",
    ]);

    const screen = createHmiScreen(added.project, { name: "Overview", screenId: "screen_main" });
    const element = addHmiElement(screen.project, {
      surfaceKind: "screen",
      surfaceId: "screen_main",
      typeId: "common.numeric-display",
      elementId: "speed_display",
    });
    const binding = setHmiElementBinding(element.project, {
      surfaceKind: "screen",
      surfaceId: "screen_main",
      elementId: "speed_display",
      binding: {
        id: "binding_value",
        targetProperty: "value",
        source: { kind: "tag", path: "Program:Mix.SpeedSP", dataType: "REAL" },
        mode: "read",
      },
    });
    expect(binding.ok).toBe(true);
    expect(binding.warnings?.some((warning) => warning.includes("missing tag"))).toBe(false);

    const stale = updateHmiControllerReferenceStatus(binding.project, {
      referenceId: "ref_clx_01",
      syncStatus: "stale",
      statusMessage: "Source L5X changed after import",
    });
    expect(stale.ok).toBe(true);
    expect(stale.warnings?.some((warning) => warning.includes("stale"))).toBe(true);

    const removed = removeHmiControllerReference(stale.project, { referenceId: "ref_clx_01" });
    expect(removed.ok).toBe(true);
    expect(getHmiProject(removed.project)?.controllerReferences).toEqual([]);
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

  it("authors open-popup and set-tag-value commands that preview through the offline runtime", () => {
    const { project, screenId, elementId } = screenWithButton();
    const withPopup = createHmiPopup(project, { name: "Motor Detail", popupId: "popup_motor" });
    expect(withPopup.ok).toBe(true);

    // These are exactly the command shapes the HMI designer's command form emits.
    const withOpen = addHmiEventCommand(withPopup.project, {
      surfaceKind: "screen",
      surfaceId: screenId,
      elementId,
      eventType: "press",
      command: { id: "cmd_open", type: "open-popup", safety: "runtime-preview", args: { popupId: "popup_motor" } },
    });
    expect(withOpen.ok).toBe(true);
    const withSet = addHmiEventCommand(withOpen.project, {
      surfaceKind: "screen",
      surfaceId: screenId,
      elementId,
      eventType: "press",
      command: { id: "cmd_set", type: "set-tag-value", safety: "runtime-preview", args: { tagPath: "Motor.Run", value: "1" } },
    });
    expect(withSet.ok).toBe(true);

    const hmi = getHmiProject(withSet.project)!;
    const press = hmi.screens[0]?.elements[0]?.events.find((event) => event.eventType === "press");
    // Both commands land on the single press handler, in authoring order.
    expect(press?.commands.map((command) => command.type)).toEqual(["open-popup", "set-tag-value"]);

    const session = executeHmiRuntimeCommands(hmi, createHmiRuntimeSession(hmi), press!.commands);
    expect(session.popupStack.map((entry) => entry.popupId)).toContain("popup_motor");
    const tagEffect = session.commandLog.find((entry) => entry.effect?.kind === "tag-write-preview");
    expect(tagEffect?.effect).toMatchObject({ tagPath: "Motor.Run", value: "1" });
    expect(session.blockedCommandCount).toBe(0);
  });

  it("authors language, data-log, recipe, and security commands that preview through the offline runtime", () => {
    const { project, screenId, elementId } = screenWithButton();
    const withLanguage = createHmiLanguagePack(project, {
      languageId: "de-DE",
      displayName: "Deutsch",
      languagePackId: "lang_de",
    });
    const withLog = createHmiDataLogDefinition(withLanguage.project, {
      name: "Process Log",
      dataLogId: "log_process",
      tagPaths: ["Tank_Level"],
    });
    const withRecipe = createHmiRecipe(withLog.project, {
      name: "Startup",
      recipeId: "recipe_startup",
      items: [{ itemId: "sp", tagPath: "Tank_Level", value: 55, dataType: "REAL" }],
    });
    const withRole = createHmiSecurityRole(withRecipe.project, {
      name: "Supervisor",
      roleId: "role_supervisor",
      permissions: ["navigate"],
    });
    const withUser = createHmiSecurityUser(withRole.project, {
      username: "alice",
      userId: "user_alice",
      roleIds: ["role_supervisor"],
      fullName: "Alice A",
    });
    expect(withUser.ok).toBe(true);

    const commandInputs = [
      { id: "cmd_lang", type: "change-language" as const, args: { languageId: "de-DE" } },
      { id: "cmd_export", type: "export-data-log" as const, args: { dataLogId: "log_process" } },
      { id: "cmd_clear", type: "clear-data-log" as const, args: { dataLogId: "log_process" } },
      { id: "cmd_recipe", type: "apply-recipe" as const, args: { recipeId: "recipe_startup" } },
      { id: "cmd_login", type: "login-user" as const, args: { username: "alice" } },
      { id: "cmd_logout", type: "logout-user" as const, args: {} },
    ];
    const authored = commandInputs.reduce(
      (current, command) =>
        addHmiEventCommand(current, {
          surfaceKind: "screen",
          surfaceId: screenId,
          elementId,
          eventType: "press",
          command: { ...command, safety: "runtime-preview" },
        }).project,
      withUser.project,
    );

    const hmi = getHmiProject(authored)!;
    const press = hmi.screens[0]?.elements[0]?.events.find((event) => event.eventType === "press");
    expect(press?.commands.map((command) => command.type)).toEqual([
      "change-language",
      "export-data-log",
      "clear-data-log",
      "apply-recipe",
      "login-user",
      "logout-user",
    ]);

    const session = executeHmiRuntimeCommands(hmi, createHmiRuntimeSession(hmi), press!.commands);
    expect(session.currentLanguage).toBe("de-DE");
    expect(session.currentUserName).toBe("Guest");
    expect(session.commandLog.map((entry) => entry.effect?.kind)).toEqual([
      "change-language",
      "data-log-export",
      "data-log-clear",
      "apply-recipe",
      "login-user",
      "logout-user",
    ]);
    expect(session.blockedCommandCount).toBe(0);
  });

  it("authors HMI recipes and guarded recipe values through the action layer", () => {
    const project = createProject("Cell");
    const controller = createController(project.id, "Controller_1");
    controller.controllerTags.push(createTag(controller.id, "SpeedSetpoint", "REAL"));
    controller.controllerTags.push(createTag(controller.id, "RunCommand", "BOOL"));
    const withController = { ...project, controllers: [controller] };

    const created = createHmiRecipe(withController, {
      name: "Startup",
      recipeId: "recipe_startup",
      items: [{ itemId: "speed", tagPath: "SpeedSetpoint", value: 45, dataType: "REAL" }],
    });
    expect(created.ok).toBe(true);
    expect(getHmiProject(created.project)?.recipes[0]).toMatchObject({
      id: "recipe_startup",
      name: "Startup",
      items: [{ tagPath: "SpeedSetpoint", value: 45 }],
    });

    const withRun = addHmiRecipeItem(created.project, {
      recipeId: "recipe_startup",
      itemId: "run",
      tagPath: "RunCommand",
      value: true,
      dataType: "BOOL",
    });
    expect(withRun.ok).toBe(true);
    expect(getHmiProject(withRun.project)?.recipes[0]?.items).toHaveLength(2);

    const duplicate = addHmiRecipeItem(withRun.project, {
      recipeId: "recipe_startup",
      tagPath: "RunCommand",
      value: false,
      dataType: "BOOL",
    });
    expect(duplicate.ok).toBe(false);
    expect(getHmiProject(duplicate.project)?.recipes[0]?.items).toHaveLength(2);

    const removed = removeHmiRecipeItem(withRun.project, { recipeId: "recipe_startup", itemId: "speed" });
    expect(removed.ok).toBe(true);
    expect(getHmiProject(removed.project)?.recipes[0]?.items.map((item) => item.tagPath)).toEqual(["RunCommand"]);

    const deleted = deleteHmiRecipe(removed.project, { recipeId: "recipe_startup" });
    expect(deleted.ok).toBe(true);
    expect(getHmiProject(deleted.project)?.recipes).toEqual([]);
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

  it("sets and clears screen/popup security roles for offline runtime preview", () => {
    const { project, screenId } = screenWithButton();
    const withPopup = createHmiPopup(project, { name: "Details", popupId: "popup_details" });
    const withOperator = createHmiSecurityRole(withPopup.project, { name: "Operator", roleId: "role_operator" });
    const withEngineer = createHmiSecurityRole(withOperator.project, { name: "Engineer", roleId: "role_engineer" });

    const securedScreen = setHmiSurfaceSecurityRoles(withEngineer.project, {
      surfaceKind: "screen",
      surfaceId: screenId,
      roleIds: ["role_engineer", "role_engineer", "role_operator"],
    });
    expect(securedScreen.ok).toBe(true);
    expect(getHmiProject(securedScreen.project)?.screens.find((screen) => screen.id === screenId)?.securityRoleIds).toEqual([
      "role_engineer",
      "role_operator",
    ]);

    const securedPopup = setHmiSurfaceSecurityRoles(securedScreen.project, {
      surfaceKind: "popup",
      surfaceId: "popup_details",
      roleIds: ["role_engineer"],
    });
    expect(getHmiProject(securedPopup.project)?.popups.find((popup) => popup.id === "popup_details")?.securityRoleIds).toEqual([
      "role_engineer",
    ]);

    const cleared = setHmiSurfaceSecurityRoles(securedPopup.project, {
      surfaceKind: "screen",
      surfaceId: screenId,
      roleIds: [],
    });
    expect(getHmiProject(cleared.project)?.screens.find((screen) => screen.id === screenId)?.securityRoleIds).toEqual([]);
    expect(setHmiSurfaceSecurityRoles(cleared.project, { surfaceKind: "screen", surfaceId: screenId, roleIds: ["missing"] }).ok).toBe(false);
    expect(setHmiSurfaceSecurityRoles(cleared.project, { surfaceKind: "popup", surfaceId: "missing", roleIds: [] }).ok).toBe(false);
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

  it("creates, edits, populates, and deletes reusable Add-On Graphic definitions", () => {
    const created = createHmiAddOnGraphic(createProject("Cell"), {
      name: "Motor Faceplate",
      addOnGraphicId: "aog_motor",
      vendor: "ESCO",
      revision: "1.0",
      width: 320,
      height: 180,
      properties: [{ name: "TagBase", dataType: "tag-path", required: true }],
    });
    const element = addHmiElement(created.project, {
      surfaceKind: "add-on-graphic",
      surfaceId: "aog_motor",
      typeId: "common.numeric-display",
      elementId: "speed_display",
      name: "Speed Display",
    });
    const updated = updateHmiAddOnGraphic(element.project, {
      addOnGraphicId: "aog_motor",
      name: "Motor Faceplate V2",
      revision: "2.0",
      width: 360,
      properties: [
        { name: "TagBase", dataType: "tag-path", required: true },
        { name: "Caption", dataType: "string", defaultValue: "Motor" },
      ],
    });
    const duplicate = createHmiAddOnGraphic(updated.project, { name: "Motor Faceplate V2" });
    const deleted = deleteHmiAddOnGraphic(updated.project, { addOnGraphicId: "aog_motor" });
    const missingDelete = deleteHmiAddOnGraphic(deleted.project, { addOnGraphicId: "aog_motor" });

    const graphic = getHmiProject(updated.project)?.addOnGraphics[0];
    expect(created.ok).toBe(true);
    expect(created.data?.addOnGraphicId).toBe("aog_motor");
    expect(element.ok).toBe(true);
    expect(updated.ok).toBe(true);
    expect(graphic).toMatchObject({
      id: "aog_motor",
      name: "Motor Faceplate V2",
      vendor: "ESCO",
      revision: "2.0",
      width: 360,
      height: 180,
    });
    expect(graphic?.properties.map((property) => property.name)).toEqual(["TagBase", "Caption"]);
    expect(graphic?.elements[0]?.id).toBe("speed_display");
    expect(duplicate.ok).toBe(false);
    expect(deleted.ok).toBe(true);
    expect(getHmiProject(deleted.project)?.addOnGraphics).toHaveLength(0);
    expect(missingDelete.ok).toBe(false);
  });
});
