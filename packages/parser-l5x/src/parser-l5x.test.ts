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
                <Text><![CDATA[XIC(StartPB)PID(SubRoutine);]]></Text>
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
    const parsed = parseRungText("XIC(StartPB)PID(SubRoutine);", registry);
    expect(parsed.unsupportedTypes).toContain("PID");
    expect(parsed.root.nodes.map((n) => n.instructionType)).toEqual(["XIC", "PID"]);
  });

  it("parses the new core instructions with named operands", () => {
    expect(opValues("XIC(Btn)ONS(OneShot)CTD(Down,0);")).toEqual([
      ["XIC", "Btn"],
      ["ONS", "OneShot"],
      ["CTD", "Down", "0"],
    ]);
    expect(opValues("XIC(Run)RTO(DwellTimer,5000);")).toEqual([
      ["XIC", "Run"],
      ["RTO", "DwellTimer", "5000"],
    ]);
    expect(opValues("XIC(Off)TOF(OffTimer,1000);")).toEqual([
      ["XIC", "Off"],
      ["TOF", "OffTimer", "1000"],
    ]);
    expect(opValues("XIC(Rst)RES(DwellTimer);")).toEqual([
      ["XIC", "Rst"],
      ["RES", "DwellTimer"],
    ]);
  });

  it("treats the new instructions as supported (none flagged unsupported)", () => {
    const parsed = parseRungText("ONS(B)TOF(T,1000)RTO(T2,500)CTD(C,0)RES(T)NOP()AFI();", registry);
    expect(parsed.unsupportedTypes).toEqual([]);
    expect(parsed.root.nodes.map((n) => n.instructionType)).toEqual([
      "ONS", "TOF", "RTO", "CTD", "RES", "NOP", "AFI",
    ]);
  });

  it("treats the compute/bitwise instructions as supported", () => {
    const parsed = parseRungText("AND(A,B,D)OR(A,B,D)XOR(A,B,D)NOT(A,D)MOD(A,B,D)SQR(A,D)NEG(A,D)ABS(A,D)CLR(D)LIM(0,X,10)MEQ(S,M,C);", registry);
    expect(parsed.unsupportedTypes).toEqual([]);
    expect(parsed.root.nodes.map((n) => n.instructionType)).toEqual([
      "AND", "OR", "XOR", "NOT", "MOD", "SQR", "NEG", "ABS", "CLR", "LIM", "MEQ",
    ]);
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

    // The PID on rung 3 is unsupported and surfaced as a warning.
    expect(warnings.some((w) => w.includes("PID"))).toBe(true);
  });

  it("rejects non-L5X input with a clear error", () => {
    expect(() => importL5X("{ not xml")).toThrow(/L5X/i);
  });

  it("reports an import duration metric", () => {
    const { summary } = importL5X(FIXTURE);
    expect(typeof summary.durationMs).toBe("number");
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("L5X → domain → .plcproj.json round trip", () => {
  it("preserves the imported project through serialize/deserialize", () => {
    const { project } = importL5X(FIXTURE);
    const restored = deserializeProject(serializeProject(project));
    expect(restored).toEqual(project);
    expect(routineNodes(mainLadder(restored)).map((n) => n.instructionType)).toEqual([
      "XIC", "XIO", "OTE", "XIC", "TON", "XIC", "MOV", "XIC", "PID",
    ]);
  });
});

describe("Imported supported logic simulates", () => {
  it("scans the imported MainRoutine (XIC/OTE, TON, MOV; PID passes through)", () => {
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
              <Rung Number="1" Type="N"><Text><![CDATA[XIC(Start)ADD(Level,1,Level)PID(SubRoutine);]]></Text></Rung>
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
    expect(summary.unsupportedInstructions).toEqual(["PID"]);
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

  it("preserves all instructions as nodes, including the unsupported PID", () => {
    const { project } = importL5X(REALISTIC);
    const types = routineNodes(programLadder(project, "Mixer")).map((n) => n.instructionType);
    expect(types).toContain("ADD"); // supported
    expect(types).toContain("PID"); // unsupported, preserved read-only
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

// A stress fixture: two programs/routines, controller + program tags, an alias
// tag, an unmodeled UDT data type, descriptions, a branch, the new core
// instructions (ONS/RES/RTO/TOF/CTD), UDT-member and array operand paths, and an
// unsupported instruction (PID).
const STRESS = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="PlantStress" ProcessorType="1756-L85E">
    <Tags>
      <Tag Name="Start" TagType="Base" DataType="BOOL"><Description><![CDATA[Master start]]></Description></Tag>
      <Tag Name="Stop" TagType="Base" DataType="BOOL"/>
      <Tag Name="Run" TagType="Base" DataType="BOOL"/>
      <Tag Name="Reset" TagType="Base" DataType="BOOL"/>
      <Tag Name="OneShot" TagType="Base" DataType="BOOL"/>
      <Tag Name="DwellTimer" TagType="Base" DataType="TIMER"/>
      <Tag Name="OffDelay" TagType="Base" DataType="TIMER"/>
      <Tag Name="PartCounter" TagType="Base" DataType="COUNTER"/>
      <Tag Name="Level" TagType="Base" DataType="DINT"/>
      <Tag Name="MyArray" TagType="Base" DataType="DINT" Dimensions="8"/>
      <Tag Name="PumpData" TagType="Base" DataType="PumpUdt"/>
      <Tag Name="PumpRun" TagType="Base" DataType="BOOL"/>
      <Tag Name="MotorCmd" TagType="Alias" AliasFor="Run"/>
    </Tags>
    <Programs>
      <Program Name="Sequencer" MainRoutineName="Cycle">
        <Tags>
          <Tag Name="LocalStep" TagType="Base" DataType="DINT"/>
        </Tags>
        <Routines>
          <Routine Name="Cycle" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Comment><![CDATA[Seal-in]]></Comment><Text><![CDATA[[XIC(Start),XIC(Run)]XIO(Stop)OTE(Run);]]></Text></Rung>
              <Rung Number="1" Type="N"><Text><![CDATA[XIC(Run)RTO(DwellTimer,5000);]]></Text></Rung>
              <Rung Number="2" Type="N"><Text><![CDATA[XIC(DwellTimer.DN)ONS(OneShot)CTU(PartCounter,10);]]></Text></Rung>
              <Rung Number="3" Type="N"><Text><![CDATA[XIC(Reset)RES(DwellTimer)RES(PartCounter);]]></Text></Rung>
              <Rung Number="4" Type="N"><Text><![CDATA[XIC(Start)TOF(OffDelay,2000);]]></Text></Rung>
              <Rung Number="5" Type="N"><Text><![CDATA[MOV(MyArray[0],Level);]]></Text></Rung>
              <Rung Number="6" Type="N"><Text><![CDATA[XIC(Start)PID(SubRoutine);]]></Text></Rung>
              <Rung Number="7" Type="N"><Text><![CDATA[XIC(PumpData.Status.Running)OTE(PumpRun);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
      <Program Name="Aux" MainRoutineName="Faults">
        <Routines>
          <Routine Name="Faults" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(Stop)CTD(PartCounter,0);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X (stress fixture)", () => {
  it("parses programs, routines, rungs, and tags", () => {
    const { summary } = importL5X(STRESS);
    expect(summary.programs).toBe(2);
    expect(summary.routines).toBe(2);
    expect(summary.rungs).toBe(9); // 8 in Cycle + 1 in Faults
    expect(summary.tags).toBe(14); // 13 controller + 1 program
  });

  it("treats only PID as unsupported (the new instructions are supported)", () => {
    const { summary } = importL5X(STRESS);
    expect(summary.unsupportedInstructions).toEqual(["PID"]);
  });

  it("warns about the unsupported instruction with routine/rung location", () => {
    const { warnings } = importL5X(STRESS);
    const jsr = warnings.find((w) => w.includes("PID"));
    expect(jsr).toBeDefined();
    expect(jsr).toMatch(/Sequencer\/Cycle rung 6/);
  });

  it("imports an alias tag and warns about it", () => {
    const { project, warnings } = importL5X(STRESS);
    const motorCmd = project.controllers[0]!.controllerTags.find((t) => t.name === "MotorCmd");
    expect(motorCmd?.aliasFor).toBe("Run");
    expect(warnings.some((w) => w.includes("MotorCmd") && /alias/i.test(w))).toBe(true);
  });

  it("imports an array tag's first dimension", () => {
    const { project } = importL5X(STRESS);
    const myArray = project.controllers[0]!.controllerTags.find((t) => t.name === "MyArray");
    expect(myArray?.dimension).toBe(8);
  });

  it("warns about an unmodeled (UDT) data type", () => {
    const { warnings } = importL5X(STRESS);
    expect(warnings.some((w) => w.includes("PumpData") && w.includes("PumpUdt"))).toBe(true);
  });

  it("preserves the unsupported instruction as a node", () => {
    const { project } = importL5X(STRESS);
    const types = routineNodes(programLadder(project, "Sequencer")).map((n) => n.instructionType);
    expect(types).toContain("PID");
    expect(types).toContain("RTO");
    expect(types).toContain("ONS");
  });

  it("round-trips through serialize/deserialize after import", () => {
    const { project } = importL5X(STRESS);
    const restored = deserializeProject(serializeProject(project));
    expect(restored).toEqual(project);
  });

  it("simulates without crashing on the unsupported instruction", () => {
    const { project } = importL5X(STRESS);
    const runtime = createRuntime({ routine: programLadder(project, "Sequencer"), tags: [], registry });
    runtime.writeTag("Start", true);
    runtime.scanOnce(6000); // long enough for RTO to finish
    expect(runtime.readTag("Run")).toBe(true); // seal-in energizes despite PID pass-through
    expect(runtime.readTag("DwellTimer.DN")).toBe(true); // RTO reached preset
  });
});

const STRUCTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content>
  <Controller Use="Target" Name="StructCtl">
    <DataTypes>
      <DataType Name="MotorUdt">
        <Description><![CDATA[Motor status UDT]]></Description>
        <Members>
          <Member Name="Running" DataType="BOOL"><Description><![CDATA[Run feedback]]></Description></Member>
          <Member Name="Speed" DataType="DINT"/>
          <Member Name="History" DataType="DINT" Dimension="8"/>
        </Members>
      </DataType>
    </DataTypes>
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="ScaleAOI" Revision="2.1">
        <Description><![CDATA[Analog scaler]]></Description>
        <Parameters>
          <Parameter Name="In" DataType="REAL" Usage="Input" Required="true" Default="0.0"><Description><![CDATA[Raw input]]></Description></Parameter>
          <Parameter Name="Out" DataType="REAL" Usage="Output"/>
        </Parameters>
        <LocalTags>
          <LocalTag Name="Scratch" DataType="DINT"><Description><![CDATA[scratch]]></Description></LocalTag>
        </LocalTags>
        <Routines><Routine Name="Logic" Type="RLL"/></Routines>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
    <Modules>
      <Module Name="Local" CatalogNumber="1756-L83E" Slot="0"/>
      <Module Name="DI_01" CatalogNumber="1756-IB16" Slot="1" ParentModule="Local"><Description><![CDATA[Field inputs]]></Description></Module>
    </Modules>
    <Tags><Tag Name="Start" DataType="BOOL"/><Tag Name="Run" DataType="BOOL"/><Tag Name="ScaleInst" DataType="ScaleAOI"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0"><Text><![CDATA[XIC(Start)OTE(Run);]]></Text></Rung>
          <Rung Number="1"><Text><![CDATA[ScaleAOI(ScaleInst);]]></Text></Rung>
        </RLLContent></Routine></Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X (structure: UDT / AOI / I/O)", () => {
  it("imports user-defined types with their members (incl. array dimension)", () => {
    const controller = importL5X(STRUCTURE).project.controllers[0]!;
    expect(controller.dataTypes).toHaveLength(1);
    const udt = controller.dataTypes[0]!;
    expect(udt.name).toBe("MotorUdt");
    expect(udt.description).toBe("Motor status UDT");
    expect(udt.members.map((m) => `${m.name}:${m.dataType}`)).toEqual([
      "Running:BOOL",
      "Speed:DINT",
      "History:DINT",
    ]);
    expect(udt.members[0]!.description).toBe("Run feedback");
    expect(udt.members.find((m) => m.name === "History")?.dimension).toBe(8);
  });

  it("imports Add-On Instruction definitions with parameters, local tags, and routines", () => {
    const aoi = importL5X(STRUCTURE).project.controllers[0]!.addOnInstructions[0]!;
    expect(aoi.name).toBe("ScaleAOI");
    expect(aoi.description).toBe("Analog scaler");
    expect(aoi.revision).toBe("2.1");
    expect(aoi.parameters.map((p) => `${p.name}:${p.usage}`)).toEqual(["In:Input", "Out:Output"]);
    expect(aoi.parameters[0]!.required).toBe(true);
    expect(aoi.parameters[0]!.defaultValue).toBe("0.0");
    expect(aoi.parameters[0]!.description).toBe("Raw input");
    expect(aoi.localTags.map((t) => t.name)).toEqual(["Scratch"]);
    expect(aoi.routineNames).toEqual(["Logic"]);
  });

  it("imports a module description and parent module", () => {
    const di = importL5X(STRUCTURE).project.controllers[0]!.ioConfiguration.modules.find(
      (m) => m.name === "DI_01",
    )!;
    expect(di.description).toBe("Field inputs");
    expect(di.parentModule).toBe("Local");
  });

  it("imports the I/O module tree with catalog and slot", () => {
    const controller = importL5X(STRUCTURE).project.controllers[0]!;
    expect(controller.ioConfiguration.modules.map((m) => m.name)).toEqual(["Local", "DI_01"]);
    const di = controller.ioConfiguration.modules.find((m) => m.name === "DI_01")!;
    expect(di.catalogNumber).toBe("1756-IB16");
    expect(di.slot).toBe(1);
  });

  it("round-trips structure metadata through serialize/deserialize", () => {
    const { project } = importL5X(STRUCTURE);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });
});
