import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Nearly every ControlLogix <Controller> carries a <RedundancyInfo> child
// describing whether redundancy is enabled, whether test edits survive a
// switchover, and the I/O-memory / data-table pad reserve percentages. The
// simulator never uses these, but they are project settings an engineer expects
// to keep, so they must survive export -> import rather than being silently
// dropped (mirrors the System Overhead Time Slice controller metadata).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="LineCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11">
    <RedundancyInfo Enabled="true" KeepTestEditsOnSwitchOver="false" IOMemoryPadPercentage="90" DataTablePadPercentage="50" FrontPortCrossloadEnabledPorts="1,2" FrontPortCrossloadSecurityEnabled="true"/>
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller redundancy info", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the RedundancyInfo attributes verbatim", () => {
    const { redundancyInfo } = controllerOf(XML);
    expect(redundancyInfo).toEqual({
      enabled: true,
      keepTestEditsOnSwitchOver: false,
      ioMemoryPadPercentage: "90",
      dataTablePadPercentage: "50",
      frontPortCrossloadEnabledPorts: "1,2",
      frontPortCrossloadSecurityEnabled: "true",
    });
  });

  it("round-trips the redundancy configuration through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const { redundancyInfo } = controllerOf(xml);
    expect(redundancyInfo).toEqual({
      enabled: true,
      keepTestEditsOnSwitchOver: false,
      ioMemoryPadPercentage: "90",
      dataTablePadPercentage: "50",
      frontPortCrossloadEnabledPorts: "1,2",
      frontPortCrossloadSecurityEnabled: "true",
    });
  });

  it("leaves redundancyInfo undefined when the controller omits it", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).redundancyInfo).toBeUndefined();
  });
});
