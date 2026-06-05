import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="AoiIdCtl" ProcessorType="1756-L85E">
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="ScaleAOI" Revision="2.1" RevisionExtension="-beta" SoftwareRevision="v32.11" Vendor="ESCO" CreatedDate="2023-04-01T08:15:00.000Z" CreatedBy="ENG\\jdoe" EditedDate="2024-09-12T16:42:00.000Z" EditedBy="ENG\\asmith">
        <Parameters>
          <Parameter Name="Raw" DataType="DINT" Usage="Input"/>
        </Parameters>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — AOI definition authoring identity", () => {
  it("imports AOI RevisionExtension, SoftwareRevision, and Vendor", () => {
    const aoi = importL5X(XML).project.controllers[0]!.addOnInstructions[0]!;
    expect(aoi.revision).toBe("2.1");
    expect(aoi.revisionExtension).toBe("-beta");
    expect(aoi.softwareRevision).toBe("v32.11");
    expect(aoi.vendor).toBe("ESCO");
  });

  it("round-trips AOI RevisionExtension, SoftwareRevision, and Vendor through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const aoi = importL5X(xml).project.controllers[0]!.addOnInstructions[0]!;
    expect(aoi.revision).toBe("2.1");
    expect(aoi.revisionExtension).toBe("-beta");
    expect(aoi.softwareRevision).toBe("v32.11");
    expect(aoi.vendor).toBe("ESCO");
  });

  it("imports AOI authoring identity (Created/Edited Date/By)", () => {
    const aoi = importL5X(XML).project.controllers[0]!.addOnInstructions[0]!;
    expect(aoi.createdDate).toBe("2023-04-01T08:15:00.000Z");
    expect(aoi.createdBy).toBe("ENG\\jdoe");
    expect(aoi.editedDate).toBe("2024-09-12T16:42:00.000Z");
    expect(aoi.editedBy).toBe("ENG\\asmith");
  });

  it("round-trips AOI authoring identity through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const aoi = importL5X(xml).project.controllers[0]!.addOnInstructions[0]!;
    expect(aoi.createdDate).toBe("2023-04-01T08:15:00.000Z");
    expect(aoi.createdBy).toBe("ENG\\jdoe");
    expect(aoi.editedDate).toBe("2024-09-12T16:42:00.000Z");
    expect(aoi.editedBy).toBe("ENG\\asmith");
  });
});
