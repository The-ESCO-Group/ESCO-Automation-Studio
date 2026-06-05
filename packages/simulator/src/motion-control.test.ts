import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();
const MOTION = [
  "MCD", "MCCD", "MCLM", "MCLP", "MCT", "MAG", "MAPC", "MATC", "MCSV", "MCCP", "MCSR",
  "MDO", "MDF", "MDAC", "MAH", "MHS", "MRP", "MRAT", "MAAT", "MRHD", "MAHD", "MGS",
];
const CONTROL = ["UID", "UIE"];

describe("motion + remaining program-control instructions", () => {
  it("registers motion mnemonics as model-only (no real motion control)", () => {
    for (const type of MOTION) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.modelOnly).toBe(true);
      expect(registry.get(type)?.category).toBe("motion");
    }
  });

  it("registers UID/UIE as model-only and IOT as executable offline I/O flush", () => {
    for (const type of CONTROL) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.modelOnly).toBe(true);
    }
    expect(registry.has("IOT")).toBe(true);
    expect(registry.get("IOT")?.modelOnly).toBeFalsy();
    expect(registry.get("IOT")?.operands[0]).toMatchObject({
      name: "updateTag",
      direction: "read",
      isLabelRef: true,
    });
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
    expect(rt.readTag("Done")).toBe(true); // motion + offline IOT pass condition through
  });

  it("validates IOT's update tag and does not modify tag memory offline", () => {
    const iot = registry.get("IOT")!;
    expect(iot.validate(createNode("IOT", []))).toEqual(["Operand 'updateTag' is required."]);

    const ladder = createLadderRoutine();
    ladder.rungs.push(createRung(ladder.id, 0, [createNode("IOT", [tagOperand("updateTag", "Local:5:O")])]));
    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);
    rt.writeTag("Local:5:O", 123);
    rt.scanOnce(0);
    expect(rt.readTag("Local:5:O")).toBe(123);
  });
});
