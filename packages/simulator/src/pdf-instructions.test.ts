import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();

/** Build a single-rung runtime from a list of in-series instruction nodes. */
function runtimeWithRung(nodes: Parameters<typeof createRung>[2]): PlcRuntime {
  const routine = createLadderRoutine();
  routine.rungs.push(createRung(routine.id, 0, nodes));
  const runtime = new PlcRuntime(registry);
  runtime.loadRoutine(routine);
  return runtime;
}

const node = (type: string, ...operands: [string, string][]) =>
  createNode(type, operands.map(([name, value]) => tagOperand(name, value)));

describe("compare aliases simulate exactly like their canonical box", () => {
  // [alias, canonical, A, B, expected pass]
  const CASES: [string, string, number, number, boolean][] = [
    ["EQ", "EQU", 5, 5, true],
    ["EQ", "EQU", 5, 6, false],
    ["NE", "NEQ", 5, 6, true],
    ["GT", "GRT", 7, 3, true],
    ["GT", "GRT", 3, 7, false],
    ["GE", "GEQ", 5, 5, true],
    ["LT", "LES", 2, 9, true],
    ["LE", "LEQ", 9, 9, true],
    ["LE", "LEQ", 9, 8, false],
  ];

  for (const [alias, canonical, a, b, expected] of CASES) {
    it(`${alias}(${a}, ${b}) == ${canonical}(...) -> ${expected}`, () => {
      for (const type of [alias, canonical]) {
        const runtime = runtimeWithRung([
          node(type, ["sourceA", "A"], ["sourceB", "B"]),
          node("OTE", ["tag", "Out"]),
        ]);
        runtime.writeTag("A", a);
        runtime.writeTag("B", b);
        runtime.scanOnce(0);
        expect(runtime.readTag("Out"), `${type}(${a},${b})`).toBe(expected);
      }
    });
  }
});

describe("Studio export aliases simulate like their canonical boxes", () => {
  it("MOVE writes Dest exactly like MOV", () => {
    for (const type of ["MOVE", "MOV"]) {
      const runtime = runtimeWithRung([node(type, ["source", "Src"], ["dest", "Dest"])]);
      runtime.writeTag("Src", 42);
      runtime.scanOnce(0);
      expect(runtime.readTag("Dest"), type).toBe(42);
    }
  });

  it("LIMIT gates rung power exactly like LIM", () => {
    for (const type of ["LIMIT", "LIM"]) {
      const runtime = runtimeWithRung([
        node(type, ["low", "0"], ["test", "Value"], ["high", "10"]),
        node("OTE", ["tag", "InRange"]),
      ]);
      runtime.writeTag("Value", 7);
      runtime.scanOnce(0);
      expect(runtime.readTag("InRange"), `${type} in range`).toBe(true);
      runtime.writeTag("Value", 17);
      runtime.scanOnce(0);
      expect(runtime.readTag("InRange"), `${type} out of range`).toBe(false);
    }
  });
});

describe("math/trig long names produce exact deterministic results", () => {
  const unary = (type: string, src: number, dest = "Dest") => {
    const runtime = runtimeWithRung([node(type, ["source", "Src"], ["dest", dest])]);
    runtime.writeTag("Src", src);
    runtime.scanOnce(0);
    return runtime.readTag(dest) as number;
  };
  const binary = (type: string, a: number, b: number) => {
    const runtime = runtimeWithRung([node(type, ["sourceA", "A"], ["sourceB", "B"], ["dest", "Dest"])]);
    runtime.writeTag("A", a);
    runtime.writeTag("B", b);
    runtime.scanOnce(0);
    return runtime.readTag("Dest") as number;
  };

  it("ACOS/ASIN/ATAN compute radians like the canonical ACS/ASN/ATN", () => {
    expect(unary("ACOS", 1)).toBeCloseTo(0, 10);
    expect(unary("ACOS", 0)).toBeCloseTo(Math.PI / 2, 10);
    expect(unary("ASIN", 1)).toBeCloseTo(Math.PI / 2, 10);
    expect(unary("ATAN", 1)).toBeCloseTo(Math.PI / 4, 10);
  });

  it("guards out-of-domain inverse trig to 0 (offline safe, no fault word)", () => {
    expect(unary("ACOS", 2)).toBe(0);
    expect(unary("ASIN", -2)).toBe(0);
  });

  it("ATAN2 is four-quadrant arc tangent of (Y, X)", () => {
    expect(binary("ATAN2", 1, 1)).toBeCloseTo(Math.PI / 4, 10);
    expect(binary("ATAN2", 1, 0)).toBeCloseTo(Math.PI / 2, 10);
    expect(binary("ATAN2", 0, -1)).toBeCloseTo(Math.PI, 10);
  });

  it("EXPT raises X to the power Y", () => {
    expect(binary("EXPT", 2, 10)).toBe(1024);
    expect(binary("EXPT", 9, 0.5)).toBeCloseTo(3, 10);
  });

  it("TRUNC removes the fractional part toward zero", () => {
    expect(unary("TRUNC", 3.9)).toBe(3);
    expect(unary("TRUNC", -3.9)).toBe(-3);
  });

  it("SQRT computes the root and guards a negative source to 0", () => {
    expect(unary("SQRT", 9)).toBe(3);
    expect(unary("SQRT", 2)).toBeCloseTo(Math.SQRT2, 10);
    expect(unary("SQRT", -4)).toBe(0);
  });
});

