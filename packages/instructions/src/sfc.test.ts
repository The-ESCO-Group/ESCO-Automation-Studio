import { describe, expect, it } from "vitest";
import { createDefaultRegistry, supportLevel } from "./index";
import { SFC_INSTRUCTIONS, SFP, SFR } from "./sfc";

const registry = createDefaultRegistry();

describe("Sequential Function Chart (SFC) control instructions", () => {
  it("registers every SFC control instruction as model-only program-control", () => {
    for (const def of SFC_INSTRUCTIONS) {
      expect(registry.has(def.type)).toBe(true);
      expect(registry.get(def.type)?.modelOnly).toBe(true);
      expect(supportLevel(registry.get(def.type))).toBe("model-only");
      // Reuses the existing program-control category — no new palette category.
      expect(registry.get(def.type)?.category).toBe("program-control");
    }
  });

  it("covers the SFC reset / pause / end-of-transition set", () => {
    expect(SFC_INSTRUCTIONS.map((d) => d.type).sort()).toEqual(["EOT", "SFP", "SFR"]);
  });

  it("declares the controlled SFC routine as a routine reference (like JSR) on SFR and SFP", () => {
    for (const def of [SFR, SFP]) {
      const operand = registry.get(def.type)?.operands[0];
      expect(operand, def.type).toMatchObject({
        name: "sfcRoutine",
        label: "SFC Routine",
        required: true,
        isRoutineRef: true,
      });
      // A routine reference, never a tag write — it must not surface as a
      // destructive tag reference in cross-reference.
      expect(operand?.direction).toBe("read");
      expect(operand?.allowedTypes).toBeUndefined();
    }
  });

  it("leaves EOT a bare pass-through with no declared operands", () => {
    expect(registry.get("EOT")?.operands).toEqual([]);
  });

  it("never validates as an error and passes the rung condition through unchanged", () => {
    const mustNotWrite = () => {
      throw new Error("model-only SFC instruction must not write tag memory");
    };
    for (const def of SFC_INSTRUCTIONS) {
      const reg = registry.get(def.type)!;
      // Model-only operand validation is skipped, so nothing is ever flagged.
      expect(reg.validate({ type: def.type, operands: [] } as never)).toEqual([]);
      const ctx = {
        rungIn: true,
        deltaMs: 0,
        readBool: () => false,
        writeBool: mustNotWrite,
        readNumber: () => 0,
        writeNumber: mustNotWrite,
        readString: () => "",
        writeString: mustNotWrite,
        numeric: () => 0,
      };
      expect(reg.execute({ id: "n", instructionType: def.type, operands: [] } as never, ctx as never)).toBe(true);
      expect(reg.execute({ id: "n", instructionType: def.type, operands: [] } as never, { ...ctx, rungIn: false } as never)).toBe(false);
    }
  });
});
