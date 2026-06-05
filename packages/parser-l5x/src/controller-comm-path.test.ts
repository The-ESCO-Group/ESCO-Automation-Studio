import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Many Studio 5000 exports stamp the <Controller> element with the last-used
// communication path/driver (CommPath/CommDriver) that the workstation used to
// connect to the controller. This tool is offline-only and never connects to,
// goes online with, or talks to a controller, but the path is configuration an
// engineer expects to keep, so it must survive export -> import rather than being
// silently dropped (mirrors the project-matching / audit-timestamp metadata).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="CommPathCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11"
      CommPath="AB_ETHIP-1\\192.168.1.10\\Backplane\\0" CommDriver="AB_ETHIP-1">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller CommPath/CommDriver", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the communication path and driver verbatim", () => {
    const controller = controllerOf(XML);
    expect(controller.commPath).toBe("AB_ETHIP-1\\192.168.1.10\\Backplane\\0");
    expect(controller.commDriver).toBe("AB_ETHIP-1");
  });

  it("round-trips the path and driver through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const controller = controllerOf(xml);
    expect(controller.commPath).toBe("AB_ETHIP-1\\192.168.1.10\\Backplane\\0");
    expect(controller.commDriver).toBe("AB_ETHIP-1");
  });

  it("leaves the path and driver undefined when the controller omits them", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    const controller = controllerOf(bare);
    expect(controller.commPath).toBeUndefined();
    expect(controller.commDriver).toBeUndefined();
  });
});
