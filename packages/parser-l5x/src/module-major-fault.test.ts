import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// A module's `MajorFault` attribute decides whether losing its connection in
// Run mode faults the controller. It is read-only configuration metadata that
// must survive import -> export -> import.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="FaultCtl" ProcessorType="1756-L85E">
    <Modules>
      <Module Name="DI_Crit" CatalogNumber="1756-IB16" ParentModule="Local" ParentModPortId="1" MajorFault="true">
        <Ports>
          <Port Id="1" Type="Backplane" Address="3"/>
        </Ports>
      </Module>
      <Module Name="DI_NonCrit" CatalogNumber="1756-IB16" ParentModule="Local" ParentModPortId="1" MajorFault="false">
        <Ports>
          <Port Id="1" Type="Backplane" Address="4"/>
        </Ports>
      </Module>
    </Modules>
  </Controller>
</RSLogix5000Content>`;

const modulesOf = (xml: string) => importL5X(xml).project.controllers[0]!.ioConfiguration.modules;

describe("importL5X — module MajorFault flag", () => {
  it("imports MajorFault=\"true\" as majorFault, omits it otherwise", () => {
    const [crit, nonCrit] = modulesOf(XML);
    expect(crit!.majorFault).toBe(true);
    expect(nonCrit!.majorFault).toBeUndefined();
  });

  it("round-trips the MajorFault flag through export", () => {
    const [crit, nonCrit] = modulesOf(exportL5X(importL5X(XML).project).xml);
    expect(crit!.majorFault).toBe(true);
    expect(nonCrit!.majorFault).toBeUndefined();
  });
});
