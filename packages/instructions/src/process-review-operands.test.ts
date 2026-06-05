import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "./index";
import {
  HLL, LDLG, MUX, POSP, PMUL, RMPS, SCL, SOC, TOT, DEDT,
  DERV, INTG, HPF, LPF, NTCH, RLIM, SCRV, LDL2, PI,
} from "./process";
import type { InstructionDefinition } from "./types";

/**
 * The loop / signal-conditioning process blocks (SCL, TOT, RMPS, ...) are
 * model-only, but each is backed by a predefined process structure tag of its
 * own datatype that the block owns and updates. They must declare that backing
 * tag as a single write (destructive) **review operand** — mirroring the safety
 * blocks and PID/PIDE — so the owned tag surfaces in the property panel and as a
 * destructive reference in tag cross-reference, instead of being mis-classified
 * as a plain read. PID/PIDE keep their own richer operand sets (covered by
 * process-safety.test.ts) and are intentionally excluded here.
 */
const SIGNAL_CONDITIONING: InstructionDefinition[] = [
  SCL, TOT, RMPS, DEDT, LDLG, HLL, MUX, SOC, POSP, PMUL,
  // Drives & filters family — same backing-tag review-operand contract.
  DERV, INTG, HPF, LPF, NTCH, RLIM, SCRV, LDL2, PI,
];

describe("process signal-conditioning review operands", () => {
  const registry = createDefaultRegistry();

  it("declares a single backing-tag write review operand on each block", () => {
    for (const def of SIGNAL_CONDITIONING) {
      const reg = registry.get(def.type);
      expect(reg, def.type).toBeDefined();
      expect(reg?.operands).toHaveLength(1);
      expect(reg?.operands[0]).toMatchObject({
        name: "block",
        label: "Block Tag",
        direction: "write",
        required: true,
        allowedTypes: [def.type],
      });
      // Review operand only — never a keyword/label or routine reference.
      expect(reg?.operands[0]?.isLabelRef).toBeUndefined();
      expect(reg?.operands[0]?.isRoutineRef).toBeUndefined();
    }
  });

  it("stays model-only in the process category and never executes (pass-through)", () => {
    for (const def of SIGNAL_CONDITIONING) {
      const reg = registry.get(def.type);
      expect(reg?.modelOnly).toBe(true);
      expect(reg?.category).toBe("process");
      // Pass-through: rung-in returned unchanged, no tag memory touched.
      const mustNotWrite = () => {
        throw new Error(`model-only ${def.type} must not write`);
      };
      const result = reg?.execute(
        { id: "n", instructionType: def.type, operands: [{ name: "block", kind: "tag", value: `${def.type}_01` }] },
        {
          rungIn: true,
          deltaMs: 0,
          readBool: () => false,
          writeBool: mustNotWrite,
          readNumber: () => 0,
          writeNumber: mustNotWrite,
          readString: () => "",
          writeString: mustNotWrite,
          numeric: () => 0,
        },
      );
      expect(result).toBe(true);
    }
  });
});
