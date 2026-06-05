import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Event-triggered I/O connections carry an `EventID` attribute (commonly 0 on
// standard input connections) alongside the requested packet interval. Like the
// rest of the connection settings it is read-only configuration metadata — never
// used to open a real controller connection — but it must survive
// import -> export -> import.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="EventCtl" ProcessorType="1756-L85E">
    <Modules>
      <Module Name="DI_Event" CatalogNumber="1756-IB16" ParentModule="Local" ParentModPortId="1">
        <Communications>
          <Connections>
            <Connection Name="Data" RPI="20000" Type="Input" Priority="Scheduled" Unicast="false" EventID="0"/>
            <Connection Name="EventIn" RPI="5000" Type="Input" Priority="High" Unicast="true" EventID="7"/>
          </Connections>
        </Communications>
      </Module>
    </Modules>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — module connection EventID metadata", () => {
  it("imports each <Connection>'s EventID alongside the other settings", () => {
    const module = importL5X(XML).project.controllers[0]!.ioConfiguration.modules[0]!;
    expect(module.connections).toEqual([
      { name: "Data", rpi: 20000, type: "Input", priority: "Scheduled", unicast: false, eventId: 0 },
      { name: "EventIn", rpi: 5000, type: "Input", priority: "High", unicast: true, eventId: 7 },
    ]);
  });

  it("round-trips the connection EventID through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    expect(xml).toContain('EventID="0"');
    expect(xml).toContain('EventID="7"');
    const module = importL5X(xml).project.controllers[0]!.ioConfiguration.modules[0]!;
    expect(module.connections).toEqual([
      { name: "Data", rpi: 20000, type: "Input", priority: "Scheduled", unicast: false, eventId: 0 },
      { name: "EventIn", rpi: 5000, type: "Input", priority: "High", unicast: true, eventId: 7 },
    ]);
  });
});
