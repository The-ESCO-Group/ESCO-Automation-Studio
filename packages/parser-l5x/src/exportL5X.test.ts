import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
  type Program,
} from "@esco/core";
import { createDefaultRegistry } from "@esco/instructions";
import {
  createBranch,
  createLadderRoutine,
  createNode,
  createRung,
  routineNodes,
  rungToText,
  tagOperand,
  type LadderRoutine,
} from "@esco/ladder";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";
import { parseRungText } from "./parseRungText";

const registry = createDefaultRegistry();

function ladderOf(routine: { ladder?: unknown }): LadderRoutine | undefined {
  const ladder = routine.ladder;
  if (ladder && typeof ladder === "object" && Array.isArray((ladder as { rungs?: unknown }).rungs)) {
    return ladder as LadderRoutine;
  }
  return undefined;
}

/**
 * A volatile-id-free, comparable view of a project: ids and per-rung source
 * text are dropped, references are resolved to names, and ladder logic is
 * reduced to neutral rung text. Two projects with equal normal forms are
 * "equivalent" for round-trip purposes.
 */
function normalize(project: PlcProject) {
  const controller = project.controllers[0]!;
  const normTag = (t: {
    name: string;
    scope: string;
    dataType: string;
    dimension?: number;
    description?: string;
    aliasFor?: string;
  }) => ({
    name: t.name,
    scope: t.scope,
    dataType: t.dataType,
    dimension: t.dimension,
    description: t.description,
    aliasFor: t.aliasFor,
  });

  const mainRoutineName = (program: Program) =>
    program.routines.find((r) => r.id === program.mainRoutineId)?.name;

  return {
    name: project.name,
    controller: {
      name: controller.name,
      processorType: controller.processorType,
      tags: controller.controllerTags.map(normTag),
      dataTypes: controller.dataTypes.map((dt) => ({
        name: dt.name,
        description: dt.description,
        members: dt.members.map((m) => ({
          name: m.name,
          dataType: m.dataType,
          dimension: m.dimension,
          description: m.description,
        })),
      })),
      aois: controller.addOnInstructions.map((aoi) => ({
        name: aoi.name,
        revision: aoi.revision,
        signature: aoi.signature,
        protected: aoi.protected,
        protectionType: aoi.protectionType,
        parameters: aoi.parameters,
        localTags: aoi.localTags,
        routineNames: aoi.routineNames,
      })),
      modules: controller.ioConfiguration.modules.map((m) => ({
        name: m.name,
        catalogNumber: m.catalogNumber,
        slot: m.slot,
        description: m.description,
        parentModule: m.parentModule,
        commPath: m.commPath,
      })),
      programs: controller.programs.map((program) => ({
        name: program.name,
        description: program.description,
        mainRoutine: mainRoutineName(program),
        programTags: program.programTags.map(normTag),
        routines: program.routines.map((routine) => ({
          name: routine.name,
          description: routine.description,
          language: routine.language,
          rungs: (ladderOf(routine)?.rungs ?? [])
            .slice()
            .sort((a, b) => a.number - b.number)
            .map((rung) => ({ number: rung.number, comment: rung.comment, text: rungToText(rung) })),
        })),
      })),
      tasks: controller.tasks.map((task) => ({
        name: task.name,
        type: task.type,
        scheduled: task.scheduledProgramIds.map(
          (id) => controller.programs.find((p) => p.id === id)?.name,
        ),
      })),
    },
  };
}

