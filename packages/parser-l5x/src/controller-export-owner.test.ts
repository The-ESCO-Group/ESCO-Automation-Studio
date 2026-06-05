import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Every Studio 5000 export stamps the root <RSLogix5000Content> element with the
// Owner that produced it — the Windows user / organization recorded at export
// time (e.g. "John Doe, Acme Corp"). The simulator never uses it, but it is
// export provenance an engineer expects to keep, so it must survive
// export -> import rather than being dropped (mirrors the root SoftwareRevision).
// It lives on the root element, not the <Controller>, so it is preserved on the
// controller domain object for round-trip purposes.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="32.04" TargetName="OwnCtl" ContentType="Controller" Owner="John Doe, Acme Corp">
  <Controller Use="Target" Name="OwnCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — root Owner", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the export owner verbatim", () => {
    expect(controllerOf(XML).exportOwner).toBe("John Doe, Acme Corp");
  });

  it("round-trips the owner through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    expect(xml).toContain('Owner="John Doe, Acme Corp"');
    expect(controllerOf(xml).exportOwner).toBe("John Doe, Acme Corp");
  });

  it("omits the attribute (rather than fabricating one) when the export had none", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).exportOwner).toBeUndefined();
    const { xml } = exportL5X(importL5X(bare).project);
    expect(xml).not.toContain("Owner=");
  });
});
