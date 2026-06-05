import { describe, expect, it } from "vitest";
import {
  createDefaultHmiProject,
  createHmiPopup,
  createHmiRuntimeSession,
  createHmiScreen,
  executeHmiRuntimeCommands,
  setHmiRuntimeSessionRoles,
} from "./index";

function securedProject() {
  const project = createDefaultHmiProject("Security HMI");
  const main = createHmiScreen("Main");
  main.id = "screen_main";
  const engineer = createHmiScreen("Engineer");
  engineer.id = "screen_engineer";
  engineer.securityRoleIds = ["role_engineer"];
  const tools = createHmiPopup("Engineer Tools");
  tools.id = "popup_tools";
  tools.securityRoleIds = ["role_engineer"];

  project.screens.push(main, engineer);
  project.popups.push(tools);
  project.homeScreenId = main.id;
  project.security.users.push({
    id: "user_engineer",
    username: "eng",
    fullName: "Erin Engineer",
    roleIds: ["role_engineer"],
  });

  return { project, main, engineer, tools };
}

describe("hmi runtime session security", () => {
  it("blocks secured navigation and popup commands until an allowed HMI user logs in", () => {
    const { project, main, engineer, tools } = securedProject();

    const initial = createHmiRuntimeSession(project);
    const blocked = executeHmiRuntimeCommands(project, initial, [
      { id: "cmd_nav_secure", type: "navigate", safety: "runtime-preview", args: { screenId: engineer.id } },
      { id: "cmd_popup_secure", type: "open-popup", safety: "runtime-preview", args: { popupId: tools.id } },
    ]);
    const elevated = executeHmiRuntimeCommands(project, blocked, [
      { id: "cmd_login", type: "login-user", safety: "runtime-preview", args: { username: "eng" } },
      { id: "cmd_nav_secure_ok", type: "navigate", safety: "runtime-preview", args: { screenId: engineer.id } },
      { id: "cmd_popup_secure_ok", type: "open-popup", safety: "runtime-preview", args: { popupId: tools.id } },
    ]);

    expect(initial.currentScreenId).toBe(main.id);
    expect(initial.activeRoleIds).toEqual(["role_operator"]);
    expect(initial.systemTags).toMatchObject({
      "System.CurrentUser": "Guest",
      "System.SecurityAuthority": "guest",
    });
    expect(blocked.currentScreenId).toBe(main.id);
    expect(blocked.popupStack).toEqual([]);
    expect(blocked.blockedCommandCount).toBe(2);
    expect(blocked.commandLog.map((entry) => entry.status)).toEqual(["blocked", "blocked"]);
    expect(blocked.commandLog[0]?.message).toContain("requires role Engineer");

    expect(elevated.activeRoleIds).toEqual(["role_engineer"]);
    expect(elevated.activeRoleNames).toEqual(["Engineer"]);
    expect(elevated.currentScreenId).toBe(engineer.id);
    expect(elevated.popupStack).toEqual([{ popupId: tools.id, popupName: tools.name }]);
    expect(elevated.systemTags).toMatchObject({
      "System.CurrentScreen": "Engineer",
      "System.CurrentUser": "eng",
      "System.CurrentUserFullName": "Erin Engineer",
      "System.SecurityAuthority": "local-user",
    });
    expect(elevated.commandLog.slice(-3).map((entry) => entry.status)).toEqual(["applied", "applied", "applied"]);
    expect(elevated.commandLog.find((entry) => entry.commandId === "cmd_login")?.effect).toEqual({
      kind: "login-user",
      username: "eng",
      roleIds: ["role_engineer"],
    });
  });

  it("returns to guest security, closes secured popups, and rescues the display after logout or role override", () => {
    const { project, main, engineer, tools } = securedProject();

    const elevated = executeHmiRuntimeCommands(
      project,
      setHmiRuntimeSessionRoles(project, createHmiRuntimeSession(project), ["role_engineer"], {
        currentUserName: "Engineer Preview",
        securityAuthority: "manual-preview",
      }),
      [
        { id: "cmd_nav_secure_ok", type: "navigate", safety: "runtime-preview", args: { screenId: engineer.id } },
        { id: "cmd_popup_secure_ok", type: "open-popup", safety: "runtime-preview", args: { popupId: tools.id } },
      ],
    );
    const manualOperator = setHmiRuntimeSessionRoles(project, elevated, ["role_operator"], {
      currentUserName: "Operator Preview",
      securityAuthority: "manual-preview",
    });
    const loggedOut = executeHmiRuntimeCommands(project, elevated, [
      { id: "cmd_logout", type: "logout-user", safety: "runtime-preview", args: {} },
    ]);

    expect(elevated.currentScreenId).toBe(engineer.id);
    expect(elevated.popupStack).toHaveLength(1);

    expect(manualOperator.currentScreenId).toBe(main.id);
    expect(manualOperator.previousScreenId).toBe(engineer.id);
    expect(manualOperator.popupStack).toEqual([]);
    expect(manualOperator.systemTags).toMatchObject({
      "System.CurrentScreen": "Main",
      "System.CurrentUser": "Operator Preview",
      "System.SecurityAuthority": "manual-preview",
    });

    expect(loggedOut.currentScreenId).toBe(main.id);
    expect(loggedOut.previousScreenId).toBe(engineer.id);
    expect(loggedOut.popupStack).toEqual([]);
    expect(loggedOut.activeRoleIds).toEqual(["role_operator"]);
    expect(loggedOut.systemTags).toMatchObject({
      "System.CurrentScreen": "Main",
      "System.CurrentUser": "Guest",
      "System.SecurityAuthority": "guest",
    });
    expect(loggedOut.commandLog.at(-1)?.effect).toEqual({ kind: "logout-user", roleIds: ["role_operator"] });
  });
});
