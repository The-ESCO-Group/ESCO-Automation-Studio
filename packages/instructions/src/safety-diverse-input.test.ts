import { describe, it, expect } from "vitest";
import { createDefaultRegistry } from "./index";
import { DIN, SAFETY_INSTRUCTIONS } from "./safety";

const registry = createDefaultRegistry();

/**
 * DIN (Diverse Input) is a GuardLogix safety application instruction that
 * monitors two diverse inputs (one normally-open, one normally-closed) which
 * must report opposite states. Like every safety block it is model-only:
 * preserved and displayed for review, never simulated. These checks lock its
 * registration so a real safety routine using DIN parses instead of being
 * flagged "unsupported".
 */
describe("DIN — Diverse Input safety instruction", () => {
  it("is exported and included in the bulk safety registration list", () => {
    expect(DIN.type).toBe("DIN");
    expect(SAFETY_INSTRUCTIONS).toContain(DIN);
  });

  it("is registered model-only in the safety category with a single backing-tag operand", () => {
    const reg = registry.get("DIN");
    expect(reg).toBeDefined();
    expect(reg?.modelOnly).toBe(true);
    expect(reg?.category).toBe("safety");
    expect(reg?.displayName).toBe("Diverse Input");
    expect(reg?.operands).toHaveLength(1);
    expect(reg?.operands[0]).toMatchObject({
      name: "safety",
      label: "Safety Tag",
      required: true,
      direction: "write",
    });
  });

  it("is a strict pass-through that never writes tag memory", () => {
    const ctx = {
      rungIn: true,
      deltaMs: 0,
      readBool: () => false,
      writeBool: () => {
        throw new Error("DIN must not write");
      },
      readNumber: () => 0,
      writeNumber: () => {
        throw new Error("DIN must not write");
      },
      readString: () => "",
      writeString: () => {
        throw new Error("DIN must not write");
      },
      numeric: () => 0,
    };
    expect(DIN.execute({ id: "n", instructionType: "DIN", operands: [] }, ctx)).toBe(true);
    ctx.rungIn = false;
    expect(DIN.execute({ id: "n", instructionType: "DIN", operands: [] }, ctx)).toBe(false);
  });
});
