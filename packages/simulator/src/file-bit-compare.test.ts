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

const FBC_OPERANDS: [string, string][] = [
  ["source", "Src"],
  ["reference", "Ref"],
  ["result", "Res"],
  ["cmpControl", "Cmp"],
  ["resultControl", "ResCtl"],
];

describe("FBC / DDT are registered as executable", () => {
  it("registers FBC and DDT so they parse, validate, and simulate (not 'unsupported')", () => {
    for (const type of ["FBC", "DDT"]) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.modelOnly).toBeFalsy();
    }
  });
});

describe("FBC — File Bit Comparator", () => {
  it("records the bit numbers of mismatches and counts them on the controls", () => {
    const rt = run(singleRung("FBC", FBC_OPERANDS));
    rt.writeTag("Cmp.LEN", 32); // compare the low 32 bits (word 0)
    rt.writeTag("ResCtl.LEN", 8); // room for 8 mismatches
    // Differ at bit 0 and bit 5 only.
    rt.writeTag("Src[0]", (1 << 0) | (1 << 5) | (1 << 10));
    rt.writeTag("Ref[0]", 1 << 10);
    rt.scanOnce(0);

    expect(rt.readTag("Res[0]")).toBe(0);
    expect(rt.readTag("Res[1]")).toBe(5);
    expect(rt.readTag("ResCtl.POS")).toBe(2);
    expect(rt.readTag("Cmp.POS")).toBe(32);
    expect(rt.readTag("Cmp.DN")).toBe(true);
    expect(rt.readTag("Cmp.FD")).toBe(true);
    expect(rt.readTag("Cmp.ER")).toBe(false);
  });

  it("crosses word boundaries: bit 33 lives in word 1", () => {
    const rt = run(singleRung("FBC", FBC_OPERANDS));
    rt.writeTag("Cmp.LEN", 64);
    rt.writeTag("ResCtl.LEN", 8);
    rt.writeTag("Src[1]", 1 << 1); // global bit 33
    rt.writeTag("Ref[1]", 0);
    rt.scanOnce(0);
    expect(rt.readTag("Res[0]")).toBe(33);
    expect(rt.readTag("ResCtl.POS")).toBe(1);
  });

  it("respects qualified program-scoped array operands and starting word offsets", () => {
    const operands: [string, string][] = [
      ["source", "Program:Safety.Src[1]"],
      ["reference", "Program:Safety.Ref[1]"],
      ["result", "Program:Safety.Res[2]"],
      ["cmpControl", "Cmp"],
      ["resultControl", "ResCtl"],
    ];
    const rt = run(singleRung("FBC", operands));
    rt.writeTag("Cmp.LEN", 64);
    rt.writeTag("ResCtl.LEN", 8);
    rt.writeTag("Program:Safety.Src[2]", 1 << 3); // starting word 1 + global word 1 -> bit 35
    rt.writeTag("Program:Safety.Ref[2]", 0);
    rt.scanOnce(0);

    expect(rt.readTag("Program:Safety.Res[2]")).toBe(35);
    expect(rt.readTag("ResCtl.POS")).toBe(1);
  });

  it("clears FD and records nothing when the files match", () => {
    const rt = run(singleRung("FBC", FBC_OPERANDS));
    rt.writeTag("Cmp.LEN", 32);
    rt.writeTag("ResCtl.LEN", 8);
    rt.writeTag("Src[0]", 0x0f0f);
    rt.writeTag("Ref[0]", 0x0f0f);
    rt.scanOnce(0);
    expect(rt.readTag("ResCtl.POS")).toBe(0);
    expect(rt.readTag("Cmp.FD")).toBe(false);
    expect(rt.readTag("Cmp.DN")).toBe(true);
  });

  it("stops recording once the Result array is full but still flags DN/FD", () => {
    const rt = run(singleRung("FBC", FBC_OPERANDS));
    rt.writeTag("Cmp.LEN", 32);
    rt.writeTag("ResCtl.LEN", 2); // only 2 slots
    rt.writeTag("Src[0]", (1 << 0) | (1 << 1) | (1 << 2)); // three mismatches
    rt.writeTag("Ref[0]", 0);
    rt.scanOnce(0);
    expect(rt.readTag("Res[0]")).toBe(0);
    expect(rt.readTag("Res[1]")).toBe(1);
    expect(rt.readTag("ResCtl.POS")).toBe(2); // capped at LEN
    expect(rt.readTag("ResCtl.DN")).toBe(true); // result array full
    expect(rt.readTag("Cmp.FD")).toBe(true);
  });

  it("flags ER and does nothing when the compare length is zero", () => {
    const rt = run(singleRung("FBC", FBC_OPERANDS));
    rt.writeTag("Cmp.LEN", 0);
    rt.writeTag("ResCtl.LEN", 8);
    rt.writeTag("Src[0]", 1);
    rt.writeTag("Ref[0]", 0);
    rt.scanOnce(0);
    expect(rt.readTag("Cmp.ER")).toBe(true);
    expect(rt.readTag("Cmp.DN")).toBe(false);
    expect(rt.readTag("ResCtl.POS")).toBe(false); // never written
  });

  it("leaves the Reference unchanged (compare only)", () => {
    const rt = run(singleRung("FBC", FBC_OPERANDS));
    rt.writeTag("Cmp.LEN", 32);
    rt.writeTag("ResCtl.LEN", 8);
    rt.writeTag("Src[0]", 0xff);
    rt.writeTag("Ref[0]", 0x0f);
    rt.scanOnce(0);
    expect(rt.readTag("Ref[0]")).toBe(0x0f); // untouched
  });
});

describe("DDT — Diagnostic Detect", () => {
  it("copies each mismatching Source bit into Reference after recording it", () => {
    const ddtOperands: [string, string][] = FBC_OPERANDS;
    const rt = run(singleRung("DDT", ddtOperands));
    rt.writeTag("Cmp.LEN", 32);
    rt.writeTag("ResCtl.LEN", 8);
    rt.writeTag("Src[0]", (1 << 2) | (1 << 7));
    rt.writeTag("Ref[0]", 0);
    rt.scanOnce(0);

    // First scan finds and records the two differences...
    expect(rt.readTag("Res[0]")).toBe(2);
    expect(rt.readTag("Res[1]")).toBe(7);
    expect(rt.readTag("ResCtl.POS")).toBe(2);
    // ...and updates Reference to match Source.
    expect(rt.readTag("Ref[0]")).toBe((1 << 2) | (1 << 7));

    // A repeated scan now finds nothing.
    rt.scanOnce(0);
    expect(rt.readTag("ResCtl.POS")).toBe(0);
    expect(rt.readTag("Cmp.FD")).toBe(false);
  });
});

describe("FBC respects the rung condition", () => {
  it("does not compare or set DN when the rung is false", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "En")]),
        createNode("FBC", FBC_OPERANDS.map(([n, v]) => tagOperand(n, v))),
      ]),
    );
    const rt = run(ladder);
    rt.writeTag("Cmp.LEN", 32);
    rt.writeTag("ResCtl.LEN", 8);
    rt.writeTag("Src[0]", 1);
    rt.writeTag("Ref[0]", 0);
    rt.scanOnce(0); // En false
    expect(rt.readTag("Cmp.DN")).toBe(false);
    expect(rt.readTag("ResCtl.POS")).toBe(false); // never written

    rt.writeTag("En", true);
    rt.scanOnce(0);
    expect(rt.readTag("Cmp.DN")).toBe(true);
    expect(rt.readTag("Res[0]")).toBe(0);
  });
});
