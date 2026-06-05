import { describe, expect, it } from "vitest";
import { collectTagReferences, importL5XFile } from "./index";

/**
 * Equipment-phase (PhaseManager) instructions are model-only (never simulated;
 * the phase state machine does not exist offline), but the external command /
 * attach blocks declare the equipment phase they command and update — and PXRQ
 * the PHASE_INSTRUCTION control tag it owns — as a single write review operand.
 * The cross-reference must surface those owned objects as destructive ("write")
 * references so the commanded phase appears in a Studio-style tag cross-reference,
 * mirroring the motion / alarm / process review-operand behaviour — see phase.ts.
 * This pins that wiring through the public collectTagReferences path (the
 * definition-level shape is covered by instructions/phase.test.ts).
 */
describe("project-actions: equipment-phase review-operand cross-reference", () => {
  const xml = `<?xml version="1.0"?>
<RSLogix5000Content><Controller Name="C">
  <Tags>
    <Tag Name="Mixer1" DataType="EQUIPMENT_PHASE"/>
    <Tag Name="XferReq" DataType="PHASE_INSTRUCTION"/>
  </Tags>
  <Programs><Program Name="MainProgram" MainRoutineName="Main">
    <Routines><Routine Name="Main" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[PATT(Mixer1);]]></Text></Rung>
      <Rung Number="1"><Text><![CDATA[PCMD(Mixer1,RESET,Result);]]></Text></Rung>
      <Rung Number="2"><Text><![CDATA[PXRQ(XferReq,DOWNLOAD INPUT PARAMETERS,Done,Error);]]></Text></Rung>
    </RLLContent></Routine></Routines>
  </Program></Programs>
</Controller></RSLogix5000Content>`;

  it("surfaces the commanded equipment phase as a destructive reference", () => {
    const { project } = importL5XFile(xml);
    const refs = collectTagReferences(project);

    const attach = refs.find((ref) => ref.tag === "Mixer1" && ref.instructionType === "PATT");
    expect(attach?.direction).toBe("write");

    const command = refs.find((ref) => ref.tag === "Mixer1" && ref.instructionType === "PCMD");
    expect(command?.direction).toBe("write");
  });

  it("surfaces the owned PHASE_INSTRUCTION control tag of PXRQ as destructive", () => {
    const { project } = importL5XFile(xml);
    const refs = collectTagReferences(project);

    const request = refs.find((ref) => ref.tag === "XferReq");
    expect(request?.instructionType).toBe("PXRQ");
    expect(request?.direction).toBe("write");
  });

  it("scopes a cross-reference query to the commanded equipment phase", () => {
    const { project } = importL5XFile(xml);
    const onlyMixer = collectTagReferences(project, "Mixer1");

    expect(onlyMixer.length).toBeGreaterThan(0);
    expect(onlyMixer.every((ref) => ref.tag === "Mixer1")).toBe(true);
  });
});
