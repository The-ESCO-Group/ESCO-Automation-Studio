import { describe, expect, it } from "vitest";
import { STRUCTURED_TYPES, memberDefs } from "@esco/core";
import { createDefaultRegistry } from "./index";
import { PROCESS_INSTRUCTIONS, PROCESS_LIBRARY_INSTRUCTIONS } from "./process";
import { SAFETY_INSTRUCTIONS } from "./safety";
import { instructionFidelity, instructionFidelityLabel, supportLevel, supportLevelLabel } from "./types";

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
      readString: () => "",
      writeString: () => {
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

  it("models process block backing members for offline review", () => {
    for (const type of ["SCL", "TOT", "RMPS", "RLIM"]) {
      expect(STRUCTURED_TYPES[type], type).toBeDefined();
      expect(memberDefs(type).map((m) => m.name)).toEqual(
        expect.arrayContaining(["EnableIn", "EnableOut", "In", "Out", "Status", "Error"]),
      );
      expect(registry.get(type)?.operands[0]).toMatchObject({
        name: "block",
        allowedTypes: [type],
        direction: "write",
        validateOnModelOnly: true,
      });
    }
  });

  it("recognizes vendor process-library object calls as model-only preserved blocks", () => {
    expect(PROCESS_LIBRARY_INSTRUCTIONS.map((def) => def.type)).toEqual([
      "RAC_DVC_PF755",
      "RAC_OPR_PF755_ENERGY",
      "RAP_DVC_LGXCHANGEDET",
      "RAP_DVC_LGXCPU_5X80",
      "RAP_DVC_LGXREDUN",
      "RAP_DVC_LGXTASKMON",
      "RAP_OPR_EXTDDALM",
      "RAP_OPR_ORGSCAN",
      "RAP_OPR_ORGVIEW",
      "RAP_TEC_PARRPT",
    ]);

    for (const def of PROCESS_LIBRARY_INSTRUCTIONS) {
      const reg = registry.get(def.type)!;
      expect(reg.modelOnly).toBe(true);
      expect(reg.category).toBe("process");
      expect(reg.fidelity?.limitations).toEqual(
        expect.arrayContaining(["no controller communication or hardware side effects"]),
      );
      expect(reg.execute({ id: "n", instructionType: reg.type, operands: [] }, {
        rungIn: true,
        deltaMs: 0,
        readBool: () => false,
        writeBool: () => {
          throw new Error(`${reg.type} must not write`);
        },
        readNumber: () => 0,
        writeNumber: () => {
          throw new Error(`${reg.type} must not write`);
        },
        readString: () => "",
        writeString: () => {
          throw new Error(`${reg.type} must not write`);
        },
        numeric: () => 0,
      })).toBe(true);
    }
  });
});

