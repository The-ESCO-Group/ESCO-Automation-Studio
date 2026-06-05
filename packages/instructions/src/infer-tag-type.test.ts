import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "./index";
import { inferOperandTagType } from "./infer-tag-type";

const registry = createDefaultRegistry();

describe("inferOperandTagType", () => {
  it("infers BOOL for bit-instruction operands", () => {
    for (const type of ["XIC", "XIO", "OTE", "OTL", "OTU"]) {
      expect(inferOperandTagType(type, 0, registry)).toBe("BOOL");
    }
  });

  it("infers TIMER for the timer operand of TON/TOF/RTO", () => {
    expect(inferOperandTagType("TON", 0, registry)).toBe("TIMER");
    expect(inferOperandTagType("TOF", 0, registry)).toBe("TIMER");
    expect(inferOperandTagType("RTO", 0, registry)).toBe("TIMER");
  });

  it("infers COUNTER for the counter operand of CTU/CTD", () => {
    expect(inferOperandTagType("CTU", 0, registry)).toBe("COUNTER");
    expect(inferOperandTagType("CTD", 0, registry)).toBe("COUNTER");
  });

  it("is case-insensitive on the mnemonic", () => {
    expect(inferOperandTagType("xic", 0, registry)).toBe("BOOL");
  });

  it("returns undefined when the operand accepts several types or is unknown", () => {
    // A non-existent operand index.
    expect(inferOperandTagType("XIC", 5, registry)).toBeUndefined();
    // An unregistered instruction.
    expect(inferOperandTagType("ZZZ", 0, registry)).toBeUndefined();
  });
});
