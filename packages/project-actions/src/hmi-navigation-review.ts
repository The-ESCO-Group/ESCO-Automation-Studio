import type { PlcProject } from "@esco/core";
import { getHmiProject, hmiNavigationModel } from "@esco/hmi-model";

export type HmiNavigationRouteSource = "screen" | "shortcut";

export type HmiNavigationRouteStatus = "reviewable" | "needs-attention";

export type HmiNavigationIssue =
  | "missing-target"
  | "dead-end-screen"
  | "omitted-screen"
  | "missing-caption"
  | "security-restricted";

export type HmiNavigationBoundary =
  | "no-runtime-navigation"
  | "no-screen-rendering"
  | "no-security-enforcement";

export interface HmiNavigationReviewRow {
  itemId: string;
  source: HmiNavigationRouteSource;
  label: string;
  folder?: string;
  targetKind: "screen" | "popup";
  targetId: string;
  targetName?: string;
  commandType: "navigate" | "open-popup";
  securityRoleIds: string[];
  status: HmiNavigationRouteStatus;
  issues: HmiNavigationIssue[];
  navigationExecuted: false;
  boundaries: HmiNavigationBoundary[];
  message: string;
}

export interface HmiNavigationReviewFolder {
  name: string;
  itemCount: number;
}

export interface HmiNavigationReviewReport {
  homeScreenId?: string;
  homeScreenName?: string;
  rows: HmiNavigationReviewRow[];
  folders: HmiNavigationReviewFolder[];
  routeCount: number;
  shortcutCount: number;
  omittedScreenCount: number;
  deadEndScreenCount: number;
  missingTargetCount: number;
  captionMissingCount: number;
  securityHiddenCount: number;
  needsAttentionCount: number;
  warnings: string[];
}

export interface HmiNavigationReviewOptions {
  /** When provided, routes hidden for these roles are flagged as security-restricted. */
  activeRoleIds?: string[];
}

// Every route is reviewed offline only. The projection never opens a panel session,
// renders a screen, or enforces the security roles it reports against.
const ROUTE_BOUNDARIES: HmiNavigationBoundary[] = [
  "no-runtime-navigation",
  "no-screen-rendering",
  "no-security-enforcement",
];

function emptyReport(): HmiNavigationReviewReport {
  return {
    rows: [],
    folders: [],
    routeCount: 0,
    shortcutCount: 0,
    omittedScreenCount: 0,
    deadEndScreenCount: 0,
    missingTargetCount: 0,
    captionMissingCount: 0,
    securityHiddenCount: 0,
    needsAttentionCount: 0,
    warnings: [],
  };
}

function messageFor(row: Omit<HmiNavigationReviewRow, "message">): string {
  const target = row.targetName ?? row.targetId;
  if (row.issues.includes("missing-target")) {
    return `Shortcut "${row.label}" targets a missing ${row.targetKind} and cannot be reached at runtime.`;
  }
  if (row.issues.includes("dead-end-screen")) {
    return `Screen "${row.label}" is omitted from the route menu and is not the home screen or a shortcut target, so operators cannot reach it.`;
  }
  if (row.issues.includes("missing-caption")) {
    return `Route "${row.label}" has no caption, so its route-menu entry renders blank for operators (the ${row.source} name is shown here as a fallback).`;
  }
  if (row.issues.includes("omitted-screen")) {
    return `Screen "${row.label}" is hidden from the route menu but stays reachable through the home screen or a shortcut.`;
  }
  if (row.issues.includes("security-restricted")) {
    return `Route "${row.label}" is hidden for the active role set; HMI security is reviewed offline but never enforced here.`;
  }
  if (row.commandType === "open-popup") {
    return `Route "${row.label}" opens popup ${target}; the popup is projected offline and not opened here.`;
  }
  return `Route "${row.label}" navigates to ${target} (${row.targetKind}); navigation is projected offline and not executed.`;
}

/**
 * Read-only review of the HMI navigation route-menu projection. Wraps
 * {@link hmiNavigationModel} and consolidates the diagnostics the validator only
 * partially surfaces (a single dead-end finding): shortcut folders, omitted but
 * still reachable screens, dead-end screens, missing shortcut targets,
 * caption-less menu entries, and security-hidden routes. Reachability verdicts
 * stay role-independent — passing `activeRoleIds` only annotates which routes a
 * role cannot currently see.
 */
