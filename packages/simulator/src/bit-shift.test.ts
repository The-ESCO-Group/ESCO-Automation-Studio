import { describe, expect, it } from "vitest";
import { createDefaultRegistry, supportLevel } from "@esco/instructions";
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

describe("bit shift instructions are executable", () => {
  it("registers BSL and BSR as executable shift instructions", () => {
    for (const type of ["BSL", "BSR"]) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.category).toBe("shift");
      expect(registry.get(type)?.modelOnly).toBeFalsy();
      expect(supportLevel(registry.get(type))).toBe("executable");
    }
  });
});

describe("BSL - Bit Shift Left", () => {
  it("shifts contiguous DINT array bits left on false-to-true edges", () => {
    const rt = runtimeFor(
      routine([
        node("XIC", [["operand", "Enable"]]),
        node("BSL", [
          ["array", "Bits"],
          ["control", "Ctl"],
          ["source", "LoadBit"],
          ["length", "33"],
        ]),
      ]),
    );

    rt.writeTag("Bits[0]", 0x80000001);
    rt.writeTag("Bits[1]", 0);
    rt.writeTag("LoadBit", true);

    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Bits[0]")).toBe(0x00000003);
    expect(rt.readTag("Bits[1]")).toBe(0x00000001);
    expect(rt.readTag("Ctl.EN")).toBe(true);
    expect(rt.readTag("Ctl.DN")).toBe(true);
    expect(rt.readTag("Ctl.ER")).toBe(false);
    expect(rt.readTag("Ctl.LEN")).toBe(33);
    expect(rt.readTag("Ctl.UL")).toBe(false);

    rt.scanOnce(0);
    expect(rt.readTag("Bits[0]")).toBe(0x00000003);
    expect(rt.readTag("Bits[1]")).toBe(0x00000001);

    rt.writeTag("Enable", false);
    rt.scanOnce(0);
    expect(rt.readTag("Ctl.EN")).toBe(false);
    expect(rt.readTag("Ctl.DN")).toBe(false);
    expect(rt.readTag("Ctl.POS")).toBe(0);

    rt.writeTag("LoadBit", false);
    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Bits[0]")).toBe(0x00000006);
    expect(rt.readTag("Bits[1]")).toBe(0x00000000);
    expect(rt.readTag("Ctl.UL")).toBe(true);
  });
});

describe("BSR - Bit Shift Right", () => {
  it("shifts contiguous DINT array bits right and loads the source bit into the top selected bit", () => {
    const rt = runtimeFor(
      routine([
        node("XIC", [["operand", "Enable"]]),
        node("BSR", [
          ["array", "Bits"],
          ["control", "Ctl"],
          ["source", "LoadBit"],
          ["length", "33"],
        ]),
      ]),
    );

    rt.writeTag("Bits[0]", 0);
    rt.writeTag("Bits[1]", 1);
    rt.writeTag("LoadBit", true);

    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Bits[0]")).toBe(-2147483648);
    expect(rt.readTag("Bits[1]")).toBe(1);
    expect(rt.readTag("Ctl.UL")).toBe(false);

    rt.writeTag("Enable", false);
    rt.scanOnce(0);
    rt.writeTag("Bits[0]", 5);
    rt.writeTag("Bits[1]", 0);
    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Bits[0]")).toBe(0x00000002);
    expect(rt.readTag("Bits[1]")).toBe(1);
    expect(rt.readTag("Ctl.UL")).toBe(true);
  });

  it("sets Control.ER for negative lengths and leaves the array unchanged", () => {
    const rt = runtimeFor(
      routine([
        node("BSR", [
          ["array", "Bits"],
          ["control", "Ctl"],
          ["source", "LoadBit"],
          ["length", "-1"],
        ]),
      ]),
    );

    rt.writeTag("Bits[0]", 0x55);
    rt.writeTag("LoadBit", true);
    rt.scanOnce(0);
    expect(rt.readTag("Bits[0]")).toBe(0x55);
    expect(rt.readTag("Ctl.ER")).toBe(true);
    expect(rt.readTag("Ctl.DN")).toBe(false);
    expect(rt.readTag("Ctl.LEN")).toBe(-1);
  });
});
