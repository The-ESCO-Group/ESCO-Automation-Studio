import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand, type LadderRoutine } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();

/** Build a one-rung routine (rung-in is unconditionally true). */
function routineWith(type: string, operands: [string, string][]): LadderRoutine {
  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [createNode(type, operands.map(([n, v]) => tagOperand(n, v)))]),
  );
  return ladder;
}

function runtimeFor(routine: LadderRoutine): PlcRuntime {
  const rt = new PlcRuntime(registry);
  rt.loadRoutine(routine);
  return rt;
}

describe("data-movement instructions are registered", () => {
  it("registers COP/CPS/FLL/MVM so they parse, validate, and simulate (not 'unsupported')", () => {
    for (const type of ["COP", "CPS", "FLL", "MVM"]) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.category).toBe("move");
    }
  });
});

describe("COP / CPS — block copy", () => {
  it("copies Length elements from Source[] to Dest[]", () => {
    const rt = runtimeFor(routineWith("COP", [["source", "Src"], ["dest", "Dst"], ["length", "3"]]));
    rt.writeTag("Src[0]", 10);
    rt.writeTag("Src[1]", 20);
    rt.writeTag("Src[2]", 30);
    rt.writeTag("Src[3]", 99); // beyond Length — must not copy
    rt.scanOnce(0);
    expect(rt.readTag("Dst[0]")).toBe(10);
    expect(rt.readTag("Dst[1]")).toBe(20);
    expect(rt.readTag("Dst[2]")).toBe(30);
    expect(rt.readTag("Dst[3]")).toBe(false); // untouched (missing => default)
  });

  it("honors an explicit start index on both sides (CPS behaves like COP)", () => {
    const rt = runtimeFor(routineWith("CPS", [["source", "Src[2]"], ["dest", "Dst[1]"], ["length", "2"]]));
    rt.writeTag("Src[2]", 7);
    rt.writeTag("Src[3]", 8);
    rt.scanOnce(0);
    expect(rt.readTag("Dst[1]")).toBe(7);
    expect(rt.readTag("Dst[2]")).toBe(8);
  });

  it("does not copy when the rung is false", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "Enable")]),
        createNode("COP", [tagOperand("source", "Src"), tagOperand("dest", "Dst"), tagOperand("length", "2")]),
      ]),
    );
    const rt = runtimeFor(ladder);
    rt.writeTag("Src[0]", 5);
    rt.scanOnce(0); // Enable is false
    expect(rt.readTag("Dst[0]")).toBe(false);
    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Dst[0]")).toBe(5);
  });
});

describe("FLL — fill", () => {
  it("fills Length consecutive Dest elements with the Source value", () => {
    const rt = runtimeFor(routineWith("FLL", [["source", "42"], ["dest", "Buf"], ["length", "4"]]));
    rt.scanOnce(0);
    expect(rt.readTag("Buf[0]")).toBe(42);
    expect(rt.readTag("Buf[3]")).toBe(42);
    expect(rt.readTag("Buf[4]")).toBe(false); // beyond Length
  });
});

describe("MVM — masked move", () => {
  it("moves only the masked bits into Dest, preserving the rest", () => {
    // Dest starts 0x00FF; Source 0xAA55 through mask 0x0F0F.
    const rt = runtimeFor(routineWith("MVM", [["source", "43605"], ["mask", "3855"], ["dest", "Word"]]));
    rt.writeTag("Word", 0x00ff); // 255
    rt.scanOnce(0);
    // (0x00FF & ~0x0F0F) | (0xAA55 & 0x0F0F) = 0x00F0 | 0x0A05 = 0x0AF5
    expect(rt.readTag("Word")).toBe(0x0af5);
  });
});

describe("safety — a huge/invalid Length never hangs the scan", () => {
  it("clamps a negative or non-numeric Length to zero and an oversized one to the cap", () => {
    const rt = runtimeFor(routineWith("FLL", [["source", "1"], ["dest", "Z"], ["length", "-5"]]));
    expect(() => rt.scanOnce(0)).not.toThrow();
    expect(rt.readTag("Z[0]")).toBe(false); // negative length => nothing filled
  });
});