// Exercises tags (BOOL/DINT/TIMER/COUNTER/array/alias/descriptions), program
// tags, a parallel seal-in branch, a TON, an unsupported PID, a second program,
// scheduled tasks, plus read-only structure (UDT / AOI incl. protected / I/O).
const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="PlantController" ProcessorType="1756-L83E">
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
      <AddOnInstructionDefinition Name="VendorAOI" Revision="3.0" SignatureID="16#abcd_1234" SourceProtectionType="Protected">
        <Description><![CDATA[Vendor-sealed instruction]]></Description>
        <Parameters><Parameter Name="Enable" DataType="BOOL" Usage="Input" Required="true"/></Parameters>
        <EncodedData EncodedType="EncryptedData"><![CDATA[QUJDREVG]]></EncodedData>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
    <Modules>
      <Module Name="Local" CatalogNumber="1756-L83E" Slot="0"/>
      <Module Name="DI_01" CatalogNumber="1756-IB16" Slot="1" ParentModule="Local"><Description><![CDATA[Field inputs]]></Description></Module>
    </Modules>
    <Tags>
      <Tag Name="Start" TagType="Base" DataType="BOOL"><Description><![CDATA[Master start]]></Description></Tag>
      <Tag Name="Stop" TagType="Base" DataType="BOOL"/>
      <Tag Name="Run" TagType="Base" DataType="BOOL"/>
      <Tag Name="Motor" TagType="Base" DataType="BOOL"/>
      <Tag Name="Level" TagType="Base" DataType="DINT"><Description><![CDATA[Tank level]]></Description></Tag>
      <Tag Name="CycleTimer" TagType="Base" DataType="TIMER"/>
      <Tag Name="PartCounter" TagType="Base" DataType="COUNTER"/>
      <Tag Name="MyArray" TagType="Base" DataType="DINT" Dimensions="8"/>
      <Tag Name="MotorCmd" TagType="Alias" AliasFor="Run"/>
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

describe("exportL5X — generated-file basics", () => {
  it("produces a valid L5X that re-imports without error", () => {
    const { project } = importL5X(FIXTURE);
    const { xml } = exportL5X(project);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(() => importL5X(xml)).not.toThrow();
  });

  it("embeds an honest 'generated offline' notice and never claims to be a Studio 5000 file", () => {
    const { project } = importL5X(FIXTURE);
    const { xml } = exportL5X(project);
    expect(xml).toContain("Generated offline by ESCO Automation Studio");
    expect(xml).toContain("not an original Studio 5000 export");
    expect(xml).toContain("never written from or to an .ACD file");
  });

  it("warns that unsupported instructions are preserved (not simulated) and protected AOIs are metadata-only", () => {
    const { project } = importL5X(FIXTURE);
    const { warnings } = exportL5X(project);
    expect(warnings.some((w) => w.includes("PID"))).toBe(true);
    expect(warnings.some((w) => w.includes("VendorAOI") && /source-protected/i.test(w))).toBe(true);
  });
});

describe("exportL5X — import → export → import round trip", () => {
  it("is semantically equivalent after a full round trip", () => {
    const { project: p1 } = importL5X(FIXTURE);
    const { xml } = exportL5X(p1);
    const { project: p2 } = importL5X(xml);
    expect(normalize(p2)).toEqual(normalize(p1));
  });

  it("preserves the unsupported PID instruction through the round trip", () => {
    const { project: p1 } = importL5X(FIXTURE);
    const { project: p2 } = importL5X(exportL5X(p1).xml);
    const mixer = p2.controllers[0]!.programs.find((p) => p.name === "Mixer")!;
    const logic = ladderOf(mixer.routines.find((r) => r.id === mixer.mainRoutineId)!)!;
    expect(routineNodes(logic).map((n) => n.instructionType)).toContain("PID");
  });

  it("preserves the parallel seal-in branch through the round trip", () => {
    const { project: p1 } = importL5X(FIXTURE);
    const { project: p2 } = importL5X(exportL5X(p1).xml);
    const conveyor = p2.controllers[0]!.programs.find((p) => p.name === "Conveyor")!;
    const main = ladderOf(conveyor.routines[0]!)!;
    expect(rungToText(main.rungs[0]!)).toBe("[XIC(Start),XIC(Run)]XIO(Stop)OTE(Run)");
  });

  it("preserves read-only structure (UDT / protected AOI / I/O) through the round trip", () => {
    const { project: p1 } = importL5X(FIXTURE);
    const { project: p2 } = importL5X(exportL5X(p1).xml);
    const c = p2.controllers[0]!;
    expect(c.dataTypes.map((d) => d.name)).toEqual(["MotorUdt"]);
    expect(c.ioConfiguration.modules.map((m) => m.name)).toEqual(["Local", "DI_01"]);
    const vendor = c.addOnInstructions.find((a) => a.name === "VendorAOI")!;
    expect(vendor.protected).toBe(true);
    expect(vendor.signature).toBe("16#abcd_1234");
  });
});

