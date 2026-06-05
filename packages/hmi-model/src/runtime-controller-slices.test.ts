import { describe, expect, it } from "vitest";
import { startHmiRuntimePreview } from "./runtime-controller";
import { createDefaultHmiProject, createHmiElement, createHmiScreen } from "./factory";
import type { HmiControllerReference, HmiProject } from "./types";

function clockFrom(start = 0, step = 1000): () => number {
  let t = start;
  return () => (t += step);
}

function slicesProject(): { project: HmiProject; lampId: string; multiId: string; textId: string; brokenId: string } {
  const project = createDefaultHmiProject("Slices Demo");
  project.controllerReferences = [
    {
      id: "ref1",
      name: "Line1",
      controllerName: "Line1",
      sourceKind: "manual",
      syncStatus: "synchronized",
      snapshot: { controllerTagCount: 2, programTagCount: 0, dataTypeCount: 0, alarmCount: 0 },
      tags: [
        { path: "Motor_Running", name: "Motor_Running", dataType: "BOOL", scope: "controller" },
        { path: "Tank_Level", name: "Tank_Level", dataType: "REAL", scope: "controller" },
      ],
      dataTypes: [],
      alarms: [],
    } as unknown as HmiControllerReference,
  ];

  const screen = createHmiScreen("Overview");

  const lamp = createHmiElement("common.indicator-lamp", "Run Lamp");
  lamp.bindings = [{ id: "bl", targetProperty: "value", source: { kind: "tag", path: "Motor_Running" }, mode: "read" }];

  const multi = createHmiElement("common.multistate-indicator", "Level State");
  multi.animations = [
    {
      id: "am",
      targetProperty: "text",
      source: { kind: "expression", path: "{Tank_Level} > 80" },
      table: { kind: "state", states: [{ value: true, state: "HIGH" }, { value: false, state: "OK" }] },
    },
  ];

  const text = createHmiElement("common.text-display", "Greeting");
  text.bindings = [{ id: "bt", targetProperty: "text", source: { kind: "system-tag", path: "Text.greeting" }, mode: "read" }];

  const broken = createHmiElement("common.numeric-display", "Broken");
  broken.bindings = [{ id: "bb", targetProperty: "value", source: { kind: "tag", path: "Ghost_Tag" }, mode: "read" }];

  screen.elements = [lamp, multi, text, broken];
  project.screens = [screen];
  project.homeScreenId = screen.id;

  project.defaultLanguage = "en-US";
  project.languagePacks = [
    { id: "len", languageId: "en-US", displayName: "English", strings: { greeting: "Hello" }, missingStringIds: [] },
    { id: "lde", languageId: "de-DE", displayName: "Deutsch", strings: { greeting: "Hallo" }, missingStringIds: [] },
  ];

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

  return { project, lampId: lamp.id, multiId: multi.id, textId: text.id, brokenId: broken.id };
}

describe("runtime controller — trend chart preview (slice 1)", () => {
  it("renders SVG sparkline geometry from sampled trend buffer", () => {
    const { project } = slicesProject();
    const controller = startHmiRuntimePreview(project, { clock: clockFrom() });
    controller.writeTag("Tank_Level", 30);
    controller.writeTag("Tank_Level", 70);
    const preview = controller.getTrendChartPreview("trend-level", { width: 240, height: 120 });
    expect(preview).toBeDefined();
    expect(preview!.width).toBe(240);
    expect(preview!.series).toHaveLength(1);
    expect(preview!.series[0]!.path).toMatch(/^M /); // an SVG move command begins the path
    expect(preview!.series[0]!.points.length).toBeGreaterThan(0);
    controller.dispose();
  });

  it("returns undefined for an unknown trend", () => {
    const { project } = slicesProject();
    const controller = startHmiRuntimePreview(project, { clock: clockFrom() });
    expect(controller.getTrendChartPreview("nope")).toBeUndefined();
    controller.dispose();
  });
});

describe("runtime controller — indicator elements (slice 2)", () => {
  it("resolves the indicator lamp lit state from a bound tag", () => {
    const { project, lampId } = slicesProject();
    const controller = startHmiRuntimePreview(project, { clock: clockFrom() });
    expect(controller.resolveScreen().find((s) => s.elementId === lampId)?.runtimeProps.value).toBe(false);
    controller.toggleTag("Motor_Running");
    expect(controller.resolveScreen().find((s) => s.elementId === lampId)?.runtimeProps.value).toBe(true);
    controller.dispose();
  });

  it("resolves the multi-state indicator caption from a state-map animation", () => {
    const { project, multiId } = slicesProject();
    const controller = startHmiRuntimePreview(project, { clock: clockFrom() });
    expect(controller.resolveScreen().find((s) => s.elementId === multiId)?.runtimeProps.text).toBe("OK");
    controller.writeTag("Tank_Level", 95);
    expect(controller.resolveScreen().find((s) => s.elementId === multiId)?.runtimeProps.text).toBe("HIGH");
    controller.dispose();
  });
});

describe("runtime controller — localization (slice 3)", () => {
  it("resolves a localized-text binding and updates live on setLanguage", () => {
    const { project, textId } = slicesProject();
    const controller = startHmiRuntimePreview(project, { clock: clockFrom() });
    const text = () => controller.resolveScreen().find((s) => s.elementId === textId)?.runtimeProps.text;
    expect(text()).toBe("Hello");
    expect(controller.getLanguages().map((l) => l.languageId)).toEqual(["en-US", "de-DE"]);

    const result = controller.setLanguage("de-DE");
    expect(result.ok).toBe(true);
    expect(controller.getCurrentLanguage()).toBe("de-DE");
    expect(text()).toBe("Hallo");
    controller.dispose();
  });
});

describe("runtime controller — combined diagnostics (slice 4)", () => {
  it("surfaces a broken-binding diagnostic alongside a live alarm and trend sample", () => {
    const { project, brokenId } = slicesProject();
    const controller = startHmiRuntimePreview(project, { clock: clockFrom() });
    controller.writeTag("Tank_Level", 95); // trips the analog-high alarm + samples the trend

    const diagnostics = controller.getDiagnostics();
    const broken = diagnostics.find((d) => d.elementId === brokenId && d.code === "unknown-tag");
    expect(broken).toBeDefined();
    expect(broken!.severity).toBe("error");

    expect(controller.getAlarmRuntime().summary.activeCount).toBe(1);
    expect(controller.getTrendBuffer("trend-level")!.traces[0]!.points.length).toBeGreaterThan(0);
    controller.dispose();
  });
});
