import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();

/** Rung: CMP(expression) drives OTE(Out). */
function cmpRuntime(expression: string): PlcRuntime {
  const routine = createLadderRoutine();
  routine.rungs.push(
    createRung(routine.id, 0, [
      createNode("CMP", [tagOperand("expression", expression)]),
      createNode("OTE", [tagOperand("tag", "Out")]),
    ]),
  );
  const runtime = new PlcRuntime(registry);
  runtime.loadRoutine(routine);
  return runtime;
}

describe("CMP - Compare (execution)", () => {
  it("energizes the output when the comparison is true", () => {
    const runtime = cmpRuntime("Level >= 100");
    runtime.writeTag("Level", 120);
    runtime.scanOnce(0);
    expect(runtime.readTag("Out")).toBe(true);
  });

  it("de-energizes the output when the comparison is false", () => {
    const runtime = cmpRuntime("Level >= 100");
    runtime.writeTag("Level", 50);
    runtime.scanOnce(0);
    expect(runtime.readTag("Out")).toBe(false);
  });

  it("evaluates combined relational + logical expressions", () => {
    const runtime = cmpRuntime("Level >= 100 AND Temp < 80");
    runtime.writeTag("Level", 120);
    runtime.writeTag("Temp", 70);
    runtime.scanOnce(0);
    expect(runtime.readTag("Out")).toBe(true);

    runtime.writeTag("Temp", 90);
    runtime.scanOnce(0);
    expect(runtime.readTag("Out")).toBe(false);
  });

  it("reacts to live tag changes across scans", () => {
    const runtime = cmpRuntime("Count = 3");
    runtime.writeTag("Count", 2);
    runtime.scanOnce(0);
    expect(runtime.readTag("Out")).toBe(false);
    runtime.writeTag("Count", 3);
    runtime.scanOnce(0);
    expect(runtime.readTag("Out")).toBe(true);
  });

  it("treats a non-finite domain result as false (e.g. LN(0) > 0)", () => {
    const runtime = cmpRuntime("LN(X) > 0");
    runtime.writeTag("X", 0); // LN(0) = -Infinity → false
    expect(() => runtime.scanOnce(0)).not.toThrow();
    expect(runtime.readTag("Out")).toBe(false);
  });

  it("treats a malformed expression as false without crashing", () => {
    const runtime = cmpRuntime("Math.max(A, 1)");
    expect(() => runtime.scanOnce(0)).not.toThrow();
    expect(runtime.readTag("Out")).toBe(false);
  });
});
