import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="AoiDocCtl" ProcessorType="1756-L85E">
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="ScaleAOI" Revision="2.1">
        <RevisionNote><![CDATA[Rev 2.1: clamp output to engineering range.]]></RevisionNote>
        <AdditionalHelpText><![CDATA[Scales Raw to EU. Set Lo/Hi before first scan.]]></AdditionalHelpText>
        <Parameters>
          <Parameter Name="Raw" DataType="DINT" Usage="Input"/>
        </Parameters>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — AOI definition documentation metadata", () => {
  it("imports AOI RevisionNote and AdditionalHelpText", () => {
    const aoi = importL5X(XML).project.controllers[0]!.addOnInstructions[0]!;
    expect(aoi.revisionNote).toBe("Rev 2.1: clamp output to engineering range.");
    expect(aoi.additionalHelpText).toBe("Scales Raw to EU. Set Lo/Hi before first scan.");
  });

  it("round-trips AOI RevisionNote and AdditionalHelpText through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const aoi = importL5X(xml).project.controllers[0]!.addOnInstructions[0]!;
    expect(aoi.revisionNote).toBe("Rev 2.1: clamp output to engineering range.");
    expect(aoi.additionalHelpText).toBe("Scales Raw to EU. Set Lo/Hi before first scan.");
  });
});
