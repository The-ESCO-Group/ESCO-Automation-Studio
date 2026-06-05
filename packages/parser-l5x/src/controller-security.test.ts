import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Nearly every Logix <Controller> carries a <Security> child describing the
// project's source-protection security code, the change types tracked for the
// audit log, and (when the project is secured) the FactoryTalk security
// authority it is bound to. The simulator never enforces permissions or
// authenticates against a security authority, but these are project settings an
// engineer expects to keep, so they must survive export -> import rather than
// being silently dropped (mirrors <RedundancyInfo>).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="SecuredCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11">
    <Security Code="123456" ChangesToDetect="16#ffff_ffff_ffff_ffff" SecurityAuthorityID="{a1b2c3d4-0000-0000-0000-000000000000}" SecurityAuthorityName="ESCO-FTSecurity"/>
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller security", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the Security attributes verbatim", () => {
    const { security } = controllerOf(XML);
    expect(security).toEqual({
      code: "123456",
      changesToDetect: "16#ffff_ffff_ffff_ffff",
      securityAuthorityId: "{a1b2c3d4-0000-0000-0000-000000000000}",
      securityAuthorityName: "ESCO-FTSecurity",
    });
  });

  it("round-trips the security configuration through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const { security } = controllerOf(xml);
    expect(security).toEqual({
      code: "123456",
      changesToDetect: "16#ffff_ffff_ffff_ffff",
      securityAuthorityId: "{a1b2c3d4-0000-0000-0000-000000000000}",
      securityAuthorityName: "ESCO-FTSecurity",
    });
  });

  it("imports the common unsecured-project Security element (Code + ChangesToDetect only)", () => {
    const unsecured = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="PlainCtl" ProcessorType="1756-L83E">
    <Security Code="0" ChangesToDetect="16#ffff_ffff_ffff_ffff_ffff"/>
  </Controller>
</RSLogix5000Content>`;
    expect(controllerOf(unsecured).security).toEqual({
      code: "0",
      changesToDetect: "16#ffff_ffff_ffff_ffff_ffff",
    });
  });

  it("leaves security undefined when the controller omits it", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).security).toBeUndefined();
  });
});
