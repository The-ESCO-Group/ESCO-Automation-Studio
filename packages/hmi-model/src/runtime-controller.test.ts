import { describe, expect, it } from "vitest";
import { HmiRuntimeController, startHmiRuntimePreview } from "./runtime-controller";
import { createDefaultHmiProject, createHmiElement, createHmiScreen } from "./factory";
import type { HmiControllerReference, HmiProject } from "./types";

function clockFrom(start = 0, step = 1000): () => number {
  let t = start;
  return () => (t += step);
}

function demoProject(): HmiProject {
  const project = createDefaultHmiProject("Runtime Demo");
  const reference = {
    id: "ref1",
    name: "Line1",
    controllerName: "Line1",
    sourceKind: "manual",
    syncStatus: "synchronized",
    snapshot: { controllerTagCount: 4, programTagCount: 0, dataTypeCount: 0, alarmCount: 0 },
    tags: [
      { path: "Motor_Start", name: "Motor_Start", dataType: "BOOL", scope: "controller" },
      { path: "Motor_Running", name: "Motor_Running", dataType: "BOOL", scope: "controller" },
      { path: "Tank_Level", name: "Tank_Level", dataType: "REAL", scope: "controller" },
      { path: "Tank_Setpoint", name: "Tank_Setpoint", dataType: "REAL", scope: "controller" },
    ],
    dataTypes: [],
    alarms: [],
  } as unknown as HmiControllerReference;
  project.controllerReferences = [reference];

  const screen = createHmiScreen("Overview");
  const level = createHmiElement("common.numeric-display", "Level");
  level.bindings = [{ id: "b-level", targetProperty: "value", source: { kind: "tag", path: "Tank_Level" }, mode: "read" }];
  const lamp = createHmiElement("common.text-display", "RunState");
  lamp.bindings = [
    { id: "b-run", targetProperty: "text", source: { kind: "expression", path: 'if({Motor_Running}, "RUNNING", "STOPPED")' }, mode: "read" },
  ];
  const startBtn = createHmiElement("common.button", "Start");
  const dataLogStatus = createHmiElement("common.text-display", "DataLogStatus");
  dataLogStatus.bindings = [
    { id: "b-datalog-status", targetProperty: "text", source: { kind: "system-tag", path: "System.DataLogStatus" }, mode: "read" },
  ];
  screen.elements = [level, lamp, startBtn, dataLogStatus];
  project.screens = [screen];
  project.homeScreenId = screen.id;

  const detail = createHmiScreen("Detail");
  project.screens.push(detail);

  project.alarms = [
    {
      id: "alm-high",
      name: "Tank High",
      tagPath: "Tank_Level",
      severity: "major",
      trigger: { kind: "analog-high", threshold: 80 },
      allowAcknowledge: true,
      enabled: true,
    },
  ];
  project.trends = [
    {
      id: "trend-level",
      name: "Level Trend",
      timeRangeSeconds: 300,
      sampleRateMs: 0,
      traces: [{ id: "t1", label: "Level", source: { kind: "tag", path: "Tank_Level" }, color: "#2563eb" }],
    },
  ];
  project.dataLogs = [
    {
      id: "log-process",
      name: "Process Log",
      sampleRateMs: 1000,
      retentionHours: 1,
      tagPaths: ["Tank_Level", "Motor_Running", "Missing_Tag"],
    },
  ];
  project.recipes = [
    {
      id: "recipe-startup",
      name: "Startup",
      securityRoleIds: [],
      items: [
        { id: "speed", tagPath: "Tank_Setpoint", value: 82, dataType: "REAL" },
        { id: "run", tagPath: "Motor_Running", value: true, dataType: "BOOL" },
      ],
    },
    {
      id: "recipe-bad",
      name: "Bad Recipe",
      securityRoleIds: [],
      items: [
        { id: "good-first", tagPath: "Tank_Setpoint", value: 91, dataType: "REAL" },
        { id: "missing", tagPath: "Missing_Setpoint", value: 5, dataType: "DINT" },
      ],
    },
    {
      id: "recipe-engineer",
      name: "Engineer Recipe",
      securityRoleIds: ["role_engineer"],
      items: [{ id: "sp", tagPath: "Tank_Setpoint", value: 12, dataType: "REAL" }],
    },
  ];
  return {
    project,
    screenId: screen.id,
    detailId: detail.id,
    levelId: level.id,
    lampId: lamp.id,
    dataLogStatusId: dataLogStatus.id,
  } as unknown as HmiProject & Record<string, string>;
}

function setup() {
  const built = demoProject() as unknown as {
    project: HmiProject;
    screenId: string;
    detailId: string;
    levelId: string;
    lampId: string;
    dataLogStatusId: string;
  };
  const controller = startHmiRuntimePreview(built.project, { clock: clockFrom() });
  return { ...built, controller };
}

