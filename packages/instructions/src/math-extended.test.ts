import { describe, expect, it } from "vitest";
import { createNode, tagOperand } from "@esco/ladder";
import { createDefaultRegistry } from "./index";
import { supportLevel } from "./types";

const registry = createDefaultRegistry();

const UNARY = ["SIN", "COS", "TAN", "ASN", "ACS", "ATN", "LN", "LOG", "DEG", "RAD", "TRN"];

describe("extended math instruction metadata", () => {
  it("registers every extended-math instruction as executable (not model-only)", () => {
    for (const type of [...UNARY, "XPY"]) {
      const def = registry.get(type);
      expect(def, `${type} should be registered`).toBeDefined();
      expect(def?.category).toBe("math");
      expect(def?.modelOnly).toBeUndefined();
      expect(supportLevel(def)).toBe("executable");
      expect(def?.render.style).toBe("box");
    }
  });

  it("requires Source and Dest on unary math boxes", () => {
    for (const type of UNARY) {
      const def = registry.get(type)!;
      expect(def.validate(createNode(type, []))).toEqual([
        "Operand 'source' is required.",
        "Operand 'dest' is required.",
      ]);
      expect(def.validate(createNode(type, [tagOperand("source", "Src"), tagOperand("dest", "Dest")]))).toEqual([]);
    }
  });

  it("requires both sources and Dest on XPY", () => {
    const xpy = registry.get("XPY")!;
    expect(xpy.validate(createNode("XPY", []))).toEqual([
      "Operand 'sourceA' is required.",
      "Operand 'sourceB' is required.",
      "Operand 'dest' is required.",
    ]);
    expect(
      xpy.validate(
        createNode("XPY", [
          tagOperand("sourceA", "X"),
          tagOperand("sourceB", "Y"),
          tagOperand("dest", "Dest"),
        ]),
      ),
    ).toEqual([]);
  });
});
