import { describe, expect, it } from "vitest";
import { collectTagReferences, importL5XFile, summarizeTagReferences } from "./index";

/**
 * Studio's Cross Reference resolves the individual tag operands *inside* a CPT /
 * CMP expression, not just plain instruction operands — and it keeps a program
 * tag's `Program:ProgramName.Tag` scope when that tag belongs to a foreign
 * program. These cases lock in that an expression operand reaching across to
 * another program's tag is cross-referenced under its qualified name (and so is
 * counted as referenced, rather than flagged unused).
 */
describe("project-actions: cross-reference of expression operands", () => {
  const xml = `<?xml version="1.0"?>
<RSLogix5000Content><Controller Name="C">
  <Tags>
    <Tag Name="Result" DataType="DINT"/>
    <Tag Name="Limit" DataType="DINT"/>
  </Tags>
  <Programs>
    <Program Name="OtherProg" MainRoutineName="Main">
      <Tags>
        <Tag Name="Remote" DataType="DINT"/>
        <Tag Name="Spare" DataType="DINT"/>
      </Tags>
      <Routines><Routine Name="Main" Type="RLL"><RLLContent>
        <Rung Number="0"><Text><![CDATA[NOP();]]></Text></Rung>
      </RLLContent></Routine></Routines>
    </Program>
    <Program Name="MainProgram" MainRoutineName="Main">
      <Routines><Routine Name="Main" Type="RLL"><RLLContent>
        <Rung Number="0"><Text><![CDATA[CPT(Result,Program:OtherProg.Remote + Limit);]]></Text></Rung>
        <Rung Number="1"><Text><![CDATA[CMP(Program:OtherProg.Remote > Limit)OTE(Result);]]></Text></Rung>
      </RLLContent></Routine></Routines>
    </Program>
  </Programs>
</Controller></RSLogix5000Content>`;

  it("resolves a foreign program tag used inside a CPT/CMP expression under its qualified name", () => {
    const { project } = importL5XFile(xml);
    const refs = collectTagReferences(project, "Program:OtherProg.Remote");

    // Once in the CPT expression, once in the CMP expression — both reads.
    expect(refs.length).toBe(2);
    expect(refs.every((ref) => ref.direction === "read")).toBe(true);
    expect(refs.map((ref) => ref.instructionType).sort()).toEqual(["CMP", "CPT"]);
    // The reference lives in the calling program, but the tag keeps its own scope.
    expect(refs.every((ref) => ref.programName === "MainProgram")).toBe(true);
  });

  it("counts an expression-only program tag as referenced, not unused", () => {
    const { project } = importL5XFile(xml);
    const report = summarizeTagReferences(project);
    const unreferenced = report.unreferencedTags.map((entry) => entry.tag);

    expect(unreferenced).not.toContain("Program:OtherProg.Remote");
    // A genuinely unused sibling program tag is still flagged.
    expect(unreferenced).toContain("Program:OtherProg.Spare");

    const remote = report.tags.find((entry) => entry.tag === "Program:OtherProg.Remote");
    expect(remote?.reads).toBe(2);
    expect(remote?.writes).toBe(0);
  });
});