describe("BCD conversion long names round-trip", () => {
  const convert = (type: string, src: number) => {
    const runtime = runtimeWithRung([node(type, ["source", "Src"], ["dest", "Dest"])]);
    runtime.writeTag("Src", src);
    runtime.scanOnce(0);
    return runtime.readTag("Dest") as number;
  };
  it("TO_BCD encodes decimal digits to packed BCD (like TOD)", () => {
    expect(convert("TO_BCD", 123)).toBe(0x123);
    expect(convert("TO_BCD", 9)).toBe(0x9);
  });
  it("BCD_TO decodes packed BCD back to an integer (like FRD)", () => {
    expect(convert("BCD_TO", 0x123)).toBe(123);
    expect(convert("TO_BCD", convert("BCD_TO", 0x250))).toBe(0x250);
  });
});

describe("Boolean logic instructions simulate exactly", () => {
  const evalBin = (type: string, a: boolean, b: boolean) => {
    const runtime = runtimeWithRung([node(type, ["in1", "A"], ["in2", "B"], ["dest", "Dest"])]);
    runtime.writeTag("A", a);
    runtime.writeTag("B", b);
    runtime.scanOnce(0);
    return runtime.readTag("Dest");
  };
  it("BAND is logical AND", () => {
    expect(evalBin("BAND", true, true)).toBe(true);
    expect(evalBin("BAND", true, false)).toBe(false);
  });
  it("BOR is logical OR", () => {
    expect(evalBin("BOR", false, true)).toBe(true);
    expect(evalBin("BOR", false, false)).toBe(false);
  });
  it("BXOR is logical exclusive OR", () => {
    expect(evalBin("BXOR", true, true)).toBe(false);
    expect(evalBin("BXOR", true, false)).toBe(true);
  });
  it("BNOT is logical complement", () => {
    const runtime = runtimeWithRung([node("BNOT", ["source", "A"], ["dest", "Dest"])]);
    runtime.writeTag("A", true);
    runtime.scanOnce(0);
    expect(runtime.readTag("Dest")).toBe(false);
  });
});

describe("model-only extended instructions pass through without corrupting simulation", () => {
  it("a model-only timer conducts rung power but leaves its structure untouched", () => {
    // XIC(In) -> TONR(T,1000) -> OTE(Out): the model-only timer must pass power
    // (Out follows In) yet never accumulate. Seed T.ACC/T.DN so an accidental
    // write would be observable, then prove they are unchanged after two scans.
    const runtime = runtimeWithRung([
      node("XIC", ["tag", "In"]),
      node("TONR", ["timer", "T"], ["preset", "1000"]),
      node("OTE", ["tag", "Out"]),
    ]);
    runtime.writeTag("In", true);
    runtime.writeTag("T.ACC", 42);
    runtime.writeTag("T.DN", true);
    runtime.scanOnce(10);
    runtime.scanOnce(10);
    expect(runtime.readTag("Out")).toBe(true); // power conducted through the model-only box
    expect(runtime.readTag("T.ACC")).toBe(42); // never simulated / unchanged
    expect(runtime.readTag("T.DN")).toBe(true); // unchanged
  });

  it("a model-only CTUD never changes the counter accumulator", () => {
    const runtime = runtimeWithRung([
      node("XIC", ["tag", "In"]),
      node("CTUD", ["counter", "C"], ["preset", "5"]),
    ]);
    runtime.writeTag("In", true);
    runtime.writeTag("C.ACC", 7);
    runtime.scanOnce(0);
    runtime.scanOnce(0);
    expect(runtime.readTag("C.ACC")).toBe(7);
  });

  it("model-only system/debug instructions are pure pass-throughs", () => {
    for (const type of ["REF", "BPT", "JXR", "UNK"]) {
      const runtime = runtimeWithRung([
        node("XIC", ["tag", "In"]),
        node(type),
        node("OTE", ["tag", "Out"]),
      ]);
      runtime.writeTag("In", true);
      runtime.scanOnce(0);
      expect(runtime.readTag("Out"), `${type} should conduct power`).toBe(true);
      runtime.writeTag("In", false);
      runtime.scanOnce(0);
      expect(runtime.readTag("Out"), `${type} should drop power`).toBe(false);
    }
  });
});
