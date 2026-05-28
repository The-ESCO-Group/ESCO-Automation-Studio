import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();
const MOTION = [
  "MCD", "MCCD", "MCLM", "MCLP", "MCT", "MAG", "MAPC", "MCSV", "MCSR",
  "MDO", "MDAC", "MAH", "MHS", "MRP", "MRAT", "MGS",
];
const CONTROL = ["UID", "UIE", "IOT"];

describe("motion + remaining program-control instructions", () => {
  it("registers motion mnemonics as model-only (no real motion control)", () => {
    for (const type of MOTION) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.modelOnly).toBe(true);
      expect(registry.get(type)?.category).toBe("motion");
    }
  });

  it("registers UID/UIE/IOT as model-only", () => {
    for (const type of CONTROL) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.modelOnly).toBe(true);
    }
  });

  it("passes the rung condition through without crashing or hanging", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "En")]),
        createNode("MCLM", [tagOperand("op0", "Grp"), tagOperand("op1", "Move")]),
        createNode("MGS", [tagOperand("op0", "Grp")]),
        createNode("IOT", [tagOperand("op0", "Out")]),
        createNode("OTE", [tagOperand("operand", "Done")]),
      ]),
    );
    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);
    rt.writeTag("En", true);
    expect(() => rt.scanOnce(0)).not.toThrow();
    expect(rt.readTag("Done")).toBe(true); // model-only motion/control pass condition through
  });
});
