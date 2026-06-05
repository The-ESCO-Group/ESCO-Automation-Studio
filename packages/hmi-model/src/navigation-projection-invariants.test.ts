import { describe, expect, it } from "vitest";
import {
  createDefaultHmiProject,
  createHmiScreen,
  hmiNavigationModel,
} from "./index";

// These guard invariants that `validateHmiProject` (validation.ts) relies on when it
// derives the `hmi-screen-unreachable` finding from `hmiNavigationModel(project)`.
// The validator never passes display options, so the reachability diagnostics
// (omittedScreenIds / deadEndScreenIds / missingTargetCount) must not depend on them.
describe("hmi navigation projection invariants", () => {
  it("keeps reachability diagnostics identical whether or not includeHidden is set", () => {
    const project = createDefaultHmiProject();
    const home = createHmiScreen("Home");
    const listed = createHmiScreen("Listed");
    const omitted = createHmiScreen("Diagnostics");
    omitted.navigation = { includeInMenu: false, caption: "Diagnostics" };
    const orphan = createHmiScreen("Orphan");
    orphan.navigation = { includeInMenu: false };
    project.screens.push(home, listed, omitted, orphan);
    project.homeScreenId = home.id;

    const visibleOnly = hmiNavigationModel(project);
    const withHidden = hmiNavigationModel(project, { includeHidden: true });

    // includeHidden only changes what `items` surfaces — never the routing verdicts.
    expect(withHidden.omittedScreenIds).toEqual(visibleOnly.omittedScreenIds);
    expect(withHidden.deadEndScreenIds).toEqual(visibleOnly.deadEndScreenIds);
    expect(withHidden.missingTargetCount).toBe(visibleOnly.missingTargetCount);
    expect(withHidden.items.length).toBeGreaterThan(visibleOnly.items.length);
  });

  it("keeps reachability diagnostics identical regardless of the active role scope", () => {
    const project = createDefaultHmiProject();
    const home = createHmiScreen("Home");
    const restricted = createHmiScreen("Settings");
    // In the menu, but only an engineer may see it. It is structurally reachable —
    // an operator simply lacks the role — so it must never be reported as a dead end.
    restricted.navigation = { includeInMenu: true, caption: "Settings" };
    restricted.securityRoleIds = ["role_engineer"];
    const orphan = createHmiScreen("Orphan");
    orphan.navigation = { includeInMenu: false };
    project.screens.push(home, restricted, orphan);
    project.homeScreenId = home.id;

    const unscoped = hmiNavigationModel(project);
    const engineer = hmiNavigationModel(project, { activeRoleIds: ["role_engineer"] });
    const operator = hmiNavigationModel(project, { activeRoleIds: ["role_operator"], includeHidden: true });

    // activeRoleIds only changes which items surface (hiddenReason: "security"),
    // never the structural routing verdicts.
    expect(operator.items.find((item) => item.targetId === restricted.id)?.hiddenReason).toBe("security");
    for (const scoped of [engineer, operator]) {
      expect(scoped.omittedScreenIds).toEqual(unscoped.omittedScreenIds);
      expect(scoped.deadEndScreenIds).toEqual(unscoped.deadEndScreenIds);
      expect(scoped.missingTargetCount).toBe(unscoped.missingTargetCount);
    }
    // The role-gated screen is reachable; only the truly orphaned screen is a dead end.
    expect(operator.deadEndScreenIds).not.toContain(restricted.id);
    expect(operator.deadEndScreenIds).toEqual([orphan.id]);
  });

  it("lists a shortcut-rescued omitted screen as omitted yet not a dead end at the same time", () => {
    const project = createDefaultHmiProject();
    const home = createHmiScreen("Home");
    const rescued = createHmiScreen("Backstage");
    rescued.navigation = { includeInMenu: false, caption: "Backstage" };
    project.screens.push(home, rescued);
    project.homeScreenId = home.id;
    project.shortcuts.push({
      id: "shortcut_backstage",
      name: "Backstage Shortcut",
      targetKind: "screen",
      targetId: rescued.id,
      caption: "Backstage",
      folder: "Maintenance",
      securityRoleIds: [],
    });

    const nav = hmiNavigationModel(project);

    // Omitted from the menu by config...
    expect(nav.omittedScreenIds).toContain(rescued.id);
    // ...but a visible shortcut routes to it, so it is reachable (not a dead end).
    expect(nav.deadEndScreenIds).not.toContain(rescued.id);
    expect(nav.folders.find((folder) => folder.name === "Maintenance")?.items.map((item) => item.targetId))
      .toContain(rescued.id);
  });
});
