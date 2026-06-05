import { describe, expect, it } from "vitest";
import { createController, createProject } from "@esco/core";
import { getHmiProject } from "@esco/hmi-model";
import type { PlcProject } from "@esco/core";
import { exportHmiLanguagePackCsv } from "@esco/hmi-model";
import {
  addHmiTrendPen,
  createHmiAlarmDefinition,
  createHmiDataLogDefinition,
  createHmiLanguagePack,
  createHmiSecurityRole,
  createHmiSecurityUser,
  createHmiTrendDefinition,
  deleteHmiAlarmDefinition,
  deleteHmiDataLogDefinition,
  deleteHmiLanguagePack,
  deleteHmiSecurityRole,
  deleteHmiSecurityUser,
  deleteHmiTrendDefinition,
  ensureHmiProject,
  importHmiLanguagePack,
  removeHmiLanguageString,
  removeHmiTrendPen,
  setHmiDefaultLanguage,
  setHmiLanguageString,
  updateHmiAlarmDefinition,
  updateHmiDataLogDefinition,
  updateHmiTrendDefinition,
} from "./index";

function baseProject(): PlcProject {
  const project = createProject("Demo");
  const withController = { ...project, controllers: [createController(project.id, "Line1")] };
  const ensured = ensureHmiProject(withController);
  expect(ensured.ok).toBe(true);
  return ensured.project;
}

