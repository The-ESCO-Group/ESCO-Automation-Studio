import { describe, expect, it } from "vitest";
import { deserializeProject, serializeProject } from "@esco/project-store";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// One program with all four routine languages: a ladder routine, a Structured
// Text routine (line-based source), a Function Block routine, and an SFC routine.
const MIXED = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="MixedCtl" ProcessorType="1756-L83E">
    <Tags>
      <Tag Name="Start" DataType="BOOL"/>
      <Tag Name="Run" DataType="BOOL"/>
      <Tag Name="Level" DataType="DINT"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="LadderMain">
        <Routines>
          <Routine Name="LadderMain" Type="RLL">
            <RLLContent>
              <Rung Number="0"><Text><![CDATA[XIC(Start)OTE(Run);]]></Text></Rung>
            </RLLContent>
          </Routine>
          <Routine Name="ScaleST" Type="ST">
            <STContent>
              <Line Number="0"><![CDATA[IF Start THEN]]></Line>
              <Line Number="1"><![CDATA[  Level := Level + 1;]]></Line>
              <Line Number="2"><![CDATA[END_IF;]]></Line>
            </STContent>
          </Routine>
          <Routine Name="LoopFBD" Type="FBD">
            <FBDContent SheetSize="Letter">
              <Sheet Number="0">
                <Block Type="PIDE" Operand="PIDE_01" Visible="true"/>
                <IRef Operand="Level"/>
                <Wire FromID="1" ToID="2"/>
              </Sheet>
            </FBDContent>
          </Routine>
          <Routine Name="SeqSFC" Type="SFC">
            <SFCContent>
              <Step Name="Step_000" InitialStep="true"/>
              <Transition Name="Tran_000"/>
              <Step Name="Step_001"/>
            </SFCContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

function routines(project: ReturnType<typeof importL5X>["project"]) {
  return project.controllers[0]!.programs[0]!.routines;
}

describe("importL5X — non-ladder routine languages", () => {
  it("detects each routine language from the Type attribute", () => {
    const byName = new Map(routines(importL5X(MIXED).project).map((r) => [r.name, r.language]));
    expect(byName.get("LadderMain")).toBe("ladder");
    expect(byName.get("ScaleST")).toBe("structured-text");
    expect(byName.get("LoopFBD")).toBe("function-block");
    expect(byName.get("SeqSFC")).toBe("sfc");
  });

  it("preserves Structured Text source line-by-line", () => {
    const st = routines(importL5X(MIXED).project).find((r) => r.name === "ScaleST")!;
    expect(st.ladder).toBeUndefined();
    expect(st.structuredText).toBe("IF Start THEN\n  Level := Level + 1;\nEND_IF;");
  });

  it("preserves Function Block structure as read-only source text", () => {
    const fbd = routines(importL5X(MIXED).project).find((r) => r.name === "LoopFBD")!;
    expect(fbd.ladder).toBeUndefined();
    expect(fbd.sourceText).toContain("Block");
    expect(fbd.sourceText).toContain("PIDE_01");
    expect(fbd.sourceText).toContain("IRef");
  });

  it("preserves SFC structure as read-only source text", () => {
    const sfc = routines(importL5X(MIXED).project).find((r) => r.name === "SeqSFC")!;
    expect(sfc.ladder).toBeUndefined();
    expect(sfc.sourceText).toContain("Step");
    expect(sfc.sourceText).toContain("Step_000");
    expect(sfc.sourceText).toContain("Transition");
  });

  it("warns (does not error) that non-ladder routines are read-only", () => {
    const { warnings } = importL5X(MIXED);
    expect(warnings.some((w) => /ScaleST.*read-only/.test(w))).toBe(true);
    expect(warnings.some((w) => /LoopFBD.*Function Block/.test(w))).toBe(true);
    expect(warnings.some((w) => /SeqSFC.*SFC/.test(w))).toBe(true);
  });

  it("counts non-ladder routines in the summary without crashing", () => {
    const { summary } = importL5X(MIXED);
    expect(summary.routines).toBe(4);
    expect(summary.rungs).toBe(1); // only the ladder routine has rungs
  });

  it("round-trips non-ladder routines through serialize/deserialize", () => {
    const { project } = importL5X(MIXED);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });

  it("exports without crashing and re-imports the Structured Text source", () => {
    const { project } = importL5X(MIXED);
    const { xml } = exportL5X(project);
    expect(() => importL5X(xml)).not.toThrow();
    const st = routines(importL5X(xml).project).find((r) => r.name === "ScaleST")!;
    expect(st.language).toBe("structured-text");
    expect(st.structuredText).toContain("Level := Level + 1;");
  });
});
