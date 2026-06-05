import { describe, expect, it } from "vitest";
import { collectTagReferences, importL5XFile } from "./index";

/**
 * Motion instructions are model-only (never simulated, no real motion control),
 * but they declare review operands — the commanded motion object (Axis /
 * Coordinate System / Motion Group) and, for the single-axis and coordinated
 * forms, the Motion Control status tag. The cross-reference must surface those
 * review operands as destructive ("write") references so the commanded object
 * appears in a Studio-style tag cross-reference, mirroring the MSG/GSV/SSV
 * review-operand behaviour — see advanced.ts. This pins that wiring through the
 * public collectTagReferences path (the definition-level shape is covered by
 * instructions/process-safety.test.ts).
 */
describe("project-actions: motion review-operand cross-reference", () => {
  const xml = `<?xml version="1.0"?>
<RSLogix5000Content><Controller Name="C">
  <Tags>
    <Tag Name="Axis1" DataType="AXIS_VIRTUAL"/>
    <Tag Name="MoveCtl" DataType="MOTION_INSTRUCTION"/>
    <Tag Name="CoordSys" DataType="COORDINATE_SYSTEM"/>
    <Tag Name="PathCtl" DataType="MOTION_INSTRUCTION"/>
  </Tags>
  <Programs><Program Name="MainProgram" MainRoutineName="Main">
    <Routines><Routine Name="Main" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[MSO(Axis1,MoveCtl);]]></Text></Rung>
      <Rung Number="1"><Text><![CDATA[MCLM(CoordSys,PathCtl);]]></Text></Rung>
    </RLLContent></Routine></Routines>
  </Program></Programs>
</Controller></RSLogix5000Content>`;

  it("surfaces single-axis motion object and motion control as destructive references", () => {
    const { project } = importL5XFile(xml);
    const refs = collectTagReferences(project);

    const axis = refs.find((ref) => ref.tag === "Axis1");
    expect(axis?.instructionType).toBe("MSO");
    expect(axis?.direction).toBe("write");

    const control = refs.find((ref) => ref.tag === "MoveCtl");
    expect(control?.instructionType).toBe("MSO");
    expect(control?.direction).toBe("write");
  });

  it("surfaces a coordinated-motion coordinate system and motion control", () => {
    const { project } = importL5XFile(xml);
    const refs = collectTagReferences(project);

    expect(refs.find((ref) => ref.tag === "CoordSys")?.direction).toBe("write");
    expect(refs.find((ref) => ref.tag === "PathCtl")?.direction).toBe("write");
    expect(refs.find((ref) => ref.tag === "CoordSys")?.instructionType).toBe("MCLM");
  });

  it("scopes a cross-reference query to the commanded motion object", () => {
    const { project } = importL5XFile(xml);
    const onlyAxis = collectTagReferences(project, "Axis1");

    expect(onlyAxis.length).toBeGreaterThan(0);
    expect(onlyAxis.every((ref) => ref.tag === "Axis1")).toBe(true);
  });
});
