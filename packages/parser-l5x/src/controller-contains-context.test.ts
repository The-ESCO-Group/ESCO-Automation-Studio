import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Nearly every Studio 5000 export stamps the root <RSLogix5000Content> element
// with ContainsContext, recording whether the file embeds surrounding project
// context beyond the exported target (e.g. "true" / "false"). The simulator
// never uses it, but it is export provenance an engineer expects to keep, so it
// must survive export -> import rather than being dropped (mirrors the root
// ExportOptions). It lives on the root element, not the <Controller>, so it is
// preserved on the controller domain object for round-trip purposes.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="32.04" TargetName="CtxCtl" ContentType="Controller" ContainsContext="true">
  <Controller Use="Target" Name="CtxCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — root ContainsContext", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the contains-context flag verbatim", () => {
    expect(controllerOf(XML).containsContext).toBe("true");
  });

  it("round-trips the flag through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    expect(xml).toContain('ContainsContext="true"');
    expect(controllerOf(xml).containsContext).toBe("true");
  });

  it("omits the attribute (rather than fabricating one) when the export had none", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).containsContext).toBeUndefined();
    const { xml } = exportL5X(importL5X(bare).project);
    expect(xml).not.toContain("ContainsContext=");
  });
});
