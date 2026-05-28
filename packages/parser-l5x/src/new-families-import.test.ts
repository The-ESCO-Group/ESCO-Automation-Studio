import { describe, expect, it } from "vitest";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// Representatives of every new instruction family: file (AVE/SRT), string (CONCAT),
// ASCII (ARD), motion (MCLM/MGS), and program control (UID/IOT).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="Fam">
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines>
          <Routine Name="Main" Type="RLL">
            <RLLContent>
              <Rung Number="0"><Text><![CDATA[AVE(Arr,Avg,Ctl,3);]]></Text></Rung>
              <Rung Number="1"><Text><![CDATA[SRT(Arr,Ctl,3);]]></Text></Rung>
              <Rung Number="2"><Text><![CDATA[CONCAT(StrA,StrB,Dst);]]></Text></Rung>
              <Rung Number="3"><Text><![CDATA[ARD(Ch0,Buf);]]></Text></Rung>
              <Rung Number="4"><Text><![CDATA[MCLM(Grp,Move);]]></Text></Rung>
              <Rung Number="5"><Text><![CDATA[MGS(Grp);]]></Text></Rung>
              <Rung Number="6"><Text><![CDATA[UID()IOT(Out);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const FAMILIES = ["AVE", "SRT", "CONCAT", "ARD", "MCLM", "MGS", "UID", "IOT"];

function mainTypes(project: ReturnType<typeof importL5X>["project"]): string[] {
  const ladder = project.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
  return routineNodes(ladder).map((n) => n.instructionType);
}

describe("importL5X — new instruction families", () => {
  it("imports without throwing and preserves every family as a node", () => {
    const { project, summary } = importL5X(XML);
    const types = mainTypes(project);
    for (const type of FAMILIES) expect(types).toContain(type);
    // Registered (executable or model-only) instructions are not "unsupported".
    for (const type of FAMILIES) expect(summary.unsupportedInstructions).not.toContain(type);
  });

  it("round-trips every family through export -> import", () => {
    const { project } = importL5X(XML);
    const reimported = importL5X(exportL5X(project).xml).project;
    const types = mainTypes(reimported);
    for (const type of FAMILIES) expect(types).toContain(type);
  });
});
