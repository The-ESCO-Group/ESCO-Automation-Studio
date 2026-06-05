import { describe, expect, it } from "vitest";
import { createProject } from "@esco/core";
import {
  createDefaultHmiProject,
  createHmiPopup,
  createHmiScreen,
  withHmiProject,
  type HmiProject,
  type HmiShortcut,
} from "@esco/hmi-model";
import { hmiNavigationReviewReport } from "./index";

function shortcut(input: Partial<HmiShortcut> & Pick<HmiShortcut, "id" | "targetId">): HmiShortcut {
  return {
    name: input.id,
    caption: input.caption ?? input.id,
    targetKind: "screen",
    securityRoleIds: [],
    ...input,
  };
}

function projectWithNavigation() {
  const home = createHmiScreen("Home");
  const diagnostics = createHmiScreen("Diagnostics");
  diagnostics.navigation = { includeInMenu: false, caption: "Diagnostics" };
  const orphan = createHmiScreen("Orphan");
  orphan.navigation = { includeInMenu: false, caption: "Orphan" };
  const engineerOnly = createHmiScreen("EngineerSetup");
  engineerOnly.securityRoleIds = ["role_engineer"];

  const hmi: HmiProject = {
    ...createDefaultHmiProject(),
    screens: [home, diagnostics, orphan, engineerOnly],
    homeScreenId: home.id,
    shortcuts: [
      // Reaches the omitted Diagnostics screen, so it is omitted-but-reachable.
      shortcut({ id: "sc_diag", targetId: diagnostics.id, folder: "Tools", caption: "Diagnostics" }),
      // Points at a deleted screen -> missing target.
      shortcut({ id: "sc_missing", targetId: "screen_deleted", folder: "Tools", caption: "Gone" }),
    ],
  };

  return { project: withHmiProject(createProject("Cell"), hmi), hmi };
}

