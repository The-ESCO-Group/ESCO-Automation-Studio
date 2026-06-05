import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand, type LadderRoutine } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

/**
 * Offline-simulation coverage for the basic executable scalar families that the
 * dedicated suites (compute / cmp / math-extended) do not pin directly: the core
 * two-source math boxes ADD/SUB/MUL/DIV (from math.ts) and the six relational
 * comparators EQU/NEQ/GRT/LES/LEQ/GEQ (from move-compare.ts).
 *
 * These lock the deliberate offline conventions — divide-by-zero is guarded to 0
 * rather than faulting, a math box leaves its Dest untouched on a false rung, and
 * each comparator gates rung continuation deterministically (observed through a
 * trailing OTE coil) — so a regression in any of them is caught here.
 */

const registry = createDefaultRegistry();

function runtimeFor(routine: LadderRoutine): PlcRuntime {
  const runtime = new PlcRuntime(registry);
  runtime.loadRoutine(routine);
  return runtime;
}

/** One unconditional rung holding a single instruction (rung-in is true). */
function singleBox(type: string, operands: [string, string][]): LadderRoutine {
  const routine = createLadderRoutine();
  routine.rungs.push(
    createRung(routine.id, 0, [createNode(type, operands.map(([n, v]) => tagOperand(n, v)))]),
  );
  return routine;
}

/** Build a math box runtime: Dest = A <op> B on a true rung. */
function mathRuntime(type: string, a: number, b: number): PlcRuntime {
  const runtime = runtimeFor(
    singleBox(type, [["sourceA", "A"], ["sourceB", "B"], ["dest", "Dest"]]),
  );
  runtime.writeTag("A", a);
  runtime.writeTag("B", b);
  return runtime;
}

describe("basic math boxes (ADD/SUB/MUL/DIV)", () => {
  it("computes each arithmetic operation into Dest", () => {
    const cases: Array<[string, number, number, number]> = [
      ["ADD", 7, 5, 12],
      ["SUB", 7, 5, 2],
      ["MUL", 7, 5, 35],
      ["DIV", 20, 5, 4],
    ];
    for (const [type, a, b, expected] of cases) {
      const runtime = mathRuntime(type, a, b);
      runtime.scanOnce(0);
      expect(runtime.readTag("Dest")).toBe(expected);
    }
  });

  it("guards divide-by-zero to 0 without crashing the scan", () => {
    const runtime = mathRuntime("DIV", 10, 0);
    expect(() => runtime.scanOnce(0)).not.toThrow();
    expect(runtime.readTag("Dest")).toBe(0);
  });

  it("leaves Dest untouched when the rung is false", () => {
    const routine = createLadderRoutine();
    routine.rungs.push(
      createRung(routine.id, 0, [
        createNode("XIC", [tagOperand("tag", "Enable")]),
        createNode("ADD", [tagOperand("sourceA", "A"), tagOperand("sourceB", "B"), tagOperand("dest", "Dest")]),
      ]),
    );
    const runtime = runtimeFor(routine);
    runtime.writeTag("Enable", false);
    runtime.writeTag("A", 3);
    runtime.writeTag("B", 4);
    runtime.writeTag("Dest", 99);

    runtime.scanOnce(0);

    expect(runtime.readTag("Dest")).toBe(99);
  });
});

describe("relational comparators (EQU/NEQ/GRT/LES/LEQ/GEQ)", () => {
  /** Compare gates a trailing OTE coil; returns the coil state for A <cmp> B. */
  function compareGatesCoil(type: string, a: number, b: number): boolean {
    const routine = createLadderRoutine();
    routine.rungs.push(
      createRung(routine.id, 0, [
        createNode(type, [tagOperand("sourceA", "A"), tagOperand("sourceB", "B")]),
        createNode("OTE", [tagOperand("tag", "Coil")]),
      ]),
    );
    const runtime = runtimeFor(routine);
    runtime.writeTag("A", a);
    runtime.writeTag("B", b);
    runtime.scanOnce(0);
    return runtime.readTag("Coil") === true;
  }

  it("passes the rung exactly when the relation holds", () => {
    // [type, A, B, expected pass]
    const cases: Array<[string, number, number, boolean]> = [
      ["EQU", 5, 5, true], ["EQU", 5, 6, false],
      ["NEQ", 5, 6, true], ["NEQ", 5, 5, false],
      ["GRT", 6, 5, true], ["GRT", 5, 5, false],
      ["LES", 5, 6, true], ["LES", 5, 5, false],
      ["LEQ", 5, 5, true], ["LEQ", 6, 5, false],
      ["GEQ", 5, 5, true], ["GEQ", 4, 5, false],
    ];
    for (const [type, a, b, expected] of cases) {
      expect(compareGatesCoil(type, a, b)).toBe(expected);
    }
  });
});
