import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Studio 5000 stamps the root <RSLogix5000Content> element with an ExportOptions
// attribute — a space-separated list of the data classes the file contains (e.g.
// "References NoRawData L5KData DecoratedData Context Dependencies"). The
// simulator never parses or acts on it, but it is export provenance an engineer
// expects to keep, so it must survive export -> import rather than being dropped
// (mirrors the root Owner). It lives on the root element, not the <Controller>,
// so it is preserved on the controller domain object for round-trip purposes.
const OPTIONS = "References NoRawData L5KData DecoratedData Context Dependencies";
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="32.04" TargetName="OptCtl" ContentType="Controller" ExportOptions="${OPTIONS}">
  <Controller Use="Target" Name="OptCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — root ExportOptions", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the export options verbatim", () => {
    expect(controllerOf(XML).exportOptions).toBe(OPTIONS);
  });

  it("round-trips the export options through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    expect(xml).toContain(`ExportOptions="${OPTIONS}"`);
    expect(controllerOf(xml).exportOptions).toBe(OPTIONS);
  });

  it("omits the attribute (rather than fabricating one) when the export had none", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).exportOptions).toBeUndefined();
    const { xml } = exportL5X(importL5X(bare).project);
    expect(xml).not.toContain("ExportOptions=");
  });
});
