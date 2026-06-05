import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// A <Program> carries TestEdits="true" while it has pending online test edits
// (logic accepted into the running controller but not yet finalized). This tool
// is offline-only and never accepts, cancels, or assembles test edits, but the
// flag must survive export -> import so it is not silently dropped when an
// engineer round-trips a project that was exported mid-edit (mirrors Disabled).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="EditCtl" ProcessorType="1756-L8E" MajorRev="33" MinorRev="11">
    <Programs>
      <Program Name="EditingProg" TestEdits="true" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
      <Program Name="CleanProg" TestEdits="false" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — program TestEdits", () => {
  const programsOf = (xml: string) => {
    const controller = importL5X(xml).project.controllers[0]!;
    return (name: string) => controller.programs.find((p) => p.name === name)!;
  };

  it("imports TestEdits as the testEdits flag", () => {
    const program = programsOf(XML);
    expect(program("EditingProg").testEdits).toBe(true);
    // TestEdits="false" must not set the flag.
    expect(program("CleanProg").testEdits).toBeUndefined();
  });

  it("round-trips the pending-test-edits flag through export -> import", () => {
    const exported = exportL5X(importL5X(XML).project).xml;
    expect(exported).toContain('TestEdits="true"');
    const program = programsOf(exported);
    expect(program("EditingProg").testEdits).toBe(true);
    expect(program("CleanProg").testEdits).toBeUndefined();
  });
});
