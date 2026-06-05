import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Every Studio 5000 export stamps the root <RSLogix5000Content> element with the
// SoftwareRevision that produced it (the major.minor software version, e.g.
// "32.04") — distinct from the controller's firmware MajorRev/MinorRev. The
// simulator never uses it, but it is export provenance an engineer expects to
// keep, so it must survive export -> import rather than being overwritten with
// this tool's own identity (mirrors the controller audit / project-matching
// metadata). It lives on the root element, not the <Controller>, so it is
// preserved on the controller domain object for round-trip purposes.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="32.04" TargetName="RevCtl" ContentType="Controller">
  <Controller Use="Target" Name="RevCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — root SoftwareRevision", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the originating software version verbatim", () => {
    expect(controllerOf(XML).softwareRevision).toBe("32.04");
  });

  it("keeps it distinct from the controller firmware revision", () => {
    const controller = controllerOf(XML);
    expect(controller.softwareRevision).toBe("32.04");
    expect(controller.firmwareRevision).toBe("33.11");
  });

  it("round-trips the software version through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    expect(xml).toContain('SoftwareRevision="32.04"');
    expect(controllerOf(xml).softwareRevision).toBe("32.04");
  });

  it("omits the attribute (rather than fabricating one) when the export had none", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).softwareRevision).toBeUndefined();
    const { xml } = exportL5X(importL5X(bare).project);
    expect(xml).not.toContain("SoftwareRevision=");
  });
});
