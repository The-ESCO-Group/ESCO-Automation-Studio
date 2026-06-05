import { describe, expect, it } from "vitest";
import { collectTagReferences, importL5XFile } from "./index";

/**
 * The GuardLogix safety instructions (ESTOP, DCS, ...) are model-only (never
 * simulated and no real safety evaluation), but each backs a predefined safety
 * structure tag that the instruction owns and updates (its status members). They
 * declare that backing tag as a single review operand with a destructive
 * ("write") direction — see safety.ts. The cross-reference must surface it that
 * way so the owned safety tag appears as a destructive reference in a
 * Studio-style tag cross-reference, mirroring the alarm / motion / phase /
 * MSG / GSV / SSV review-operand behaviour. This pins that wiring through the
 * public collectTagReferences path (the definition-level shape is covered by
 * instructions/process-safety.test.ts).
 */
describe("project-actions: safety review-operand cross-reference", () => {
  const xml = `<?xml version="1.0"?>
<RSLogix5000Content><Controller Name="C">
  <Tags>
    <Tag Name="EStopButton" DataType="ESTOP"/>
    <Tag Name="GateStop" DataType="DCS"/>
  </Tags>
  <Programs><Program Name="MainProgram" MainRoutineName="Main">
    <Routines><Routine Name="Main" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[ESTOP(EStopButton);]]></Text></Rung>
      <Rung Number="1"><Text><![CDATA[DCS(GateStop);]]></Text></Rung>
    </RLLContent></Routine></Routines>
  </Program></Programs>
</Controller></RSLogix5000Content>`;

  it("surfaces the backing safety tag as a destructive reference", () => {
    const { project } = importL5XFile(xml);
    const refs = collectTagReferences(project);

    const estop = refs.find((ref) => ref.tag === "EStopButton");
    expect(estop?.instructionType).toBe("ESTOP");
    expect(estop?.direction).toBe("write");

    const dcs = refs.find((ref) => ref.tag === "GateStop");
    expect(dcs?.instructionType).toBe("DCS");
    expect(dcs?.direction).toBe("write");
  });

  it("scopes a cross-reference query to the owned safety tag", () => {
    const { project } = importL5XFile(xml);
    const onlyEstop = collectTagReferences(project, "EStopButton");

    expect(onlyEstop.length).toBeGreaterThan(0);
    expect(onlyEstop.every((ref) => ref.tag === "EStopButton")).toBe(true);
    expect(onlyEstop.every((ref) => ref.direction === "write")).toBe(true);
  });
});
