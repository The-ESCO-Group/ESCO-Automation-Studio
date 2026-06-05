import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Almost every ControlLogix <Controller> carries System Overhead Time Slice
// scheduling metadata: TimeSlice (the percent of CPU time given to
// communications/background work) and ShareUnusedTimeSlice (whether the unused
// slice is handed back to the continuous task). The simulator never uses these,
// but they are project settings an engineer expects to keep, so they must
// survive export -> import rather than being silently dropped (mirrors the
// catalog / firmware / handler controller metadata).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="LineCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11" TimeSlice="20" ShareUnusedTimeSlice="1">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller system overhead time slice", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the TimeSlice / ShareUnusedTimeSlice attributes verbatim", () => {
    const controller = controllerOf(XML);
    expect(controller.timeSlice).toBe("20");
    expect(controller.shareUnusedTimeSlice).toBe("1");
  });

  it("round-trips the time-slice scheduling metadata through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const controller = controllerOf(xml);
    expect(controller.timeSlice).toBe("20");
    expect(controller.shareUnusedTimeSlice).toBe("1");
  });

  it("leaves the fields undefined when the controller omits them", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    const controller = controllerOf(bare);
    expect(controller.timeSlice).toBeUndefined();
    expect(controller.shareUnusedTimeSlice).toBeUndefined();
  });
});
