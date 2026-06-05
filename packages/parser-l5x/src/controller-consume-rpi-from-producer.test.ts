import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Studio 5000 exports a controller-level flag for whether a consumed tag may
// adopt the connection RPI requested by its producer (it pairs with the
// produced/consumed tag <ConsumeInfo> RPI). Current references document
// CanUseRPIFromController while older/common exports use CanUseRPIFromProducer.
// The simulator never uses either spelling to schedule a connection or talk to a
// controller, but this configuration must survive export -> import rather than
// being silently dropped (mirrors the project-matching / minor-overflow metadata).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="ConsumeCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11"
      CanUseRPIFromProducer="true">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller CanUseRPIFromProducer", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the consumed-tag RPI-from-producer setting verbatim", () => {
    expect(controllerOf(XML).canUseRPIFromProducer).toBe("true");
  });

  it("round-trips the setting through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    expect(xml).toContain('CanUseRPIFromProducer="true"');
    expect(controllerOf(xml).canUseRPIFromProducer).toBe("true");
  });

  it("preserves the documented CanUseRPIFromController spelling", () => {
    const documented = XML.replace('CanUseRPIFromProducer="true"', 'CanUseRPIFromController="false"');

    const imported = controllerOf(documented);
    expect(imported.canUseRPIFromProducer).toBeUndefined();
    expect(imported.canUseRPIFromController).toBe("false");

    const { xml } = exportL5X(importL5X(documented).project);
    expect(xml).toContain('CanUseRPIFromController="false"');
    expect(controllerOf(xml).canUseRPIFromController).toBe("false");
  });

  it("leaves the setting undefined when the controller omits it", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).canUseRPIFromProducer).toBeUndefined();
  });
});
