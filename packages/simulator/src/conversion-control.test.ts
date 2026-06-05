import { describe, expect, it } from "vitest";
import { createDefaultRegistry, supportLevel } from "@esco/instructions";
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
    for (const type of ["TOD", "FRD", "BTD", "BTDT", "SWPB", "TND", "JMP", "LBL", "MCR", "BRK", "FOR"]) {
      expect(registry.has(type)).toBe(true);
    }
  });
});

describe("SWPB — byte reordering", () => {
  it("executes the documented DINT order modes", () => {
    for (const [mode, expected] of [
      ["REVERSE", 0x44434241],
      ["WORD", 0x43444142],
      ["HIGHLOW", 0x42414443],
    ] as const) {
      const rt = run(singleRung("SWPB", [["source", String(0x41424344)], ["orderMode", mode], ["dest", "Out"]]));
      rt.scanOnce(0);
      expect(rt.readTag("Out")).toBe(expected);
    }
  });

  it("accepts numeric order modes and writes signed DINT results", () => {
    const rt = run(singleRung("SWPB", [["source", String(0x12345678)], ["orderMode", "0"], ["dest", "Out"]]));
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(0x78563412);

    const signed = run(singleRung("SWPB", [["source", String(0x11223380)], ["orderMode", "REVERSE"], ["dest", "Out"]]));
    signed.scanOnce(0);
    expect(signed.readTag("Out")).toBe(-2144132591); // 0x80332211 as signed DINT
  });

  it("does not write while false or when order mode is invalid", () => {
    const falseRung = createLadderRoutine();
    falseRung.rungs.push(createRung(falseRung.id, 0, [
      createNode("XIC", [tagOperand("operand", "Gate")]),
      createNode("SWPB", [
        tagOperand("source", String(0x41424344)),
        tagOperand("orderMode", "REVERSE"),
        tagOperand("dest", "Out"),
      ]),
    ]));
    const falseRt = run(falseRung);
    falseRt.writeTag("Out", 88);
    falseRt.scanOnce(0);
    expect(falseRt.readTag("Out")).toBe(88);

    const invalid = run(singleRung("SWPB", [["source", String(0x41424344)], ["orderMode", "BAD"], ["dest", "Out"]]));
    invalid.writeTag("Out", 99);
    invalid.scanOnce(0);
    expect(invalid.readTag("Out")).toBe(99);
  });

  it("validates required operands and order-mode keywords", () => {
    const swpb = registry.get("SWPB")!;
    expect(swpb.validate(createNode("SWPB", []))).toEqual([
      "Operand 'source' is required.",
      "Operand 'orderMode' is required.",
      "Operand 'dest' is required.",
    ]);
    expect(swpb.validate(createNode("SWPB", [
      tagOperand("source", "In"),
      tagOperand("orderMode", "HIGH/LOW"),
      tagOperand("dest", "Out"),
    ]))).toEqual([]);
    expect(swpb.validate(createNode("SWPB", [
      tagOperand("source", "In"),
      tagOperand("orderMode", "BAD"),
      tagOperand("dest", "Out"),
    ]))).toContain("Operand 'orderMode' must be REVERSE, WORD, HIGHLOW, 0, 1, or 2.");
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

describe("BTDT — bit field distribute with target", () => {
  it("executes the target-style variant and preserves other target bits", () => {
    const rt = run(
      singleRung("BTDT", [
        ["source", "15"],
        ["sourceBit", "0"],
        ["length", "4"],
        ["destBit", "8"],
        ["target", "Word"],
      ]),
    );
    rt.writeTag("Word", 1);
    rt.scanOnce(0);
    expect(rt.readTag("Word")).toBe(1 | (0xf << 8));
  });

  it("does not write the target when the rung is false", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(createRung(ladder.id, 0, [
      createNode("XIC", [tagOperand("operand", "Gate")]),
      createNode("BTDT", [
        tagOperand("source", "15"),
        tagOperand("sourceBit", "0"),
        tagOperand("length", "4"),
        tagOperand("destBit", "8"),
        tagOperand("target", "Word"),
      ]),
    ]));
    const rt = run(ladder);
    rt.writeTag("Word", 1);
    rt.scanOnce(0);
    expect(rt.readTag("Word")).toBe(1);
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

describe("JMP / LBL — bounded routine jumps", () => {
  it("marks conversion and program-flow instructions executable", () => {
    for (const type of ["SWPB", "JMP", "LBL", "FOR", "BRK", "MCR"]) {
      expect(supportLevel(registry.get(type))).toBe("executable");
    }
  });

  it("skips intervening rungs when a true JMP targets an LBL", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "Jump")]),
        createNode("JMP", [tagOperand("label", "Skip")]),
      ]),
    );
    ladder.rungs.push(createRung(ladder.id, 1, [createNode("OTE", [tagOperand("operand", "Skipped")])]));
    ladder.rungs.push(createRung(ladder.id, 2, [createNode("LBL", [tagOperand("label", "Skip")])]));
    ladder.rungs.push(createRung(ladder.id, 3, [createNode("OTE", [tagOperand("operand", "After")])]));

    const rt = run(ladder);
    rt.writeTag("Jump", true);
    rt.scanOnce(0);

    expect(rt.readTag("Skipped")).toBe(false);
    expect(rt.readTag("After")).toBe(true);
  });

  it("falls through when the JMP rung is false or the label is missing", () => {
    const falseJump = createLadderRoutine();
    falseJump.rungs.push(
      createRung(falseJump.id, 0, [
        createNode("XIC", [tagOperand("operand", "Jump")]),
        createNode("JMP", [tagOperand("label", "Skip")]),
      ]),
    );
    falseJump.rungs.push(createRung(falseJump.id, 1, [createNode("OTE", [tagOperand("operand", "Reached")])]));
    falseJump.rungs.push(createRung(falseJump.id, 2, [createNode("LBL", [tagOperand("label", "Skip")])]));
    let rt = run(falseJump);
    rt.writeTag("Jump", false);
    rt.scanOnce(0);
    expect(rt.readTag("Reached")).toBe(true);

    const missingLabel = createLadderRoutine();
    missingLabel.rungs.push(createRung(missingLabel.id, 0, [createNode("JMP", [tagOperand("label", "Missing")])]));
    missingLabel.rungs.push(createRung(missingLabel.id, 1, [createNode("OTE", [tagOperand("operand", "Reached")])]));
    rt = run(missingLabel);
    rt.scanOnce(0);
    expect(rt.readTag("Reached")).toBe(true);
  });

  it("FOR executes a sibling routine with an index tag", () => {
    const main = createLadderRoutine();
    main.rungs.push(createRung(main.id, 0, [
      createNode("FOR", [
        tagOperand("routine", "LoopBody"),
        tagOperand("index", "I"),
        tagOperand("initial", "1"),
        tagOperand("terminal", "3"),
        tagOperand("step", "1"),
      ]),
    ]));
    const loopBody = createLadderRoutine();
    loopBody.rungs.push(createRung(loopBody.id, 0, [
      createNode("ADD", [
        tagOperand("sourceA", "Sum"),
        tagOperand("sourceB", "I"),
        tagOperand("dest", "Sum"),
      ]),
    ]));

    const rt = run(main);
    rt.loadRoutines(new Map([["LoopBody", loopBody]]));
    rt.scanOnce(0);

    expect(rt.readTag("Sum")).toBe(6);
    expect(rt.readTag("I")).toBe(3);
  });

  it("BRK exits the active FOR loop", () => {
    const main = createLadderRoutine();
    main.rungs.push(createRung(main.id, 0, [
      createNode("FOR", [
        tagOperand("routine", "LoopBody"),
        tagOperand("index", "I"),
        tagOperand("initial", "1"),
        tagOperand("terminal", "5"),
        tagOperand("step", "1"),
      ]),
    ]));
    const loopBody = createLadderRoutine();
    loopBody.rungs.push(createRung(loopBody.id, 0, [
      createNode("ADD", [
        tagOperand("sourceA", "Sum"),
        tagOperand("sourceB", "I"),
        tagOperand("dest", "Sum"),
      ]),
    ]));
    loopBody.rungs.push(createRung(loopBody.id, 1, [
      createNode("EQU", [tagOperand("sourceA", "I"), tagOperand("sourceB", "2")]),
      createNode("BRK", []),
    ]));

    const rt = run(main);
    rt.loadRoutines(new Map([["LoopBody", loopBody]]));
    rt.scanOnce(0);

    expect(rt.readTag("Sum")).toBe(3);
    expect(rt.readTag("I")).toBe(2);
  });

  it("MCR scans disabled zone rungs with false power until the closing MCR", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(createRung(ladder.id, 0, [
      createNode("XIC", [tagOperand("operand", "EnableZone")]),
      createNode("MCR", []),
    ]));
    ladder.rungs.push(createRung(ladder.id, 1, [createNode("OTE", [tagOperand("operand", "ZoneOut")])]));
    ladder.rungs.push(createRung(ladder.id, 2, [
      createNode("MOV", [tagOperand("source", "99"), tagOperand("dest", "Moved")]),
    ]));
    ladder.rungs.push(createRung(ladder.id, 3, [createNode("MCR", [])]));
    ladder.rungs.push(createRung(ladder.id, 4, [createNode("OTE", [tagOperand("operand", "After")])]));

    const rt = run(ladder);
    rt.writeTag("ZoneOut", true);
    rt.writeTag("Moved", 7);
    rt.writeTag("EnableZone", false);
    rt.scanOnce(0);
    expect(rt.readTag("ZoneOut")).toBe(false);
    expect(rt.readTag("Moved")).toBe(7);
    expect(rt.readTag("After")).toBe(true);

    rt.writeTag("EnableZone", true);
    rt.scanOnce(0);
    expect(rt.readTag("ZoneOut")).toBe(true);
    expect(rt.readTag("Moved")).toBe(99);
  });

});
