import { describe, expect, it } from "vitest";
import { SimEngine } from "./engine";
import { createSimProject } from "./project";
import { TAG } from "./catalog";
import type { SimDevice } from "./types";

const NOW = () => "2026-01-01T00:00:00.000Z";

function pumpStation() {
  return createSimProject({ name: "Pump Test", processType: "pump-station", now: NOW });
}

function deviceOf(project: ReturnType<typeof pumpStation>, kind: SimDevice["kind"]): SimDevice {
  const device = project.devices.find((d) => d.kind === kind);
  if (!device) throw new Error(`No ${kind} in fixture`);
  return device;
}

describe("SimEngine offline scan engine", () => {
  it("generates virtual tags and seeds logic for the process type", () => {
    const project = pumpStation();
    expect(project.devices.length).toBeGreaterThan(0);
    expect(project.logicBlocks.length).toBeGreaterThan(0);
    const engine = new SimEngine(project);
    expect(engine.liveTags().length).toBeGreaterThan(0);
    expect(engine.scan).toBe(0);
  });

  it("starts a motor through its holding circuit and seals in", () => {
    const project = pumpStation();
    const motor = deviceOf(project, "motor");
    const engine = new SimEngine(project);
    engine.setTag(`${motor.tag}_${TAG.startPb}`, true);
    engine.run(3);
    expect(engine.readTag(`${motor.tag}_${TAG.runCmd}`)).toBe(true);
    // release start, motor seals in
    engine.setTag(`${motor.tag}_${TAG.startPb}`, false);
    engine.run(5);
    expect(engine.readTag(`${motor.tag}_${TAG.runCmd}`)).toBe(true);
    expect(engine.readTag(`${motor.tag}_${TAG.run}`)).toBe(true);
  });

  it("trips a running motor when an overload is injected (virtual fault)", () => {
    const project = pumpStation();
    const motor = deviceOf(project, "motor");
    const engine = new SimEngine(project);
    engine.setTag(`${motor.tag}_${TAG.startPb}`, true);
    engine.run(3);
    engine.setTag(`${motor.tag}_${TAG.startPb}`, false);
    engine.run(3);
    expect(engine.readTag(`${motor.tag}_${TAG.runCmd}`)).toBe(true);

    const result = engine.injectFault(motor.id, "overload");
    expect(result.ok).toBe(true);
    engine.run(3);
    expect(engine.readTag(`${motor.tag}_${TAG.runCmd}`)).toBe(false);
    const overloadAlarm = engine.alarms().find((a) => a.name === `${motor.tag}_Overload`);
    expect(overloadAlarm?.active).toBe(true);
  });

  it("rejects unsupported faults", () => {
    const project = pumpStation();
    const level = deviceOf(project, "level-transmitter");
    const engine = new SimEngine(project);
    expect(engine.injectFault(level.id, "overload").ok).toBe(false);
  });

  it("records a timeline with scan/tag/alarm/data-log activity", () => {
    const project = pumpStation();
    const engine = new SimEngine(project);
    const frames = engine.run(5);
    expect(frames).toHaveLength(5);
    expect(frames[0]!.scan).toBe(1);
    expect(frames[4]!.timeMs).toBe(5 * project.controller.scanRateMs);
    expect(Object.keys(frames[0]!.dataLog).length).toBeGreaterThan(0);
  });

  it("samples a historian for analog tags", () => {
    const project = pumpStation();
    const motor = deviceOf(project, "motor");
    const engine = new SimEngine(project);
    engine.setTag(`${motor.tag}_${TAG.startPb}`, true);
    engine.run(20);
    const current = engine.historian().find((s) => s.tag === `${motor.tag}_${TAG.current}`);
    expect(current).toBeDefined();
    expect(current!.points.length).toBe(20);
    // current ramps up while running
    expect(current!.points.at(-1)!.value!).toBeGreaterThan(current!.points[0]!.value!);
  });

  it("is deterministic: identical runs produce identical evidence", () => {
    const project = pumpStation();
    const run = () => {
      const engine = new SimEngine(project);
      const motor = deviceOf(project, "motor");
      engine.setTag(`${motor.tag}_${TAG.startPb}`, true);
      engine.run(10);
      return JSON.stringify(engine.liveTags());
    };
    expect(run()).toBe(run());
  });

  it("reset returns to power-up state", () => {
    const project = pumpStation();
    const motor = deviceOf(project, "motor");
    const engine = new SimEngine(project);
    engine.setTag(`${motor.tag}_${TAG.startPb}`, true);
    engine.run(10);
    engine.reset();
    expect(engine.scan).toBe(0);
    expect(engine.readTag(`${motor.tag}_${TAG.runCmd}`)).toBe(false);
  });
});
