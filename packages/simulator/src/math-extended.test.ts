import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();

/** Build a runtime running a single unary math box: Dest = TYPE(Source). */
function unary(type: string, source: number): PlcRuntime {
  const routine = createLadderRoutine();
  routine.rungs.push(
    createRung(routine.id, 0, [
      createNode(type, [tagOperand("source", "Src"), tagOperand("dest", "Dest")]),
    ]),
  );
  const runtime = new PlcRuntime(registry);
  runtime.loadRoutine(routine);
  runtime.writeTag("Src", source);
  return runtime;
}

function runUnary(type: string, source: number): number {
  const runtime = unary(type, source);
  runtime.scanOnce(0);
  return runtime.readTag("Dest") as number;
}

describe("extended math — trigonometric (radians)", () => {
  it("computes sine, cosine, and tangent in radians", () => {
    expect(runUnary("SIN", 0)).toBeCloseTo(0, 10);
    expect(runUnary("SIN", Math.PI / 2)).toBeCloseTo(1, 10);
    expect(runUnary("COS", 0)).toBeCloseTo(1, 10);
    expect(runUnary("COS", Math.PI)).toBeCloseTo(-1, 10);
    expect(runUnary("TAN", Math.PI / 4)).toBeCloseTo(1, 10);
  });

  it("computes inverse trig with results in radians", () => {
    expect(runUnary("ASN", 1)).toBeCloseTo(Math.PI / 2, 10);
    expect(runUnary("ACS", 1)).toBeCloseTo(0, 10);
    expect(runUnary("ACS", 0)).toBeCloseTo(Math.PI / 2, 10);
    expect(runUnary("ATN", 1)).toBeCloseTo(Math.PI / 4, 10);
  });

  it("guards out-of-domain inverse trig to 0 (no NaN leaks into tag memory)", () => {
    expect(runUnary("ASN", 2)).toBe(0);
    expect(runUnary("ACS", -5)).toBe(0);
  });
});

describe("extended math — logarithms", () => {
  it("computes natural and base-10 logarithms", () => {
    expect(runUnary("LN", Math.E)).toBeCloseTo(1, 10);
    expect(runUnary("LN", 1)).toBeCloseTo(0, 10);
    expect(runUnary("LOG", 100)).toBeCloseTo(2, 10);
    expect(runUnary("LOG", 1)).toBeCloseTo(0, 10);
  });

  it("guards non-positive logarithm inputs to 0 (ln(0)=-Inf, ln(-1)=NaN)", () => {
    expect(runUnary("LN", 0)).toBe(0);
    expect(runUnary("LN", -1)).toBe(0);
    expect(runUnary("LOG", 0)).toBe(0);
  });
});

describe("extended math — angle conversion and truncation", () => {
  it("converts between radians and degrees", () => {
    expect(runUnary("DEG", Math.PI)).toBeCloseTo(180, 10);
    expect(runUnary("DEG", Math.PI / 2)).toBeCloseTo(90, 10);
    expect(runUnary("RAD", 180)).toBeCloseTo(Math.PI, 10);
    expect(runUnary("RAD", 90)).toBeCloseTo(Math.PI / 2, 10);
  });

  it("truncates toward zero", () => {
    expect(runUnary("TRN", 3.7)).toBe(3);
    expect(runUnary("TRN", -3.7)).toBe(-3);
    expect(runUnary("TRN", 5)).toBe(5);
  });
});

describe("extended math — XPY (X to the power Y)", () => {
  function xpy(x: number, y: number, enable = true): number {
    const routine = createLadderRoutine();
    routine.rungs.push(
      createRung(routine.id, 0, [
        createNode("XIC", [tagOperand("tag", "En")]),
        createNode("XPY", [
          tagOperand("sourceA", "X"),
          tagOperand("sourceB", "Y"),
          tagOperand("dest", "Dest"),
        ]),
      ]),
    );
    const runtime = new PlcRuntime(registry);
    runtime.loadRoutine(routine);
    runtime.writeTag("En", enable);
    runtime.writeTag("X", x);
    runtime.writeTag("Y", y);
    runtime.writeTag("Dest", -1);
    runtime.scanOnce(0);
    return runtime.readTag("Dest") as number;
  }

  it("raises a base to a power", () => {
    expect(xpy(2, 10)).toBe(1024);
    expect(xpy(9, 0.5)).toBeCloseTo(3, 10);
    expect(xpy(-2, 3)).toBe(-8); // negative base, integer exponent is well-defined
  });

  it("guards a non-finite power result to 0 (negative base, fractional exponent)", () => {
    expect(xpy(-2, 0.5)).toBe(0);
  });

  it("does not write Dest when the rung is false", () => {
    expect(xpy(2, 10, false)).toBe(-1);
  });
});
