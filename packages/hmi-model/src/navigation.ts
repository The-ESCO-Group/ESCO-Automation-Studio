import type {
  HmiNavigationFolder,
  HmiNavigationItem,
  HmiNavigationModel,
  HmiNavigationProjectionOptions,
  HmiProject,
  HmiScreen,
  HmiShortcut,
} from "./types";

function isVisibleToRoles(required: string[], active: Set<string> | undefined): boolean {
  if (required.length === 0) return true;
  if (!active) return true;
  return required.some((roleId) => active.has(roleId));
}

function screenItem(screen: HmiScreen, activeRoles: Set<string> | undefined): HmiNavigationItem {
  const included = screen.navigation?.includeInMenu !== false;
  const visibleToRole = isVisibleToRoles(screen.securityRoleIds, activeRoles);
  return {
    id: `screen:${screen.id}`,
    source: "screen",
    label: screen.navigation?.caption?.trim() || screen.name,
    icon: screen.navigation?.icon,
    targetKind: "screen",
    targetId: screen.id,
    targetName: screen.name,
    commandType: "navigate",
    securityRoleIds: [...screen.securityRoleIds],
    visible: included && visibleToRole,
    hiddenReason: !included ? "screen-omitted" : !visibleToRole ? "security" : undefined,
  };
}

function shortcutItem(project: HmiProject, shortcut: HmiShortcut, activeRoles: Set<string> | undefined): HmiNavigationItem {
  const target = shortcut.targetKind === "screen"
    ? project.screens.find((screen) => screen.id === shortcut.targetId)
    : project.popups.find((popup) => popup.id === shortcut.targetId);
  const visibleToRole = isVisibleToRoles(shortcut.securityRoleIds, activeRoles);
  return {
    id: `shortcut:${shortcut.id}`,
    source: "shortcut",
    label: shortcut.caption.trim() || shortcut.name,
    icon: shortcut.icon,
    folder: shortcut.folder?.trim() || undefined,
    targetKind: shortcut.targetKind,
    targetId: shortcut.targetId,
    targetName: target?.name,
    commandType: shortcut.targetKind === "screen" ? "navigate" : "open-popup",
    securityRoleIds: [...shortcut.securityRoleIds],
    visible: Boolean(target) && visibleToRole,
    hiddenReason: !target ? "missing-target" : !visibleToRole ? "security" : undefined,
  };
}

function groupFolders(items: HmiNavigationItem[]): HmiNavigationFolder[] {
  const folders = new Map<string, HmiNavigationItem[]>();
  for (const item of items) {
    const folder = item.folder?.trim() || "Root";
    folders.set(folder, [...(folders.get(folder) ?? []), item]);
  }
  return [...folders.entries()]
    .map(([name, folderItems]) => ({ name, items: folderItems }))
    // Ungrouped top-level routes (the synthetic "Root" group: every screen plus any
    // folderless shortcut) lead the menu the way a FactoryTalk navigation tree renders
    // them; named shortcut folders follow alphabetically. Sorting "Root" purely by name
    // would bury the main menu behind any folder that sorts ahead of it (e.g. "Alarms").
    .sort((a, b) => {
      if (a.name === "Root") return b.name === "Root" ? 0 : -1;
      if (b.name === "Root") return 1;
      return a.name.localeCompare(b.name);
    });
}

export function hmiNavigationModel(
  project: HmiProject,
  options: HmiNavigationProjectionOptions = {},
): HmiNavigationModel {
  const activeRoles = options.activeRoleIds ? new Set(options.activeRoleIds) : undefined;
  const allItems = [
    ...project.screens.map((screen) => screenItem(screen, activeRoles)),
    ...project.shortcuts.map((shortcut) => shortcutItem(project, shortcut, activeRoles)),
  ];
  const items = options.includeHidden ? allItems : allItems.filter((item) => item.visible);
  // Reachability is a structural, role-independent verdict: a screen is routed if it
  // appears in the menu or is the resolved target of a shortcut, regardless of which
  // roles can currently see it. Filtering on `item.visible` here would let a passed
  // `activeRoleIds` falsely demote a role-gated (but reachable) screen to a dead end,
  // which the invariant tests and the validator's `hmi-screen-unreachable` message
  // both forbid. Security only affects `visible`/`items`, never the routing verdict.
  const routedScreenIds = new Set(
    allItems
      .filter(
        (item) =>
          item.targetKind === "screen" &&
          item.hiddenReason !== "screen-omitted" &&
          item.hiddenReason !== "missing-target",
      )
      .map((item) => item.targetId),
  );
  if (project.homeScreenId) routedScreenIds.add(project.homeScreenId);
  const omittedScreenIds = project.screens
    .filter((screen) => screen.navigation?.includeInMenu === false)
    .map((screen) => screen.id);
  const deadEndScreenIds = project.screens
    .filter((screen) => !routedScreenIds.has(screen.id))
    .map((screen) => screen.id);

  return {
    homeScreenId: project.homeScreenId,
    homeScreenName: project.screens.find((screen) => screen.id === project.homeScreenId)?.name,
    items,
    folders: groupFolders(items),
    omittedScreenIds,
    deadEndScreenIds,
    missingTargetCount: allItems.filter((item) => item.hiddenReason === "missing-target").length,
    hiddenBySecurityCount: allItems.filter((item) => item.hiddenReason === "security").length,
  };
}
