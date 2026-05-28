import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { routineNodes, type LadderRoutine } from "@esco/ladder";
import { createRuntime } from "@esco/simulator";
import { deserializeProject, serializeProject } from "@esco/project-store";
import { importL5X, parseRungText } from "./index";

const registry = createDefaultRegistry();
const opValues = (text: string) =>
  parseRungText(text, registry).root.nodes.map((n) => [n.instructionType, ...n.operands.map((o) => o.value)]);

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="DemoController" ContentType="Controller">
  <Controller Use="Target" Name="DemoController" ProcessorType="Emulator">
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="StopPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="MotorRun" TagType="Base" DataType="BOOL"/>
      <Tag Name="SomeDint" TagType="Base" DataType="DINT"/>
      <Tag Name="Timer1" TagType="Base" DataType="TIMER"/>
      <Tag Name="Count1" TagType="Base" DataType="COUNTER"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Tags>
          <Tag Name="LocalFlag" TagType="Base" DataType="BOOL"/>
        </Tags>
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N">
                <Comment><![CDATA[Start / stop motor]]></Comment>
                <Text><![CDATA[XIC(StartPB)XIO(StopPB)OTE(MotorRun);]]></Text>
              </Rung>
              <Rung Number="1" Type="N">
                <Text><![CDATA[XIC(StartPB)TON(Timer1,1000);]]></Text>
              </Rung>
              <Rung Number="2" Type="N">
                <Text><![CDATA[XIC(StartPB)MOV(123,SomeDint);]]></Text>
              </Rung>
              <Rung Number="3" Type="N">
                <Text><![CDATA[XIC(StartPB)ADD(SomeDint,1,SomeDint);]]></Text>
              </Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks>
      <Task Name="MainTask" Type="CONTINUOUS">
        <ScheduledPrograms>
          <ScheduledProgram Name="MainProgram"/>
        </ScheduledPrograms>
      </Task>
    </Tasks>
  </Controller>
</RSLogix5000Content>`;

function mainLadder(project: ReturnType<typeof importL5X>["project"]): LadderRoutine {
  return project.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
}

describe("parseRungText", () => {
  it("parses XIC(StartPB) XIO(StopPB) OTE(MotorRun)", () => {
    expect(opValues("XIC(StartPB)XIO(StopPB)OTE(MotorRun);")).toEqual([
      ["XIC", "StartPB"],
      ["XIO", "StopPB"],
      ["OTE", "MotorRun"],
    ]);
  });

  it("parses TON(Timer1, 1000)", () => {
    expect(opValues("TON(Timer1,1000)")).toEqual([["TON", "Timer1", "1000"]]);
  });

  it("parses MOV(123, SomeDint)", () => {
    expect(opValues("MOV(123,SomeDint)")).toEqual([["MOV", "123", "SomeDint"]]);
  });

  it("parses EQU(SomeDint, 123)", () => {
    expect(opValues("EQU(SomeDint,123)")).toEqual([["EQU", "SomeDint", "123"]]);
  });

  it("preserves unsupported instructions and reports them", () => {
    const parsed = parseRungText("XIC(StartPB)ADD(SomeDint,1,SomeDint);", registry);
    expect(parsed.unsupportedTypes).toContain("ADD");
    expect(parsed.root.nodes.map((n) => n.instructionType)).toEqual(["XIC", "ADD"]);
  });
});

describe("importL5X (fixture)", () => {
  it("extracts the controller, tags, program, routine, and rungs", () => {
    const { project, warnings } = importL5X(FIXTURE);

    expect(project.name).toBe("DemoController");
    const controller = project.controllers[0]!;
    expect(controller.name).toBe("DemoController");
    expect(controller.controllerTags.map((t) => t.name)).toEqual([
      "StartPB",
      "StopPB",
      "MotorRun",
      "SomeDint",
      "Timer1",
      "Count1",
    ]);
    expect(controller.controllerTags.find((t) => t.name === "Timer1")?.dataType).toBe("TIMER");

    const program = controller.programs[0]!;
    expect(program.name).toBe("MainProgram");
    expect(program.programTags.map((t) => t.name)).toEqual(["LocalFlag"]);

    const routine = program.routines[0]!;
    expect(program.mainRoutineId).toBe(routine.id);

    const ladder = mainLadder(project);
    expect(ladder.rungs).toHaveLength(4);
    expect(ladder.rungs[0]!.comment).toBe("Start / stop motor");
    expect(ladder.rungs[0]!.sourceText).toContain("OTE(MotorRun)");

    expect(controller.tasks[0]!.name).toBe("MainTask");
    expect(controller.tasks[0]!.scheduledProgramIds).toEqual([program.id]);

    // The ADD on rung 3 is unsupported and surfaced as a warning.
    expect(warnings.some((w) => w.includes("ADD"))).toBe(true);
  });

  it("rejects non-L5X input with a clear error", () => {
    expect(() => importL5X("{ not xml")).toThrow(/L5X/i);
  });
});

describe("L5X → domain → .plcproj.json round trip", () => {
  it("preserves the imported project through serialize/deserialize", () => {
    const { project } = importL5X(FIXTURE);
    const restored = deserializeProject(serializeProject(project));
    expect(restored).toEqual(project);
    expect(routineNodes(mainLadder(restored)).map((n) => n.instructionType)).toEqual([
      "XIC", "XIO", "OTE", "XIC", "TON", "XIC", "MOV", "XIC", "ADD",
    ]);
  });
});

describe("Imported supported logic simulates", () => {
  it("scans the imported MainRoutine (XIC/OTE, TON, MOV; ADD passes through)", () => {
    const { project } = importL5X(FIXTURE);
    const runtime = createRuntime({ routine: mainLadder(project), tags: [], registry });

    runtime.writeTag("StartPB", true);
    runtime.scanOnce(1000); // advance timers by 1000 ms

    expect(runtime.readTag("MotorRun")).toBe(true); // XIC(StartPB) XIO(StopPB) OTE(MotorRun)
    expect(runtime.readTag("SomeDint")).toBe(123); // MOV(123, SomeDint)
    expect(runtime.readTag("Timer1.DN")).toBe(true); // TON(Timer1, 1000) after 1000 ms
  });
});
