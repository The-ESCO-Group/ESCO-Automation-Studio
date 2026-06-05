import { describe, expect, it } from "vitest";
import { createDefaultRegistry, supportLevel } from "./index";
import { PATT, PCLF, PCMD, PDET, POVR, PXRQ, PHASE_INSTRUCTIONS } from "./phase";
import type { InstructionDefinition } from "./types";

const registry = createDefaultRegistry();

describe("equipment phase (PhaseManager) instructions", () => {
  it("registers every PhaseManager instruction as model-only", () => {
    for (const def of PHASE_INSTRUCTIONS) {
      expect(registry.has(def.type)).toBe(true);
      expect(registry.get(def.type)?.modelOnly).toBe(true);
      expect(supportLevel(registry.get(def.type))).toBe("model-only");
      // Reuses the existing program-control category — no new palette category.
      expect(registry.get(def.type)?.category).toBe("program-control");
    }
  });

  it("covers the documented PhaseManager set", () => {
    const types = PHASE_INSTRUCTIONS.map((d) => d.type).sort();
    expect(types).toEqual(
      ["PATT", "PCLF", "PCMD", "PDET", "PFL", "POVR", "PPD", "PRNP", "PSC", "PXRQ"],
    );
  });

  it("never validates as an error and passes the rung condition through", () => {
    for (const def of PHASE_INSTRUCTIONS) {
      // Model-only operand validation is skipped, so nothing is ever flagged.
      expect(def.validate({ type: def.type, operands: [] } as never)).toEqual([]);
      expect(def.execute({ type: def.type, operands: [] } as never, { rungIn: true } as never)).toBe(true);
      expect(def.execute({ type: def.type, operands: [] } as never, { rungIn: false } as never)).toBe(false);
    }
  });

  // The external command / attach blocks own and update an equipment phase (or,
  // for PXRQ, a PHASE_INSTRUCTION control tag). They must declare that owned
  // object as a single write (destructive) review operand so it surfaces in tag
  // cross-reference, mirroring the motion / alarm / process families.
  describe("review operands on external command / attach blocks", () => {
    const PHASE_OBJECT_BLOCKS: InstructionDefinition[] = [PATT, PDET, PCMD, POVR, PCLF];

    it("declares the commanded EQUIPMENT_PHASE as a single write review operand", () => {
      for (const def of PHASE_OBJECT_BLOCKS) {
        const reg = registry.get(def.type);
        expect(reg?.operands, def.type).toHaveLength(1);
        expect(reg?.operands[0]).toMatchObject({
          name: "phase",
          label: "Equipment Phase",
          direction: "write",
          required: true,
          allowedTypes: ["EQUIPMENT_PHASE"],
        });
        // Review operand only — never a keyword/label or routine reference.
        expect(reg?.operands[0]?.isLabelRef).toBeUndefined();
        expect(reg?.operands[0]?.isRoutineRef).toBeUndefined();
      }
    });

    it("declares the owned PHASE_INSTRUCTION control tag as a write review operand on PXRQ", () => {
      const reg = registry.get(PXRQ.type);
      expect(reg?.operands).toHaveLength(1);
      expect(reg?.operands[0]).toMatchObject({
        name: "phaseInstruction",
        direction: "write",
        required: true,
        allowedTypes: ["PHASE_INSTRUCTION"],
      });
    });

    it("leaves the in-phase blocks (PSC/PPD/PRNP/PFL) without operands", () => {
      for (const type of ["PSC", "PPD", "PRNP", "PFL"]) {
        expect(registry.get(type)?.operands, type).toEqual([]);
      }
    });
  });
});
