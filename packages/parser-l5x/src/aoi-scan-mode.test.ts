import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="AoiScanCtl" ProcessorType="1756-L85E">
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="ScanAOI" Revision="1.0" ExecutePrescan="true" ExecutePostscan="false" ExecuteEnableInFalse="true">
        <Parameters>
          <Parameter Name="Raw" DataType="DINT" Usage="Input"/>
        </Parameters>
      </AddOnInstructionDefinition>
      <AddOnInstructionDefinition Name="PlainAOI" Revision="1.0">
        <Parameters>
          <Parameter Name="In" DataType="DINT" Usage="Input"/>
        </Parameters>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — AOI scan-mode flags", () => {
  const aois = importL5X(XML).project.controllers[0]!.addOnInstructions;
  const scan = aois.find((a) => a.name === "ScanAOI")!;
  const plain = aois.find((a) => a.name === "PlainAOI")!;

  it("imports only the explicitly-true scan-mode flags", () => {
    expect(scan.executePrescan).toBe(true);
    expect(scan.executeEnableInFalse).toBe(true);
    // ExecutePostscan="false" and absent flags are not captured.
    expect(scan.executePostscan).toBeUndefined();
  });

  it("leaves scan-mode flags undefined when the AOI omits them", () => {
    expect(plain.executePrescan).toBeUndefined();
    expect(plain.executePostscan).toBeUndefined();
    expect(plain.executeEnableInFalse).toBeUndefined();
  });

  it("round-trips the scan-mode flags through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const reimported = importL5X(xml).project.controllers[0]!.addOnInstructions.find(
      (a) => a.name === "ScanAOI",
    )!;
    expect(reimported.executePrescan).toBe(true);
    expect(reimported.executeEnableInFalse).toBe(true);
    expect(reimported.executePostscan).toBeUndefined();
  });
});
