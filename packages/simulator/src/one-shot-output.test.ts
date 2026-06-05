import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand, type LadderRoutine } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();

function routine(nodes: ReturnType<typeof createNode>[]): LadderRoutine {
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(ladder.id, 0, nodes));
  return ladder;
}

function node(type: string, operands: [string, string][]) {
  return createNode(type, operands.map(([name, value]) => tagOperand(name, value)));
}

function runtimeFor(ladder: LadderRoutine): PlcRuntime {
  const rt = new PlcRuntime(registry);
  rt.loadRoutine(ladder);
  return rt;
}

describe("one-shot output instructions are executable", () => {
  it("registers OSR/OSF as executable bit instructions", () => {
    for (const type of ["OSR", "OSF", "OSRI", "OSFI"]) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.category).toBe("bit");
      expect(registry.get(type)?.modelOnly).toBeFalsy();
    }
  });
});

describe("OSR - One Shot Rising", () => {
  it("pulses the output bit for one scan on a false→true edge", () => {
    const rt = runtimeFor(
      routine([
        node("XIC", [["tag", "Enable"]]),
        node("OSR", [["storage", "Stg"], ["output", "Pulse"]]),
      ]),
    );

    // Rung false: no pulse.
    rt.scanOnce(0);
    expect(rt.readTag("Pulse")).toBe(false);

    // Rising edge: pulse true for exactly this scan.
    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Pulse")).toBe(true);
    expect(rt.readTag("Stg")).toBe(true);

    // Held true: no new edge, pulse clears.
    rt.scanOnce(0);
    expect(rt.readTag("Pulse")).toBe(false);

    // Falling then rising again re-arms and pulses once more.
    rt.writeTag("Enable", false);
    rt.scanOnce(0);
    expect(rt.readTag("Pulse")).toBe(false);
    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Pulse")).toBe(true);
  });
});

describe("OSF - One Shot Falling", () => {
  it("pulses the output bit for one scan on a true→false edge", () => {
    const rt = runtimeFor(
      routine([
        node("XIC", [["tag", "Enable"]]),
        node("OSF", [["storage", "Stg"], ["output", "Pulse"]]),
      ]),
    );

    // Rung true: arms the storage bit, no falling pulse yet.
    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Pulse")).toBe(false);
    expect(rt.readTag("Stg")).toBe(true);

    // Falling edge: pulse true for exactly this scan.
    rt.writeTag("Enable", false);
    rt.scanOnce(0);
    expect(rt.readTag("Pulse")).toBe(true);
    expect(rt.readTag("Stg")).toBe(false);

    // Held false: no new edge, pulse clears.
    rt.scanOnce(0);
    expect(rt.readTag("Pulse")).toBe(false);
  });
});

describe("OSRI - FBD One Shot Rising with Input", () => {
  it("pulses Shot.OutputBit for one scan on a false→true InputBit edge", () => {
    const rt = runtimeFor(routine([node("OSRI", [["shot", "Shot"]])]));

    rt.scanOnce(0);
    expect(rt.readTag("Shot.OutputBit")).toBe(false);
    expect(rt.readTag("Shot.EnableOut")).toBe(true);

    rt.writeTag("Shot.InputBit", true);
    rt.scanOnce(0);
    expect(rt.readTag("Shot.OutputBit")).toBe(true);

    rt.scanOnce(0);
    expect(rt.readTag("Shot.OutputBit")).toBe(false);

    rt.writeTag("Shot.InputBit", false);
    rt.scanOnce(0);
    expect(rt.readTag("Shot.OutputBit")).toBe(false);
    rt.writeTag("Shot.InputBit", true);
    rt.scanOnce(0);
    expect(rt.readTag("Shot.OutputBit")).toBe(true);
  });

  it("does not pulse on the first scan when InputBit is already true", () => {
    const rt = runtimeFor(routine([node("OSRI", [["shot", "Shot"]])]));
    rt.writeTag("Shot.InputBit", true);

    rt.scanOnce(0);
    expect(rt.readTag("Shot.OutputBit")).toBe(false);

    rt.scanOnce(0);
    expect(rt.readTag("Shot.OutputBit")).toBe(false);
  });
});

describe("OSFI - FBD One Shot Falling with Input", () => {
  it("pulses Shot.OutputBit for one scan on a true→false InputBit edge", () => {
    const rt = runtimeFor(routine([node("OSFI", [["shot", "Shot"]])]));

    rt.writeTag("Shot.InputBit", true);
    rt.scanOnce(0);
    expect(rt.readTag("Shot.OutputBit")).toBe(false);

    rt.writeTag("Shot.InputBit", false);
    rt.scanOnce(0);
    expect(rt.readTag("Shot.OutputBit")).toBe(true);

    rt.scanOnce(0);
    expect(rt.readTag("Shot.OutputBit")).toBe(false);
  });
});
