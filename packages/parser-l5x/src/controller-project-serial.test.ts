import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// When MatchProjectToController is enabled, a Logix <Controller> also carries
// the target controller's serial number in a ProjectSN attribute (e.g.
// "16#0000_1a2b"). This tool is offline-only and never matches a serial number
// or talks to a controller, but the serial is a project setting an engineer
// expects to keep, so it must survive export -> import rather than being
// silently dropped (mirrors the MatchProjectToController metadata it pairs with).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="LineCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11" MatchProjectToController="true" ProjectSN="16#0000_1a2b">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller project serial number metadata", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the ProjectSN attribute verbatim", () => {
    const controller = controllerOf(XML);
    expect(controller.projectSN).toBe("16#0000_1a2b");
  });

  it("round-trips the project serial number through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const controller = controllerOf(xml);
    expect(controller.projectSN).toBe("16#0000_1a2b");
    expect(controller.matchProjectToController).toBe("true");
  });

  it("leaves projectSN undefined when the controller omits it", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    const controller = controllerOf(bare);
    expect(controller.projectSN).toBeUndefined();
  });
});
