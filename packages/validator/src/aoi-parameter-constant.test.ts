import { describe, expect, it } from "vitest";
import {
  createController,
  createProject,
  type AddOnInstruction,
  type AoiParameter,
  type PlcProject,
} from "@esco/core";
import { createDefaultEngine } from "./index";

const constantFindings = (proj: PlcProject) =>
  createDefaultEngine()
    .run(proj)
    .filter((f) => f.ruleId === "aoi-parameter-constant");

/** Build a project with one controller holding one AOI with the given parameters. */
function aoiProject(parameters: AoiParameter[], protectedSource = false): PlcProject {
  const proj = createProject("Cell");
  const controller = createController(proj.id, "Ctrl");
  const aoi: AddOnInstruction = {
    id: "aoi-METER",
    name: "METER",
    parameters,
    localTags: [],
    routineNames: [],
    ...(protectedSource ? { protected: true } : {}),
  };
  controller.addOnInstructions.push(aoi);
  proj.controllers.push(controller);
  return proj;
}

describe("aoi-parameter-constant", () => {
  it("flags a constant Output parameter", () => {
    const findings = constantFindings(
      aoiProject([{ name: "Result", dataType: "DINT", usage: "Output", constant: true }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.message).toContain("Output");
    expect(findings[0]!.message).toContain("Constant");
    expect(findings[0]!.message).toContain("Input parameters");
    expect(findings[0]!.target).toBe("Ctrl/METER.Result");
  });

  it("flags a constant InOut parameter", () => {
    const findings = constantFindings(
      aoiProject([{ name: "Buffer", dataType: "DINT", usage: "InOut", constant: true, dimensions: [16] }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("InOut");
    expect(findings[0]!.target).toBe("Ctrl/METER.Buffer");
  });

  it("accepts a constant Input parameter", () => {
    const findings = constantFindings(
      aoiProject([{ name: "Setpoint", dataType: "REAL", usage: "Input", required: true, constant: true }]),
    );
    expect(findings).toHaveLength(0);
  });

  it("accepts non-constant Output/InOut parameters", () => {
    const findings = constantFindings(
      aoiProject([
        { name: "Result", dataType: "DINT", usage: "Output" },
        { name: "Buffer", dataType: "DINT", usage: "InOut", dimensions: [8] },
      ]),
    );
    expect(findings).toHaveLength(0);
  });

  it("still validates the interface metadata of a source-protected AOI", () => {
    // The parameter signature is public and survives source protection, so the
    // constant-usage check does not depend on the (unavailable) logic body.
    const findings = constantFindings(
      aoiProject([{ name: "Result", dataType: "DINT", usage: "Output", constant: true }], true),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("Output");
  });

  it("leaves a parameter with missing or unrecognized usage alone", () => {
    // A clean Studio export never writes Constant on a non-Input parameter, so
    // the conservative rule does not fire when it cannot prove the usage.
    const findings = constantFindings(
      aoiProject([
        { name: "Mystery", dataType: "DINT", constant: true },
        { name: "Weird", dataType: "DINT", usage: "Producer", constant: true },
      ]),
    );
    expect(findings).toHaveLength(0);
  });
});
