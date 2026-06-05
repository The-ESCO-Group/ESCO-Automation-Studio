import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Nearly every Studio 5000 export stamps the <Controller> element with project
// documentation/audit timestamps: when the project was first created
// (ProjectCreationDate) and when it was last modified (LastModifiedDate). The
// simulator never parses or uses these, but they are project documentation an
// engineer expects to keep, so they must survive export -> import rather than
// being silently dropped (mirrors <WallClockTime> / project-matching metadata).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="AuditCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11"
      ProjectCreationDate="Tue Mar 12 09:15:23 2024" LastModifiedDate="Thu May 30 14:02:51 2024">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller audit timestamps", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the audit timestamps verbatim", () => {
    const controller = controllerOf(XML);
    expect(controller.projectCreationDate).toBe("Tue Mar 12 09:15:23 2024");
    expect(controller.lastModifiedDate).toBe("Thu May 30 14:02:51 2024");
  });

  it("round-trips the audit timestamps through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const controller = controllerOf(xml);
    expect(controller.projectCreationDate).toBe("Tue Mar 12 09:15:23 2024");
    expect(controller.lastModifiedDate).toBe("Thu May 30 14:02:51 2024");
  });

  it("leaves the timestamps undefined when the controller omits them", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    const controller = controllerOf(bare);
    expect(controller.projectCreationDate).toBeUndefined();
    expect(controller.lastModifiedDate).toBeUndefined();
  });
});
