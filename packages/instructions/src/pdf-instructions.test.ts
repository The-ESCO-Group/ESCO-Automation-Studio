import { describe, expect, it } from "vitest";
import { memberDefs } from "@esco/core";
import { createNode, tagOperand } from "@esco/ladder";
import { createDefaultRegistry } from "./index";
import { instructionFidelity, supportLevel } from "./types";

const registry = createDefaultRegistry();

// Every instruction the PDF-coverage task asked for, split by how it is supported.
const EXECUTABLE = [
  "MOVE", "LIMIT",
  "EQ", "NE", "GT", "GE", "LT", "LE",
  "ACOS", "ASIN", "ATAN", "ATAN2", "EXPT", "TRUNC", "SQRT",
  "TO_BCD", "BCD_TO",
  "BAND", "BOR", "BXOR", "BNOT",
  "BTDT", "MVMT",
  "OSRI", "OSFI",
];
const MODEL_ONLY = [
  "TONR", "TOFR", "RTOR", "CTUD",
  "ASO", "BPT", "TPT", "LV", "JXR", "REF", "UNK",
];
const ALL_CANDIDATES = [...EXECUTABLE, ...MODEL_ONLY];

describe("PDF instruction coverage: registry", () => {
  it("registers every missing/high-priority candidate so imports do not flag them unsupported", () => {
    for (const type of ALL_CANDIDATES) {
      const def = registry.get(type);
      expect(def, `${type} should be registered`).toBeDefined();
      expect(registry.has(type)).toBe(true);
    }
  });

  it("builds the default registry without duplicate-type collisions", () => {
    expect(() => createDefaultRegistry()).not.toThrow();
  });

  it("classifies executable vs model-only support levels correctly", () => {
    for (const type of EXECUTABLE) {
      expect(supportLevel(registry.get(type)), `${type} executable`).toBe("executable");
      expect(registry.get(type)?.modelOnly).toBeUndefined();
    }
    for (const type of MODEL_ONLY) {
      expect(supportLevel(registry.get(type)), `${type} model-only`).toBe("model-only");
      expect(registry.get(type)?.modelOnly).toBe(true);
    }
  });

  it("models the documented FBD_ONESHOT public members for OSRI/OSFI", () => {
    expect(memberDefs("FBD_ONESHOT").map((member) => `${member.name}:${member.type}`)).toEqual([
      "EnableIn:BOOL",
      "InputBit:BOOL",
      "EnableOut:BOOL",
      "OutputBit:BOOL",
    ]);
    expect(instructionFidelity(registry.get("OSRI")).status).toBe("executable-partial");
    expect(instructionFidelity(registry.get("OSFI")).status).toBe("executable-partial");
  });
});

describe("PDF instruction coverage: compare aliases mirror their canonical box", () => {
  const ALIASES: [string, string][] = [
    ["EQ", "EQU"], ["NE", "NEQ"], ["GT", "GRT"], ["GE", "GEQ"], ["LT", "LES"], ["LE", "LEQ"],
  ];
  it("shares category, style, and operand shape with the canonical compare", () => {
    for (const [alias, canonical] of ALIASES) {
      const a = registry.get(alias)!;
      const c = registry.get(canonical)!;
      expect(a.category).toBe("compare");
      expect(a.category).toBe(c.category);
      expect(a.render.style).toBe(c.render.style);
      expect(a.operands.map((o) => o.name)).toEqual(c.operands.map((o) => o.name));
    }
  });
  it("requires both sources, like the canonical compare", () => {
    for (const [alias] of ALIASES) {
      const def = registry.get(alias)!;
      expect(def.validate(createNode(alias, []))).toEqual([
        "Operand 'sourceA' is required.",
        "Operand 'sourceB' is required.",
      ]);
      expect(
        def.validate(createNode(alias, [tagOperand("sourceA", "A"), tagOperand("sourceB", "B")])),
      ).toEqual([]);
    }
  });
});

