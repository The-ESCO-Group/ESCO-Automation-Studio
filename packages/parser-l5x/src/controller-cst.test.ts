import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Nearly every ControlLogix <Controller> carries a <CST> child describing its
// Coordinated System Time configuration: which device in the chassis is the CST
// time master (MasterID). The simulator never coordinates a system clock or
// talks to a controller, but this is a project setting an engineer expects to
// keep, so it must survive export -> import rather than being silently dropped
// (mirrors <TimeSynchronize> / <WallClockTime>).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="CstCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11">
    <CST MasterID="3"/>
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller coordinated system time", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the CST MasterID verbatim", () => {
    const { cst } = controllerOf(XML);
    expect(cst).toEqual({ masterId: "3" });
  });

  it("round-trips the coordinated-system-time configuration through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const { cst } = controllerOf(xml);
    expect(cst).toEqual({ masterId: "3" });
  });

  it("leaves cst undefined when the controller omits it", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).cst).toBeUndefined();
  });
});
