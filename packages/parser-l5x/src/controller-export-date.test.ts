import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Studio 5000 stamps the root <RSLogix5000Content> element with an ExportDate
// attribute — the day/time the file was generated (e.g. "Tue Jan 02 14:03:11 2024").
// The simulator never parses or acts on it, but it is export provenance an engineer
// expects to keep, so it must survive export -> import rather than being overwritten
// with this tool's own export time (mirrors the root Owner / ExportOptions). It lives
// on the root element, not the <Controller>, so it is preserved on the controller
// domain object for round-trip purposes.
const EXPORT_DATE = "Tue Jan 02 14:03:11 2024";
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="32.04" TargetName="DateCtl" ContentType="Controller" ExportDate="${EXPORT_DATE}">
  <Controller Use="Target" Name="DateCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — root ExportDate", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the export date verbatim", () => {
    expect(controllerOf(XML).exportDate).toBe(EXPORT_DATE);
  });

  it("round-trips the export date through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    expect(xml).toContain(`ExportDate="${EXPORT_DATE}"`);
    expect(controllerOf(xml).exportDate).toBe(EXPORT_DATE);
  });

  it("falls back to this tool's own export time when the import had none", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).exportDate).toBeUndefined();
    const project = importL5X(bare).project;
    const { xml } = exportL5X(project);
    // An ExportDate is always emitted (Studio 5000 always stamps one); when none
    // was imported it carries this tool's own export time, never a fabricated date.
    expect(xml).toContain(`ExportDate="${project.updatedAt}"`);
  });
});
