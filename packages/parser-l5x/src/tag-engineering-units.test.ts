import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Logix stores engineering units for the whole tag or for individual array
// elements / structure members in a per-tag <EngineeringUnits> block (keyed by
// operand), parallel to <Comments>. These must survive import and round-trip
// through export.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="UnitsCtl">
    <Tags>
      <Tag Name="Pressure" TagType="Base" DataType="REAL">
        <EngineeringUnits>
          <EngineeringUnit Operand=""><![CDATA[psi]]></EngineeringUnit>
        </EngineeringUnits>
      </Tag>
      <Tag Name="Motor" TagType="Base" DataType="MOTOR_UDT">
        <EngineeringUnits>
          <EngineeringUnit Operand=".Speed"><![CDATA[RPM]]></EngineeringUnit>
          <EngineeringUnit Operand=".Torque"><![CDATA[N*m]]></EngineeringUnit>
        </EngineeringUnits>
      </Tag>
      <Tag Name="Flows" TagType="Base" DataType="REAL" Dimensions="3">
        <EngineeringUnits>
          <EngineeringUnit Operand="[0]"><![CDATA[L/min]]></EngineeringUnit>
          <EngineeringUnit Operand="[2]"><![CDATA[gal/min]]></EngineeringUnit>
        </EngineeringUnits>
      </Tag>
      <Tag Name="Plain" TagType="Base" DataType="BOOL"/>
    </Tags>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — per-operand tag engineering units", () => {
  const tagsOf = (xml: string) => {
    const controller = importL5X(xml).project.controllers[0]!;
    return (name: string) => controller.controllerTags.find((t) => t.name === name)!;
  };

  it("imports tag-level and per-element/member engineering units keyed by operand", () => {
    const tag = tagsOf(XML);
    expect(tag("Pressure").engineeringUnits).toEqual([{ operand: "", text: "psi" }]);
    expect(tag("Motor").engineeringUnits).toEqual([
      { operand: ".Speed", text: "RPM" },
      { operand: ".Torque", text: "N*m" },
    ]);
    expect(tag("Flows").engineeringUnits).toEqual([
      { operand: "[0]", text: "L/min" },
      { operand: "[2]", text: "gal/min" },
    ]);
    expect(tag("Plain").engineeringUnits).toBeUndefined();
  });

  it("round-trips engineering units through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const tag = tagsOf(xml);
    expect(tag("Pressure").engineeringUnits).toEqual([{ operand: "", text: "psi" }]);
    expect(tag("Motor").engineeringUnits).toEqual([
      { operand: ".Speed", text: "RPM" },
      { operand: ".Torque", text: "N*m" },
    ]);
    expect(tag("Flows").engineeringUnits).toEqual([
      { operand: "[0]", text: "L/min" },
      { operand: "[2]", text: "gal/min" },
    ]);
  });
});
