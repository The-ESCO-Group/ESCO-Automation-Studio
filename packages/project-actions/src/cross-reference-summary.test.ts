import { describe, expect, it } from "vitest";
import { importL5XFile, summarizeTagReferences } from "./index";

/**
 * The Cross Reference window groups every reference by tag and shows read vs.
 * destructive-write counts, while Verify flags declared-but-unused tags.
 * summarizeTagReferences rolls the flat collectTagReferences list into that view
 * and detects the unreferenced tags, scoping program tags by their qualified name.
 */
describe("project-actions: cross-reference summary", () => {
  const xml = `<?xml version="1.0"?>
<RSLogix5000Content><Controller Name="C">
  <Tags>
    <Tag Name="Input1" DataType="BOOL"/>
    <Tag Name="Output1" DataType="BOOL"/>
    <Tag Name="SpareCtrl" DataType="DINT"/>
  </Tags>
  <Programs><Program Name="MainProgram" MainRoutineName="Main">
    <Tags>
      <Tag Name="LocalUsed" DataType="BOOL"/>
      <Tag Name="LocalSpare" DataType="DINT"/>
    </Tags>
    <Routines><Routine Name="Main" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[XIC(Input1)OTE(Output1);]]></Text></Rung>
      <Rung Number="1"><Text><![CDATA[XIC(LocalUsed)OTE(Output1);]]></Text></Rung>
    </RLLContent></Routine></Routines>
  </Program></Programs>
</Controller></RSLogix5000Content>`;

  it("rolls up reads, writes, and distinct-routine counts per tag", () => {
    const { project } = importL5XFile(xml);
    const report = summarizeTagReferences(project);

    const output = report.tags.find((entry) => entry.tag === "Output1");
    expect(output?.total).toBe(2);
    expect(output?.writes).toBe(2);
    expect(output?.reads).toBe(0);
    expect(output?.routineCount).toBe(1);

    const input = report.tags.find((entry) => entry.tag === "Input1");
    expect(input?.reads).toBe(1);
    expect(input?.writes).toBe(0);
  });

  it("flags declared-but-unreferenced tags, qualifying program scope", () => {
    const { project } = importL5XFile(xml);
    const unreferenced = summarizeTagReferences(project).unreferencedTags.map((entry) => entry.tag);

    expect(unreferenced).toContain("SpareCtrl");
    expect(unreferenced).toContain("Program:MainProgram.LocalSpare");
    expect(unreferenced).not.toContain("Input1");
    expect(unreferenced).not.toContain("Program:MainProgram.LocalUsed");
  });

  it("returns tags sorted by name", () => {
    const { project } = importL5XFile(xml);
    const names = summarizeTagReferences(project).tags.map((entry) => entry.tag);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("classifies AHL masks as reads and control/status operands as writes", () => {
    const ahlXml = `<?xml version="1.0"?>
<RSLogix5000Content><Controller Name="C">
  <Tags>
    <Tag Name="ResetMask" DataType="DINT"/>
    <Tag Name="SetMask" DataType="DINT"/>
    <Tag Name="AhlCtl" DataType="CONTROL"/>
    <Tag Name="AhlStatus" DataType="DINT"/>
  </Tags>
  <Programs><Program Name="MainProgram" MainRoutineName="Main">
    <Routines><Routine Name="Main" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[AHL(0,ResetMask,SetMask,AhlCtl,AhlStatus);]]></Text></Rung>
    </RLLContent></Routine></Routines>
  </Program></Programs>
</Controller></RSLogix5000Content>`;
    const { project } = importL5XFile(ahlXml);
    const report = summarizeTagReferences(project);

    expect(report.tags.find((entry) => entry.tag === "ResetMask")).toMatchObject({ reads: 1, writes: 0 });
    expect(report.tags.find((entry) => entry.tag === "SetMask")).toMatchObject({ reads: 1, writes: 0 });
    expect(report.tags.find((entry) => entry.tag === "AhlCtl")).toMatchObject({ reads: 0, writes: 1 });
    expect(report.tags.find((entry) => entry.tag === "AhlStatus")).toMatchObject({ reads: 0, writes: 1 });
  });
});
