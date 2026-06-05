import { describe, expect, it } from "vitest";
import {
  createController,
  createProject,
  type AddOnInstruction,
  type AoiParameter,
  type PlcProject,
  type UserDefinedType,
} from "@esco/core";
import { createDefaultEngine } from "./index";

const typeFindings = (proj: PlcProject) =>
  createDefaultEngine()
    .run(proj)
    .filter((f) => f.ruleId === "aoi-parameter-type");

/** Build a project with one controller holding the given AOIs (and optional UDTs). */
function aoiProject(
  parameters: AoiParameter[],
  dataTypes: UserDefinedType[] = [],
): PlcProject {
  const proj = createProject("Cell");
  const controller = createController(proj.id, "Ctrl");
  controller.dataTypes.push(...dataTypes);
  const aoi: AddOnInstruction = {
    id: "aoi-METER",
    name: "METER",
    parameters,
    localTags: [],
    routineNames: [],
  };
  controller.addOnInstructions.push(aoi);
  proj.controllers.push(controller);
  return proj;
}

function udt(name: string): UserDefinedType {
  return { id: `udt-${name}`, name, members: [{ name: "Value", dataType: "DINT" }] };
}

describe("aoi-parameter-type", () => {
  it("flags an Input parameter declared as an array", () => {
    const findings = typeFindings(
      aoiProject([{ name: "Samples", dataType: "DINT", usage: "Input", dimensions: [8] }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.message).toContain("Input");
    expect(findings[0]!.message).toContain("DINT[8]");
    expect(findings[0]!.message).toContain("InOut");
    expect(findings[0]!.target).toBe("Ctrl/METER.Samples");
  });

  it("flags an Output parameter declared as a predefined structure", () => {
    const findings = typeFindings(
      aoiProject([{ name: "Clock", dataType: "TIMER", usage: "Output" }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("Output");
    expect(findings[0]!.message).toContain('structured type "TIMER"');
  });

  it("flags an Input parameter typed as a controller UDT", () => {
    const findings = typeFindings(
      aoiProject([{ name: "Cfg", dataType: "MotorCfg", usage: "Input" }], [udt("MotorCfg")]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('structured type "MotorCfg"');
  });

  it("flags an Input parameter typed as STRING", () => {
    const findings = typeFindings(
      aoiProject([{ name: "Label", dataType: "STRING", usage: "Input" }]),
    );
    expect(findings).toHaveLength(1);
  });

  it("matches the UDT name case-insensitively", () => {
    const findings = typeFindings(
      aoiProject([{ name: "Cfg", dataType: "motorcfg", usage: "Input" }], [udt("MotorCfg")]),
    );
    expect(findings).toHaveLength(1);
  });

  it("accepts atomic Input/Output parameters", () => {
    const findings = typeFindings(
      aoiProject([
        { name: "EnableIn", dataType: "BOOL", usage: "Input" },
        { name: "In", dataType: "DINT", usage: "Input" },
        { name: "Gain", dataType: "REAL", usage: "Input" },
        { name: "Small", dataType: "SINT", usage: "Input" },
        { name: "Wide", dataType: "LINT", usage: "Output" },
        { name: "EnableOut", dataType: "BOOL", usage: "Output" },
      ]),
    );
    expect(findings).toHaveLength(0);
  });

  it("does not constrain InOut parameters, which may be arrays or structures", () => {
    const findings = typeFindings(
      aoiProject(
        [
          { name: "Buffer", dataType: "DINT", usage: "InOut", dimensions: [16] },
          { name: "Clock", dataType: "TIMER", usage: "InOut" },
          { name: "Cfg", dataType: "MotorCfg", usage: "InOut" },
        ],
        [udt("MotorCfg")],
      ),
    );
    expect(findings).toHaveLength(0);
  });

  it("leaves an unrecognized (unimported) type name alone", () => {
    // Not an array, not a known structure or controller UDT — could be an atomic
    // this build does not model, so the conservative rule does not fire.
    const findings = typeFindings(
      aoiProject([{ name: "Raw", dataType: "USINT", usage: "Input" }]),
    );
    expect(findings).toHaveLength(0);
  });
});