describe("exportL5X — round-trips an app-authored project (not from import)", () => {
  function buildProject(): PlcProject {
    const project = createProject("AuthoredCtl");
    const controller = createController(project.id, "AuthoredCtl");
    controller.processorType = "1756-L85E";
    controller.controllerTags.push(
      createTag(controller.id, "Start", "BOOL", { value: false, description: "Start PB" }),
      createTag(controller.id, "Stop", "BOOL", { value: false }),
      createTag(controller.id, "Run", "BOOL", { value: false }),
      createTag(controller.id, "Count", "DINT", { value: 0 }),
    );
    const program = createProgram(controller.id, "MainProgram");
    program.description = "Authored program";
    const routine = createRoutine(program.id, "MainRoutine", "ladder");
    program.mainRoutineId = routine.id;
    const ladder = createLadderRoutine();
    // Seal-in: [XIC(Start),XIC(Run)]XIO(Stop)OTE(Run)
    const sealIn = createBranch([createNode("XIC", [tagOperand("operand", "Start")])], {
      parallelBranches: [createBranch([createNode("XIC", [tagOperand("operand", "Run")])])],
      next: createBranch([
        createNode("XIO", [tagOperand("operand", "Stop")]),
        createNode("OTE", [tagOperand("operand", "Run")]),
      ]),
    });
    const rung0 = createRung(ladder.id, 0, [], "Seal-in");
    rung0.root = sealIn;
    ladder.rungs.push(rung0);
    ladder.rungs.push(
      createRung(ladder.id, 1, [
        createNode("XIC", [tagOperand("operand", "Run")]),
        createNode("CTU", [tagOperand("counter", "Count"), tagOperand("preset", "5")]),
      ]),
    );
    routine.ladder = ladder;
    program.routines.push(routine);
    controller.programs.push(program);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
    project.controllers.push(controller);
    return project;
  }

  it("round-trips authored logic, tags, and the scheduled task", () => {
    const authored = buildProject();
    const { project: reimported } = importL5X(exportL5X(authored).xml);
    expect(normalize(reimported)).toEqual(normalize(authored));
  });
});

describe("exportL5X — degenerate inputs never crash", () => {
  it("exports an empty (no-controller) project with a warning and a re-importable shell", () => {
    const empty = createProject("EmptyProj");
    const { xml, warnings } = exportL5X(empty);
    expect(warnings.some((w) => /no controller/i.test(w))).toBe(true);
    expect(() => importL5X(xml)).not.toThrow();
    expect(importL5X(xml).project.controllers[0]!.name).toBe("EmptyProj");
  });
});

describe("rungToText is the inverse of parseRungText for supported shapes", () => {
  for (const text of [
    "XIC(Start)XIO(Stop)OTE(Run)",
    "[XIC(Start),XIC(Run)]XIO(Stop)OTE(Run)",
    "XIC(Run)TON(CycleTimer,2000)",
    "XIC(Start)PID(SubRoutine)",
  ]) {
    it(`re-serializes ${text} unchanged`, () => {
      const parsed = parseRungText(text, registry);
      const rung = createRung("r", 0);
      rung.root = parsed.root;
      expect(rungToText(rung)).toBe(text);
    });
  }
});
