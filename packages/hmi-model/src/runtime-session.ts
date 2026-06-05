import type {
  HmiCommand,
  HmiProject,
  HmiRuntimeCommandEffect,
  HmiRuntimeCommandResult,
  HmiRuntimeSession,
  HmiScreen,
  HmiSecurityUser,
} from "./types";

type SecurityOptions = Partial<
  Pick<HmiRuntimeSession, "currentUserName" | "currentUserFullName" | "securityAuthority">
>;

function stringArg(command: HmiCommand, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = command.args[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function cloneSession(session: HmiRuntimeSession): HmiRuntimeSession {
  return {
    ...session,
    activeRoleIds: [...session.activeRoleIds],
    activeRoleNames: [...session.activeRoleNames],
    popupStack: session.popupStack.map((popup) => ({ ...popup })),
    commandLog: session.commandLog.map((entry) => ({ ...entry, effect: entry.effect ? { ...entry.effect } : undefined })),
    systemTags: { ...session.systemTags },
  };
}

function normalizeRoleIds(project: HmiProject, roleIds: readonly string[]): string[] {
  const knownRoleIds = new Set(project.security.roles.map((role) => role.id));
  const normalized: string[] = [];
  for (const raw of roleIds) {
    const roleId = raw.trim();
    if (!roleId || !knownRoleIds.has(roleId) || normalized.includes(roleId)) continue;
    normalized.push(roleId);
  }
  return normalized;
}

function roleNames(project: HmiProject, roleIds: readonly string[]): string[] {
  const names = new Map(project.security.roles.map((role) => [role.id, role.name]));
  return roleIds.map((roleId) => names.get(roleId) ?? roleId);
}

function guestRoleIds(project: HmiProject): string[] {
  return normalizeRoleIds(project, project.security.guestRoleId ? [project.security.guestRoleId] : []);
}

function canAccessRoleIds(requiredRoleIds: readonly string[], activeRoleIds: readonly string[]): boolean {
  const required = requiredRoleIds.map((roleId) => roleId.trim()).filter(Boolean);
  if (required.length === 0) return true;
  const active = new Set(activeRoleIds);
  return required.some((roleId) => active.has(roleId));
}

function requiredRoleNames(project: HmiProject, requiredRoleIds: readonly string[]): string {
  return roleNames(project, requiredRoleIds.map((roleId) => roleId.trim()).filter(Boolean)).join(", ") || "configured role";
}

function findEnabledUser(project: HmiProject, username: string): HmiSecurityUser | undefined {
  const needle = username.trim().toLowerCase();
  return project.security.users.find((user) => !user.disabled && user.username.trim().toLowerCase() === needle);
}

function fallbackScreen(project: HmiProject, activeRoleIds: readonly string[]): HmiScreen | undefined {
  const home = project.screens.find((screen) => screen.id === project.homeScreenId);
  if (home && canAccessRoleIds(home.securityRoleIds, activeRoleIds)) return home;
  return project.screens.find((screen) => canAccessRoleIds(screen.securityRoleIds, activeRoleIds));
}

function reconcileAccessibleSurfaces(
  project: HmiProject,
  session: Omit<HmiRuntimeSession, "systemTags">,
): Omit<HmiRuntimeSession, "systemTags"> {
  const current = project.screens.find((screen) => screen.id === session.currentScreenId);
  let currentScreenId = current?.id;
  let currentScreenName = current?.name;
  let previousScreenId = session.previousScreenId;
  let previousScreenName = session.previousScreenName;

  if (!current || !canAccessRoleIds(current.securityRoleIds, session.activeRoleIds)) {
    const fallback = fallbackScreen(project, session.activeRoleIds);
    if (current && fallback?.id !== current.id) {
      previousScreenId = current.id;
      previousScreenName = current.name;
    }
    currentScreenId = fallback?.id;
    currentScreenName = fallback?.name;
  }

  const popupStack = session.popupStack.flatMap((entry) => {
    const popup = project.popups.find((candidate) => candidate.id === entry.popupId);
    if (!popup || !canAccessRoleIds(popup.securityRoleIds, session.activeRoleIds)) return [];
    return [{ popupId: popup.id, popupName: popup.name }];
  });

  return {
    ...session,
    currentScreenId,
    currentScreenName,
    previousScreenId,
    previousScreenName,
    popupStack,
  };
}

function summarizeSystemTags(project: HmiProject, session: Omit<HmiRuntimeSession, "systemTags">): HmiRuntimeSession["systemTags"] {
  return {
    "System.CurrentScreen": session.currentScreenName ?? "",
    "System.PreviousScreen": session.previousScreenName ?? "",
    "System.CurrentLanguage": session.currentLanguage,
    "System.ProjectName": project.name,
    "System.CurrentUser": session.currentUserName,
    "System.CurrentUserFullName": session.currentUserFullName,
    "System.SecurityAuthority": session.securityAuthority,
  };
}

function withSystemTags(project: HmiProject, session: Omit<HmiRuntimeSession, "systemTags">): HmiRuntimeSession {
  const reconciled = reconcileAccessibleSurfaces(project, session);
  return {
    ...reconciled,
    systemTags: summarizeSystemTags(project, reconciled),
  };
}

function withResult(
  project: HmiProject,
  session: Omit<HmiRuntimeSession, "systemTags" | "blockedCommandCount"> & { blockedCommandCount?: number },
  result: HmiRuntimeCommandResult,
): HmiRuntimeSession {
  const blockedCommandCount = (session.blockedCommandCount ?? 0) + (result.status === "blocked" ? 1 : 0);
  const next = {
    ...session,
    blockedCommandCount,
    commandLog: [...session.commandLog, result],
  };
  return withSystemTags(project, next);
}

function result(
  command: HmiCommand,
  status: HmiRuntimeCommandResult["status"],
  message: string,
  effect?: HmiRuntimeCommandEffect,
): HmiRuntimeCommandResult {
  return {
    commandId: command.id,
    type: command.type,
    status,
    message,
    effect,
  };
}

function commandBlockedBySafety(command: HmiCommand): HmiRuntimeCommandResult | undefined {
  if (command.safety === "hardware-only") {
    return result(command, "blocked", `Command "${command.type}" requires hardware runtime support and was not executed offline.`);
  }
  if (command.safety === "unsupported" || command.type === "unknown") {
    return result(command, "blocked", `Command "${command.preservedType ?? command.type}" is unsupported and preserved read-only.`);
  }
  return undefined;
}

export function createHmiRuntimeSession(project: HmiProject): HmiRuntimeSession {
  const activeRoleIds = guestRoleIds(project);
  const activeRoleNames = roleNames(project, activeRoleIds);
  const currentScreen = fallbackScreen(project, activeRoleIds);
  const base = {
    projectId: project.id,
    projectName: project.name,
    currentScreenId: currentScreen?.id,
    currentScreenName: currentScreen?.name,
    currentLanguage: project.defaultLanguage,
    currentUserName: activeRoleIds.length ? "Guest" : "",
    currentUserFullName: "",
    activeRoleIds,
    activeRoleNames,
    securityAuthority: activeRoleIds.length ? "guest" : "none",
    popupStack: [],
    commandLog: [],
    blockedCommandCount: 0,
  } satisfies Omit<HmiRuntimeSession, "systemTags">;
  return withSystemTags(project, base);
}

export function setHmiRuntimeSessionRoles(
  project: HmiProject,
  session: HmiRuntimeSession,
  roleIds: readonly string[],
  options: SecurityOptions = {},
): HmiRuntimeSession {
  const activeRoleIds = normalizeRoleIds(project, roleIds);
  const activeRoleNames = roleNames(project, activeRoleIds);
  const next = {
    ...cloneSession(session),
    activeRoleIds,
    activeRoleNames,
    currentUserName: options.currentUserName ?? activeRoleNames.join(", "),
    currentUserFullName: options.currentUserFullName ?? "",
    securityAuthority: options.securityAuthority ?? (activeRoleIds.length ? "manual-preview" : "none"),
  } satisfies HmiRuntimeSession;
  return withSystemTags(project, next);
}

export function executeHmiRuntimeCommand(
  project: HmiProject,
  session: HmiRuntimeSession,
  command: HmiCommand,
): HmiRuntimeSession {
  const safetyBlocked = commandBlockedBySafety(command);
  if (safetyBlocked) return withResult(project, cloneSession(session), safetyBlocked);

  const next = cloneSession(session);
  switch (command.type) {
    case "navigate": {
      const screenId = stringArg(command, "screenId", "targetScreenId", "targetId");
      const screen = project.screens.find((candidate) => candidate.id === screenId);
      if (!screenId || !screen) {
        return withResult(project, next, result(command, "blocked", "Navigate command targets a missing screen."));
      }
      if (!canAccessRoleIds(screen.securityRoleIds, next.activeRoleIds)) {
        return withResult(
          project,
          next,
          result(
            command,
            "blocked",
            `Navigate command blocked by HMI security; screen "${screen.name}" requires role ${requiredRoleNames(project, screen.securityRoleIds)}.`,
          ),
        );
      }
      const previousScreenId = next.currentScreenId;
      next.previousScreenId = previousScreenId;
      next.previousScreenName = next.currentScreenName;
      next.currentScreenId = screen.id;
      next.currentScreenName = screen.name;
      return withResult(
        project,
        next,
        result(command, "applied", `Navigated to screen "${screen.name}".`, {
          kind: "navigate",
          screenId: screen.id,
          previousScreenId,
        }),
      );
    }
    case "open-popup": {
      const popupId = stringArg(command, "popupId", "targetPopupId", "targetId");
      const popup = project.popups.find((candidate) => candidate.id === popupId);
      if (!popupId || !popup) {
        return withResult(project, next, result(command, "blocked", "Open popup command targets a missing popup."));
      }
      if (!canAccessRoleIds(popup.securityRoleIds, next.activeRoleIds)) {
        return withResult(
          project,
          next,
          result(
            command,
            "blocked",
            `Open popup command blocked by HMI security; popup "${popup.name}" requires role ${requiredRoleNames(project, popup.securityRoleIds)}.`,
          ),
        );
      }
      next.popupStack = next.popupStack.filter((entry) => entry.popupId !== popup.id);
      next.popupStack.push({ popupId: popup.id, popupName: popup.name });
      return withResult(
        project,
        next,
        result(command, "applied", `Opened popup "${popup.name}".`, { kind: "open-popup", popupId: popup.id }),
      );
    }
    case "close-popup": {
      const popupId = stringArg(command, "popupId", "targetPopupId", "targetId");
      if (popupId) {
        const before = next.popupStack.length;
        next.popupStack = next.popupStack.filter((entry) => entry.popupId !== popupId);
        return withResult(
          project,
          next,
          result(
            command,
            before === next.popupStack.length ? "ignored" : "applied",
            before === next.popupStack.length ? "Popup was not open." : "Closed popup.",
            { kind: "close-popup", popupId },
          ),
        );
      }
      const closed = next.popupStack.pop();
      return withResult(
        project,
        next,
        result(
          command,
          closed ? "applied" : "ignored",
          closed ? `Closed popup "${closed.popupName}".` : "No popup was open.",
          { kind: "close-popup", popupId: closed?.popupId },
        ),
      );
    }
    case "change-language": {
      const languageId = stringArg(command, "languageId", "targetLanguage", "targetId");
      const language = project.languagePacks.find((candidate) => candidate.languageId === languageId);
      if (!languageId || !language) {
        return withResult(project, next, result(command, "blocked", "Change language command targets a missing language pack."));
      }
      next.currentLanguage = language.languageId;
      return withResult(
        project,
        next,
        result(command, "applied", `Changed language to "${language.displayName}".`, {
          kind: "change-language",
          languageId: language.languageId,
        }),
      );
    }
    case "set-tag-value": {
      const tagPath = stringArg(command, "tagPath", "targetTagPath");
      if (!tagPath) {
        return withResult(project, next, result(command, "blocked", "Set-tag command requires a tag path."));
      }
      return withResult(
        project,
        next,
        result(command, "applied", `Queued offline tag-write preview for "${tagPath}".`, {
          kind: "tag-write-preview",
          tagPath,
          value: command.args.value,
        }),
      );
    }
    case "export-data-log":
    case "clear-data-log": {
      const dataLogId = stringArg(command, "dataLogId", "logId", "targetId");
      const dataLog = project.dataLogs.find((candidate) => candidate.id === dataLogId);
      if (!dataLogId || !dataLog) {
        return withResult(project, next, result(command, "blocked", "Data-log command targets a missing data log."));
      }
      const kind = command.type === "export-data-log" ? "data-log-export" : "data-log-clear";
      return withResult(
        project,
        next,
        result(command, "applied", `${command.type === "export-data-log" ? "Exported" : "Cleared"} data log "${dataLog.name}" in offline preview.`, {
          kind,
          dataLogId: dataLog.id,
        }),
      );
    }
    case "apply-recipe": {
      const recipeId = stringArg(command, "recipeId", "targetRecipeId", "targetId");
      const recipe = (project.recipes ?? []).find((candidate) => candidate.id === recipeId);
      if (!recipeId || !recipe) {
        return withResult(project, next, result(command, "blocked", "Recipe command targets a missing recipe."));
      }
      if (recipe.items.length === 0) {
        return withResult(project, next, result(command, "blocked", `Recipe "${recipe.name}" has no tag values.`));
      }
      if (!canAccessRoleIds(recipe.securityRoleIds, next.activeRoleIds)) {
        return withResult(
          project,
          next,
          result(
            command,
            "blocked",
            `Recipe command blocked by HMI security; recipe "${recipe.name}" requires role ${requiredRoleNames(project, recipe.securityRoleIds)}.`,
          ),
        );
      }
      return withResult(
        project,
        next,
        result(command, "applied", `Queued offline recipe apply preview for "${recipe.name}".`, {
          kind: "apply-recipe",
          recipeId: recipe.id,
        }),
      );
    }
    case "login-user": {
      const username = stringArg(command, "username", "userName", "targetUser", "targetId");
      const user = username ? findEnabledUser(project, username) : undefined;
      if (!username || !user) {
        return withResult(project, next, result(command, "blocked", "Login command targets a missing or disabled HMI user."));
      }
      const activeRoleIds = normalizeRoleIds(project, user.roleIds);
      if (activeRoleIds.length === 0) {
        return withResult(project, next, result(command, "blocked", `Login command user "${user.username}" has no valid HMI security roles.`));
      }
      const secured = setHmiRuntimeSessionRoles(project, next, activeRoleIds, {
        currentUserName: user.username,
        currentUserFullName: user.fullName?.trim() || user.username,
        securityAuthority: "local-user",
      });
      return withResult(
        project,
        secured,
        result(command, "applied", `Logged in HMI user "${user.username}".`, {
          kind: "login-user",
          username: user.username,
          roleIds: activeRoleIds,
        }),
      );
    }
    case "logout-user": {
      const activeRoleIds = guestRoleIds(project);
      const secured = setHmiRuntimeSessionRoles(project, next, activeRoleIds, {
        currentUserName: activeRoleIds.length ? "Guest" : "",
        currentUserFullName: "",
        securityAuthority: activeRoleIds.length ? "guest" : "none",
      });
      return withResult(
        project,
        secured,
        result(command, "applied", "Logged out to the HMI guest security context.", {
          kind: "logout-user",
          roleIds: activeRoleIds,
        }),
      );
    }
    case "device-command":
      return withResult(project, next, result(command, "blocked", "Device command is model-only in offline runtime preview."));
    default:
      return withResult(project, next, result(command, "ignored", `Command "${command.type}" has no offline runtime effect.`));
  }
}

export function executeHmiRuntimeCommands(
  project: HmiProject,
  session: HmiRuntimeSession,
  commands: readonly HmiCommand[],
): HmiRuntimeSession {
  return commands.reduce((current, command) => executeHmiRuntimeCommand(project, current, command), session);
}
