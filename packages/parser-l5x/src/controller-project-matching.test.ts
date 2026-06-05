import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Almost every Logix <Controller> carries project/controller matching and
// firmware-update configuration: MatchProjectToController (whether the project
// is matched to a specific controller serial number before download) and
// InhibitAutomaticFirmwareUpdate (whether automatic firmware updates on connect
// are inhibited). This tool is offline-only and never talks to a controller,
// matches a serial number, or updates firmware, but these are project settings
// an engineer expects to keep, so they must survive export -> import rather than
// being silently dropped (mirrors the pass-through / language controller
// metadata).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="LineCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11" MatchProjectToController="true" InhibitAutomaticFirmwareUpdate="1">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller project matching / firmware-update metadata", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the MatchProjectToController / InhibitAutomaticFirmwareUpdate attributes verbatim", () => {
    const controller = controllerOf(XML);
    expect(controller.matchProjectToController).toBe("true");
    expect(controller.inhibitAutomaticFirmwareUpdate).toBe("1");
  });

  it("round-trips the project-matching metadata through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const controller = controllerOf(xml);
    expect(controller.matchProjectToController).toBe("true");
    expect(controller.inhibitAutomaticFirmwareUpdate).toBe("1");
  });

  it("leaves the fields undefined when the controller omits them", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    const controller = controllerOf(bare);
    expect(controller.matchProjectToController).toBeUndefined();
    expect(controller.inhibitAutomaticFirmwareUpdate).toBeUndefined();
  });
});