describe("HmiRuntimeController", () => {
  it("starts and resolves the active screen's objects from live values", () => {
    const { controller, levelId, lampId } = setup();
    const states = controller.resolveScreen();
    const level = states.find((s) => s.elementId === levelId);
    const lamp = states.find((s) => s.elementId === lampId);
    expect(level?.runtimeProps.value).toBe(0); // REAL default
    expect(lamp?.runtimeProps.text).toBe("STOPPED");
    controller.dispose();
  });

  it("write/setTag updates a bound object", () => {
    const { controller, levelId } = setup();
    controller.writeTag("Tank_Level", 55);
    expect(controller.resolveScreen().find((s) => s.elementId === levelId)?.runtimeProps.value).toBe(55);
    controller.dispose();
  });

  it("toggleTag flips a boolean and updates an expression binding", () => {
    const { controller, lampId } = setup();
    controller.toggleTag("Motor_Running");
    expect(controller.resolveScreen().find((s) => s.elementId === lampId)?.runtimeProps.text).toBe("RUNNING");
    controller.toggleTag("Motor_Running");
    expect(controller.resolveScreen().find((s) => s.elementId === lampId)?.runtimeProps.text).toBe("STOPPED");
    controller.dispose();
  });

  it("momentary writes pressed then released values", () => {
    const { controller } = setup();
    controller.momentary("Motor_Start", "press");
    expect(controller.provider.read("Motor_Start").value).toBe(true);
    controller.momentary("Motor_Start", "release");
    expect(controller.provider.read("Motor_Start").value).toBe(false);
    controller.dispose();
  });

  it("increment/decrement clamp to bounds", () => {
    const { controller } = setup();
    controller.writeTag("Tank_Setpoint", 98);
    controller.incrementTag("Tank_Setpoint", 5, 100);
    expect(controller.provider.read("Tank_Setpoint").value).toBe(100);
    controller.decrementTag("Tank_Setpoint", 200, 0);
    expect(controller.provider.read("Tank_Setpoint").value).toBe(0);
    controller.dispose();
  });

  it("navigation updates the active screen and System.CurrentScreen", () => {
    const { controller, detailId } = setup();
    const result = controller.navigateToScreen(detailId);
    expect(result.ok).toBe(true);
    expect(controller.getSession().currentScreenId).toBe(detailId);
    expect(controller.getSession().systemTags["System.CurrentScreen"]).toBe("Detail");
    controller.dispose();
  });

  it("activates an alarm from a high tag value and acknowledges it", () => {
    const { controller } = setup();
    controller.writeTag("Tank_Level", 95);
    let alarm = controller.getAlarmRuntime().alarms.find((a) => a.alarmId === "alm-high");
    expect(alarm?.active).toBe(true);
    expect(alarm?.acknowledged).toBe(false);
    expect(controller.getAlarmRuntime().summary.activeCount).toBe(1);

    controller.acknowledgeAllVisible();
    alarm = controller.getAlarmRuntime().alarms.find((a) => a.alarmId === "alm-high");
    expect(alarm?.acknowledged).toBe(true);
    controller.dispose();
  });

  it("resets returned alarms and exposes manager/history table rows", () => {
    const { controller } = setup();
    controller.writeTag("Tank_Level", 95);
    controller.writeTag("Tank_Level", 30);

    expect(controller.getAlarmTableRows("manager").find((row) => row.alarmId === "alm-high")).toMatchObject({
      state: "returned-unacknowledged",
      acknowledged: false,
    });
    expect(controller.getAlarmTableRows("history").some((row) => row.eventType === "returned")).toBe(true);

    controller.resetAllVisible();
    const alarm = controller.getAlarmRuntime().alarms.find((row) => row.alarmId === "alm-high");
    expect(alarm).toMatchObject({ state: "normal", acknowledged: true, active: false });
    expect(controller.getAlarmRuntime().summary.unacknowledgedCount).toBe(0);
    expect(controller.getAlarmTableRows("history")[0]).toMatchObject({ alarmId: "alm-high", eventType: "reset" });
    controller.dispose();
  });

  it("collects trend samples from the live provider", () => {
    const { controller } = setup();
    controller.writeTag("Tank_Level", 30);
    controller.writeTag("Tank_Level", 60);
    const buffer = controller.getTrendBuffer("trend-level");
    expect(buffer).toBeDefined();
    const points = buffer!.traces[0]!.points;
    expect(points.length).toBeGreaterThan(0);
    expect(points.at(-1)?.value).toBe(60);
    controller.dispose();
  });

  it("records, exports, and clears data-log samples from the live provider", () => {
    const { controller, dataLogStatusId } = setup();

    controller.writeTag("Tank_Level", 30);
    controller.writeTag("Motor_Running", true);

    const buffer = controller.getDataLogBuffer("log-process");
    expect(buffer).toBeDefined();
    expect(buffer?.status).toBe("recording");
    expect(buffer?.rows.length).toBeGreaterThan(0);
    expect(buffer?.rows.at(-1)?.values.Tank_Level).toMatchObject({ value: 30, quality: "good" });
    expect(buffer?.rows.at(-1)?.values.Motor_Running).toMatchObject({ value: true, quality: "good" });
    expect(buffer?.rows.at(-1)?.values.Missing_Tag).toMatchObject({ value: null, quality: "missing" });

    const statusText = controller.resolveScreen().find((s) => s.elementId === dataLogStatusId)?.runtimeProps.text;
    expect(String(statusText)).toMatch(/Process Log/);

    const exported = controller.exportDataLogCsv("log-process");
    expect(exported?.fileName).toBe("Process-Log.hmi-data-log.csv");
    expect(exported?.rowCount).toBe(buffer?.rows.length);
    expect(exported?.text).toContain("Tank_Level,Tank_Level__quality");
    expect(exported?.text).toContain("Missing_Tag,Missing_Tag__quality");

    const cleared = controller.clearDataLog("log-process");
    expect(cleared.ok).toBe(true);
    expect(controller.getDataLogBuffer("log-process")?.rows).toHaveLength(0);
    expect(controller.exportDataLogCsv("missing-log")).toBeUndefined();
    controller.dispose();
  });

  it("applies HMI recipes through the offline runtime tag provider", () => {
    const { controller } = setup();

    const applied = controller.applyRecipe("recipe-startup");
    expect(applied.ok).toBe(true);
    expect(controller.provider.read("Tank_Setpoint").value).toBe(82);
    expect(controller.provider.read("Motor_Running").value).toBe(true);
    expect(controller.getRecipeApplyHistory().at(-1)).toMatchObject({
      recipeName: "Startup",
      appliedCount: 2,
      failedCount: 0,
    });

    const failed = controller.applyRecipe("recipe-bad");
    expect(failed.ok).toBe(false);
    expect(controller.provider.read("Tank_Setpoint").value).toBe(82);
    expect(controller.getRecipeApplyHistory().at(-1)).toMatchObject({
      recipeName: "Bad Recipe",
      appliedCount: 0,
      failedCount: 2,
    });
    expect(controller.getRecipeApplyHistory().at(-1)?.rows.map((row) => row.status)).toEqual(["skipped", "failed"]);
    expect(controller.getDiagnostics().some((diagnostic) => diagnostic.targetProperty === "Missing_Setpoint")).toBe(true);
    controller.dispose();
  });

  it("blocks secured recipes until the preview session has a matching role", () => {
    const { controller } = setup();

    const blocked = controller.applyRecipe("recipe-engineer");
    expect(blocked.ok).toBe(false);
    expect(controller.provider.read("Tank_Setpoint").value).toBe(0);
    expect(controller.getRecipeApplyHistory().at(-1)).toMatchObject({
      recipeName: "Engineer Recipe",
      appliedCount: 0,
      failedCount: 1,
    });
    expect(controller.getDiagnostics().some((diagnostic) => diagnostic.targetProperty === "recipe:recipe-engineer")).toBe(true);

    controller.setRoles(["role_engineer"]);
    const applied = controller.applyRecipe("recipe-engineer");
    expect(applied.ok).toBe(true);
    expect(controller.provider.read("Tank_Setpoint").value).toBe(12);
    controller.dispose();
  });

  it("records a diagnostic when an action targets an unknown/read-only tag", () => {
    const { controller } = setup();
    const result = controller.writeTag("Not_A_Tag", 1);
    expect(result.ok).toBe(false);
    expect(controller.getDiagnostics().some((d) => d.targetProperty === "Not_A_Tag")).toBe(true);
    controller.dispose();
  });

  it("promotes runtime diagnostics into active and history rows", () => {
    const { controller } = setup();
    const result = controller.writeTag("Not_A_Tag", 1);
    expect(result.ok).toBe(false);

    const runtime = controller.getDiagnosticsRuntime();
    const liveRows = controller.getDiagnosticsTableRows("live");
    const historyRows = controller.getDiagnosticsTableRows("history");

    expect(runtime.summary.activeErrorCount).toBe(1);
    expect(liveRows).toHaveLength(1);
    expect(liveRows[0]).toMatchObject({
      source: "runtime",
      severity: "error",
      code: "unsupported",
      target: "hmi/runtime:Not_A_Tag",
    });
    expect(historyRows[0]?.message).toContain("Not_A_Tag");

    controller.clearDiagnostics("runtime");
    expect(controller.getDiagnosticsTableRows("live")).toHaveLength(0);
    expect(controller.getDiagnosticsTableRows("history")[0]).toMatchObject({
      status: "cleared",
      source: "runtime",
      code: "unsupported",
    });
    controller.dispose();
  });

  it("dispose stops the provider and binding engine subscriptions", () => {
    const { controller, levelId } = setup();
    controller.dispose();
    expect(controller.isDisposed).toBe(true);
    // Resolve still returns the last elements but no live wiring remains.
    expect(controller.bindingEngine.isDisposed).toBe(true);
    expect(controller.resolveScreen().find((s) => s.elementId === levelId)).toBeUndefined();
  });

  it("throws if started after dispose", () => {
    const { project } = demoProject() as unknown as { project: HmiProject };
    const controller = new HmiRuntimeController(project, { clock: clockFrom() });
    controller.dispose();
    expect(() => controller.start()).toThrow();
  });
});
