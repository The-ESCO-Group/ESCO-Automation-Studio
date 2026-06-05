import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand, type LadderRoutine } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();

/** Build a one-rung routine whose single instruction sees an unconditionally true rung. */
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

describe("DCD / ENC instructions are registered", () => {
  it("registers DCD and ENC so they parse, validate, and simulate (not 'unsupported')", () => {
    for (const type of ["DCD", "ENC"]) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.modelOnly).toBeUndefined();
    }
  });
});

describe("DCD — decode 4 to 1 of 16", () => {
  it("turns on the single bit selected by the low 4 bits of Source", () => {
    const rt = runtimeFor(routineWith("DCD", [["source", "Sel"], ["dest", "Word"]]));
    for (const [sel, expected] of [
      [0, 1], // bit 0
      [3, 1 << 3], // 8
      [15, 1 << 15], // 32768 — highest of the 16 bits
    ] as const) {
      rt.writeTag("Sel", sel);
      rt.scanOnce(0);
      expect(rt.readTag("Word")).toBe(expected);
    }
  });

  it("uses only the low 4 bits of Source (ignores higher bits)", () => {
    const rt = runtimeFor(routineWith("DCD", [["source", "Sel"], ["dest", "Word"]]));
    rt.writeTag("Sel", 0x12); // low nibble = 2
    rt.scanOnce(0);
    expect(rt.readTag("Word")).toBe(1 << 2);
  });
});

describe("ENC — encode 1 of 16 to 4", () => {
  it("writes the position of the lowest set bit", () => {
    const rt = runtimeFor(routineWith("ENC", [["source", "Word"], ["dest", "Pos"]]));
    for (const [word, expected] of [
      [1 << 0, 0],
      [1 << 7, 7],
      [1 << 15, 15],
    ] as const) {
      rt.writeTag("Word", word);
      rt.scanOnce(0);
      expect(rt.readTag("Pos")).toBe(expected);
    }
  });

  it("encodes the lowest set bit when several are set", () => {
    const rt = runtimeFor(routineWith("ENC", [["source", "Word"], ["dest", "Pos"]]));
    rt.writeTag("Word", (1 << 4) | (1 << 9)); // lowest is bit 4
    rt.scanOnce(0);
    expect(rt.readTag("Pos")).toBe(4);
  });

  it("guards Dest to 0 when no bit is set (no offline fault word)", () => {
    const rt = runtimeFor(routineWith("ENC", [["source", "Word"], ["dest", "Pos"]]));
    rt.writeTag("Word", 0);
    rt.scanOnce(0);
    expect(rt.readTag("Pos")).toBe(0);
  });

  it("is the inverse of DCD across the 16 positions", () => {
    const rt = runtimeFor(routineWith("DCD", [["source", "Sel"], ["dest", "Word"]]));
    const back = runtimeFor(routineWith("ENC", [["source", "Word"], ["dest", "Pos"]]));
    for (let n = 0; n < 16; n += 1) {
      rt.writeTag("Sel", n);
      rt.scanOnce(0);
      back.writeTag("Word", rt.readTag("Word") as number);
      back.scanOnce(0);
      expect(back.readTag("Pos")).toBe(n);
    }
  });
});

describe("DCD / ENC respect the rung condition", () => {
  it("does not write Dest when the rung is false", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "Enable")]),
        createNode("DCD", [tagOperand("source", "Sel"), tagOperand("dest", "Word")]),
      ]),
    );
    const rt = runtimeFor(ladder);
    rt.writeTag("Sel", 5);
    rt.scanOnce(0); // Enable false
    expect(rt.readTag("Word")).toBe(false); // untouched
    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Word")).toBe(1 << 5);
  });
});