describe("hmiNavigationReviewReport", () => {
  it("returns an empty report when the project has no HMI", () => {
    const report = hmiNavigationReviewReport(createProject("Headless"));
    expect(report.rows).toEqual([]);
    expect(report.routeCount).toBe(0);
    expect(report.warnings).toEqual([]);
    expect(report.homeScreenId).toBeUndefined();
  });

  it("consolidates omitted, dead-end, and missing-target route diagnostics", () => {
    const { project } = projectWithNavigation();
    const report = hmiNavigationReviewReport(project);

    expect(report.homeScreenName).toBe("Home");
    // Diagnostics + Orphan are both omitted from the menu.
    expect(report.omittedScreenCount).toBe(2);
    // Only Orphan is unreachable (Diagnostics is reached by a shortcut).
    expect(report.deadEndScreenCount).toBe(1);
    expect(report.missingTargetCount).toBe(1);

    const orphanRow = report.rows.find((row) => row.label === "Orphan");
    expect(orphanRow?.issues).toContain("dead-end-screen");
    expect(orphanRow?.status).toBe("needs-attention");

    const diagnosticsRow = report.rows.find((row) => row.source === "screen" && row.label === "Diagnostics");
    expect(diagnosticsRow?.issues).toEqual(["omitted-screen"]);
    expect(diagnosticsRow?.status).toBe("reviewable");

    const missingRow = report.rows.find((row) => row.itemId === "shortcut:sc_missing");
    expect(missingRow?.issues).toContain("missing-target");
    expect(missingRow?.status).toBe("needs-attention");

    expect(report.folders.map((folder) => folder.name)).toContain("Tools");
    expect(report.needsAttentionCount).toBe(2);
    expect(report.warnings.some((w) => w.includes("Orphan"))).toBe(true);

    // Offline boundary is reported on every route.
    expect(report.rows.every((row) => row.navigationExecuted === false)).toBe(true);
    expect(orphanRow?.boundaries).toContain("no-security-enforcement");
  });

  it("warns when screens exist but no home screen is selected", () => {
    const { hmi } = projectWithNavigation();
    const noHome: HmiProject = { ...hmi, homeScreenId: undefined };
    const report = hmiNavigationReviewReport(withHmiProject(createProject("Cell"), noHome));

    expect(report.homeScreenId).toBeUndefined();
    expect(report.homeScreenName).toBeUndefined();
    expect(report.warnings[0]).toBe(
      "No home screen is selected; operators have no default route into the HMI.",
    );
  });

  it("warns when the configured home screen no longer exists", () => {
    const { hmi } = projectWithNavigation();
    const danglingHome: HmiProject = { ...hmi, homeScreenId: "screen_deleted_home" };
    const report = hmiNavigationReviewReport(withHmiProject(createProject("Cell"), danglingHome));

    // homeScreenId stays set, but it resolves to no screen.
    expect(report.homeScreenId).toBe("screen_deleted_home");
    expect(report.homeScreenName).toBeUndefined();
    expect(report.warnings[0]).toBe(
      "The configured home screen no longer exists; operators have no default route into the HMI.",
    );
  });

  it("projects popup shortcuts as open-popup routes without treating them as screen reachability", () => {
    const home = createHmiScreen("Home");
    const faceplate = createHmiPopup("Motor Faceplate");
    const hmi: HmiProject = {
      ...createDefaultHmiProject(),
      screens: [home],
      popups: [faceplate],
      homeScreenId: home.id,
      shortcuts: [
        shortcut({ id: "sc_popup", targetId: faceplate.id, targetKind: "popup", folder: "Tools", caption: "Faceplate" }),
        // Points at a deleted popup -> missing target on the popup branch.
        shortcut({ id: "sc_popup_gone", targetId: "popup_deleted", targetKind: "popup", caption: "Gone" }),
      ],
    };
    const report = hmiNavigationReviewReport(withHmiProject(createProject("Cell"), hmi));

    // Popup targets never participate in screen reachability accounting.
    expect(report.deadEndScreenCount).toBe(0);
    expect(report.missingTargetCount).toBe(1);

    const popupRow = report.rows.find((row) => row.itemId === "shortcut:sc_popup");
    expect(popupRow?.commandType).toBe("open-popup");
    expect(popupRow?.targetKind).toBe("popup");
    expect(popupRow?.issues).toEqual([]);
    expect(popupRow?.status).toBe("reviewable");
    // Open-popup routes read as opening a popup, not navigating to a screen.
    expect(popupRow?.message).toContain("opens popup Motor Faceplate");

    const missingPopupRow = report.rows.find((row) => row.itemId === "shortcut:sc_popup_gone");
    expect(missingPopupRow?.issues).toContain("missing-target");
    expect(missingPopupRow?.status).toBe("needs-attention");
    expect(missingPopupRow?.message).toContain("missing popup");
  });

  it("flags menu-visible screens and shortcuts whose caption is blank", () => {
    const home = createHmiScreen("Home");
    const blankCaptionScreen = createHmiScreen("Status");
    // Included in the menu, but the caption was cleared.
    blankCaptionScreen.navigation = { includeInMenu: true, caption: "   " };
    const hmi: HmiProject = {
      ...createDefaultHmiProject(),
      screens: [home, blankCaptionScreen],
      homeScreenId: home.id,
      shortcuts: [
        // Valid target, blank caption -> still renders blank in the menu.
        shortcut({ id: "sc_blank", targetId: blankCaptionScreen.id, caption: "  " }),
      ],
    };
    const report = hmiNavigationReviewReport(withHmiProject(createProject("Cell"), hmi));

    expect(report.captionMissingCount).toBe(2);

    const screenRow = report.rows.find((row) => row.source === "screen" && row.targetId === blankCaptionScreen.id);
    expect(screenRow?.issues).toContain("missing-caption");
    expect(screenRow?.status).toBe("needs-attention");
    // The label falls back to the screen name, and the message says so.
    expect(screenRow?.label).toBe("Status");
    expect(screenRow?.message).toContain("renders blank");

    const shortcutRow = report.rows.find((row) => row.itemId === "shortcut:sc_blank");
    expect(shortcutRow?.issues).toContain("missing-caption");
    expect(shortcutRow?.status).toBe("needs-attention");

    // Both caption warnings reach the consolidated warning list.
    expect(report.warnings.filter((w) => w.includes("renders blank")).length).toBe(2);
  });

  it("does not flag a blank caption on a screen omitted from the menu", () => {
    const home = createHmiScreen("Home");
    const omitted = createHmiScreen("Hidden");
    // Omitted from the menu, so its caption never renders -> not a caption issue.
    omitted.navigation = { includeInMenu: false, caption: "" };
    const hmi: HmiProject = {
      ...createDefaultHmiProject(),
      screens: [home, omitted],
      homeScreenId: home.id,
      // A shortcut keeps the omitted screen reachable so it is not also a dead end.
      shortcuts: [shortcut({ id: "sc_hidden", targetId: omitted.id, caption: "Hidden" })],
    };
    const report = hmiNavigationReviewReport(withHmiProject(createProject("Cell"), hmi));

    expect(report.captionMissingCount).toBe(0);
    const omittedRow = report.rows.find((row) => row.source === "screen" && row.targetId === omitted.id);
    expect(omittedRow?.issues).toEqual(["omitted-screen"]);
  });

  it("flags security-hidden routes without changing reachability verdicts", () => {
    const { project } = projectWithNavigation();
    const report = hmiNavigationReviewReport(project, { activeRoleIds: ["role_operator"] });

    expect(report.securityHiddenCount).toBe(1);
    // Reachability is role-independent: the dead-end count must not change.
    expect(report.deadEndScreenCount).toBe(1);

    const gatedRow = report.rows.find((row) => row.label === "EngineerSetup");
    expect(gatedRow?.issues).toContain("security-restricted");
    // A role-gated but reachable screen is reviewable, not a dead end.
    expect(gatedRow?.status).toBe("reviewable");
  });
});
