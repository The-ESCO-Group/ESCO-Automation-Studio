import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Nearly every Logix <Controller> carries a <TimeSynchronize> child describing
// its CIP Sync / IEEE 1588 (Precision Time Protocol) configuration: whether PTP
// is enabled and the grandmaster election priorities. The simulator never
// synchronizes a clock or talks to a controller, but these are project settings
// an engineer expects to keep, so they must survive export -> import rather than
// being silently dropped (mirrors <WallClockTime> / <RedundancyInfo>).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="SyncCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11">
    <TimeSynchronize PTPEnable="true" Priority1="128" Priority2="200"/>
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller time synchronization", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the TimeSynchronize attributes verbatim", () => {
    const { timeSync } = controllerOf(XML);
    expect(timeSync).toEqual({
      ptpEnable: true,
      priority1: "128",
      priority2: "200",
    });
  });

  it("round-trips the time-synchronization configuration through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const { timeSync } = controllerOf(xml);
    expect(timeSync).toEqual({
      ptpEnable: true,
      priority1: "128",
      priority2: "200",
    });
  });

  it("leaves timeSync undefined when the controller omits it", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).timeSync).toBeUndefined();
  });
});