describe("PDF instruction coverage: Studio export aliases mirror canonical boxes", () => {
  const ALIASES: [string, string][] = [
    ["MOVE", "MOV"],
    ["LIMIT", "LIM"],
  ];

  it("shares category, style, and operand shape with the canonical instruction", () => {
    for (const [alias, canonical] of ALIASES) {
      const a = registry.get(alias)!;
      const c = registry.get(canonical)!;
      expect(a.category).toBe(c.category);
      expect(a.render.style).toBe(c.render.style);
      expect(a.operands.map((o) => o.name)).toEqual(c.operands.map((o) => o.name));
      expect(a.render.symbol).toBe(alias);
    }
  });

  it("uses the canonical operand validation", () => {
    expect(registry.get("MOVE")!.validate(createNode("MOVE", []))).toEqual([
      "Operand 'source' is required.",
      "Operand 'dest' is required.",
    ]);
    expect(registry.get("LIMIT")!.validate(createNode("LIMIT", []))).toEqual([
      "Operand 'low' is required.",
      "Operand 'test' is required.",
      "Operand 'high' is required.",
    ]);
    expect(
      registry.get("MOVE")!.validate(createNode("MOVE", [tagOperand("source", "A"), tagOperand("dest", "B")])),
    ).toEqual([]);
    expect(
      registry.get("LIMIT")!.validate(
        createNode("LIMIT", [tagOperand("low", "Low"), tagOperand("test", "Test"), tagOperand("high", "High")]),
      ),
    ).toEqual([]);
  });
});

describe("PDF instruction coverage: math/trig/conversion validation", () => {
  it("requires Source and Dest on the unary math long names", () => {
    for (const type of ["ACOS", "ASIN", "ATAN", "TRUNC", "SQRT"]) {
      const def = registry.get(type)!;
      expect(def.category).toBe("math");
      expect(def.validate(createNode(type, []))).toEqual([
        "Operand 'source' is required.",
        "Operand 'dest' is required.",
      ]);
    }
  });
  it("requires both sources and Dest on the binary math names", () => {
    for (const type of ["ATAN2", "EXPT"]) {
      const def = registry.get(type)!;
      expect(def.validate(createNode(type, []))).toEqual([
        "Operand 'sourceA' is required.",
        "Operand 'sourceB' is required.",
        "Operand 'dest' is required.",
      ]);
    }
  });
  it("registers TO_BCD/BCD_TO as executable move-category conversions", () => {
    for (const type of ["TO_BCD", "BCD_TO"]) {
      const def = registry.get(type)!;
      expect(def.category).toBe("move");
      expect(supportLevel(def)).toBe("executable");
      expect(def.validate(createNode(type, []))).toEqual([
        "Operand 'source' is required.",
        "Operand 'dest' is required.",
      ]);
    }
  });
});

describe("PDF instruction coverage: Boolean logic validation", () => {
  it("requires two BOOL inputs and a Dest on BAND/BOR/BXOR", () => {
    for (const type of ["BAND", "BOR", "BXOR"]) {
      const def = registry.get(type)!;
      expect(def.category).toBe("bit");
      expect(def.operands.every((o) => o.allowedTypes?.includes("BOOL"))).toBe(true);
      expect(def.validate(createNode(type, []))).toEqual([
        "Operand 'in1' is required.",
        "Operand 'in2' is required.",
        "Operand 'dest' is required.",
      ]);
    }
  });
  it("requires Source and Dest on BNOT", () => {
    const def = registry.get("BNOT")!;
    expect(def.validate(createNode("BNOT", []))).toEqual([
      "Operand 'source' is required.",
      "Operand 'dest' is required.",
    ]);
  });
});

describe("PDF instruction coverage: model-only instructions are safe pass-throughs", () => {
  it("never report a validation error and pass rung power through unchanged", () => {
    for (const type of MODEL_ONLY) {
      const def = registry.get(type)!;
      // Model-only validate never errors, even with no operands.
      expect(def.validate(createNode(type, []))).toEqual([]);
      // A model-only execute is a pure pass-through that never touches tag memory.
      const touched: string[] = [];
      const ctx = {
        rungIn: true,
        deltaMs: 0,
        readBool: () => false,
        writeBool: (p: string) => touched.push(p),
        readNumber: () => 0,
        writeNumber: (p: string) => touched.push(p),
        readString: () => "",
        writeString: (p: string) => touched.push(p),
        numeric: () => 0,
      };
      expect(def.execute(createNode(type, []), ctx)).toBe(true);
      expect(ctx.rungIn && def.execute(createNode(type, []), { ...ctx, rungIn: false })).toBe(false);
      expect(touched, `${type} must not write tag memory`).toEqual([]);
    }
  });
});
