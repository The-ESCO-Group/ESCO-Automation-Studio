import { describe, expect, it } from "vitest";
import {
  createDefaultHmiProject,
  createHmiPopup,
  createHmiScreen,
  hmiNavigationModel,
} from "./index";

describe("hmi navigation projection edge cases", () => {
  it("treats a home screen omitted from the menu as omitted but still reachable (not a dead end)", () => {
    const project = createDefaultHmiProject();
    const home = createHmiScreen("Boot");
    home.navigation = { includeInMenu: false, caption: "Boot" };
    const main = createHmiScreen("Main");
    main.navigation = { includeInMenu: true, caption: "Main" };
    project.screens.push(home, main);
    project.homeScreenId = home.id;

    const nav = hmiNavigationModel(project);

    // Excluded from the menu, so it reports as omitted and never appears as a visible item...
    expect(nav.omittedScreenIds).toContain(home.id);
    expect(nav.items.some((item) => item.targetId === home.id && item.visible)).toBe(false);
    // ...but because it is the configured home screen it is routed, so it must NOT be a dead end.
    expect(nav.deadEndScreenIds).not.toContain(home.id);
    expect(nav.homeScreenName).toBe("Boot");
  });

  it("counts a shortcut pointing at a missing popup as a missing target", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    project.screens.push(screen);
    project.homeScreenId = screen.id;
    project.shortcuts.push({
      id: "shortcut_ghost_popup",
      name: "Ghost",
      targetKind: "popup",
      targetId: "popup_does_not_exist",
      caption: "Ghost Popup",
      securityRoleIds: [],
    });

    const nav = hmiNavigationModel(project);
    const ghost = hmiNavigationModel(project, { includeHidden: true }).items.find(
      (item) => item.id === "shortcut:shortcut_ghost_popup",
    );

    expect(nav.missingTargetCount).toBe(1);
    // A missing target is hidden by default (not in the routable menu).
    expect(nav.items.some((item) => item.id === "shortcut:shortcut_ghost_popup")).toBe(false);
    expect(ghost?.hiddenReason).toBe("missing-target");
    expect(ghost?.commandType).toBe("open-popup");
  });

  it("orders the ungrouped Root routes ahead of named shortcut folders", () => {
    const project = createDefaultHmiProject();
    const home = createHmiScreen("Home");
    project.screens.push(home);
    project.homeScreenId = home.id;
    // A folder whose name sorts before "Root" alphabetically — the main (Root) menu
    // must still lead, with the folder nested after it, not ahead of it.
    project.shortcuts.push({
      id: "shortcut_alarms",
      name: "Alarms",
      targetKind: "screen",
      targetId: home.id,
      caption: "Alarm Summary",
      folder: "Alarms",
      securityRoleIds: [],
    });

    const nav = hmiNavigationModel(project);

    expect(nav.folders[0]?.name).toBe("Root");
    const rootIndex = nav.folders.findIndex((folder) => folder.name === "Root");
    const alarmsIndex = nav.folders.findIndex((folder) => folder.name === "Alarms");
    expect(alarmsIndex).toBeGreaterThan(rootIndex);
  });

  it("surfaces omitted screen items with a screen-omitted reason when includeHidden is set", () => {
    const project = createDefaultHmiProject();
    const main = createHmiScreen("Main");
    main.navigation = { includeInMenu: true, caption: "Main" };
    const diagnostics = createHmiScreen("Diagnostics");
    diagnostics.navigation = { includeInMenu: false, caption: "Diagnostics" };
    const popup = createHmiPopup("Tools");
    project.screens.push(main, diagnostics);
    project.popups.push(popup);
    project.homeScreenId = main.id;

    const visibleOnly = hmiNavigationModel(project);
    const withHidden = hmiNavigationModel(project, { includeHidden: true });

    expect(visibleOnly.items.some((item) => item.targetId === diagnostics.id)).toBe(false);
    const hiddenItem = withHidden.items.find((item) => item.targetId === diagnostics.id);
    expect(hiddenItem?.visible).toBe(false);
    expect(hiddenItem?.hiddenReason).toBe("screen-omitted");
  });
});
