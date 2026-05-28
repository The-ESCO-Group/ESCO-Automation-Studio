import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();
const MODEL_ONLY = [
  "SQO", "SQI", "SQC", "BSL", "BSR", "FAL", "FSC",
  "MSG", "GSV", "SSV", "ALMA", "ALMD",
  "MSO", "MSF", "MAM", "MAJ", "MAS",
];

describe("advanced model-only instructions", () => {
  it("are all registered and flagged model-only", () => {
    for (const type of MODEL_ONLY) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.modelOnly).toBe(true);
    }
  });

  it("leaves PID and PIDE unregistered (deferred — see advanced.ts note)", () => {
    expect(registry.has("PID")).toBe(false);
    expect(registry.has("PIDE")).toBe(false);
  });

  it("passes the rung condition through and never alters tag memory or hangs", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "Enable")]),
        createNode("MSG", [tagOperand("op0", "MsgCtl")]),
        createNode("OTE", [tagOperand("operand", "Done")]),
      ]),
    );
    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);
    rt.writeTag("Enable", true);
    expect(() => rt.scanOnce(0)).not.toThrow();
    expect(rt.readTag("Done")).toBe(true); // MSG is a pass-through: condition reaches OTE
  });
});
