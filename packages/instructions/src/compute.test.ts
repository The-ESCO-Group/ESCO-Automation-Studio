import { describe, expect, it } from "vitest";
import { createNode, tagOperand } from "@esco/ladder";
import { createDefaultRegistry } from "./index";
import { supportLevel } from "./types";

const registry = createDefaultRegistry();

const cptNode = (dest: string, expression: string) =>
  createNode("CPT", [
    tagOperand("dest", dest),
    tagOperand("expression", expression),
  ]);

describe("CPT - Compute instruction metadata", () => {
  it("registers CPT as an executable math instruction", () => {
    const cpt = registry.get("CPT");
    expect(cpt).toBeDefined();
    expect(cpt?.category).toBe("math");
    expect(cpt?.modelOnly).toBeUndefined();
    expect(supportLevel(cpt)).toBe("executable");
  });

  it("validates required operands and safe arithmetic expressions", () => {
    const cpt = registry.get("CPT")!;
    expect(cpt.validate(cptNode("Dest", "(1 + 2) * -3"))).toEqual([]);
    expect(cpt.validate(cptNode("Dest", "16#10 + 2#1010 + Tank.Level[1]"))).toEqual([]);
    expect(cpt.validate(createNode("CPT", []))).toEqual([
      "Operand 'dest' is required.",
      "Operand 'expression' is required.",
    ]);
    expect(cpt.validate(cptNode("Dest", "Math.max(A, 1)"))).toContain(
      "Operand 'expression' must be a safe numeric expression.",
    );
    expect(cpt.validate(cptNode("Dest", "A + (1 *)"))).toContain(
      "Operand 'expression' must be a safe numeric expression.",
    );
    expect(cpt.validate(cptNode("Dest", "2#102"))).toContain(
      "Operand 'expression' must be a safe numeric expression.",
    );
  });
});

const cmpNode = (expression: string) =>
  createNode("CMP", [tagOperand("expression", expression)]);

describe("CMP - Compare instruction metadata", () => {
  it("registers CMP as an executable compare instruction", () => {
    const cmp = registry.get("CMP");
    expect(cmp).toBeDefined();
    expect(cmp?.category).toBe("compare");
    expect(cmp?.modelOnly).toBeUndefined();
    expect(supportLevel(cmp)).toBe("executable");
    expect(cmp?.render.style).toBe("function");
  });

  it("validates a required, syntactically valid comparison expression", () => {
    const cmp = registry.get("CMP")!;
    expect(cmp.validate(cmpNode("Level >= 100 AND Pump.DN"))).toEqual([]);
    expect(cmp.validate(cmpNode("ABS(A - B) < Tolerance"))).toEqual([]);
    expect(cmp.validate(createNode("CMP", []))).toEqual(["Operand 'expression' is required."]);
    expect(cmp.validate(cmpNode("Level >= "))).toContain(
      "Operand 'expression' must be a safe comparison expression.",
    );
    expect(cmp.validate(cmpNode("Math.max(A, 1)"))).toContain(
      "Operand 'expression' must be a safe comparison expression.",
    );
  });
});
