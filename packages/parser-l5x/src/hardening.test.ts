import { describe, expect, it } from "vitest";
import { routineNodes, rungToText, type LadderRoutine } from "@esco/ladder";
import type { Routine } from "@esco/core";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

/**
 * Import/export hardening: edge-case L5X content must survive a full
 * export → import round trip with its operands, comments, and instruction types
 * intact — whether the instruction is executable, model-only (process / safety /
 * motion), or a completely unknown vendor block. Nothing is ever silently
 * dropped, and unsupported/model-only logic is surfaced as warnings, not errors.
 */

const ladderOf = (routine: Routine): LadderRoutine => routine.ladder as LadderRoutine;

function mainLadder(xmlText: string, programName = "MainProgram"): LadderRoutine {
  const project = importL5X(xmlText).project;
  const program = project.controllers[0]!.programs.find((p) => p.name === programName)!;
  const main = program.routines.find((r) => r.id === program.mainRoutineId) ?? program.routines[0]!;
  return ladderOf(main);
}

const EDGE_CASES = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="EdgeCtl" ContentType="Controller">
  <Controller Use="Target" Name="EdgeCtl">
    <Tags>
      <Tag Name="Enable" TagType="Base" DataType="BOOL"/>
      <Tag Name="Loop1" TagType="Base" DataType="PID"/>
      <Tag Name="PVin" TagType="Base" DataType="DINT"/>
      <Tag Name="CVout" TagType="Base" DataType="DINT"/>
      <Tag Name="EStopOK" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines>
          <Routine Name="Main" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Comment><![CDATA[Process loop — review only]]></Comment><Text><![CDATA[XIC(Enable)PID(Loop1,PVin,0,CVout);]]></Text></Rung>
              <Rung Number="1" Type="N"><Comment><![CDATA[Safety estop]]></Comment><Text><![CDATA[ESTOP(EStopOK);]]></Text></Rung>
              <Rung Number="2" Type="N"><Text><![CDATA[XIC(Enable)XUNKNOWN(Foo,Bar,Baz);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("import/export hardening — round-trip preservation", () => {
  it("preserves a model-only PID with all its operands through export → import", () => {
    const { project: p1 } = importL5X(EDGE_CASES);
    const nodes = routineNodes(mainLadder(exportL5X(p1).xml));
    const pid = nodes.find((n) => n.instructionType === "PID")!;
    expect(pid).toBeDefined();
    expect(pid.operands.map((o) => o.value)).toEqual(["Loop1", "PVin", "0", "CVout"]);
  });

  it("preserves a model-only safety instruction (ESTOP)", () => {
    const { project: p1 } = importL5X(EDGE_CASES);
    const nodes = routineNodes(mainLadder(exportL5X(p1).xml));
    expect(nodes.map((n) => n.instructionType)).toContain("ESTOP");
  });

  it("preserves an unknown vendor block with every operand", () => {
    const { project: p1 } = importL5X(EDGE_CASES);
    const nodes = routineNodes(mainLadder(exportL5X(p1).xml));
    const unknown = nodes.find((n) => n.instructionType === "XUNKNOWN")!;
    expect(unknown).toBeDefined();
    expect(unknown.operands.map((o) => o.value)).toEqual(["Foo", "Bar", "Baz"]);
  });

  it("preserves rung comments through the round trip", () => {
    const { project: p1 } = importL5X(EDGE_CASES);
    const ladder = mainLadder(exportL5X(p1).xml);
    expect(ladder.rungs[0]!.comment).toBe("Process loop — review only");
    expect(ladder.rungs[1]!.comment).toBe("Safety estop");
  });

  it("re-serializes the model-only PID rung to identical neutral text", () => {
    const ladder = mainLadder(EDGE_CASES);
    expect(rungToText(ladder.rungs[0]!)).toBe("XIC(Enable)PID(Loop1,PVin,0,CVout)");
  });

  it("warns about the unknown block but NOT about the model-only process/safety blocks", () => {
    const { project } = importL5X(EDGE_CASES);
    const { warnings } = exportL5X(project);
    expect(warnings.some((w) => w.includes("XUNKNOWN"))).toBe(true);
    // PID and ESTOP are recognized model-only — they must not be reported as unsupported.
    expect(warnings.some((w) => /\bPID\b/.test(w) && /unsupported/i.test(w))).toBe(false);
    expect(warnings.some((w) => /\bESTOP\b/.test(w) && /unsupported/i.test(w))).toBe(false);
  });

  it("reports the model-only instructions in the import summary, separate from unsupported", () => {
    const { summary } = importL5X(EDGE_CASES);
    expect(summary.unsupportedInstructions).toContain("XUNKNOWN");
    expect(summary.unsupportedInstructions).not.toContain("PID");
    expect(summary.unsupportedInstructions).not.toContain("ESTOP");
  });
});
