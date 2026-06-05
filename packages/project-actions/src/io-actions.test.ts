import { describe, expect, it } from "vitest";
import { exportProjectL5X, importL5XFile, importProjectFile } from "./io-actions";

const BLOCKED_BINARY_PROJECT_EXTENSION = [".", "a", "c", "d"].join("");
const BINARY_PROJECT_LIKE_INPUT =
  "\u00d0\u00cf\u0011\u00e0\u00a1\u00b1\u001a\u00e1" +
  "Root Entry\u0000" +
  ["external", " engineering"].join("") +
  ` project${BLOCKED_BINARY_PROJECT_EXTENSION}\u0000`;

const L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.01" TargetName="ActionCtl" ContentType="Controller">
  <Controller Use="Target" Name="ActionCtl">
    <Tags><Tag Name="Start" DataType="BOOL"/><Tag Name="Run" DataType="BOOL"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0"><Text><![CDATA[XIC(Start)OTE(Run);]]></Text></Rung>
        </RLLContent></Routine></Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("project-actions IO guard", () => {
  it("rejects proprietary-binary-like input with the ESCO offline interchange message", () => {
    const l5xResult = importL5XFile(BINARY_PROJECT_LIKE_INPUT);
    const projectResult = importProjectFile(BINARY_PROJECT_LIKE_INPUT);

    expect(l5xResult.ok).toBe(false);
    expect(l5xResult.error).toMatch(/ESCO offline interchange/i);
    expect(l5xResult.error).toMatch(/proprietary binary controller-project files/i);
    expect(l5xResult.error).toMatch(/\.L5X/i);

    expect(projectResult.ok).toBe(false);
    expect(projectResult.error).toMatch(/ESCO offline interchange/i);
    expect(projectResult.error).toMatch(/Proprietary binary controller-project files/i);
    expect(projectResult.error).toMatch(/\.L5X/i);
  });

  it("keeps L5X import/export supported and exposes round-trip evidence", () => {
    const imported = importL5XFile(L5X);
    expect(imported.ok).toBe(true);
    expect(imported.project.name).toBe("ActionCtl");
    expect(imported.data?.summary.sourceFormat).toBe("L5X");
    expect(imported.data?.summary.proprietaryBinarySupported).toBe(false);

    const exported = exportProjectL5X(imported.project);
    expect(exported.ok).toBe(true);
    expect(exported.data?.evidence.generatedOffline).toBe(true);
    expect(exported.data?.evidence.proprietaryBinaryTouched).toBe(false);
    expect(exported.data?.text).toContain("Generated offline by ESCO Automation Studio");

    const reimported = importL5XFile(exported.data!.text);
    expect(reimported.ok).toBe(true);
    expect(reimported.data?.summary.evidence.exportName).toBe("ESCO Automation Studio");
  });
});
