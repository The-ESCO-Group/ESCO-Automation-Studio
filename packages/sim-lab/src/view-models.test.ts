import { describe, expect, it } from "vitest";
import { createSimProject } from "./project";
import { SimEngine } from "./engine";
import { TAG } from "./catalog";
import { addScenarioFromTemplate, runScenario } from "./scenarios";
import { generateSimReport } from "./report";
import {
  alarmConsoleModel,
  deviceDetailModel,
  deviceVisualState,
  fieldCheckoutModel,
  historianModel,
  ioCabinetModel,
  logicDebugModel,
  pidViewModel,
  processOverviewModel,
  buildTagMap,
  type SimViewSource,
} from "./view-models";
import type { SimDevice, SimProject } from "./types";

const NOW = () => "2026-01-01T00:00:00.000Z";

function skid(): SimProject {
  return createSimProject({ name: "VM Test", processType: "skid", now: NOW });
}
function deviceOf(p: SimProject, kind: SimDevice["kind"]): SimDevice {
  return p.devices.find((d) => d.kind === kind)!;
}
function source(project: SimProject, engine: SimEngine): SimViewSource {
  return {
    project,
    liveTags: engine.liveTags(),
    alarms: engine.alarms(),
    timeline: engine.timeline(),
    events: engine.events(),
    historian: engine.historian(),
    scan: engine.scan,
    timeMs: engine.timeMs,
  };
}

describe("device → visual state mapping", () => {
  it("maps motor running/stopped/tripped", () => {
    const p = skid();
    const motor = deviceOf(p, "motor");
    const engine = new SimEngine(p);
    let tags = buildTagMap(engine.liveTags());
    expect(deviceVisualState(motor, tags).state).toBe("stopped");

    engine.setTag(`${motor.tag}_${TAG.startPb}`, true);
    engine.run(4);
    tags = buildTagMap(engine.liveTags());
    let vis = deviceVisualState(motor, tags);
    expect(vis.state).toBe("running");
    expect(vis.tone).toBe("good");
    expect(vis.running).toBe(true);

    engine.injectFault(motor.id, "overload");
    engine.run(3);
    vis = deviceVisualState(motor, buildTagMap(engine.liveTags()));
    expect(vis.state).toBe("tripped");
    expect(vis.tone).toBe("fault");
    expect(vis.faulted).toBe(true);
  });

  it("maps valve closed → traveling, and sensor comm-fail", () => {
    const p = skid();
    const valve = deviceOf(p, "valve");
    const flow = deviceOf(p, "flow-meter");
    const engine = new SimEngine(p);
    expect(deviceVisualState(valve, buildTagMap(engine.liveTags())).state).toBe("closed");
    engine.setTag(`${valve.tag}_${TAG.openCmd}`, true);
    engine.run(3);
    expect(deviceVisualState(valve, buildTagMap(engine.liveTags())).state).toBe("traveling");

    engine.injectFault(flow.id, "comm-loss");
    engine.run(2);
    expect(deviceVisualState(flow, buildTagMap(engine.liveTags())).state).toBe("comm-fail");
  });

  it("maps safety input healthy → tripped", () => {
    const p = skid();
    const safety = deviceOf(p, "safety-input");
    const engine = new SimEngine(p);
    expect(deviceVisualState(safety, buildTagMap(engine.liveTags())).state).toBe("healthy");
    engine.injectFault(safety.id, "estop");
    engine.run(2);
    expect(deviceVisualState(safety, buildTagMap(engine.liveTags())).state).toBe("tripped");
  });
});

