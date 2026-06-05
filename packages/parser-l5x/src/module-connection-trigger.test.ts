import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Beyond name/RPI/type/priority/unicast, an I/O module <Connection> carries
// quality-of-service metadata describing how input data is delivered
// (InputConnectionType), what triggers its production (InputProductionTrigger),
// and whether an output connection allows a redundant owner
// (OutputRedundantOwner). These are read-only; never used to open a real
// controller connection, but they must survive import -> export -> import.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="ConnCtl" ProcessorType="1756-L85E">
    <Modules>
      <Module Name="DI_01" CatalogNumber="1756-IB16" ParentModule="Local" ParentModPortId="1">
        <Communications>
          <Connections>
            <Connection Name="Data" RPI="20000" Type="Input" InputConnectionType="Multicast" InputProductionTrigger="Cyclic"/>
            <Connection Name="Output" RPI="10000" Type="Output" OutputRedundantOwner="false"/>
          </Connections>
        </Communications>
      </Module>
    </Modules>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — module connection trigger/ownership metadata", () => {
  it("imports InputConnectionType / InputProductionTrigger / OutputRedundantOwner", () => {
    const module = importL5X(XML).project.controllers[0]!.ioConfiguration.modules[0]!;
    expect(module.connections).toEqual([
      {
        name: "Data",
        rpi: 20000,
        type: "Input",
        inputConnectionType: "Multicast",
        inputProductionTrigger: "Cyclic",
      },
      { name: "Output", rpi: 10000, type: "Output", outputRedundantOwner: false },
    ]);
  });

  it("round-trips the trigger/ownership settings through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const module = importL5X(xml).project.controllers[0]!.ioConfiguration.modules[0]!;
    expect(module.connections).toEqual([
      {
        name: "Data",
        rpi: 20000,
        type: "Input",
        inputConnectionType: "Multicast",
        inputProductionTrigger: "Cyclic",
      },
      { name: "Output", rpi: 10000, type: "Output", outputRedundantOwner: false },
    ]);
  });
});
