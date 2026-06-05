import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createTag,
  type AddOnInstruction,
  type PlcProject,
  type Tag,
  type UserDefinedType,
} from "@esco/core";
import { createDefaultEngine } from "./index";

/** A controller tag carrying a data type and (optional) display radix. */
function tag(controllerId: string, name: string, dataType: string, radix?: string): Tag {
  return { ...createTag(controllerId, name, dataType), radix };
}

const radixFindings = (proj: PlcProject) =>
  createDefaultEngine()
    .run(proj)
    .filter((f) => f.ruleId === "radix-data-type");

/** Build a project whose single controller carries the given controller tags. */
function tagProject(make: (controllerId: string) => Tag[]): PlcProject {
  const proj = createProject("Cell");
  const controller = createController(proj.id, "Ctrl");
  controller.controllerTags.push(...make(controller.id));
  proj.controllers.push(controller);
  return proj;
}

describe("radix-data-type", () => {
  it("flags Float radix on an integer tag", () => {
    const findings = radixFindings(tagProject((id) => [tag(id, "Count", "DINT", "Float")]));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.message).toContain("Float");
    expect(findings[0]!.message).toContain("DINT");
    expect(findings[0]!.target).toBe("Ctrl/Count");
  });

  it("flags Hex radix on a REAL tag", () => {
    const findings = radixFindings(tagProject((id) => [tag(id, "Level", "REAL", "Hex")]));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("Float, Exponential");
  });

  it("flags ASCII radix on a BOOL tag", () => {
    const findings = radixFindings(tagProject((id) => [tag(id, "Run", "BOOL", "ASCII")]));
    expect(findings).toHaveLength(1);
  });

  it("accepts valid radices for each atomic family", () => {
    const findings = radixFindings(
      tagProject((id) => [
        tag(id, "A", "DINT", "Hex"),
        tag(id, "B", "INT", "ASCII"),
        tag(id, "C", "SINT", "Binary"),
        tag(id, "D", "LINT", "Date/Time"),
        tag(id, "E", "REAL", "Float"),
        tag(id, "F", "LREAL", "Exponential"),
        tag(id, "G", "BOOL", "Binary"),
      ]),
    );
    expect(findings).toHaveLength(0);
  });

  it("keeps the SINT/INT/DINT family distinct from LINT for Date/Time", () => {
    // Date/Time is a LINT-only style; on a 32-bit DINT it is a verify error.
    const findings = radixFindings(tagProject((id) => [tag(id, "Stamp", "DINT", "Date/Time")]));
    expect(findings).toHaveLength(1);
  });

  it("ignores unrecognized or absent radices and structured/alias types", () => {
    const findings = radixFindings(
      tagProject((id) => [
        tag(id, "NoRadix", "REAL"), // unset -> inherit, skipped
        tag(id, "Null", "REAL", "NullType"), // not a recognized style, skipped
        tag(id, "Struct", "MyUdt", "Hex"), // non-atomic type, skipped
        tag(id, "Str", "STRING", "ASCII"), // STRING left to its own display rules
      ]),
    );
    expect(findings).toHaveLength(0);
  });

  it("flags a program tag, reporting program scope in the target", () => {
    const proj = createProject("Cell");
    const controller = createController(proj.id, "Ctrl");
    const program = createProgram(controller.id, "Main");
    program.programTags.push(tag(controller.id, "Temp", "REAL", "Decimal"));
    controller.programs.push(program);
    proj.controllers.push(controller);
    const findings = radixFindings(proj);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.target).toBe("Ctrl/Main/Temp");
  });

  it("flags a UDT member and an AOI parameter", () => {
    const proj = createProject("Cell");
    const controller = createController(proj.id, "Ctrl");
    const udt: UserDefinedType = {
      id: "udt1",
      name: "Motor",
      members: [
        { name: "Speed", dataType: "REAL", radix: "Binary" },
        { name: "Cmd", dataType: "DINT", radix: "Hex" },
      ],
    };
    controller.dataTypes.push(udt);
    const aoi = {
      id: "aoi1",
      name: "Pump",
      parameters: [{ name: "Setpoint", dataType: "REAL", radix: "Octal" }],
      localTags: [{ name: "Acc", dataType: "DINT", radix: "Float" }],
    } as unknown as AddOnInstruction;
    controller.addOnInstructions.push(aoi);
    proj.controllers.push(controller);

    const findings = radixFindings(proj);
    // Speed (REAL/Binary), Setpoint (REAL/Octal), Acc (DINT/Float) are invalid;
    // Cmd (DINT/Hex) is valid.
    expect(findings).toHaveLength(3);
    expect(findings.map((f) => f.target)).toEqual([
      "Ctrl/Motor.Speed",
      "Ctrl/Pump.Setpoint",
      "Ctrl/Pump.Acc",
    ]);
  });
});