describe("screen view-models are engine-driven", () => {
  it("process overview reflects running/faulted counts", () => {
    const p = skid();
    const motor = deviceOf(p, "motor");
    const engine = new SimEngine(p);
    engine.setTag(`${motor.tag}_${TAG.startPb}`, true);
    engine.run(5);
    const vm = processOverviewModel(source(p, engine));
    expect(vm.equipment.length).toBe(p.devices.length);
    expect(vm.metrics.running).toBeGreaterThanOrEqual(1);
  });

  it("I/O cabinet reflects virtual tags as channels with LEDs", () => {
    const p = skid();
    const motor = deviceOf(p, "motor");
    const engine = new SimEngine(p);
    engine.setTag(`${motor.tag}_${TAG.startPb}`, true);
    engine.run(4);
    const vm = ioCabinetModel(source(p, engine));
    expect(vm.offlineNotice).toMatch(/offline/i);
    expect(vm.controller.name).toBe(p.controller.name);
    const dop = vm.modules.find((m) => m.kind === "DO");
    expect(dop).toBeDefined();
    // RunCmd output is active once the motor seals in.
    const runCmd = dop!.channels.find((c) => c.tag === `${motor.tag}_${TAG.runCmd}`);
    expect(runCmd?.active).toBe(true);
    const ai = vm.modules.find((m) => m.kind === "AI");
    expect(ai && ai.channels.length).toBeGreaterThan(0);
  });

  it("device detail exposes start count, runtime, faults, and VFD data", () => {
    const p = skid();
    const motor = deviceOf(p, "motor");
    const vfd = deviceOf(p, "vfd");
    const engine = new SimEngine(p);
    engine.setTag(`${motor.tag}_${TAG.startPb}`, true);
    engine.run(6);
    engine.setTag(`${vfd.tag}_${TAG.runCmd}`, true);
    engine.setTag(`${vfd.tag}_${TAG.speedCmd}`, 60);
    engine.run(20);
    engine.injectFault(motor.id, "overload");
    engine.run(3);

    const md = deviceDetailModel(source(p, engine), motor.id)!;
    expect(md.startCount).toBeGreaterThanOrEqual(1);
    expect(md.runtimeHours).toBeGreaterThan(0);
    expect(md.faults.find((f) => f.id === "overload")?.active).toBe(true);
    expect(md.lastFault).toMatch(/overload/i);
    expect(md.relatedTags.length).toBeGreaterThan(0);

    const vd = deviceDetailModel(source(p, engine), vfd.id)!;
    expect(vd.vfd).toBeDefined();
    expect(vd.vfd!.speedFeedback).toBeGreaterThan(0);
    expect(["Accelerating", "At speed", "Decelerating", "Stopped"]).toContain(vd.vfd!.accelDecel);
  });

  it("logic debug reflects energized coils after a start", () => {
    const p = skid();
    const motor = deviceOf(p, "motor");
    const engine = new SimEngine(p);
    engine.setTag(`${motor.tag}_${TAG.startPb}`, true);
    engine.run(4);
    const blocks = logicDebugModel(source(p, engine));
    const holding = blocks.find((b) => b.templateKind === "motor-holding-interlocks");
    expect(holding).toBeDefined();
    const coilEnergized = holding!.rungs.some((r) => r.energized && r.nodes.some((n) => n.role === "coil" && n.active));
    expect(coilEnergized).toBe(true);
  });

  it("alarm console categorizes alarms and areas", () => {
    const p = skid();
    const motor = deviceOf(p, "motor");
    const engine = new SimEngine(p);
    engine.setTag(`${motor.tag}_${TAG.startPb}`, true);
    engine.run(4);
    engine.injectFault(motor.id, "overload");
    engine.run(3);
    const vm = alarmConsoleModel(source(p, engine));
    expect(vm.counts.active).toBeGreaterThanOrEqual(1);
    expect(vm.active.some((a) => a.name.includes("Overload"))).toBe(true);
    expect(vm.areas.length).toBeGreaterThan(0);
    expect(vm.events.length).toBeGreaterThan(0);
  });

  it("historian produces series and markers from timeline + events", () => {
    const p = skid();
    const motor = deviceOf(p, "motor");
    const engine = new SimEngine(p);
    engine.setTag(`${motor.tag}_${TAG.startPb}`, true);
    engine.run(10);
    engine.injectFault(motor.id, "overload");
    engine.run(4);
    const vm = historianModel(source(p, engine));
    expect(vm.series.length).toBeGreaterThan(0);
    expect(vm.series.every((s) => s.points.length > 0)).toBe(true);
    expect(vm.markers.some((m) => m.kind === "fault")).toBe(true);
  });

  it("field checkout builds 4/12/20 mA loop points for an analog instrument", () => {
    const p = skid();
    const flow = deviceOf(p, "flow-meter");
    const engine = new SimEngine(p);
    const vm = fieldCheckoutModel(source(p, engine), flow.id)!;
    expect(vm.analog).toBe(true);
    expect(vm.loopPoints.map((x) => x.label)).toEqual(["4 mA", "12 mA", "20 mA"]);
    expect(vm.loopPoints[2]!.eu).toBeGreaterThan(vm.loopPoints[0]!.eu);
  });

  it("P&ID symbols carry setpoints and select-able devices", () => {
    const p = skid();
    const engine = new SimEngine(p);
    const vm = pidViewModel(source(p, engine));
    expect(vm.symbols.length).toBe(p.devices.length);
    expect(vm.symbols.some((s) => s.instrument)).toBe(true);
  });
});

describe("report enrichment from scenario evidence", () => {
  it("includes I/O channels exercised and trends captured", () => {
    let p = skid();
    const added = addScenarioFromTemplate(p, "trip-overload", NOW);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    p = added.project;
    const result = runScenario(p, added.data!);
    const report = generateSimReport(p, [result], { now: NOW });
    expect(report.ioChannelsTested.total).toBeGreaterThan(0);
    expect(report.ioChannelsTested.exercised).toBeGreaterThan(0);
    expect(report.trendsCaptured.length).toBeGreaterThan(0);
  });
});
