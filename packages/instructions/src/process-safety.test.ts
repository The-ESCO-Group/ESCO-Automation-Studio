import { describe, expect, it } from "vitest";
import { STRUCTURED_TYPES, memberDefs } from "@esco/core";
import { createDefaultRegistry } from "./index";
import { PROCESS_INSTRUCTIONS } from "./process";
import { SAFETY_INSTRUCTIONS } from "./safety";
import { supportLevel, supportLevelLabel } from "./types";

const registry = createDefaultRegistry();

describe("process-control instructions", () => {
  it("registers every process instruction as model-only in the process category", () => {
    for (const def of PROCESS_INSTRUCTIONS) {
      const reg = registry.get(def.type);
      expect(reg).toBeDefined();
      expect(reg?.modelOnly).toBe(true);
      expect(reg?.category).toBe("process");
    }
  });

  it("declares display operands on PID/PIDE without making them executable", () => {
    const pid = registry.get("PID")!;
    expect(pid.operands[0]?.name).toBe("loop");
    expect(pid.operands.some((o) => o.label === "Process Variable")).toBe(true);
    // model-only means the executor is a pure pass-through (rung-in unchanged)
    const passed = pid.execute({ id: "n", instructionType: "PID", operands: [] }, {
      rungIn: true,
      deltaMs: 0,
      readBool: () => false,
      writeBool: () => {
        throw new Error("model-only PID must not write");
      },
      readNumber: () => 0,
      writeNumber: () => {
        throw new Error("model-only PID must not write");
      },
      numeric: () => 0,
    });
    expect(passed).toBe(true);
  });

  it("models PID / PIDE loop members as a data model for the Watch and validation", () => {
    expect(STRUCTURED_TYPES.PID).toBeDefined();
    expect(memberDefs("PID").map((m) => m.name)).toEqual(
      expect.arrayContaining(["SP", "PV", "OUT", "KP", "KI", "KD"]),
    );
    expect(memberDefs("PIDE").map((m) => m.name)).toEqual(
      expect.arrayContaining(["SP", "PV", "CV"]),
    );
  });
});

describe("safety instructions", () => {
  it("registers every safety instruction as model-only in the safety category", () => {
    for (const def of SAFETY_INSTRUCTIONS) {
      const reg = registry.get(def.type);
      expect(reg).toBeDefined();
      expect(reg?.modelOnly).toBe(true);
      expect(reg?.category).toBe("safety");
    }
  });

  it("never executes safety logic (strict pass-through, no tag writes)", () => {
    for (const def of SAFETY_INSTRUCTIONS) {
      const result = def.execute({ id: "n", instructionType: def.type, operands: [] }, {
        rungIn: false,
        deltaMs: 0,
        readBool: () => false,
        writeBool: () => {
          throw new Error(`${def.type} must not write`);
        },
        readNumber: () => 0,
        writeNumber: () => {
          throw new Error(`${def.type} must not write`);
        },
        numeric: () => 0,
      });
      expect(result).toBe(false); // returns rung-in unchanged
    }
  });
});

describe("supportLevel", () => {
  it("classifies executable / model-only / unknown and labels them", () => {
    expect(supportLevel(registry.get("XIC"))).toBe("executable");
    expect(supportLevel(registry.get("PID"))).toBe("model-only");
    expect(supportLevel(registry.get("ESTOP"))).toBe("model-only");
    expect(supportLevel(undefined)).toBe("unknown");
    expect(supportLevelLabel("executable")).toBe("Executable");
    expect(supportLevelLabel("model-only")).toBe("Model-only / preserved, not simulated");
    expect(supportLevelLabel("unknown")).toBe("Unknown unsupported");
  });
});