describe("message-control data model", () => {
  it("models common MESSAGE members for Watch and validation while MSG remains model-only", () => {
    expect(STRUCTURED_TYPES.MESSAGE).toBeDefined();
    expect(memberDefs("MESSAGE").map((m) => m.name)).toEqual(
      expect.arrayContaining(["EN", "DN", "ER", "EW", "ST", "ERR", "EXERR", "Path", "RemoteElement"]),
    );
    expect(registry.get("MSG")?.modelOnly).toBe(true);
  });

  it("declares review operands for MSG/GSV/SSV without making them executable", () => {
    const msg = registry.get("MSG")!;
    expect(msg.operands[0]).toMatchObject({
      name: "message",
      label: "Message",
      allowedTypes: ["MESSAGE"],
      direction: "write",
    });

    const gsv = registry.get("GSV")!;
    expect(gsv.operands.slice(0, 3).every((operand) => operand.isLabelRef)).toBe(true);
    expect(gsv.operands[3]).toMatchObject({ name: "dest", label: "Dest", direction: "write" });

    const ssv = registry.get("SSV")!;
    expect(ssv.operands.slice(0, 3).every((operand) => operand.isLabelRef)).toBe(true);
    expect(ssv.operands[3]).toMatchObject({ name: "source", label: "Source", direction: "read" });
    expect(gsv.modelOnly).toBe(true);
    expect(ssv.modelOnly).toBe(true);
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

  it("registers both redundant-output blocks (ROUT and CROUT)", () => {
    for (const type of ["ROUT", "CROUT"]) {
      const reg = registry.get(type);
      expect(reg, `${type} should be registered`).toBeDefined();
      expect(reg?.modelOnly).toBe(true);
      expect(reg?.category).toBe("safety");
    }
  });

  it("declares a single backing-tag review operand on every safety block", () => {
    for (const def of SAFETY_INSTRUCTIONS) {
      const reg = registry.get(def.type)!;
      expect(reg.operands).toHaveLength(1);
      expect(reg.operands[0]).toMatchObject({
        name: "safety",
        label: "Safety Tag",
        required: true,
        allowedTypes: [def.type],
        direction: "write",
        validateOnModelOnly: true,
      });
      // Review operand only — it must not be treated as a routine/label/keyword ref.
      expect(reg.operands[0]?.isLabelRef).toBeUndefined();
      expect(reg.operands[0]?.isRoutineRef).toBeUndefined();
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
        readString: () => "",
        writeString: () => {
          throw new Error(`${def.type} must not write`);
        },
        numeric: () => 0,
      });
      expect(result).toBe(false); // returns rung-in unchanged
    }
  });

  it("models common safety backing members for offline review", () => {
    for (const type of ["ESTOP", "DCS", "DIN"]) {
      expect(STRUCTURED_TYPES[type], type).toBeDefined();
      expect(memberDefs(type).map((m) => m.name)).toEqual(
        expect.arrayContaining(["EnableIn", "EnableOut", "In1", "In2", "Out", "FaultPresent", "Status"]),
      );
    }
    for (const type of ["ROUT", "CROUT"]) {
      expect(STRUCTURED_TYPES[type], type).toBeDefined();
      expect(memberDefs(type).map((m) => m.name)).toEqual(
        expect.arrayContaining(["EnableIn", "EnableOut", "O1", "O2", "Feedback1", "Feedback2", "FaultPresent"]),
      );
    }
  });
});