describe("HMI alarm authoring", () => {
  it("creates a digital alarm with defaults", () => {
    const result = createHmiAlarmDefinition(baseProject(), { name: "Motor Fault", tagPath: "Motor_Fault" });
    expect(result.ok).toBe(true);
    const alarm = getHmiProject(result.project)!.alarms[0]!;
    expect(alarm).toMatchObject({ name: "Motor Fault", tagPath: "Motor_Fault", severity: "warning", allowAcknowledge: true, enabled: true });
    expect(alarm.trigger).toEqual({ kind: "digital", activeValue: true });
  });

  it("creates an analog-high alarm with threshold and deadband", () => {
    const result = createHmiAlarmDefinition(baseProject(), {
      name: "Tank High",
      tagPath: "Tank_Level",
      severity: "major",
      triggerKind: "analog-high",
      threshold: 90,
      deadband: 2,
    });
    expect(result.ok).toBe(true);
    expect(getHmiProject(result.project)!.alarms[0]!.trigger).toEqual({ kind: "analog-high", threshold: 90, deadband: 2 });
  });

  it("rejects an analog alarm without a finite threshold", () => {
    const result = createHmiAlarmDefinition(baseProject(), { name: "Bad", tagPath: "X", triggerKind: "analog-low" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/finite threshold/);
  });

  it("rejects a blank name, blank tag, and duplicate name", () => {
    expect(createHmiAlarmDefinition(baseProject(), { name: "", tagPath: "X" }).ok).toBe(false);
    expect(createHmiAlarmDefinition(baseProject(), { name: "A", tagPath: "" }).ok).toBe(false);
    const once = createHmiAlarmDefinition(baseProject(), { name: "Dup", tagPath: "X" });
    const twice = createHmiAlarmDefinition(once.project, { name: "Dup", tagPath: "Y" });
    expect(twice.ok).toBe(false);
    expect(twice.error).toMatch(/already exists/);
  });

  it("updates an alarm and reswitches its trigger kind", () => {
    const created = createHmiAlarmDefinition(baseProject(), { name: "Tank", tagPath: "Tank_Level" });
    const alarmId = created.data!.alarmId;
    const updated = updateHmiAlarmDefinition(created.project, {
      alarmId,
      severity: "critical",
      triggerKind: "analog-high",
      threshold: 80,
    });
    expect(updated.ok).toBe(true);
    const alarm = getHmiProject(updated.project)!.alarms[0]!;
    expect(alarm.severity).toBe("critical");
    expect(alarm.trigger).toEqual({ kind: "analog-high", threshold: 80 });
  });

  it("deletes an alarm", () => {
    const created = createHmiAlarmDefinition(baseProject(), { name: "Tank", tagPath: "Tank_Level" });
    const removed = deleteHmiAlarmDefinition(created.project, { alarmId: created.data!.alarmId });
    expect(removed.ok).toBe(true);
    expect(getHmiProject(removed.project)!.alarms).toHaveLength(0);
    expect(deleteHmiAlarmDefinition(removed.project, { alarmId: "ghost" }).ok).toBe(false);
  });
});

describe("HMI trend authoring", () => {
  it("creates a trend with defaults and validates sample rate", () => {
    const result = createHmiTrendDefinition(baseProject(), { name: "Levels" });
    expect(result.ok).toBe(true);
    expect(getHmiProject(result.project)!.trends[0]).toMatchObject({ name: "Levels", sampleRateMs: 1000, timeRangeSeconds: 300, traces: [] });
    expect(createHmiTrendDefinition(baseProject(), { name: "Bad", sampleRateMs: 0 }).ok).toBe(false);
    expect(createHmiTrendDefinition(baseProject(), { name: "Bad", timeRangeSeconds: -1 }).ok).toBe(false);
  });

  it("adds and removes pens, auto-assigning colors", () => {
    const trend = createHmiTrendDefinition(baseProject(), { name: "Levels" });
    const trendId = trend.data!.trendId;
    const pen1 = addHmiTrendPen(trend.project, { trendId, label: "Level", tagPath: "Tank_Level" });
    expect(pen1.ok).toBe(true);
    const pen2 = addHmiTrendPen(pen1.project, { trendId, label: "Speed", tagPath: "Motor_Speed", color: "#123456" });
    const traces = getHmiProject(pen2.project)!.trends[0]!.traces;
    expect(traces).toHaveLength(2);
    expect(traces[0]).toMatchObject({ label: "Level", color: "#2563eb", source: { kind: "tag", path: "Tank_Level" } });
    expect(traces[1]!.color).toBe("#123456");

    const removed = removeHmiTrendPen(pen2.project, { trendId, traceId: traces[0]!.id });
    expect(removed.ok).toBe(true);
    expect(getHmiProject(removed.project)!.trends[0]!.traces).toHaveLength(1);
  });

  it("rejects pens without a label or tag path, and updates/deletes trends", () => {
    const trend = createHmiTrendDefinition(baseProject(), { name: "Levels" });
    const trendId = trend.data!.trendId;
    expect(addHmiTrendPen(trend.project, { trendId, label: "", tagPath: "X" }).ok).toBe(false);
    expect(addHmiTrendPen(trend.project, { trendId, label: "L", tagPath: "" }).ok).toBe(false);

    const updated = updateHmiTrendDefinition(trend.project, { trendId, name: "Renamed", sampleRateMs: 500 });
    expect(updated.ok).toBe(true);
    expect(getHmiProject(updated.project)!.trends[0]).toMatchObject({ name: "Renamed", sampleRateMs: 500 });

    const deleted = deleteHmiTrendDefinition(updated.project, { trendId });
    expect(deleted.ok).toBe(true);
    expect(getHmiProject(deleted.project)!.trends).toHaveLength(0);
  });
});

describe("HMI data-log authoring", () => {
  it("creates a data log with normalized tag paths and defaults", () => {
    const result = createHmiDataLogDefinition(baseProject(), {
      name: "Batch Log",
      dataLogId: "log_batch",
      tagPaths: ["Tank_Level", " ", "Tank_Level", "Motor_Speed"],
    });
    const log = getHmiProject(result.project)!.dataLogs[0]!;

    expect(result.ok).toBe(true);
    expect(log).toMatchObject({
      id: "log_batch",
      name: "Batch Log",
      sampleRateMs: 1000,
      retentionHours: 24,
      tagPaths: ["Tank_Level", "Motor_Speed"],
    });
  });

  it("rejects invalid data-log timing, blank tags, and duplicate names", () => {
    expect(createHmiDataLogDefinition(baseProject(), { name: "Bad", tagPaths: ["Tank"], sampleRateMs: 0 }).ok).toBe(false);
    expect(createHmiDataLogDefinition(baseProject(), { name: "Bad", tagPaths: ["Tank"], retentionHours: -1 }).ok).toBe(false);
    expect(createHmiDataLogDefinition(baseProject(), { name: "Bad", tagPaths: [" "] }).ok).toBe(false);

    const once = createHmiDataLogDefinition(baseProject(), { name: "Batch", tagPaths: ["Tank_Level"] });
    const twice = createHmiDataLogDefinition(once.project, { name: "batch", tagPaths: ["Motor_Speed"] });
    expect(twice.ok).toBe(false);
    expect(twice.error).toMatch(/already exists/);
  });

  it("updates and deletes a data log", () => {
    const created = createHmiDataLogDefinition(baseProject(), {
      name: "Batch",
      tagPaths: ["Tank_Level"],
      statusTagPath: "System.DataLogStatus",
    });
    const dataLogId = created.data!.dataLogId;
    const updated = updateHmiDataLogDefinition(created.project, {
      dataLogId,
      name: "Batch Archive",
      sampleRateMs: 500,
      retentionHours: 12,
      tagPaths: ["Motor_Speed", "Tank_Level"],
      statusTagPath: null,
    });
    const log = getHmiProject(updated.project)!.dataLogs[0]!;

    expect(updated.ok).toBe(true);
    expect(log).toMatchObject({
      name: "Batch Archive",
      sampleRateMs: 500,
      retentionHours: 12,
      tagPaths: ["Motor_Speed", "Tank_Level"],
    });
    expect(log.statusTagPath).toBeUndefined();

    const deleted = deleteHmiDataLogDefinition(updated.project, { dataLogId });
    expect(deleted.ok).toBe(true);
    expect(getHmiProject(deleted.project)!.dataLogs).toHaveLength(0);
    expect(deleteHmiDataLogDefinition(deleted.project, { dataLogId }).ok).toBe(false);
  });
});

describe("HMI language authoring", () => {
  it("creates a language pack and sets/removes strings", () => {
    const created = createHmiLanguagePack(baseProject(), { languageId: "de-DE", displayName: "Deutsch" });
    expect(created.ok).toBe(true);
    const setStr = setHmiLanguageString(created.project, { languageId: "de-DE", key: "greeting", value: "Hallo" });
    expect(setStr.ok).toBe(true);
    expect(getHmiProject(setStr.project)!.languagePacks.find((p) => p.languageId === "de-DE")!.strings.greeting).toBe("Hallo");

    const removed = removeHmiLanguageString(setStr.project, { languageId: "de-DE", key: "greeting" });
    expect(removed.ok).toBe(true);
    expect(getHmiProject(removed.project)!.languagePacks.find((p) => p.languageId === "de-DE")!.strings.greeting).toBeUndefined();
  });

  it("rejects invalid/duplicate language ids", () => {
    expect(createHmiLanguagePack(baseProject(), { languageId: "" }).ok).toBe(false);
    expect(createHmiLanguagePack(baseProject(), { languageId: "not a tag!" }).ok).toBe(false);
    const once = createHmiLanguagePack(baseProject(), { languageId: "fr-FR" });
    expect(createHmiLanguagePack(once.project, { languageId: "fr-FR" }).ok).toBe(false);
  });

  it("round-trips a language pack through CSV export/import", () => {
    const created = createHmiLanguagePack(baseProject(), { languageId: "de-DE", displayName: "Deutsch" });
    const withStr = setHmiLanguageString(created.project, { languageId: "de-DE", key: "greeting", value: "Hallo" });
    const pack = getHmiProject(withStr.project)!.languagePacks.find((p) => p.languageId === "de-DE")!;
    const csv = exportHmiLanguagePackCsv(pack).text;

    // Import the CSV into a fresh project (no de-DE pack yet).
    const imported = importHmiLanguagePack(baseProject(), { text: csv, sourceFileName: "de.csv" });
    expect(imported.ok).toBe(true);
    const importedPack = getHmiProject(imported.project)!.languagePacks.find((p) => p.languageId === "de-DE");
    expect(importedPack?.strings.greeting).toBe("Hallo");
    expect(importHmiLanguagePack(baseProject(), { text: "" }).ok).toBe(false);
  });

  it("sets the default language and prevents deleting the last pack", () => {
    const created = createHmiLanguagePack(baseProject(), { languageId: "de-DE" });
    const def = setHmiDefaultLanguage(created.project, { languageId: "de-DE" });
    expect(def.ok).toBe(true);
    expect(getHmiProject(def.project)!.defaultLanguage).toBe("de-DE");

    // Deleting the default reassigns it to a remaining pack.
    const deleted = deleteHmiLanguagePack(def.project, { languageId: "de-DE" });
    expect(deleted.ok).toBe(true);
    const hmi = getHmiProject(deleted.project)!;
    expect(hmi.languagePacks.some((p) => p.languageId === "de-DE")).toBe(false);
    expect(hmi.languagePacks.some((p) => p.languageId === hmi.defaultLanguage)).toBe(true);

    // Cannot remove the final remaining pack.
    expect(deleteHmiLanguagePack(deleted.project, { languageId: hmi.defaultLanguage }).ok).toBe(false);
  });
});

describe("HMI security authoring", () => {
  it("creates a role and assigns a user to it", () => {
    const role = createHmiSecurityRole(baseProject(), { name: "Supervisor", permissions: ["navigate", "configure"] });
    expect(role.ok).toBe(true);
    const roleId = role.data!.roleId;
    expect(getHmiProject(role.project)!.security.roles.some((r) => r.id === roleId)).toBe(true);

    const user = createHmiSecurityUser(role.project, { username: "alice", roleIds: [roleId], fullName: "Alice A" });
    expect(user.ok).toBe(true);
    expect(getHmiProject(user.project)!.security.users[0]).toMatchObject({ username: "alice", roleIds: [roleId] });
  });

  it("assigns the guest role when none remains", () => {
    let project = baseProject();
    for (const role of [...getHmiProject(project)!.security.roles]) {
      const res = deleteHmiSecurityRole(project, { roleId: role.id });
      expect(res.ok).toBe(true);
      project = res.project;
    }
    expect(getHmiProject(project)!.security.guestRoleId).toBeUndefined();
    const created = createHmiSecurityRole(project, { name: "Operator" });
    expect(getHmiProject(created.project)!.security.guestRoleId).toBe(created.data!.roleId);
  });

  it("rejects duplicate roles, users with no/unknown roles", () => {
    const once = createHmiSecurityRole(baseProject(), { name: "Maintenance" });
    expect(createHmiSecurityRole(once.project, { name: "Maintenance" }).ok).toBe(false);
    expect(createHmiSecurityUser(once.project, { username: "bob", roleIds: [] }).ok).toBe(false);
    expect(createHmiSecurityUser(once.project, { username: "bob", roleIds: ["ghost"] }).ok).toBe(false);
  });

  it("deletes a role (removing it from users) and deletes users", () => {
    const r1 = createHmiSecurityRole(baseProject(), { name: "Supervisor" });
    const r2 = createHmiSecurityRole(r1.project, { name: "Maintenance" });
    const roleId1 = r1.data!.roleId;
    const roleId2 = r2.data!.roleId;
    const user = createHmiSecurityUser(r2.project, { username: "carol", roleIds: [roleId1, roleId2] });

    const delRole = deleteHmiSecurityRole(user.project, { roleId: roleId1 });
    expect(delRole.ok).toBe(true);
    expect(getHmiProject(delRole.project)!.security.users[0]!.roleIds).toEqual([roleId2]);

    const userId = user.data!.userId;
    const delUser = deleteHmiSecurityUser(delRole.project, { userId });
    expect(delUser.ok).toBe(true);
    expect(getHmiProject(delUser.project)!.security.users).toHaveLength(0);
  });
});
