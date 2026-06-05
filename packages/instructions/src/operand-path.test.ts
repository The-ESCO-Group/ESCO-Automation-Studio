import { describe, expect, it } from "vitest";
import { parseOperandPath } from "./operand-path";

describe("parseOperandPath", () => {
  it("parses a simple tag", () => {
    const parsed = parseOperandPath("MotorStart");
    expect(parsed.kind).toBe("tag");
    expect(parsed.valid).toBe(true);
    expect(parsed.baseTag).toBe("MotorStart");
    expect(parsed.memberPath).toEqual([]);
    expect(parsed.indices).toEqual([]);
    expect(parsed.bitAccess).toBeUndefined();
  });

  it("parses a member path", () => {
    expect(parseOperandPath("Pump.RunCmd")).toMatchObject({
      kind: "tag",
      baseTag: "Pump",
      memberPath: ["RunCmd"],
    });
    expect(parseOperandPath("Timer1.DN").memberPath).toEqual(["DN"]);
    expect(parseOperandPath("Timer1.ACC").memberPath).toEqual(["ACC"]);
    expect(parseOperandPath("Counter1.CU").memberPath).toEqual(["CU"]);
  });

  it("parses single- and multi-dimension array indices", () => {
    expect(parseOperandPath("Array[0]")).toMatchObject({
      kind: "tag",
      baseTag: "Array",
      indices: [[0]],
    });
    expect(parseOperandPath("Array[1,2]")).toMatchObject({
      baseTag: "Array",
      indices: [[1, 2]],
    });
  });

  it("parses mixed array + member references", () => {
    expect(parseOperandPath("Tank[2].Level")).toMatchObject({
      baseTag: "Tank",
      indices: [[2]],
      memberPath: ["Level"],
    });
    expect(parseOperandPath("Recipe[2].Step[1]")).toMatchObject({
      baseTag: "Recipe",
      indices: [[2], [1]],
      memberPath: ["Step"],
    });
  });

  it("parses bit access", () => {
    expect(parseOperandPath("DINT_Tag.3")).toMatchObject({
      kind: "tag",
      baseTag: "DINT_Tag",
      bitAccess: 3,
    });
    // Bit access after an array index is valid and terminal.
    expect(parseOperandPath("Word[0].5")).toMatchObject({
      baseTag: "Word",
      indices: [[0]],
      bitAccess: 5,
    });
  });

  it("treats numeric and radix constants as literals, not tags", () => {
    expect(parseOperandPath("3000").kind).toBe("literal");
    expect(parseOperandPath("16#FF").kind).toBe("literal");
    expect(parseOperandPath("-1.5").kind).toBe("literal");
    expect(parseOperandPath("3000").baseTag).toBe("");
  });

  it("reports a blank operand as empty (valid, but no tag)", () => {
    expect(parseOperandPath("")).toMatchObject({ kind: "empty", valid: true, baseTag: "" });
    expect(parseOperandPath("   ").kind).toBe("empty");
  });

  it("allows indirect (tag) array indices", () => {
    const parsed = parseOperandPath("Buffer[Index]");
    expect(parsed.kind).toBe("tag");
    expect(parsed.valid).toBe(true);
    expect(parsed.hasIndirectIndex).toBe(true);
    expect(parsed.indices).toEqual([]);
  });

  it("flags invalid syntax with a reason", () => {
    expect(parseOperandPath("1Tag").valid).toBe(false);
    expect(parseOperandPath("Array[").valid).toBe(false);
    expect(parseOperandPath("Array[]").valid).toBe(false);
    expect(parseOperandPath("Array[1,]").valid).toBe(false);
    expect(parseOperandPath("Pump.").valid).toBe(false);
    expect(parseOperandPath("Tag-Name").valid).toBe(false);
    // A trailing part after bit access is malformed.
    expect(parseOperandPath("DINT_Tag.3.DN").valid).toBe(false);
    expect(parseOperandPath("Array[").error).toMatch(/Unbalanced/);
  });
});
