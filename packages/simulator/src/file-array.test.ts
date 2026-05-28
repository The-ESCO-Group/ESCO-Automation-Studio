import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand, type LadderRoutine } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();

function singleRung(type: string, operands: [string, string][]): LadderRoutine {
  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [createNode(type, operands.map(([n, v]) => tagOperand(n, v)))]),
  );
  return ladder;
}

function run(routine: LadderRoutine): PlcRuntime {
  const rt = new PlcRuntime(registry);
  rt.loadRoutine(routine);
  return rt;
}

describe("file/array instructions are registered", () => {
  it("registers AVE/STD/SRT (executable) and SIZE/FFL/FFU/LFL/LFU (model-only)", () => {
    for (const type of ["AVE", "STD", "SRT"]) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.modelOnly).toBeFalsy();
    }
    for (const type of ["SIZE", "FFL", "FFU", "LFL", "LFU"]) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.modelOnly).toBe(true);
    }
  });
});

describe("AVE / STD / SRT execute over array elements", () => {
  it("AVE averages Length elements into Dest", () => {
    const rt = run(singleRung("AVE", [["array", "Arr"], ["dest", "Avg"], ["control", "Ctl"], ["length", "3"]]));
    rt.writeTag("Arr[0]", 10);
    rt.writeTag("Arr[1]", 20);
    rt.writeTag("Arr[2]", 30);
    rt.writeTag("Arr[3]", 999); // beyond Length — ignored
    rt.scanOnce(0);
    expect(rt.readTag("Avg")).toBe(20);
  });

  it("STD computes the sample standard deviation", () => {
    const rt = run(singleRung("STD", [["array", "Arr"], ["dest", "Sd"], ["control", "Ctl"], ["length", "3"]]));
    rt.writeTag("Arr[0]", 1);
    rt.writeTag("Arr[1]", 2);
    rt.writeTag("Arr[2]", 3);
    rt.scanOnce(0);
    expect(rt.readTag("Sd")).toBe(1); // mean 2, sample variance ((1)+(0)+(1))/2 = 1
  });

  it("SRT sorts Length elements ascending in place", () => {
    const rt = run(singleRung("SRT", [["array", "Arr"], ["control", "Ctl"], ["length", "3"]]));
    rt.writeTag("Arr[0]", 30);
    rt.writeTag("Arr[1]", 10);
    rt.writeTag("Arr[2]", 20);
    rt.scanOnce(0);
    expect(rt.readTag("Arr[0]")).toBe(10);
    expect(rt.readTag("Arr[1]")).toBe(20);
    expect(rt.readTag("Arr[2]")).toBe(30);
  });

  it("does not execute when the rung is false", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "En")]),
        createNode("AVE", [tagOperand("array", "Arr"), tagOperand("dest", "Avg"), tagOperand("control", "Ctl"), tagOperand("length", "2")]),
      ]),
    );
    const rt = run(ladder);
    rt.writeTag("Arr[0]", 4);
    rt.writeTag("Arr[1]", 6);
    rt.scanOnce(0);
    expect(rt.readTag("Avg")).toBe(false); // En false → no write
    rt.writeTag("En", true);
    rt.scanOnce(0);
    expect(rt.readTag("Avg")).toBe(5);
  });
});

describe("model-only file instructions pass through safely", () => {
  it("SIZE/FFL/FFU/LFL/LFU do not crash or alter the rung condition", () => {
    const cases: [string, [string, string][]][] = [
      ["SIZE", [["source", "Arr"], ["dimension", "0"], ["size", "Sz"]]],
      ["FFL", [["source", "In"], ["fifo", "Q"], ["control", "Ctl"], ["length", "8"]]],
      ["FFU", [["fifo", "Q"], ["dest", "Out"], ["control", "Ctl"], ["length", "8"]]],
      ["LFL", [["source", "In"], ["lifo", "S"], ["control", "Ctl"], ["length", "8"]]],
      ["LFU", [["lifo", "S"], ["dest", "Out"], ["control", "Ctl"], ["length", "8"]]],
    ];
    for (const [type, ops] of cases) {
      const ladder = createLadderRoutine();
      ladder.rungs.push(
        createRung(ladder.id, 0, [
          createNode("XIC", [tagOperand("operand", "En")]),
          createNode(type, ops.map(([n, v]) => tagOperand(n, v))),
          createNode("OTE", [tagOperand("operand", "Done")]),
        ]),
      );
      const rt = run(ladder);
      rt.writeTag("En", true);
      expect(() => rt.scanOnce(0)).not.toThrow();
      expect(rt.readTag("Done")).toBe(true); // model-only passes condition through to OTE
    }
  });
});
