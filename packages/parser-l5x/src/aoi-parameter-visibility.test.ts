import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// An AOI parameter carries both Required and Visible flags. They are
// independent: here "Gain" is required but hidden from the instruction face,
// while "Enable" is visible but not required.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="AoiVisCtl" ProcessorType="1756-L85E">
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="ScaleAOI" Revision="1.0">
        <Parameters>
          <Parameter Name="Gain" DataType="REAL" Usage="Input" Required="true" Visible="false"/>
          <Parameter Name="Enable" DataType="BOOL" Usage="Input" Required="false" Visible="true"/>
        </Parameters>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
  </Controller>
</RSLogix5000Content>`;

function paramsOf(project: ReturnType<typeof importL5X>["project"]) {
  const params = project.controllers[0]!.addOnInstructions[0]!.parameters;
  return {
    gain: params.find((p) => p.name === "Gain")!,
    enable: params.find((p) => p.name === "Enable")!,
  };
}

describe("importL5X — AOI parameter instruction-face visibility", () => {
  it("imports the Visible flag independently of Required", () => {
    const { gain, enable } = paramsOf(importL5X(XML).project);
    expect(gain.required).toBe(true);
    expect(gain.visible).toBeUndefined();
    expect(enable.required).toBeUndefined();
    expect(enable.visible).toBe(true);
  });

  it("round-trips the Visible flag through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const { gain, enable } = paramsOf(importL5X(xml).project);
    expect(gain.required).toBe(true);
    expect(gain.visible).toBeUndefined();
    expect(enable.required).toBeUndefined();
    expect(enable.visible).toBe(true);
  });
});