export function hmiNavigationReviewReport(
  project: PlcProject,
  options: HmiNavigationReviewOptions = {},
): HmiNavigationReviewReport {
  const hmi = getHmiProject(project);
  if (!hmi) return emptyReport();

  // includeHidden keeps omitted and security-hidden items in the projection so
  // they can be reviewed; visibility is read off each item's hiddenReason.
  const model = hmiNavigationModel(hmi, {
    activeRoleIds: options.activeRoleIds,
    includeHidden: true,
  });
  const deadEnds = new Set(model.deadEndScreenIds);
  const screensById = new Map(hmi.screens.map((screen) => [screen.id, screen] as const));
  const shortcutsById = new Map(hmi.shortcuts.map((shortcut) => [shortcut.id, shortcut] as const));

  // A menu entry whose configured caption is blank renders empty for operators —
  // the projection falls back to the screen/shortcut name, so without this check the
  // route would look fine. Mirrors the validator's hmi-screen-navigation-caption-required
  // (only when a screen is explicitly included in the menu) and hmi-shortcut-caption-required.
  const captionMissing = (item: (typeof model.items)[number]): boolean => {
    if (item.source === "screen") {
      const screen = screensById.get(item.targetId);
      return Boolean(screen?.navigation?.includeInMenu) && !screen?.navigation?.caption?.trim();
    }
    const shortcut = shortcutsById.get(item.id.replace(/^shortcut:/, ""));
    return shortcut ? !shortcut.caption.trim() : false;
  };

  const rows: HmiNavigationReviewRow[] = model.items.map((item) => {
    const issues: HmiNavigationIssue[] = [];
    const isDeadEnd = item.targetKind === "screen" && deadEnds.has(item.targetId);
    if (item.hiddenReason === "missing-target") issues.push("missing-target");
    if (isDeadEnd) issues.push("dead-end-screen");
    if (item.hiddenReason === "screen-omitted" && !isDeadEnd) issues.push("omitted-screen");
    // Omitted screens are not in the menu, so a blank caption there is irrelevant.
    if (!issues.includes("omitted-screen") && captionMissing(item)) issues.push("missing-caption");
    if (item.hiddenReason === "security") issues.push("security-restricted");

    const status: HmiNavigationRouteStatus =
      issues.includes("missing-target") || issues.includes("dead-end-screen") || issues.includes("missing-caption")
        ? "needs-attention"
        : "reviewable";

    const rowBase = {
      itemId: item.id,
      source: item.source,
      label: item.label,
      folder: item.folder,
      targetKind: item.targetKind,
      targetId: item.targetId,
      targetName: item.targetName,
      commandType: item.commandType,
      securityRoleIds: [...item.securityRoleIds],
      status,
      issues,
      navigationExecuted: false as const,
      boundaries: [...ROUTE_BOUNDARIES],
    };
    return { ...rowBase, message: messageFor(rowBase) };
  });

  const warnings = rows.filter((row) => row.status === "needs-attention").map((row) => row.message);
  if (hmi.screens.length > 0 && !model.homeScreenName) {
    // homeScreenName only resolves when homeScreenId points at a real screen, so a
    // dangling home (its target screen was deleted) is caught alongside an unset one —
    // mirroring the validator's hmi-home-screen-missing / hmi-home-screen-unset split.
    warnings.unshift(
      model.homeScreenId
        ? "The configured home screen no longer exists; operators have no default route into the HMI."
        : "No home screen is selected; operators have no default route into the HMI.",
    );
  }

  return {
    homeScreenId: model.homeScreenId,
    homeScreenName: model.homeScreenName,
    rows,
    folders: model.folders.map((folder) => ({ name: folder.name, itemCount: folder.items.length })),
    routeCount: rows.length,
    shortcutCount: rows.filter((row) => row.source === "shortcut").length,
    omittedScreenCount: model.omittedScreenIds.length,
    deadEndScreenCount: model.deadEndScreenIds.length,
    missingTargetCount: model.missingTargetCount,
    captionMissingCount: rows.filter((row) => row.issues.includes("missing-caption")).length,
    securityHiddenCount: model.hiddenBySecurityCount,
    needsAttentionCount: rows.filter((row) => row.status === "needs-attention").length,
    warnings,
  };
}
