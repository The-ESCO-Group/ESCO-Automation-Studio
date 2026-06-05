import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// An I/O module carries its connection settings (notably the requested packet
// interval) in <Communications><Connections><Connection>. This is read-only
// configuration metadata; it is never used to open a real controller
// connection, but it must survive import -> export -> import.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="ConnCtl" ProcessorType="1756-L85E">
    <Modules>
      <Module Name="DI_01" CatalogNumber="1756-IB16" ParentModule="Local" ParentModPortId="1">
        <Communications>
          <Connections>
            <Connection Name="Data" RPI="20000" Type="Input" Priority="Scheduled" Unicast="false"/>
            <Connection Name="Output" RPI="10000" Type="Output" Priority="High" Unicast="true"/>
          </Connections>
        </Communications>
      </Module>
    </Modules>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — module connection metadata", () => {
  it("imports each <Connection>'s name, RPI, type, priority, and unicast flag", () => {
    const module = importL5X(XML).project.controllers[0]!.ioConfiguration.modules[0]!;
    expect(module.connections).toEqual([
      { name: "Data", rpi: 20000, type: "Input", priority: "Scheduled", unicast: false },
      { name: "Output", rpi: 10000, type: "Output", priority: "High", unicast: true },
    ]);
  });

  it("round-trips the connection settings through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const module = importL5X(xml).project.controllers[0]!.ioConfiguration.modules[0]!;
    expect(module.connections).toEqual([
      { name: "Data", rpi: 20000, type: "Input", priority: "Scheduled", unicast: false },
      { name: "Output", rpi: 10000, type: "Output", priority: "High", unicast: true },
    ]);
  });
});