describe("motion instructions", () => {
  const SINGLE_AXIS = [
    "MSO", "MSF", "MAM", "MAJ", "MAS", "MCD", "MDO", "MDAC", "MAH", "MHS", "MRP", "MRAT", "MATC",
    "MAFR", "MASD", "MASR", "MDW", "MDR",
  ];

  it("declares an axis + motion-control review pair on single-axis motion blocks", () => {
    for (const type of SINGLE_AXIS) {
      const def = registry.get(type)!;
      expect(def.modelOnly).toBe(true);
      expect(def.category).toBe("motion");
      expect(def.operands).toHaveLength(2);
      expect(def.operands[0]).toMatchObject({ name: "axis", label: "Axis", direction: "write" });
      expect(def.operands[1]).toMatchObject({ name: "motionControl", label: "Motion Control", direction: "write" });
      // Review operands only — never keyword/routine refs.
      expect(def.operands[0]?.isLabelRef).toBeUndefined();
      expect(def.operands[1]?.isRoutineRef).toBeUndefined();
    }
  });

  it("names the commanded object on coordinated / group / reordered motion blocks", () => {
    expect(registry.get("MCLM")?.operands[0]).toMatchObject({ name: "coordinateSystem", label: "Coordinate System" });
    expect(registry.get("MCLM")?.operands[1]).toMatchObject({ name: "motionControl" });
    expect(registry.get("MGS")?.operands[0]).toMatchObject({ name: "motionGroup", label: "Motion Group" });
    expect(registry.get("MAG")?.operands[0]).toMatchObject({ name: "slaveAxis", label: "Slave Axis" });
    // Reordered forms declare only their leading object — no assumed control index.
    expect(registry.get("MAG")?.operands).toHaveLength(1);
    expect(registry.get("MCT")?.operands).toHaveLength(1);
  });

  it("declares the coordinate-system / group control pair on the added shutdown family", () => {
    for (const type of ["MCCM", "MCSD", "MCS", "MCTP"]) {
      const def = registry.get(type)!;
      expect(def.modelOnly).toBe(true);
      expect(def.category).toBe("motion");
      expect(def.operands[0]).toMatchObject({ name: "coordinateSystem", label: "Coordinate System", direction: "write" });
      expect(def.operands[1]).toMatchObject({ name: "motionControl", direction: "write" });
    }
    for (const type of ["MGSD", "MGSR", "MGSP"]) {
      const def = registry.get(type)!;
      expect(def.category).toBe("motion");
      expect(def.operands[0]).toMatchObject({ name: "motionGroup", label: "Motion Group" });
      expect(def.operands[1]).toMatchObject({ name: "motionControl" });
    }
  });

  it("declares only the leading axis on the reordered arm/output-cam forms", () => {
    for (const type of ["MAW", "MAR", "MAOC", "MDOC"]) {
      const def = registry.get(type)!;
      expect(def.modelOnly).toBe(true);
      expect(def.category).toBe("motion");
      expect(def.operands).toHaveLength(1);
      expect(def.operands[0]).toMatchObject({ name: "axis", label: "Axis", direction: "write" });
    }
  });

  it("stays a strict pass-through despite declaring review operands (no tag writes)", () => {
    const def = registry.get("MAM")!;
    const result = def.execute({ id: "n", instructionType: "MAM", operands: [] }, {
      rungIn: true,
      deltaMs: 0,
      readBool: () => false,
      writeBool: () => {
        throw new Error("model-only motion must not write");
      },
      readNumber: () => 0,
      writeNumber: () => {
        throw new Error("model-only motion must not write");
      },
      readString: () => "",
      writeString: () => {
        throw new Error("model-only motion must not write");
      },
      numeric: () => 0,
    });
    expect(result).toBe(true); // rung-in passes through unchanged
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

describe("instruction fidelity metadata", () => {
  it("keeps legacy support levels while exposing finer simulation fidelity", () => {
    expect(instructionFidelity(registry.get("XIC")).status).toBe("executable-simulation");
    expect(instructionFidelity(registry.get("ARD")).status).toBe("executable-partial");
    expect(instructionFidelity(registry.get("TONR")).status).toBe("model-only");
    expect(instructionFidelity(undefined).status).toBe("unsupported");
    expect(instructionFidelityLabel("review-only")).toBe("Review-only");
  });

  it("marks PID/PIDE as model-only, not firmware-faithful process execution", () => {
    for (const type of ["PID", "PIDE"]) {
      const fidelity = instructionFidelity(registry.get(type));
      expect(fidelity.status, type).toBe("model-only");
      expect(fidelity.limitations?.join(" "), type).toMatch(/no firmware-faithful PID\/PIDE algorithm execution/);
      expect(fidelity.limitations?.join(" "), type).toMatch(/no process-variable sampling/);
      expect(fidelity.limitations?.join(" "), type).toMatch(/no control-variable output/);
    }
  });

  it("marks MSG/GSV/SSV as model-only without hardware communication or system-value transfer", () => {
    for (const type of ["MSG", "GSV", "SSV"]) {
      const fidelity = instructionFidelity(registry.get(type));
      expect(fidelity.status, type).toBe("model-only");
      expect(fidelity.limitations?.join(" "), type).toMatch(/no controller or hardware side effects/);
    }
  });

  it("marks motion, safety, PhaseManager, and SFC control blocks as review-only", () => {
    for (const type of ["MAM", "MCLM", "ESTOP", "PCMD", "SFR"]) {
      const fidelity = instructionFidelity(registry.get(type));
      expect(fidelity.status, type).toBe("review-only");
      expect(supportLevel(registry.get(type)), type).toBe("model-only");
    }
  });
});
