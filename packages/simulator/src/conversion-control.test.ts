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

describe("Session 05 instructions are registered", () => {
  it("registers conversion + program-control instructions (parse/validate/simulate, not 'unsupported')", () => {
    for (const type of ["TOD", "FRD", "BTD", "SWPB", "TND", "JMP", "LBL", "MCR", "BRK", "FOR"]) {
      expect(registry.has(type)).toBe(true);
    }
  });
});

describe("TOD / FRD — BCD conversion", () => {
  it("TOD encodes an integer as packed BCD", () => {
    const rt = run(singleRung("TOD", [["source", "1234"], ["dest", "Bcd"]]));
    rt.scanOnce(0);
    expect(rt.readTag("Bcd")).toBe(0x1234); // 4660
  });

  it("FRD decodes packed BCD back to an integer (round-trips TOD)", () => {
    const rt = run(singleRung("FRD", [["source", String(0x1234)], ["dest", "Int"]]));
    rt.scanOnce(0);
    expect(rt.readTag("Int")).toBe(1234);
  });
});

describe("BTD — bit field distribute", () => {
  it("copies Length bits from Source[SourceBit] into Dest[DestBit], preserving other bits", () => {
    // Move 4 bits from Source bit 0 (0b1111) into Dest bit 8, Dest starts 1.
    const rt = run(
      singleRung("BTD", [
        ["source", "15"],
        ["sourceBit", "0"],
        ["dest", "Word"],
        ["destBit", "8"],
        ["length", "4"],
      ]),
    );
    rt.writeTag("Word", 1);
    rt.scanOnce(0);
    expect(rt.readTag("Word")).toBe(1 | (0xf << 8)); // 0x0F01
  });
});

describe("TND — temporary end", () => {
  it("ends the routine scan early when true, skipping later rungs", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "Stop")]),
        createNode("TND", []),
      ]),
    );
    ladder.rungs.push(createRung(ladder.id, 1, [createNode("OTE", [tagOperand("operand", "After")])]));
    const rt = run(ladder);

    rt.writeTag("Stop", true);
    rt.scanOnce(0);
    expect(rt.readTag("After")).toBe(false); // TND ended the scan before rung 1

    rt.writeTag("Stop", false);
    rt.scanOnce(0);
    expect(rt.readTag("After")).toBe(true); // no early end → rung 1 runs
  });
});

describe("model-only flow never alters memory or hangs", () => {
  it("marks non-simulated conversion/control flow as model-only", () => {
    for (const type of ["SWPB", "JMP", "LBL", "MCR", "BRK", "FOR"]) {
      expect(registry.get(type)?.modelOnly).toBe(true);
    }
  });

  it("JMP/LBL/MCR/BRK/SWPB pass through without crashing", () => {
    for (const [type, ops] of [
      ["JMP", [["label", "Loop1"]]],
      ["LBL", [["label", "Loop1"]]],
      ["MCR", []],
      ["BRK", []],
      ["SWPB", [["source", "Word"]]],
    ] as [string, [string, string][]][]) {
      const rt = run(singleRung(type, ops));
      expect(() => rt.scanOnce(0)).not.toThrow();
    }
  });
});
