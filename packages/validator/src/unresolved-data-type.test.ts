import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createTag,
  type AddOnInstruction,
  type PlcProject,
  type UserDefinedType,
} from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a project whose single controller carries the given UDTs and AOIs. */
function project(udts: UserDefinedType[], aois: AddOnInstruction[] = []): PlcProject {
  const proj = createProject("Cell");
  const controller = createController(proj.id, "Ctrl");
  for (const udt of udts) controller.dataTypes.push(udt);
  for (const aoi of aois) controller.addOnInstructions.push(aoi);
  proj.controllers.push(controller);
  return proj;
}

const unresolvedFindings = (proj: PlcProject) =>
  createDefaultEngine().run(proj).filter((f) => f.ruleId === "unresolved-data-type");

describe("unresolved-data-type", () => {
  it("flags a UDT member whose data type is not defined", () => {
    const findings = unresolvedFindings(
      project([
        {
          id: "udt-motor",
          name: "Motor",
          members: [
            { name: "Speed", dataType: "DINT" },
            { name: "Drive", dataType: "Ghost" },
          ],
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain('Member "Drive" of "Motor"');
    expect(findings[0].message).toContain('"Ghost"');
    expect(findings[0].target).toBe("Ctrl/Motor");
  });

  it("resolves atomic, predefined structured, and predefined unmodeled types", () => {
    const findings = unresolvedFindings(
      project([
        {
          id: "udt-mixed",
          name: "Mixed",
          members: [
            { name: "A", dataType: "DINT" },
            { name: "B", dataType: "REAL" },
            { name: "Flag", dataType: "BOOL" },
            { name: "Tmr", dataType: "TIMER" }, // modeled predefined structure
            { name: "Scale", dataType: "SCL" },
            { name: "Totalizer", dataType: "TOT" },
            { name: "RampSoak", dataType: "RMPS" },
            { name: "Limiter", dataType: "RLIM" },
            { name: "EStop", dataType: "ESTOP" },
            { name: "DoorGate", dataType: "DCS" },
            { name: "DiverseStop", dataType: "DIN" },
            { name: "Output", dataType: "ROUT" },
            { name: "ConfigOutput", dataType: "CROUT" },
            { name: "Axis", dataType: "AXIS_SERVO_DRIVE" }, // predefined, unmodeled offline
          ],
        },
      ]),
    );
    expect(findings).toHaveLength(0);
  });

  it("resolves a member typed as another UDT or an AOI, case-insensitively", () => {
    const findings = unresolvedFindings(
      project(
        [
          {
            id: "udt-axis",
            name: "AxisData",
            members: [{ name: "Pos", dataType: "DINT" }],
          },
          {
            id: "udt-cell",
            name: "Cell",
            members: [
              { name: "Axis", dataType: "axisdata" }, // UDT, different case
              { name: "Pump", dataType: "PUMP_AOI" }, // AOI name
            ],
          },
        ],
        [
          {
            id: "aoi-pump",
            name: "Pump_Aoi",
            parameters: [{ name: "EnableIn", dataType: "BOOL", usage: "Input", required: true }],
            localTags: [],
            routineNames: [],
          },
        ],
      ),
    );
    expect(findings).toHaveLength(0);
  });

  it("flags an AOI parameter and an AOI local tag declared with an undefined type", () => {
    const findings = unresolvedFindings(
      project(
        [],
        [
          {
            id: "aoi-ctrl",
            name: "Regulator",
            parameters: [
              { name: "EnableIn", dataType: "BOOL", usage: "Input", required: true },
              { name: "Setpoint", dataType: "Phantom", usage: "Input", required: true },
            ],
            localTags: [{ name: "Scratch", dataType: "Spectre" }],
            routineNames: [],
          },
        ],
      ),
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === "warning")).toBe(true);
    expect(findings.some((f) => f.message.includes('Parameter "Setpoint" of "Regulator"'))).toBe(true);
    expect(findings.some((f) => f.message.includes('Local tag "Scratch" of "Regulator"'))).toBe(true);
    expect(findings.every((f) => f.target === "Ctrl/Regulator")).toBe(true);
  });

  it("flags a controller tag declared with an undefined data type", () => {
    const proj = createProject("Cell");
    const controller = createController(proj.id, "Ctrl");
    controller.controllerTags.push(createTag(controller.id, "Drive", "GhostType"));
    controller.controllerTags.push(createTag(controller.id, "Speed", "DINT"));
    proj.controllers.push(controller);

    const findings = unresolvedFindings(proj);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain('Tag "Drive"');
    expect(findings[0].message).toContain('"GhostType"');
    expect(findings[0].target).toBe("Ctrl/Drive");
  });

  it("flags a program tag declared with an undefined data type", () => {
    const proj = createProject("Cell");
    const controller = createController(proj.id, "Ctrl");
    const program = createProgram(controller.id, "MainProgram");
    program.programTags.push(createTag(controller.id, "Local", "Phantom", { scope: "program", programId: program.id }));
    controller.programs.push(program);
    proj.controllers.push(controller);

    const findings = unresolvedFindings(proj);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Tag "Local" of program "MainProgram"');
    expect(findings[0].target).toBe("Ctrl/MainProgram/Local");
  });

  it("resolves a tag typed as a UDT defined on the controller, case-insensitively", () => {
    const proj = createProject("Cell");
    const controller = createController(proj.id, "Ctrl");
    controller.dataTypes.push({
      id: "udt-motor",
      name: "Motor",
      members: [{ name: "Speed", dataType: "DINT" }],
    });
    controller.controllerTags.push(createTag(controller.id, "M1", "motor")); // UDT, different case
    controller.controllerTags.push(createTag(controller.id, "Pulse", "TIMER")); // predefined
    proj.controllers.push(controller);

    expect(unresolvedFindings(proj)).toHaveLength(0);
  });

  it("does not flag a member whose type is a custom STRING UDT", () => {
    const findings = unresolvedFindings(
      project([
        {
          id: "udt-str",
          name: "STRING_20",
          family: "StringFamily",
          members: [
            { name: "LEN", dataType: "DINT" },
            { name: "DATA", dataType: "SINT", dimension: 20 },
          ],
        },
        {
          id: "udt-rec",
          name: "Recipe",
          members: [{ name: "Name", dataType: "STRING_20" }],
        },
      ]),
    );
    expect(findings).toHaveLength(0);
  });
});
