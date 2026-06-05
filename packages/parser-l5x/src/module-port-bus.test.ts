import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// A backplane port carries a <Bus Size="N"/> child giving the chassis slot count.
// This is read-only display metadata; it must survive import -> export -> import.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BusCtl" ProcessorType="1756-L85E">
    <Modules>
      <Module Name="Local" CatalogNumber="1756-L85E" ParentModule="Local" ParentModPortId="1">
        <Ports>
          <Port Id="1" Type="ICP" Address="0" Upstream="false"><Bus Size="17"/></Port>
        </Ports>
      </Module>
    </Modules>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — module port bus (chassis) size", () => {
  it("imports the backplane port's <Bus Size> as busSize", () => {
    const module = importL5X(XML).project.controllers[0]!.ioConfiguration.modules[0]!;
    expect(module.ports?.[0]?.busSize).toBe(17);
  });

  it("round-trips the bus size through export", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const port = importL5X(xml).project.controllers[0]!.ioConfiguration.modules[0]!.ports?.[0]!;
    expect(port.busSize).toBe(17);
  });
});
