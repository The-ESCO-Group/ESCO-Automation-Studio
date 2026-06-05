import { describe, expect, it, vi } from "vitest";
import {
  DEMO_TAG_SEEDS,
  SimulatorTagProvider,
  coerceTagValue,
} from "./runtime-tag-provider";
import type { HmiControllerReference } from "./types";

function clockFrom(start = 1000): () => number {
  let t = start;
  return () => (t += 10);
}

describe("coerceTagValue", () => {
  it("coerces by Logix data type", () => {
    expect(coerceTagValue("BOOL", 1)).toBe(true);
    expect(coerceTagValue("BOOL", "false")).toBe(false);
    expect(coerceTagValue("DINT", "42")).toBe(42);
    expect(coerceTagValue("REAL", "abc")).toBeNull();
    expect(coerceTagValue("STRING", 5)).toBe("5");
  });
});

describe("SimulatorTagProvider", () => {
  it("falls back to demo tags when nothing seeds it", () => {
    const provider = new SimulatorTagProvider({ clock: clockFrom() });
    expect(provider.listTags()).toEqual(DEMO_TAG_SEEDS.map((seed) => seed.path));
    expect(provider.read("Tank_Level").value).toBe(42);
  });

  it("seeds from controller references and respects read-only access", () => {
    const reference = {
      id: "ref1",
      tags: [
        { path: "Motor_Run", name: "Motor_Run", dataType: "BOOL", scope: "controller", externalAccess: "Read/Write" },
        { path: "Line_Speed", name: "Line_Speed", dataType: "REAL", scope: "controller", externalAccess: "Read Only" },
      ],
    } as unknown as HmiControllerReference;
    const provider = new SimulatorTagProvider({ controllerReferences: [reference], clock: clockFrom() });
    expect(provider.listTags()).toEqual(["Motor_Run", "Line_Speed"]);
    expect(provider.getMetadata("Motor_Run")?.writable).toBe(true);
    expect(provider.getMetadata("Line_Speed")?.writable).toBe(false);
  });

  it("reads values with quality and timestamps", () => {
    const provider = new SimulatorTagProvider({
      seeds: [{ path: "A", dataType: "DINT", value: 7 }],
      clock: clockFrom(500),
    });
    const sample = provider.read("A");
    expect(sample).toMatchObject({ path: "A", value: 7, quality: "good" });
    expect(sample.timestampMs).toBeGreaterThan(0);
  });

  it("returns bad quality for unknown tags", () => {
    const provider = new SimulatorTagProvider({ seeds: [{ path: "A", dataType: "DINT" }], clock: clockFrom() });
    expect(provider.read("Nope")).toMatchObject({ value: null, quality: "bad" });
  });

  it("writes typed values and reports success", () => {
    const provider = new SimulatorTagProvider({ seeds: [{ path: "Speed", dataType: "DINT", value: 0 }], clock: clockFrom() });
    const result = provider.write({ path: "Speed", value: "55", reason: "input:commit", sourceObjectId: "el1" });
    expect(result).toMatchObject({ ok: true, value: 55, quality: "good" });
    expect(provider.read("Speed").value).toBe(55);
  });

  it("rejects writes to unknown and read-only tags", () => {
    const provider = new SimulatorTagProvider({
      seeds: [{ path: "RO", dataType: "DINT", writable: false, value: 3 }],
      clock: clockFrom(),
    });
    expect(provider.write({ path: "Ghost", value: 1 }).ok).toBe(false);
    const ro = provider.write({ path: "RO", value: 9 });
    expect(ro.ok).toBe(false);
    expect(provider.read("RO").value).toBe(3);
  });

  it("notifies subscribers on write and on subscribe, and stops after unsubscribe", () => {
    const provider = new SimulatorTagProvider({ seeds: [{ path: "X", dataType: "BOOL", value: false }], clock: clockFrom() });
    const cb = vi.fn();
    const unsubscribe = provider.subscribe("X", cb);
    // Immediate current-value delivery.
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ path: "X", value: false }));

    provider.write({ path: "X", value: true });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ value: true, quality: "good" }));

    unsubscribe();
    provider.write({ path: "X", value: false });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("setValue drives simulator updates and notifies subscribers (tick/inspector path)", () => {
    const provider = new SimulatorTagProvider({ seeds: [{ path: "Level", dataType: "REAL", value: 10 }], clock: clockFrom() });
    const cb = vi.fn();
    provider.subscribe("Level", cb);
    provider.setValue("Level", 88);
    expect(provider.read("Level").value).toBe(88);
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ value: 88 }));
  });

  it("can mark a tag bad quality via setValue", () => {
    const provider = new SimulatorTagProvider({ seeds: [{ path: "Q", dataType: "REAL", value: 1 }], clock: clockFrom() });
    provider.setValue("Q", 1, "uncertain");
    expect(provider.read("Q").quality).toBe("uncertain");
  });

  it("reset restores seeded initial values", () => {
    const provider = new SimulatorTagProvider({ seeds: [{ path: "S", dataType: "DINT", value: 5 }], clock: clockFrom() });
    provider.write({ path: "S", value: 99 });
    expect(provider.read("S").value).toBe(99);
    provider.reset();
    expect(provider.read("S").value).toBe(5);
  });

  it("dispose clears subscribers", () => {
    const provider = new SimulatorTagProvider({ seeds: [{ path: "S", dataType: "DINT", value: 5 }], clock: clockFrom() });
    const cb = vi.fn();
    provider.subscribe("S", cb);
    cb.mockClear();
    provider.dispose();
    provider.setValue("S", 1);
    expect(cb).not.toHaveBeenCalled();
    expect(provider.isDisposed).toBe(true);
  });
});
