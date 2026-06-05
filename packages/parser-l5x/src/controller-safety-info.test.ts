import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Nearly every GuardLogix <Controller> carries a <SafetyInfo> child describing
// whether the safety task is locked, its safety signature, and the
// signature/IO configuration policy. The simulator never verifies safety
// signatures or enforces locking, but these are project settings an engineer
// expects to keep, so they must survive export -> import rather than being
// silently dropped (mirrors <RedundancyInfo>).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="SafeCtl" ProcessorType="1756-L8SP" MajorRev="33" MinorRev="11">
    <SafetyInfo SafetyEnabled="true" SafetyLocked="true" SafetySignatureID="16#abcd_1234" SafetySignatureTimestamp="2024-09-18T13:45:21.000Z" SignatureRunModeProtect="false" ConfigureSafetyIOAlways="true" SafetyLevel="SIL2/PLd"/>
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller safety info", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the SafetyInfo attributes verbatim", () => {
    const { safetyInfo } = controllerOf(XML);
    expect(safetyInfo).toEqual({
      safetyEnabled: "true",
      safetyLocked: true,
      safetySignatureId: "16#abcd_1234",
      safetySignatureTimestamp: "2024-09-18T13:45:21.000Z",
      signatureRunModeProtect: false,
      configureSafetyIOAlways: true,
      safetyLevel: "SIL2/PLd",
    });
  });

  it("round-trips the safety configuration through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const { safetyInfo } = controllerOf(xml);
    expect(safetyInfo).toEqual({
      safetyEnabled: "true",
      safetyLocked: true,
      safetySignatureId: "16#abcd_1234",
      safetySignatureTimestamp: "2024-09-18T13:45:21.000Z",
      signatureRunModeProtect: false,
      configureSafetyIOAlways: true,
      safetyLevel: "SIL2/PLd",
    });
  });

  it("round-trips the <SafetyTagMap> child element through export -> import", () => {
    // GuardLogix projects with standard <-> safety tag mapping carry the
    // mapping in a <SafetyTagMap> child element (not an attribute). It must
    // survive export -> import rather than being dropped when <SafetyInfo> is
    // re-emitted.
    const withTagMap = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="SafeCtl" ProcessorType="1756-L8SP" MajorRev="33" MinorRev="11">
    <SafetyInfo SafetyEnabled="true" SafetyLocked="true">
      <SafetyTagMap>StdOK,SafeOK StdRun,SafeRun</SafetyTagMap>
    </SafetyInfo>
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;
    expect(controllerOf(withTagMap).safetyInfo?.safetyTagMap).toBe(
      "StdOK,SafeOK StdRun,SafeRun",
    );
    const { xml } = exportL5X(importL5X(withTagMap).project);
    expect(controllerOf(xml).safetyInfo?.safetyTagMap).toBe(
      "StdOK,SafeOK StdRun,SafeRun",
    );
  });

  it("leaves safetyInfo undefined when the controller omits it", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    expect(controllerOf(bare).safetyInfo).toBeUndefined();
  });
});
