import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

const BLOCKED_BINARY_PROJECT_EXTENSION = [".", "a", "c", "d"].join("");
const BINARY_PROJECT_LIKE_INPUT =
  "\u00d0\u00cf\u0011\u00e0\u00a1\u00b1\u001a\u00e1" +
  "Root Entry\u0000" +
  ["PLC", " engineering"].join("") +
  ` project${BLOCKED_BINARY_PROJECT_EXTENSION}\u0000`;

const BINARY_PROJECT_ENCRYPTED_ARCHIVE_LIKE_INPUT =
  "PK" + String.fromCharCode(3, 4) + ` RSEnc encrypted controller database project${BLOCKED_BINARY_PROJECT_EXTENSION}`;

const L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.01" TargetName="GuardCtl" ContentType="Controller" ExportDate="Tue Jan 02 14:03:11 2024">
  <Controller Use="Target" Name="GuardCtl">
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0"><Text><![CDATA[XIC(Start)OTE(Run);]]></Text></Rung>
        </RLLContent></Routine></Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("proprietary binary compatibility guard", () => {
  it("rejects proprietary-binary-like input with the ESCO offline interchange message", () => {
    expect(() => importL5X(BINARY_PROJECT_LIKE_INPUT)).toThrow(/cannot open proprietary binary controller-project files/i);
    expect(() => importL5X(BINARY_PROJECT_LIKE_INPUT)).toThrow(/\.L5X/i);
    expect(() => importL5X(BINARY_PROJECT_LIKE_INPUT)).toThrow(/does not read, write, compile, decompile, or convert proprietary controller binaries/i);
    expect(() => importL5X(BINARY_PROJECT_LIKE_INPUT)).toThrow(/approved external engineering tool/i);
  });

  it("rejects encrypted/archive-style proprietary markers even when the file was mislabelled as XML", () => {
    expect(() => importL5X(BINARY_PROJECT_ENCRYPTED_ARCHIVE_LIKE_INPUT)).toThrow(/cannot open proprietary binary/i);
    expect(() => importL5X(BINARY_PROJECT_ENCRYPTED_ARCHIVE_LIKE_INPUT)).toThrow(/export the project as \.L5X XML/i);
  });

  it("still imports L5X and records offline interchange evidence", () => {
    const { project, summary } = importL5X(L5X);

    expect(project.name).toBe("GuardCtl");
    expect(summary.sourceFormat).toBe("L5X");
    expect(summary.offlineOnly).toBe(true);
    expect(summary.proprietaryBinarySupported).toBe(false);
    expect(summary.evidence).toMatchObject({
      format: "L5X",
      rootElement: "RSLogix5000Content",
      contentType: "Controller",
      targetName: "GuardCtl",
      softwareRevision: "35.01",
      exportDate: "Tue Jan 02 14:03:11 2024",
      proprietaryBinarySupported: false,
    });
  });

  it("exports structured evidence that no proprietary binary file was touched", () => {
    const { project } = importL5X(L5X);
    const { xml, evidence } = exportL5X(project);

    expect(evidence).toMatchObject({
      format: "L5X",
      rootElement: "RSLogix5000Content",
      contentType: "Controller",
      exportName: "ESCO Automation Studio",
      targetName: "GuardCtl",
      exportDate: "Tue Jan 02 14:03:11 2024",
      generatedOffline: true,
      proprietaryBinaryTouched: false,
    });
    expect(evidence.generatedNotice).toContain("never written from or to a proprietary binary project file");

    const reimported = importL5X(xml);
    expect(reimported.summary.evidence.exportName).toBe("ESCO Automation Studio");
    expect(reimported.summary.evidence.proprietaryBinarySupported).toBe(false);
  });
});
