import { describe, expect, it } from "vitest";
import {
  createController,
  createProject,
  type AddOnInstruction,
  type PlcProject,
  type UserDefinedType,
} from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a project whose single controller carries the given UDTs and AOIs. */
function project(opts: { udts?: UserDefinedType[]; aois?: AddOnInstruction[] }): PlcProject {
  const proj = createProject("Cell");
  const controller = createController(proj.id, "Ctrl");
  for (const udt of opts.udts ?? []) controller.dataTypes.push(udt);
  for (const aoi of opts.aois ?? []) controller.addOnInstructions.push(aoi);
  proj.controllers.push(controller);
  return proj;
}

const reservedFindings = (proj: PlcProject) =>
  createDefaultEngine().run(proj).filter((f) => f.ruleId === "reserved-name");

const aoi = (name: string): AddOnInstruction => ({
  id: `aoi-${name}`,
  name,
  parameters: [{ name: "EnableIn", dataType: "BOOL", usage: "Input" }],
  localTags: [],
  routineNames: ["Logic"],
});

const udt = (name: string): UserDefinedType => ({
  id: `udt-${name}`,
  name,
  members: [{ name: "Value", dataType: "DINT" }],
});

describe("reserved-name", () => {
  it("flags an AOI that reuses a built-in instruction mnemonic", () => {
    const findings = reservedFindings(project({ aois: [aoi("TON")] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("built-in instruction TON");
    expect(findings[0].target).toBe("Ctrl/TON");
  });

  it("matches built-in instruction names case-insensitively", () => {
    const findings = reservedFindings(project({ aois: [aoi("Add")] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("built-in instruction ADD");
  });

  it("flags an AOI that reuses a predefined data type", () => {
    const findings = reservedFindings(project({ aois: [aoi("Timer")] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("predefined data type TIMER");
    expect(findings[0].target).toBe("Ctrl/Timer");
  });

  it("flags a UDT that reuses a predefined data type", () => {
    const findings = reservedFindings(project({ udts: [udt("DINT")] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("predefined data type DINT");
    expect(findings[0].target).toBe("Ctrl/DINT");
  });

  it("flags a UDT that reuses a predefined structured type", () => {
    const findings = reservedFindings(project({ udts: [udt("counter")] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("predefined data type COUNTER");
  });

  it("does not flag ordinary AOI and UDT names", () => {
    const findings = reservedFindings(
      project({ aois: [aoi("Scale")], udts: [udt("MotorUdt")] }),
    );
    expect(findings).toHaveLength(0);
  });
});
