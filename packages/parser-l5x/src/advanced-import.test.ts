import { describe, expect, it } from "vitest";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import { importL5X } from "./index";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="Adv">
    <Tags><Tag Name="Enable" DataType="BOOL"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines>
          <Routine Name="Main" Type="RLL">
            <RLLContent>
              <Rung Number="0"><Text><![CDATA[XIC(Enable)MSG(MsgCtl);]]></Text></Rung>
              <Rung Number="1"><Text><![CDATA[SQO(Seq,Mask,Dest,SeqCtl,4);]]></Text></Rung>
              <Rung Number="2"><Text><![CDATA[MSO(Axis1,MotionCtl);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — model-only advanced instructions", () => {
  it("preserves MSG/SQO/MSO as nodes and no longer reports them as unsupported", () => {
    const { project, summary } = importL5X(XML);
    const main = project.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    const types = routineNodes(main).map((n) => n.instructionType);
    expect(types).toContain("MSG");
    expect(types).toContain("SQO");
    expect(types).toContain("MSO");
    // Registered model-only instructions are recognized, so they are not "unsupported".
    expect(summary.unsupportedInstructions).not.toContain("MSG");
    expect(summary.unsupportedInstructions).not.toContain("SQO");
    expect(summary.unsupportedInstructions).not.toContain("MSO");
  });

  it("imports without throwing", () => {
    expect(() => importL5X(XML)).not.toThrow();
  });
});
