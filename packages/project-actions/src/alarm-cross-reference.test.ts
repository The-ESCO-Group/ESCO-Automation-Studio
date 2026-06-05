import { describe, expect, it } from "vitest";
import { collectTagReferences, importL5XFile } from "./index";

/**
 * The alarm instructions (ALMA / ALMD) are model-only (never simulated), but each
 * backs an ALARM_ANALOG / ALARM_DIGITAL tag that the instruction owns and updates,
 * and reads an input. They declare those as review operands — the backing alarm
 * tag as a destructive ("write") reference and the In input as a "read" reference;
 * trailing program-command bits (ProgAck / ProgReset / ...) fall through to opN as
 * reads — see advanced.ts. The cross-reference must surface them that way so the
 * owned alarm tag appears as a destructive reference in a Studio-style tag
 * cross-reference, mirroring the motion / MSG / GSV / SSV review-operand behaviour.
 * This pins that wiring through the public collectTagReferences path (the
 * definition-level shape is covered by instructions/process-safety.test.ts).
 */
describe("project-actions: alarm review-operand cross-reference", () => {
  const xml = `<?xml version="1.0"?>
<RSLogix5000Content><Controller Name="C">
  <Tags>
    <Tag Name="LevelHigh" DataType="ALARM_ANALOG"/>
    <Tag Name="LevelPV" DataType="REAL"/>
    <Tag Name="DoorOpen" DataType="ALARM_DIGITAL"/>
    <Tag Name="DoorIn" DataType="BOOL"/>
    <Tag Name="AckBit" DataType="BOOL"/>
  </Tags>
  <Programs><Program Name="MainProgram" MainRoutineName="Main">
    <Routines><Routine Name="Main" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[ALMA(LevelHigh,LevelPV);]]></Text></Rung>
      <Rung Number="1"><Text><![CDATA[ALMD(DoorOpen,DoorIn,AckBit);]]></Text></Rung>
    </RLLContent></Routine></Routines>
  </Program></Programs>
</Controller></RSLogix5000Content>`;

  it("surfaces the analog alarm tag as a destructive reference and its In as a read", () => {
    const { project } = importL5XFile(xml);
    const refs = collectTagReferences(project);

    const alarm = refs.find((ref) => ref.tag === "LevelHigh");
    expect(alarm?.instructionType).toBe("ALMA");
    expect(alarm?.direction).toBe("write");

    const input = refs.find((ref) => ref.tag === "LevelPV");
    expect(input?.instructionType).toBe("ALMA");
    expect(input?.direction).toBe("read");
  });

  it("surfaces the digital alarm tag as destructive, its In and command bit as reads", () => {
    const { project } = importL5XFile(xml);
    const refs = collectTagReferences(project);

    expect(refs.find((ref) => ref.tag === "DoorOpen")?.direction).toBe("write");
    expect(refs.find((ref) => ref.tag === "DoorIn")?.direction).toBe("read");
    // Trailing program-command bit falls through to opN as a read reference.
    expect(refs.find((ref) => ref.tag === "AckBit")?.direction).toBe("read");
    expect(refs.find((ref) => ref.tag === "DoorOpen")?.instructionType).toBe("ALMD");
  });

  it("scopes a cross-reference query to the owned alarm tag", () => {
    const { project } = importL5XFile(xml);
    const onlyAlarm = collectTagReferences(project, "DoorOpen");

    expect(onlyAlarm.length).toBeGreaterThan(0);
    expect(onlyAlarm.every((ref) => ref.tag === "DoorOpen")).toBe(true);
  });
});
