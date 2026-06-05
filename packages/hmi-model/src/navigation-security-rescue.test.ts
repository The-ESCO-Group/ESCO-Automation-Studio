import { describe, expect, it } from "vitest";
import {
  createDefaultHmiProject,
  createHmiScreen,
  hmiNavigationModel,
} from "./index";

// Locks in the intersection of the three navigation concerns the projection has to
// reconcile at once: security-aware visibility, shortcut-folder routing, and
// dead-end reachability. The existing edge/invariant suites cover a *visible*
// shortcut rescuing an omitted screen and a role-gated *in-menu* screen, but not
// the combination where the ONLY route to an omitted screen is a shortcut that is
// itself hidden for the active role. Reachability must stay role-independent here
// (see navigation.ts: filtering routing on `item.visible` would let a passed
// `activeRoleIds` falsely demote this screen to a dead end and trip the validator's
// `hmi-screen-unreachable` finding for an operator who simply lacks the role).
describe("hmi navigation projection — security-gated shortcut rescue", () => {
  it("keeps an omitted screen reachable when its only route is a role-hidden shortcut", () => {
    const project = createDefaultHmiProject();
    const home = createHmiScreen("Home");
    const backstage = createHmiScreen("Backstage");
    backstage.navigation = { includeInMenu: false, caption: "Backstage" };
    project.screens.push(home, backstage);
    project.homeScreenId = home.id;
    project.shortcuts.push({
      id: "shortcut_backstage",
      name: "Backstage Shortcut",
      targetKind: "screen",
      targetId: backstage.id,
      caption: "Backstage",
      folder: "Maintenance",
      securityRoleIds: ["role_engineer"],
    });

    // Scope to an operator who cannot see the engineer-only shortcut.
    const operator = hmiNavigationModel(project, {
      activeRoleIds: ["role_operator"],
      includeHidden: true,
    });
    const shortcut = operator.items.find((item) => item.id === "shortcut:shortcut_backstage");

    // The shortcut is hidden by security for the operator...
    expect(shortcut?.visible).toBe(false);
    expect(shortcut?.hiddenReason).toBe("security");
    // ...yet the screen is omitted-but-routed, so it is NOT a dead end regardless of role.
    expect(operator.omittedScreenIds).toContain(backstage.id);
    expect(operator.deadEndScreenIds).not.toContain(backstage.id);

    // And the routing verdict is identical to the unscoped (validator) projection.
    const unscoped = hmiNavigationModel(project);
    expect(operator.deadEndScreenIds).toEqual(unscoped.deadEndScreenIds);
    expect(operator.missingTargetCount).toBe(unscoped.missingTargetCount);
    // The shortcut still groups under its declared folder even while hidden.
    expect(
      operator.folders
        .find((folder) => folder.name === "Maintenance")
        ?.items.map((item) => item.targetId),
    ).toContain(backstage.id);
  });
});
