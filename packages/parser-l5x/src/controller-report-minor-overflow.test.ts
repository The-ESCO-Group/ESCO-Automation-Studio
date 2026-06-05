import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Nearly every Studio 5000 export stamps the <Controller> element with
// ReportMinorOverflow: whether the controller reports a minor fault when an
// arithmetic operation overflows. The simulator never uses it to decide overflow
// handling, but it is a controller configuration an engineer expects to keep, so
// it must survive export -> import rather than being silently dropped (mirrors
// the project-matching / audit-timestamp metadata).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="OverflowCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11"
      ReportMinorOverflow="true">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller ReportMinorOverflow", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the minor-overflow reporting setting verbatim", () => {
    expect(controllerOf(XML).reportMinorOverflow).toBe("true");
  });

  it("round-trips the setting through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    expect(controllerOf(xml).reportMinorOverflow).toBe("true");
  });

  it("leaves the setting undefined when the controller omits it", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).reportMinorOverflow).toBeUndefined();
  });
});
