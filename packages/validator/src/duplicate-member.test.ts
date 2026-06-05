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

const memberFindings = (proj: PlcProject) =>
  createDefaultEngine().run(proj).filter((f) => f.ruleId === "duplicate-member");

describe("duplicate-member", () => {
  it("flags a UDT with two members of the same name", () => {
    const findings = memberFindings(
      project({
        udts: [
          {
            id: "udt-motor",
            name: "MotorUdt",
            members: [
              { name: "Status", dataType: "DINT" },
              { name: "Cmd", dataType: "BOOL" },
              { name: "Status", dataType: "BOOL" },
            ],
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('member named "Status"');
    expect(findings[0].target).toBe("Ctrl/MotorUdt");
  });

  it("treats member names as case-insensitive, matching Logix", () => {
    const findings = memberFindings(
      project({
        udts: [
          {
            id: "udt-motor",
            name: "MotorUdt",
            members: [
              { name: "Status", dataType: "DINT" },
              { name: "status", dataType: "BOOL" },
            ],
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
  });

  it("reports each duplicated member name only once", () => {
    const findings = memberFindings(
      project({
        udts: [
          {
            id: "udt-motor",
            name: "MotorUdt",
            members: [
              { name: "Status", dataType: "DINT" },
              { name: "Status", dataType: "BOOL" },
              { name: "Status", dataType: "SINT" },
            ],
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
  });

  it("flags an AOI whose parameter and local tag share a name", () => {
    const findings = memberFindings(
      project({
        aois: [
          {
            id: "aoi-scale",
            name: "Scale",
            parameters: [
              { name: "EnableIn", dataType: "BOOL", usage: "Input" },
              { name: "Raw", dataType: "DINT", usage: "Input" },
            ],
            localTags: [{ name: "Raw", dataType: "REAL" }],
            routineNames: ["Logic"],
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("Add-On Instruction \"Scale\"");
    expect(findings[0].message).toContain('named "Raw"');
    expect(findings[0].target).toBe("Ctrl/Scale");
  });

  it("does not flag unique UDT members or AOI parameters/local tags", () => {
    const findings = memberFindings(
      project({
        udts: [
          {
            id: "udt-motor",
            name: "MotorUdt",
            members: [
              { name: "Status", dataType: "DINT" },
              { name: "Cmd", dataType: "BOOL" },
            ],
          },
        ],
        aois: [
          {
            id: "aoi-scale",
            name: "Scale",
            parameters: [
              { name: "EnableIn", dataType: "BOOL", usage: "Input" },
              { name: "Raw", dataType: "DINT", usage: "Input" },
            ],
            localTags: [{ name: "Work", dataType: "REAL" }],
            routineNames: ["Logic"],
          },
        ],
      }),
    );
    expect(findings).toHaveLength(0);
  });
});
