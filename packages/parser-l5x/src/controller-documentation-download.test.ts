import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Nearly every Logix <Controller> carries project documentation download /
// pass-through configuration: PassThroughConfiguration (whether comments and
// descriptions are downloaded to the controller, e.g. "EnabledWithAppend"),
// DownloadProjectDocumentationAndExtendedProperties and
// DownloadProjectCustomProperties ("true"/"false"). The simulator never uses
// these, but they are project settings an engineer expects to keep, so they
// must survive export -> import rather than being silently dropped (mirrors the
// project-language / time-slice / redundancy controller metadata).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="LineCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11" PassThroughConfiguration="EnabledWithAppend" DownloadProjectDocumentationAndExtendedProperties="true" DownloadProjectCustomProperties="false">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller project documentation download configuration", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the pass-through / documentation-download attributes verbatim", () => {
    const controller = controllerOf(XML);
    expect(controller.passThroughConfiguration).toBe("EnabledWithAppend");
    expect(controller.downloadProjectDocumentationAndExtendedProperties).toBe("true");
    expect(controller.downloadProjectCustomProperties).toBe("false");
  });

  it("round-trips the documentation-download configuration through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const controller = controllerOf(xml);
    expect(controller.passThroughConfiguration).toBe("EnabledWithAppend");
    expect(controller.downloadProjectDocumentationAndExtendedProperties).toBe("true");
    expect(controller.downloadProjectCustomProperties).toBe("false");
  });

  it("leaves the fields undefined when the controller omits them", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    const controller = controllerOf(bare);
    expect(controller.passThroughConfiguration).toBeUndefined();
    expect(controller.downloadProjectDocumentationAndExtendedProperties).toBeUndefined();
    expect(controller.downloadProjectCustomProperties).toBeUndefined();
  });
});
