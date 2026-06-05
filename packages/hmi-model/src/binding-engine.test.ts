import { describe, expect, it, vi } from "vitest";
import { HmiBindingEngine, resolveHmiElement } from "./binding-engine";
import { SimulatorTagProvider } from "./runtime-tag-provider";
import type { HmiGraphicElement } from "./types";

function element(overrides: Partial<HmiGraphicElement>): HmiGraphicElement {
  return {
    id: "el1",
    typeId: "common.text-display",
    name: "El",
    geometry: { x: 0, y: 0, width: 10, height: 10 },
    zIndex: 0,
    properties: {},
    bindings: [],
    events: [],
    animations: [],
    ...overrides,
  };
}

function provider() {
  return new SimulatorTagProvider({
    seeds: [
      { path: "Tank_Level", dataType: "REAL", value: 42 },
      { path: "Tank_Setpoint", dataType: "REAL", value: 75 },
      { path: "Motor_Running", dataType: "BOOL", value: false },
    ],
    clock: () => 1000,
  });
}

const lookupFor = (p: SimulatorTagProvider) =>
  (path: string) => (p.getMetadata(path) ? { value: p.read(path).value, quality: p.read(path).quality } : undefined);

describe("resolveHmiElement", () => {
  it("resolves a tag binding to a runtime property", () => {
    const p = provider();
    const el = element({
      typeId: "common.numeric-display",
      bindings: [{ id: "b1", targetProperty: "value", source: { kind: "tag", path: "Tank_Level" }, mode: "read" }],
    });
    const state = resolveHmiElement(el, { lookup: lookupFor(p), nowMs: 1000 });
    expect(state.runtimeProps.value).toBe(42);
    expect(state.quality.value).toBe("good");
    expect(state.diagnostics).toHaveLength(0);
  });

  it("resolves an expression binding", () => {
    const p = provider();
    const el = element({
      bindings: [
        {
          id: "b1",
          targetProperty: "text",
          source: { kind: "expression", path: 'if({Motor_Running}, "RUN", "STOP")' },
          mode: "read",
        },
      ],
    });
    expect(resolveHmiElement(el, { lookup: lookupFor(p), nowMs: 1 }).runtimeProps.text).toBe("STOP");
    p.write({ path: "Motor_Running", value: true });
    expect(resolveHmiElement(el, { lookup: lookupFor(p), nowMs: 2 }).runtimeProps.text).toBe("RUN");
  });

  it("resolves a state-map animation (value -> state)", () => {
    const p = provider();
    const el = element({
      typeId: "common.button",
      animations: [
        {
          id: "a1",
          targetProperty: "state",
          source: { kind: "tag", path: "Motor_Running" },
          table: { kind: "state", states: [{ value: true, state: "on" }, { value: false, state: "off" }] },
        },
      ],
    });
    expect(resolveHmiElement(el, { lookup: lookupFor(p), nowMs: 1 }).runtimeProps.state).toBe("off");
    p.write({ path: "Motor_Running", value: true });
    expect(resolveHmiElement(el, { lookup: lookupFor(p), nowMs: 2 }).runtimeProps.state).toBe("on");
  });

  it("resolves a color-map animation (value -> fillColor)", () => {
    const p = provider();
    const el = element({
      animations: [
        {
          id: "a1",
          targetProperty: "fillColor",
          source: { kind: "expression", path: "{Tank_Level} > {Tank_Setpoint}" },
          table: { kind: "color", states: [{ value: true, color: "#ff0000" }, { value: false, color: "#00ff00" }] },
        },
      ],
    });
    expect(resolveHmiElement(el, { lookup: lookupFor(p), nowMs: 1 }).runtimeProps.fillColor).toBe("#00ff00");
    p.write({ path: "Tank_Level", value: 90 });
    expect(resolveHmiElement(el, { lookup: lookupFor(p), nowMs: 2 }).runtimeProps.fillColor).toBe("#ff0000");
  });

  it("creates a diagnostic for a missing tag", () => {
    const p = provider();
    const el = element({
      bindings: [{ id: "b1", targetProperty: "value", source: { kind: "tag", path: "DoesNotExist" }, mode: "read" }],
    });
    const state = resolveHmiElement(el, { lookup: lookupFor(p), nowMs: 1 });
    expect(state.diagnostics[0]).toMatchObject({ code: "unknown-tag", severity: "error", targetProperty: "value" });
    expect(state.quality.value).toBe("bad");
  });

  it("skips write-only bindings (no display value)", () => {
    const p = provider();
    const el = element({
      bindings: [{ id: "b1", targetProperty: "value", source: { kind: "tag", path: "Tank_Level" }, mode: "write" }],
    });
    expect(resolveHmiElement(el, { lookup: lookupFor(p), nowMs: 1 }).runtimeProps).toEqual({});
  });

  it("resolves a static property binding", () => {
    const p = provider();
    const el = element({
      properties: { label: "Pump 1" },
      bindings: [{ id: "b1", targetProperty: "text", source: { kind: "property", path: "label" }, mode: "read" }],
    });
    expect(resolveHmiElement(el, { lookup: lookupFor(p), nowMs: 1 }).runtimeProps.text).toBe("Pump 1");
  });
});

describe("HmiBindingEngine (live)", () => {
  it("notifies listeners when a referenced tag changes", () => {
    const p = provider();
    const engine = new HmiBindingEngine(p, { clock: () => 5 });
    const el = element({
      typeId: "common.numeric-display",
      bindings: [{ id: "b1", targetProperty: "value", source: { kind: "tag", path: "Tank_Level" }, mode: "read" }],
    });
    engine.setElements([el]);
    const listener = vi.fn();
    engine.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.lastCall?.[0][0].runtimeProps.value).toBe(42);

    p.setValue("Tank_Level", 88);
    expect(listener.mock.lastCall?.[0][0].runtimeProps.value).toBe(88);
    engine.dispose();
  });

  it("merges system tags into the lookup", () => {
    const p = provider();
    const engine = new HmiBindingEngine(p, { systemTags: { "System.CurrentScreen": "Home" }, clock: () => 1 });
    const el = element({
      bindings: [{ id: "b1", targetProperty: "text", source: { kind: "system-tag", path: "System.CurrentScreen" }, mode: "read" }],
    });
    engine.setElements([el]);
    expect(engine.resolve("el1")?.runtimeProps.text).toBe("Home");
    engine.dispose();
  });

  it("dispose removes subscriptions so further changes do not notify", () => {
    const p = provider();
    const engine = new HmiBindingEngine(p, { clock: () => 1 });
    engine.setElements([
      element({ bindings: [{ id: "b1", targetProperty: "value", source: { kind: "tag", path: "Tank_Level" }, mode: "read" }] }),
    ]);
    const listener = vi.fn();
    engine.subscribe(listener);
    listener.mockClear();
    engine.dispose();
    p.setValue("Tank_Level", 1);
    expect(listener).not.toHaveBeenCalled();
    expect(engine.isDisposed).toBe(true);
  });

  it("exposes aggregate diagnostics across elements", () => {
    const p = provider();
    const engine = new HmiBindingEngine(p, { clock: () => 1 });
    engine.setElements([
      element({ id: "bad", bindings: [{ id: "b", targetProperty: "value", source: { kind: "tag", path: "Ghost" }, mode: "read" }] }),
    ]);
    expect(engine.diagnostics().some((d) => d.code === "unknown-tag")).toBe(true);
    engine.dispose();
  });
});
