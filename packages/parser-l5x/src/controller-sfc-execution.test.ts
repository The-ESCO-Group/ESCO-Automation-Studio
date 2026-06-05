import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Nearly every Logix <Controller> carries SFC execution-control scheduling
// metadata: SFCExecutionControl (how SFC charts execute, e.g. "CurrentActive"),
// SFCRestartPosition (where a chart restarts, e.g. "MostRecent"), and
// SFCLastScan (how the last scan is handled, e.g. "DontScan"). The simulator
// never uses these, but they are project settings an engineer expects to keep,
// so they must survive export -> import rather than being silently dropped
// (mirrors the System Overhead Time Slice controller metadata).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="LineCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11" SFCExecutionControl="CurrentActive" SFCRestartPosition="MostRecent" SFCLastScan="DontScan">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller SFC execution control", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the SFC execution-control attributes verbatim", () => {
    const controller = controllerOf(XML);
    expect(controller.sfcExecutionControl).toBe("CurrentActive");
    expect(controller.sfcRestartPosition).toBe("MostRecent");
    expect(controller.sfcLastScan).toBe("DontScan");
  });

  it("round-trips the SFC execution-control metadata through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const controller = controllerOf(xml);
    expect(controller.sfcExecutionControl).toBe("CurrentActive");
    expect(controller.sfcRestartPosition).toBe("MostRecent");
    expect(controller.sfcLastScan).toBe("DontScan");
  });

  it("leaves the fields undefined when the controller omits them", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    const controller = controllerOf(bare);
    expect(controller.sfcExecutionControl).toBeUndefined();
    expect(controller.sfcRestartPosition).toBeUndefined();
    expect(controller.sfcLastScan).toBeUndefined();
  });
});
