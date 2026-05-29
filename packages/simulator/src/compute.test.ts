import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();

function runtimeWithCpt(dest: string, expression: string): PlcRuntime {
  const routine = createLadderRoutine();
  routine.rungs.push(
    createRung(routine.id, 0, [
      createNode("CPT", [
        tagOperand("dest", dest),
        tagOperand("expression", expression),
      ]),
    ]),
  );

  const runtime = new PlcRuntime(registry);
  runtime.loadRoutine(routine);
  return runtime;
}

describe("CPT - Compute", () => {
  it("computes literal arithmetic with operator precedence", () => {
    const runtime = runtimeWithCpt("Dest", "1 + 2 * 3 - 4 % 3");
    runtime.scanOnce(0);
    expect(runtime.readTag("Dest")).toBe(6);
  });

  it("computes radix literals and unary signs", () => {
    const runtime = runtimeWithCpt("Dest", "-16#10 + +2#1010 * (8#7 - 4)");
    runtime.scanOnce(0);
    expect(runtime.readTag("Dest")).toBe(14);
  });

  it("reads tags, array elements, members, and parentheses", () => {
    const runtime = runtimeWithCpt("Dest", "((A + B) * C[1]) - Motor.Speed");
    runtime.writeTag("A", 2);
    runtime.writeTag("B", 4);
    runtime.writeTag("C[1]", 5);
    runtime.writeTag("Motor.Speed", 10);

    runtime.scanOnce(0);

    expect(runtime.readTag("Dest")).toBe(20);
  });

  it("handles divide by zero deterministically without crashing", () => {
    const runtime = runtimeWithCpt("Dest", "10 / (A - A)");
    runtime.writeTag("A", 3);

    expect(() => runtime.scanOnce(0)).not.toThrow();
    expect(runtime.readTag("Dest")).toBe(0);
  });

  it("ignores unsafe expressions without overwriting the destination", () => {
    const runtime = runtimeWithCpt("Dest", "Math.max(A, 1)");
    runtime.writeTag("A", 3);
    runtime.writeTag("Dest", 42);

    expect(() => runtime.scanOnce(0)).not.toThrow();
    expect(runtime.readTag("Dest")).toBe(42);
  });

  it("does not write when rung-in is false", () => {
    const routine = createLadderRoutine();
    routine.rungs.push(
      createRung(routine.id, 0, [
        createNode("XIC", [tagOperand("tag", "Enable")]),
        createNode("CPT", [
          tagOperand("dest", "Dest"),
          tagOperand("expression", "A + 1"),
        ]),
      ]),
    );

    const runtime = new PlcRuntime(registry);
    runtime.loadRoutine(routine);
    runtime.writeTag("A", 3);
    runtime.writeTag("Dest", 42);

    runtime.scanOnce(0);

    expect(runtime.readTag("Dest")).toBe(42);
  });
});
