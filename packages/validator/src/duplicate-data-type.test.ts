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

const duplicateFindings = (proj: PlcProject) =>
  createDefaultEngine().run(proj).filter((f) => f.ruleId === "duplicate-data-type-name");

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

describe("duplicate-data-type-name", () => {
  it("flags two UDTs that share a name", () => {
    const findings = duplicateFindings(project({ udts: [udt("MotorUdt"), udt("MotorUdt")] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('more than one data type named "MotorUdt"');
    expect(findings[0].target).toBe("Ctrl/MotorUdt");
  });

  it("flags two AOIs that share a name", () => {
    const findings = duplicateFindings(project({ aois: [aoi("Scale"), aoi("Scale")] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('more than one Add-On Instruction named "Scale"');
  });

  it("flags a UDT and an AOI that share the one data-type namespace", () => {
    const findings = duplicateFindings(project({ udts: [udt("Valve")], aois: [aoi("Valve")] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("share one data-type namespace");
    expect(findings[0].target).toBe("Ctrl/Valve");
  });

  it("matches names case-insensitively and uses the first spelling", () => {
    const findings = duplicateFindings(project({ udts: [udt("Motor"), udt("motor")] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('named "Motor"');
  });

  it("reports each duplicated name only once", () => {
    const findings = duplicateFindings(
      project({ udts: [udt("Pump"), udt("Pump"), udt("Pump")] }),
    );
    expect(findings).toHaveLength(1);
  });

  it("does not flag distinct UDT and AOI names", () => {
    const findings = duplicateFindings(
      project({ udts: [udt("MotorUdt"), udt("ValveUdt")], aois: [aoi("Scale")] }),
    );
    expect(findings).toHaveLength(0);
  });
});
