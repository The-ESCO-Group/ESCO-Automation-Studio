import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Safety controllers partition not only tags and programs but also Add-On
// Instruction definitions into Safety / Standard via the `Class` attribute on
// <AddOnInstructionDefinition>. Like the tag / program partition, it is
// display/organisational metadata (never used here to drive a safety task), but
// it must survive export -> import so the partition is not silently lost when an
// engineer round-trips a GuardLogix project containing safety AOIs.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="SafetyCtl" ProcessorType="1756-L8SP" MajorRev="33" MinorRev="11">
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="SafetyGate" Revision="1.0" Class="Safety">
        <Parameters>
          <Parameter Name="EnableIn" DataType="BOOL" Usage="Input"/>
        </Parameters>
      </AddOnInstructionDefinition>
      <AddOnInstructionDefinition Name="StandardScale" Revision="1.0" Class="Standard">
        <Parameters>
          <Parameter Name="EnableIn" DataType="BOOL" Usage="Input"/>
        </Parameters>
      </AddOnInstructionDefinition>
      <AddOnInstructionDefinition Name="PlainHelper" Revision="1.0">
        <Parameters>
          <Parameter Name="EnableIn" DataType="BOOL" Usage="Input"/>
        </Parameters>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — AOI safety class", () => {
  const aoisOf = (xml: string) => {
    const controller = importL5X(xml).project.controllers[0]!;
    return (name: string) => controller.addOnInstructions.find((a) => a.name === name)!;
  };

  it("imports the AOI definition Class attribute as safetyClass", () => {
    const aoi = aoisOf(XML);
    expect(aoi("SafetyGate").safetyClass).toBe("Safety");
    expect(aoi("StandardScale").safetyClass).toBe("Standard");
    expect(aoi("PlainHelper").safetyClass).toBeUndefined();
  });

  it("round-trips the AOI safety partition through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const aoi = aoisOf(xml);
    expect(aoi("SafetyGate").safetyClass).toBe("Safety");
    expect(aoi("StandardScale").safetyClass).toBe("Standard");
    expect(aoi("PlainHelper").safetyClass).toBeUndefined();
  });
});
