import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// AOI InOut parameters are commonly arrays passed by reference, carrying a
// Dimensions attribute. "Buffer" is a single-dimension DINT[16] InOut array and
// "Matrix" is a multi-dimensional REAL[2,3] InOut array; "Scale" is a plain
// atomic Input with no dimensions.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="AoiDimCtl" ProcessorType="1756-L85E">
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="FilterAOI" Revision="1.0">
        <Parameters>
          <Parameter Name="Buffer" DataType="DINT" Usage="InOut" Required="true" Dimensions="16"/>
          <Parameter Name="Matrix" DataType="REAL" Usage="InOut" Required="true" Dimensions="2 3"/>
          <Parameter Name="Scale" DataType="REAL" Usage="Input"/>
        </Parameters>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
  </Controller>
</RSLogix5000Content>`;

function paramsOf(project: ReturnType<typeof importL5X>["project"]) {
  const params = project.controllers[0]!.addOnInstructions[0]!.parameters;
  return {
    buffer: params.find((p) => p.name === "Buffer")!,
    matrix: params.find((p) => p.name === "Matrix")!,
    scale: params.find((p) => p.name === "Scale")!,
  };
}

describe("importL5X — AOI parameter array dimensions", () => {
  it("imports single- and multi-dimensional parameter Dimensions", () => {
    const { buffer, matrix, scale } = paramsOf(importL5X(XML).project);
    expect(buffer.dimension).toBe(16);
    expect(buffer.dimensions).toBeUndefined();
    expect(matrix.dimension).toBe(2);
    expect(matrix.dimensions).toEqual([2, 3]);
    expect(scale.dimension).toBeUndefined();
    expect(scale.dimensions).toBeUndefined();
  });

  it("round-trips parameter Dimensions through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const { buffer, matrix, scale } = paramsOf(importL5X(xml).project);
    expect(buffer.dimension).toBe(16);
    expect(matrix.dimensions).toEqual([2, 3]);
    expect(scale.dimension).toBeUndefined();
  });
});
