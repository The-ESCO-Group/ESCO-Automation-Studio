import { describe, expect, it } from "vitest";
import { createDefaultRegistry, supportLevel } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();
const MODEL_ONLY = [
  "SQO", "SQI", "SQC", "BSL", "BSR", "FAL", "FSC",
  "MSG", "GSV", "SSV", "ALMA", "ALMD",
  "MSO", "MSF", "MAM", "MAJ", "MAS",
  // Process-control family (process.ts)
  "PID", "PIDE", "SCL", "TOT", "RMPS", "DEDT", "LDLG", "HLL", "MUX",
  // GuardLogix safety family (safety.ts)
  "ESTOP", "DCS", "DCSTL", "THRS", "LC", "SMAT", "RESET",
];

describe("advanced model-only instructions", () => {
  it("are all registered and flagged model-only", () => {
    for (const type of MODEL_ONLY) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.modelOnly).toBe(true);
    }
  });

  it("registers PID and PIDE as model-only (process-control depth)", () => {
    expect(registry.get("PID")?.modelOnly).toBe(true);
    expect(registry.get("PID")?.category).toBe("process");
    expect(registry.get("PIDE")?.modelOnly).toBe(true);
    // The canonical "unknown unsupported" example is the XUNKNOWN vendor token.
    expect(registry.has("XUNKNOWN")).toBe(false);
  });

  it("classifies support levels for executable / model-only / unknown", () => {
    expect(supportLevel(registry.get("XIC"))).toBe("executable");
    expect(supportLevel(registry.get("PID"))).toBe("model-only");
    expect(supportLevel(registry.get("ESTOP"))).toBe("model-only");
    expect(supportLevel(registry.get("XUNKNOWN"))).toBe("unknown");
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
