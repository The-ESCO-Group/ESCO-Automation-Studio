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

describe("parseRungText branches", () => {
  it("parses a single-level parallel branch into the AST", () => {
    const parsed = parseRungText("[XIC(Start),XIC(Run)]XIO(Stop)OTE(Run);", registry);
    expect(parsed.complexBranch).toBe(false);
    // group at start: root.nodes empty, root.next is the parallel group
    expect(parsed.root.next?.parallelBranches?.length).toBe(1);
  });

  it("flattens a nested branch and flags it", () => {
    const parsed = parseRungText("[XIC(A)[XIC(B),XIC(C)],XIC(D)]OTE(E);", registry);
    expect(parsed.complexBranch).toBe(true);
    expect(parsed.root.nodes.map((n) => n.instructionType)).toEqual(["XIC", "XIC", "XIC", "XIC", "OTE"]);
  });
});

// A more realistic export: one controller + task, two programs, controller and
// program tags (with descriptions), a branch routine, an unsupported-instruction
// routine, and TIMER/COUNTER tags.
const REALISTIC = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="PlantController" ProcessorType="1756-L83E">
    <Tags>
      <Tag Name="Start" TagType="Base" DataType="BOOL"><Description><![CDATA[Master start]]></Description></Tag>
      <Tag Name="Stop" TagType="Base" DataType="BOOL"/>
      <Tag Name="Run" TagType="Base" DataType="BOOL"/>
      <Tag Name="Aux" TagType="Base" DataType="BOOL"/>
      <Tag Name="Motor" TagType="Base" DataType="BOOL"/>
      <Tag Name="Level" TagType="Base" DataType="DINT"><Description><![CDATA[Tank level]]></Description></Tag>
      <Tag Name="Setpoint" TagType="Base" DataType="DINT"/>
      <Tag Name="CycleTimer" TagType="Base" DataType="TIMER"/>
      <Tag Name="PartCounter" TagType="Base" DataType="COUNTER"/>
    </Tags>
    <Programs>
      <Program Name="Conveyor" MainRoutineName="Main">
        <Description><![CDATA[Conveyor control]]></Description>
        <Tags>
          <Tag Name="LocalJam" TagType="Base" DataType="BOOL"><Description><![CDATA[Local jam flag]]></Description></Tag>
        </Tags>
        <Routines>
          <Routine Name="Main" Type="RLL">
            <Description><![CDATA[Conveyor main]]></Description>
            <RLLContent>
              <Rung Number="0" Type="N"><Comment><![CDATA[Seal-in with run feedback]]></Comment><Text><![CDATA[[XIC(Start),XIC(Run)]XIO(Stop)OTE(Run);]]></Text></Rung>
              <Rung Number="1" Type="N"><Text><![CDATA[XIC(Run)TON(CycleTimer,2000);]]></Text></Rung>
              <Rung Number="2" Type="N"><Text><![CDATA[XIC(CycleTimer.DN)OTE(Motor);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
      <Program Name="Mixer" MainRoutineName="Logic">
        <Routines>
          <Routine Name="Logic" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(Start)CTU(PartCounter,5);]]></Text></Rung>
              <Rung Number="1" Type="N"><Text><![CDATA[XIC(Start)ADD(Level,1,Level)JSR(SubRoutine);]]></Text></Rung>
              <Rung Number="2" Type="N"><Text><![CDATA[GRT(Level,Setpoint)OTE(Motor);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks>
      <Task Name="MainTask" Type="CONTINUOUS">
        <ScheduledPrograms>
          <ScheduledProgram Name="Conveyor"/>
          <ScheduledProgram Name="Mixer"/>
        </ScheduledPrograms>
      </Task>
    </Tasks>
  </Controller>
</RSLogix5000Content>`;

function programLadder(project: ReturnType<typeof importL5X>["project"], programName: string): LadderRoutine {
  const program = project.controllers[0]!.programs.find((p) => p.name === programName)!;
  const main = program.routines.find((r) => r.id === program.mainRoutineId)!;
  return main.ladder as LadderRoutine;
}

describe("importL5X (realistic fixture)", () => {
  it("reports an accurate import summary", () => {
    const { summary } = importL5X(REALISTIC);
    expect(summary.programs).toBe(2);
    expect(summary.routines).toBe(2);
    expect(summary.rungs).toBe(6);
    expect(summary.tags).toBe(10); // 9 controller + 1 program
    expect(summary.unsupportedInstructions).toEqual(["ADD", "JSR"]);
  });

  it("extracts descriptions on tags, programs, and routines", () => {
    const { project } = importL5X(REALISTIC);
    const controller = project.controllers[0]!;
    expect(controller.controllerTags.find((t) => t.name === "Start")?.description).toBe("Master start");
    const conveyor = controller.programs.find((p) => p.name === "Conveyor")!;
    expect(conveyor.description).toBe("Conveyor control");
    expect(conveyor.programTags[0]?.description).toBe("Local jam flag");
    expect(conveyor.routines[0]?.description).toBe("Conveyor main");
  });

  it("imports TIMER/COUNTER tags and the scheduled task", () => {
    const { project } = importL5X(REALISTIC);
    const controller = project.controllers[0]!;
    expect(controller.controllerTags.find((t) => t.name === "CycleTimer")?.dataType).toBe("TIMER");
    expect(controller.controllerTags.find((t) => t.name === "PartCounter")?.dataType).toBe("COUNTER");
    expect(controller.tasks[0]?.scheduledProgramIds).toHaveLength(2);
  });

  it("preserves unsupported instructions (ADD, JSR) as nodes", () => {
    const { project } = importL5X(REALISTIC);
    const types = routineNodes(programLadder(project, "Mixer")).map((n) => n.instructionType);
    expect(types).toContain("ADD");
    expect(types).toContain("JSR");
  });

  it("simulates the imported branch (seal-in) routine", () => {
    const { project } = importL5X(REALISTIC);
    const runtime = createRuntime({ routine: programLadder(project, "Conveyor"), tags: [], registry });

    runtime.writeTag("Start", true);
    runtime.scanOnce(2000);
    expect(runtime.readTag("Run")).toBe(true); // (Start | Run) & !Stop
    expect(runtime.readTag("CycleTimer.DN")).toBe(true); // TON reached 2000ms
    expect(runtime.readTag("Motor")).toBe(true); // XIC(CycleTimer.DN) OTE(Motor)

    runtime.writeTag("Start", false);
    runtime.scanOnce(0);
    expect(runtime.readTag("Run")).toBe(true); // sealed in by XIC(Run)

    runtime.writeTag("Stop", true);
    runtime.scanOnce(0);
    expect(runtime.readTag("Run")).toBe(false); // stop breaks the seal
  });
});
