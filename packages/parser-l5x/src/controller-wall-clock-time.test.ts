import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Nearly every Logix <Controller> carries a <WallClockTime> child describing the
// controller's local time offset from UTC (LocalTimeAdjustment, in microseconds)
// and its configured time zone string. The simulator never sets or reads a
// controller's clock, but these are project settings an engineer expects to
// keep, so they must survive export -> import rather than being silently dropped
// (mirrors <RedundancyInfo> / <SafetyInfo>).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="ClockCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11">
    <WallClockTime LocalTimeAdjustment="-21600000000" TimeZone="(GMT-06:00) Central Time (US &amp; Canada)"/>
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller wall-clock time", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the WallClockTime attributes verbatim", () => {
    const { wallClockTime } = controllerOf(XML);
    expect(wallClockTime).toEqual({
      localTimeAdjustment: "-21600000000",
      timeZone: "(GMT-06:00) Central Time (US & Canada)",
    });
  });

  it("round-trips the wall-clock configuration through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const { wallClockTime } = controllerOf(xml);
    expect(wallClockTime).toEqual({
      localTimeAdjustment: "-21600000000",
      timeZone: "(GMT-06:00) Central Time (US & Canada)",
    });
  });

  it("leaves wallClockTime undefined when the controller omits it", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).wallClockTime).toBeUndefined();
  });
});
