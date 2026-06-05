import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Event-triggered I/O input connections carry a `ProgrammaticallySendEventTrigger`
// attribute alongside the `EventID` (it lets the connection fire an event task
// programmatically). Like the rest of the connection settings it is read-only
// configuration metadata — never used to open a real controller connection or
// fire an event — but it must survive import -> export -> import (mirrors the
// produced-tag flag of the same name).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="EventCtl" ProcessorType="1756-L85E">
    <Modules>
      <Module Name="DI_Event" CatalogNumber="1756-IB16" ParentModule="Local" ParentModPortId="1">
        <Communications>
          <Connections>
            <Connection Name="Data" RPI="20000" Type="Input" EventID="0" ProgrammaticallySendEventTrigger="false"/>
            <Connection Name="EventIn" RPI="5000" Type="Input" EventID="7" ProgrammaticallySendEventTrigger="true"/>
          </Connections>
        </Communications>
      </Module>
    </Modules>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — module connection ProgrammaticallySendEventTrigger metadata", () => {
  it("imports each <Connection>'s ProgrammaticallySendEventTrigger flag", () => {
    const module = importL5X(XML).project.controllers[0]!.ioConfiguration.modules[0]!;
    expect(module.connections).toEqual([
      { name: "Data", rpi: 20000, type: "Input", eventId: 0, programmaticallySendEventTrigger: false },
      { name: "EventIn", rpi: 5000, type: "Input", eventId: 7, programmaticallySendEventTrigger: true },
    ]);
  });

  it("round-trips the flag (including an explicit false) through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    expect(xml).toContain('ProgrammaticallySendEventTrigger="false"');
    expect(xml).toContain('ProgrammaticallySendEventTrigger="true"');
    const module = importL5X(xml).project.controllers[0]!.ioConfiguration.modules[0]!;
    expect(module.connections).toEqual([
      { name: "Data", rpi: 20000, type: "Input", eventId: 0, programmaticallySendEventTrigger: false },
      { name: "EventIn", rpi: 5000, type: "Input", eventId: 7, programmaticallySendEventTrigger: true },
    ]);
  });
});
