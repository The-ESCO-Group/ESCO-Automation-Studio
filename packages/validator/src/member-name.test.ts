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

const nameFindings = (proj: PlcProject) =>
  createDefaultEngine().run(proj).filter((f) => f.ruleId === "invalid-member-name");

describe("invalid-member-name", () => {
  it("flags a UDT member whose name is not a valid Logix identifier", () => {
    const findings = nameFindings(
      project({
        udts: [
          {
            id: "udt-motor",
            name: "MotorUdt",
            members: [
              { name: "Status", dataType: "DINT" },
              { name: "1Bad", dataType: "BOOL" },
            ],
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('Member "1Bad"');
    expect(findings[0].message).toContain('data type "MotorUdt"');
    expect(findings[0].target).toBe("Ctrl/MotorUdt");
  });

  it("flags AOI parameter and local-tag names that break the rules", () => {
    const findings = nameFindings(
      project({
        aois: [
          {
            id: "aoi-scale",
            name: "Scale",
            parameters: [
              { name: "EnableIn", dataType: "BOOL", usage: "Input" },
              { name: "Raw-In", dataType: "DINT", usage: "Input" },
            ],
            localTags: [{ name: "work__buf", dataType: "REAL" }],
            routineNames: ["Logic"],
          },
        ],
      }),
    );
    expect(findings).toHaveLength(2);
    expect(findings.some((f) => f.message.includes('Parameter "Raw-In"'))).toBe(true);
    expect(findings.some((f) => f.message.includes('Local tag "work__buf"'))).toBe(true);
    for (const finding of findings) expect(finding.target).toBe("Ctrl/Scale");
  });

  it("flags a member name longer than 40 characters", () => {
    const findings = nameFindings(
      project({
        udts: [
          {
            id: "udt-long",
            name: "LongUdt",
            members: [{ name: "M".repeat(41), dataType: "DINT" }],
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("limit is 40");
  });

  it("does not flag valid member, parameter, or local-tag names", () => {
    const findings = nameFindings(
      project({
        udts: [
          {
            id: "udt-motor",
            name: "MotorUdt",
            members: [
              { name: "Status", dataType: "DINT" },
              { name: "_Cmd", dataType: "BOOL" },
              { name: "Run_Time", dataType: "DINT" },
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
