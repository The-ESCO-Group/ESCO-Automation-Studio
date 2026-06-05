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
    externalAccess?: string;
    constant?: boolean;
    produced?: boolean;
    consumed?: boolean;
  }) => ({
    name: t.name,
    scope: t.scope,
    dataType: t.dataType,
    dimension: t.dimension,
    description: t.description,
    aliasFor: t.aliasFor,
    externalAccess: t.externalAccess,
    constant: t.constant,
    produced: t.produced,
    consumed: t.consumed,
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
        parentPortId: m.parentPortId,
        commPath: m.commPath,
        vendor: m.vendor,
        productType: m.productType,
        productCode: m.productCode,
        majorRevision: m.majorRevision,
        minorRevision: m.minorRevision,
        electronicKeying: m.electronicKeying,
        inhibited: m.inhibited,
        ports: m.ports,
      })),
      programs: controller.programs.map((program) => ({
        name: program.name,
        description: program.description,
        inhibited: program.inhibited,
        mainRoutine: mainRoutineName(program),
        faultRoutine: program.faultRoutineId
          ? program.routines.find((r) => r.id === program.faultRoutineId)?.name
          : undefined,
        parameters: program.parameters,
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
// tags, a parallel seal-in branch, a TON, an unsupported XUNKNOWN, a second program,
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
      <Module Name="DI_01" CatalogNumber="1756-IB16" Vendor="1" ProductType="7" ProductCode="16" Major="3" Minor="2" ElectronicKeying="CompatibleModule" Inhibited="true" ParentModule="Local" ParentModPortId="1">
        <Description><![CDATA[Field inputs]]></Description>
        <Ports>
          <Port Id="1" Type="Backplane" Address="1" Upstream="true"/>
          <Port Id="2" Type="Ethernet" Address="192.168.1.20"/>
        </Ports>
      </Module>
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
              <Rung Number="1" Type="N"><Text><![CDATA[XIC(Start)ADD(Level,1,Level)XUNKNOWN(SubRoutine);]]></Text></Rung>
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

  it("embeds an honest 'generated offline' notice and never claims to be an original vendor export", () => {
    const { project } = importL5X(FIXTURE);
    const { xml } = exportL5X(project);
    expect(xml).toContain("Generated offline by ESCO Automation Studio");
    expect(xml).toContain("not an original vendor export");
    expect(xml).toContain("never written from or to a proprietary binary project file");
  });

  it("warns that unsupported instructions are preserved (not simulated) and protected AOIs are metadata-only", () => {
    const { project } = importL5X(FIXTURE);
    const { warnings } = exportL5X(project);
    expect(warnings.some((w) => w.includes("XUNKNOWN"))).toBe(true);
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

  it("preserves the unsupported XUNKNOWN instruction through the round trip", () => {
    const { project: p1 } = importL5X(FIXTURE);
    const { project: p2 } = importL5X(exportL5X(p1).xml);
    const mixer = p2.controllers[0]!.programs.find((p) => p.name === "Mixer")!;
    const logic = ladderOf(mixer.routines.find((r) => r.id === mixer.mainRoutineId)!)!;
    expect(routineNodes(logic).map((n) => n.instructionType)).toContain("XUNKNOWN");
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
    const di = c.ioConfiguration.modules.find((m) => m.name === "DI_01")!;
    expect(di).toMatchObject({
      catalogNumber: "1756-IB16",
      vendor: "1",
      productType: "7",
      productCode: "16",
      majorRevision: "3",
      minorRevision: "2",
      electronicKeying: "CompatibleModule",
      inhibited: true,
      parentModule: "Local",
      parentPortId: "1",
      slot: 1,
    });
    expect(di.ports).toEqual([
      { id: "1", type: "Backplane", address: "1", upstream: true },
      { id: "2", type: "Ethernet", address: "192.168.1.20" },
    ]);
    const vendor = c.addOnInstructions.find((a) => a.name === "VendorAOI")!;
    expect(vendor.protected).toBe(true);
    expect(vendor.signature).toBe("16#abcd_1234");
  });

  it("preserves multi-dimensional array dimensions through import/export/import", () => {
    const xml = FIXTURE.replace(
      '<Tag Name="MyArray" TagType="Base" DataType="DINT" Dimensions="8"/>',
      '<Tag Name="MyArray" TagType="Base" DataType="DINT" Dimensions="2 3"/>',
    ).replace(
      '<Member Name="History" DataType="DINT" Dimension="8"/>',
      '<Member Name="History" DataType="DINT" Dimension="2 4"/>',
    );
    const { project: p1 } = importL5X(xml);
    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('Name="MyArray"');
    expect(exported).toContain('Dimensions="2 3"');
    expect(exported).toContain('Dimension="2 4"');

    const { project: p2 } = importL5X(exported);
    const tag = p2.controllers[0]!.controllerTags.find((candidate) => candidate.name === "MyArray")!;
    expect(tag.dimension).toBe(2);
    expect(tag.dimensions).toEqual([2, 3]);
    const member = p2.controllers[0]!.dataTypes[0]!.members.find((candidate) => candidate.name === "History")!;
    expect(member.dimension).toBe(2);
    expect(member.dimensions).toEqual([2, 4]);
  });

  it("preserves tag display radix through import/export/import", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content><Controller Name="RadixCtl">
  <Tags>
    <Tag Name="HexTag" TagType="Base" DataType="DINT" Radix="Hex"/>
    <Tag Name="AsciiTag" TagType="Base" DataType="SINT" Radix="ASCII"/>
    <Tag Name="PlainTag" TagType="Base" DataType="DINT"/>
  </Tags>
</Controller></RSLogix5000Content>`;
    // Assert on the FIRST import too: a symmetric drop on both sides would still
    // satisfy a round-trip-stability check, so it would not catch a lost radix.
    const { project: p1 } = importL5X(xml);
    const tags1 = p1.controllers[0]!.controllerTags;
    expect(tags1.find((t) => t.name === "HexTag")?.radix).toBe("Hex");
    expect(tags1.find((t) => t.name === "AsciiTag")?.radix).toBe("ASCII");
    expect(tags1.find((t) => t.name === "PlainTag")?.radix).toBeUndefined();

    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('Radix="Hex"');
    expect(exported).toContain('Radix="ASCII"');

    const { project: p2 } = importL5X(exported);
    const tags2 = p2.controllers[0]!.controllerTags;
    expect(tags2.find((t) => t.name === "HexTag")?.radix).toBe("Hex");
    expect(tags2.find((t) => t.name === "AsciiTag")?.radix).toBe("ASCII");
    expect(tags2.find((t) => t.name === "PlainTag")?.radix).toBeUndefined();
  });

  it("preserves UDT member display radix through import/export/import", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content><Controller Name="MemberRadixCtl">
  <DataTypes>
    <DataType Name="Word">
      <Members>
        <Member Name="Mask" DataType="DINT" Radix="Binary"/>
        <Member Name="Code" DataType="SINT" Radix="ASCII"/>
        <Member Name="Plain" DataType="DINT"/>
      </Members>
    </DataType>
  </DataTypes>
</Controller></RSLogix5000Content>`;
    // Assert on the FIRST import too: a symmetric drop on both sides would still
    // satisfy normalize(p1) === normalize(p2), so a stability-only check is not enough.
    const { project: p1 } = importL5X(xml);
    const members1 = p1.controllers[0]!.dataTypes[0]!.members;
    expect(members1.find((m) => m.name === "Mask")?.radix).toBe("Binary");
    expect(members1.find((m) => m.name === "Code")?.radix).toBe("ASCII");
    expect(members1.find((m) => m.name === "Plain")?.radix).toBeUndefined();

    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('Radix="Binary"');
    expect(exported).toContain('Radix="ASCII"');

    const { project: p2 } = importL5X(exported);
    const members2 = p2.controllers[0]!.dataTypes[0]!.members;
    expect(members2.find((m) => m.name === "Mask")?.radix).toBe("Binary");
    expect(members2.find((m) => m.name === "Code")?.radix).toBe("ASCII");
    expect(members2.find((m) => m.name === "Plain")?.radix).toBeUndefined();
  });

  it("preserves unprotected non-ladder AOI routine bodies through export", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content><Controller Name="AoiCtl">
  <AddOnInstructionDefinitions>
    <AddOnInstructionDefinition Name="ReviewAOI">
      <Parameters><Parameter Name="In" DataType="REAL" Usage="Input"/></Parameters>
      <Routines>
        <Routine Name="Calc" Type="ST"><STContent>
          <Line Number="0"><![CDATA[Temp := In;]]></Line>
        </STContent></Routine>
        <Routine Name="Diagram" Type="FBD"><FBDContent>
          <Sheet Number="1"><Blocks/></Sheet>
        </FBDContent></Routine>
      </Routines>
    </AddOnInstructionDefinition>
  </AddOnInstructionDefinitions>
</Controller></RSLogix5000Content>`;
    const { project: p1 } = importL5X(xml);
    const { xml: exported, warnings } = exportL5X(p1);
    expect(exported).toContain('<Routine Name="Calc" Type="ST">');
    expect(exported).toContain("<FBDContent>");
    expect(warnings.some((warning) => warning.includes("AOI ReviewAOI/Calc") && warning.includes("read-only"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("AOI ReviewAOI/Diagram") && warning.includes("read-only"))).toBe(true);

    const { project: p2 } = importL5X(exported);
    const aoi = p2.controllers[0]!.addOnInstructions[0]!;
    expect(aoi.routines?.map((routine) => `${routine.name}:${routine.language}`)).toEqual([
      "Calc:structured-text",
      "Diagram:function-block",
    ]);
    expect(aoi.routines?.[0]?.structuredText).toBe("Temp := In;");
    expect(aoi.routines?.[1]?.sourceText).toContain("<FBDContent>");
  });

  it("preserves AOI local-tag array dimensions through import and export", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content><Controller Name="AoiDimCtl">
  <AddOnInstructionDefinitions>
    <AddOnInstructionDefinition Name="BufferAOI">
      <LocalTags>
        <LocalTag Name="History" DataType="DINT" Dimensions="16"><Description><![CDATA[ring buffer]]></Description></LocalTag>
        <LocalTag Name="Scratch" DataType="REAL"/>
      </LocalTags>
    </AddOnInstructionDefinition>
  </AddOnInstructionDefinitions>
</Controller></RSLogix5000Content>`;
    // The dimension must survive the FIRST import (not just round-trip stability):
    // a symmetric drop would still satisfy the normalize(p1)===normalize(p2) check.
    const { project: p1 } = importL5X(xml);
    const local1 = p1.controllers[0]!.addOnInstructions[0]!.localTags;
    expect(local1.find((t) => t.name === "History")?.dimension).toBe(16);
    expect(local1.find((t) => t.name === "Scratch")?.dimension).toBeUndefined();

    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('<LocalTag Name="History" DataType="DINT" Dimensions="16">');

    const { project: p2 } = importL5X(exported);
    const local2 = p2.controllers[0]!.addOnInstructions[0]!.localTags;
    expect(local2.find((t) => t.name === "History")?.dimension).toBe(16);
    expect(local2.find((t) => t.name === "Scratch")?.dimension).toBeUndefined();
  });

  it("preserves AOI local-tag display radix and external access through import and export", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content><Controller Name="AoiLocalMetaCtl">
  <AddOnInstructionDefinitions>
    <AddOnInstructionDefinition Name="MaskAOI">
      <LocalTags>
        <LocalTag Name="Mask" DataType="DINT" Radix="Binary" ExternalAccess="Read Only"/>
        <LocalTag Name="Plain" DataType="REAL"/>
      </LocalTags>
    </AddOnInstructionDefinition>
  </AddOnInstructionDefinitions>
</Controller></RSLogix5000Content>`;
    // Assert on the FIRST import too: a symmetric drop on both sides would still
    // satisfy normalize(p1) === normalize(p2), so a stability-only check is not enough.
    const { project: p1 } = importL5X(xml);
    const mask1 = p1.controllers[0]!.addOnInstructions[0]!.localTags.find((t) => t.name === "Mask")!;
    expect(mask1.radix).toBe("Binary");
    expect(mask1.externalAccess).toBe("read-only");
    const plain1 = p1.controllers[0]!.addOnInstructions[0]!.localTags.find((t) => t.name === "Plain")!;
    expect(plain1.radix).toBeUndefined();
    expect(plain1.externalAccess).toBeUndefined();

    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('Radix="Binary"');
    expect(exported).toContain('ExternalAccess="Read Only"');

    const { project: p2 } = importL5X(exported);
    const mask2 = p2.controllers[0]!.addOnInstructions[0]!.localTags.find((t) => t.name === "Mask")!;
    expect(mask2.radix).toBe("Binary");
    expect(mask2.externalAccess).toBe("read-only");
    const plain2 = p2.controllers[0]!.addOnInstructions[0]!.localTags.find((t) => t.name === "Plain")!;
    expect(plain2.radix).toBeUndefined();
    expect(plain2.externalAccess).toBeUndefined();
  });

  it("preserves AOI parameter usage, required, default, and description through import and export", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content><Controller Name="AoiParamCtl">
  <AddOnInstructionDefinitions>
    <AddOnInstructionDefinition Name="ScaleAOI">
      <Parameters>
        <Parameter Name="Raw" DataType="DINT" Usage="Input" Required="true" Default="100"><Description><![CDATA[raw count]]></Description></Parameter>
        <Parameter Name="Scaled" DataType="REAL" Usage="Output"/>
      </Parameters>
    </AddOnInstructionDefinition>
  </AddOnInstructionDefinitions>
</Controller></RSLogix5000Content>`;
    // Assert on the FIRST import too: a symmetric drop on both sides would still
    // satisfy normalize(p1) === normalize(p2), so a stability-only check is not enough.
    const { project: p1 } = importL5X(xml);
    const raw1 = p1.controllers[0]!.addOnInstructions[0]!.parameters.find((p) => p.name === "Raw")!;
    expect(raw1).toMatchObject({ usage: "Input", required: true, defaultValue: "100", description: "raw count" });
    const scaled1 = p1.controllers[0]!.addOnInstructions[0]!.parameters.find((p) => p.name === "Scaled")!;
    expect(scaled1.required).toBeUndefined();
    expect(scaled1.defaultValue).toBeUndefined();

    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('Name="Raw"');
    expect(exported).toContain('Usage="Input"');
    expect(exported).toContain('Required="true"');
    expect(exported).toContain('Default="100"');

    const { project: p2 } = importL5X(exported);
    const raw2 = p2.controllers[0]!.addOnInstructions[0]!.parameters.find((p) => p.name === "Raw")!;
    expect(raw2).toMatchObject({ usage: "Input", required: true, defaultValue: "100", description: "raw count" });
    const scaled2 = p2.controllers[0]!.addOnInstructions[0]!.parameters.find((p) => p.name === "Scaled")!;
    expect(scaled2.required).toBeUndefined();
    expect(scaled2.defaultValue).toBeUndefined();
  });

  it("preserves AOI parameter display radix and external access through import and export", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content><Controller Name="AoiParamMetaCtl">
  <AddOnInstructionDefinitions>
    <AddOnInstructionDefinition Name="BitsAOI">
      <Parameters>
        <Parameter Name="Flags" DataType="DINT" Usage="Input" Radix="Binary" ExternalAccess="Read Only"/>
        <Parameter Name="Plain" DataType="REAL" Usage="Output"/>
      </Parameters>
    </AddOnInstructionDefinition>
  </AddOnInstructionDefinitions>
</Controller></RSLogix5000Content>`;
    // Assert on the FIRST import too: a symmetric drop on both sides would still
    // satisfy normalize(p1) === normalize(p2), so a stability-only check is not enough.
    const { project: p1 } = importL5X(xml);
    const flags1 = p1.controllers[0]!.addOnInstructions[0]!.parameters.find((p) => p.name === "Flags")!;
    expect(flags1.radix).toBe("Binary");
    expect(flags1.externalAccess).toBe("read-only");
    const plain1 = p1.controllers[0]!.addOnInstructions[0]!.parameters.find((p) => p.name === "Plain")!;
    expect(plain1.radix).toBeUndefined();
    expect(plain1.externalAccess).toBeUndefined();

    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('Radix="Binary"');
    expect(exported).toContain('ExternalAccess="Read Only"');

    const { project: p2 } = importL5X(exported);
    const flags2 = p2.controllers[0]!.addOnInstructions[0]!.parameters.find((p) => p.name === "Flags")!;
    expect(flags2.radix).toBe("Binary");
    expect(flags2.externalAccess).toBe("read-only");
    const plain2 = p2.controllers[0]!.addOnInstructions[0]!.parameters.find((p) => p.name === "Plain")!;
    expect(plain2.radix).toBeUndefined();
    expect(plain2.externalAccess).toBeUndefined();
  });

  it("preserves program parameter usage, required, default, and description through import and export", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content><Controller Name="ProgParamCtl">
  <Programs>
    <Program Name="MainProgram" MainRoutineName="Main">
      <Parameters>
        <Parameter Name="Setpoint" DataType="REAL" Usage="Input" Required="true" Default="72.5"><Description><![CDATA[target temp]]></Description></Parameter>
        <Parameter Name="Alarm" DataType="BOOL" Usage="Output"/>
      </Parameters>
      <Routines><Routine Name="Main" Type="RLL"><RLLContent></RLLContent></Routine></Routines>
    </Program>
  </Programs>
</Controller></RSLogix5000Content>`;
    // Assert on the FIRST import too: a symmetric drop on both sides would still
    // satisfy normalize(p1) === normalize(p2), so a stability-only check is not enough.
    const { project: p1 } = importL5X(xml);
    const setpoint1 = p1.controllers[0]!.programs[0]!.parameters!.find((p) => p.name === "Setpoint")!;
    expect(setpoint1).toMatchObject({ usage: "Input", required: true, defaultValue: "72.5", description: "target temp" });
    const alarm1 = p1.controllers[0]!.programs[0]!.parameters!.find((p) => p.name === "Alarm")!;
    expect(alarm1.required).toBeUndefined();
    expect(alarm1.defaultValue).toBeUndefined();

    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('Name="Setpoint"');
    expect(exported).toContain('Default="72.5"');

    const { project: p2 } = importL5X(exported);
    const setpoint2 = p2.controllers[0]!.programs[0]!.parameters!.find((p) => p.name === "Setpoint")!;
    expect(setpoint2).toMatchObject({ usage: "Input", required: true, defaultValue: "72.5", description: "target temp" });
    const alarm2 = p2.controllers[0]!.programs[0]!.parameters!.find((p) => p.name === "Alarm")!;
    expect(alarm2.required).toBeUndefined();
    expect(alarm2.defaultValue).toBeUndefined();
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

describe("exportL5X — task scheduling metadata round trip", () => {
  const TASK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="TaskCtl" ProcessorType="1756-L85E">
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines>
          <Routine Name="Main" Type="RLL"><RLLContent>
            <Rung Number="0"><Text><![CDATA[XIC(A)OTE(A);]]></Text></Rung>
          </RLLContent></Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks>
      <Task Name="MainTask" Type="PERIODIC" Rate="20" Priority="10" Watchdog="500" InhibitTask="true" DisableUpdateOutputs="true">
        <ScheduledPrograms><ScheduledProgram Name="MainProgram"/></ScheduledPrograms>
      </Task>
    </Tasks>
  </Controller>
</RSLogix5000Content>`;

  it("preserves task period, priority, watchdog, and inhibit through export -> import", () => {
    const { project: p1 } = importL5X(TASK_XML);
    const { project: p2 } = importL5X(exportL5X(p1).xml);
    const task = p2.controllers[0]!.tasks[0]!;
    expect(task.type).toBe("periodic");
    expect(task.periodMs).toBe(20);
    expect(task.priority).toBe(10);
    expect(task.watchdogMs).toBe(500);
    expect(task.inhibited).toBe(true);
    expect(task.disableUpdateOutputs).toBe(true);
    // Assert the FIRST import too: a symmetric drop on both sides would still
    // satisfy a stability-only check, so verify the flag survives each hop.
    expect(importL5X(TASK_XML).project.controllers[0]!.tasks[0]!.disableUpdateOutputs).toBe(true);
    // The scheduled program reference still resolves after the round trip.
    expect(task.scheduledProgramIds).toEqual([p2.controllers[0]!.programs[0]!.id]);
  });

  const EVENT_TASK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="EventCtl" ProcessorType="1756-L85E">
    <Programs>
      <Program Name="EventProgram" MainRoutineName="Main">
        <Routines>
          <Routine Name="Main" Type="RLL"><RLLContent>
            <Rung Number="0"><Text><![CDATA[XIC(A)OTE(A);]]></Text></Rung>
          </RLLContent></Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks>
      <Task Name="EventTask" Type="EVENT" Priority="10" Watchdog="500">
        <EventInfo EventTrigger="Consumed Tag Connection" EnableTimeout="false" Tag="RemoteData"/>
        <ScheduledPrograms><ScheduledProgram Name="EventProgram"/></ScheduledPrograms>
      </Task>
    </Tasks>
  </Controller>
</RSLogix5000Content>`;

  it("preserves EVENT task trigger info (EventTrigger/Tag) through export -> import", () => {
    // Assert on the FIRST import too: a symmetric drop on both sides would still
    // satisfy a stability-only check, so verify the trigger survives each hop.
    const { project: p1 } = importL5X(EVENT_TASK_XML);
    const task1 = p1.controllers[0]!.tasks[0]!;
    expect(task1.type).toBe("event");
    expect(task1.eventInfo?.eventTrigger).toBe("Consumed Tag Connection");
    expect(task1.eventInfo?.eventTag).toBe("RemoteData");
    // EnableTimeout="false" must survive — `false` is meaningful here, not a
    // missing attribute, so a naive falsy drop would silently lose it.
    expect(task1.eventInfo?.enableTimeout).toBe(false);

    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain('EventTrigger="Consumed Tag Connection"');
    expect(exported).toContain('EnableTimeout="false"');
    expect(exported).toContain('Tag="RemoteData"');

    const { project: p2 } = importL5X(exported);
    const task2 = p2.controllers[0]!.tasks[0]!;
    expect(task2.type).toBe("event");
    expect(task2.eventInfo?.eventTrigger).toBe("Consumed Tag Connection");
    expect(task2.eventInfo?.eventTag).toBe("RemoteData");
    expect(task2.eventInfo?.enableTimeout).toBe(false);
  });

  const DESCRIBED_TASK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="DescCtl" ProcessorType="1756-L85E">
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines>
          <Routine Name="Main" Type="RLL"><RLLContent>
            <Rung Number="0"><Text><![CDATA[XIC(A)OTE(A);]]></Text></Rung>
          </RLLContent></Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks>
      <Task Name="MainTask" Type="PERIODIC" Rate="20">
        <Description><![CDATA[Main 20ms control loop]]></Description>
        <ScheduledPrograms><ScheduledProgram Name="MainProgram"/></ScheduledPrograms>
      </Task>
    </Tasks>
  </Controller>
</RSLogix5000Content>`;

  it("preserves the task description through export -> import", () => {
    // Assert the FIRST import too: a symmetric drop on both sides would still
    // satisfy a stability-only check, so verify it survives each hop.
    const { project: p1 } = importL5X(DESCRIBED_TASK_XML);
    expect(p1.controllers[0]!.tasks[0]!.description).toBe("Main 20ms control loop");

    const { xml: exported } = exportL5X(p1);
    expect(exported).toContain("Main 20ms control loop");

    const { project: p2 } = importL5X(exported);
    expect(p2.controllers[0]!.tasks[0]!.description).toBe("Main 20ms control loop");
  });
});

describe("exportL5X — controller metadata round trip", () => {
  const CTRL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="LineCtl" ProcessorType="1756-L85E" CatalogNumber="1756-L85E" MajorRev="33" MinorRev="11" ChassisType="1756-A7" Slot="2" FaultHandler="FaultHandler" PowerLossHandler="PowerUp">
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines>
          <Routine Name="Main" Type="RLL"><RLLContent>
            <Rung Number="0"><Text><![CDATA[XIC(A)OTE(A);]]></Text></Rung>
          </RLLContent></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

  it("preserves firmware, catalog, chassis, slot, and handler programs through export -> import", () => {
    const { project: p1 } = importL5X(CTRL_XML);
    const { project: p2 } = importL5X(exportL5X(p1).xml);
    const ctl = p2.controllers[0]!;
    expect(ctl.processorType).toBe("1756-L85E");
    expect(ctl.catalogNumber).toBe("1756-L85E");
    expect(ctl.firmwareRevision).toBe("33.11");
    expect(ctl.chassis).toBe("1756-A7");
    expect(ctl.slot).toBe(2);
    expect(ctl.faultRoutineName).toBe("FaultHandler");
    expect(ctl.powerUpRoutineName).toBe("PowerUp");
  });
});

describe("exportL5X — tag metadata round trip", () => {
  const TAG_META_XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="TagMetaCtl" ProcessorType="1756-L85E">
    <Tags>
      <Tag Name="ConstTag" TagType="Base" DataType="DINT" Constant="true" ExternalAccess="Read Only" OpcUaAccess="None"/>
      <Tag Name="ProdTag" TagType="Produced" DataType="DINT" ExternalAccess="Read/Write">
        <ProduceInfo ProduceCount="3" UnicastPermitted="true" ProgrammaticallySendEventTrigger="false"/>
      </Tag>
      <Tag Name="ConsTag" TagType="Consumed" DataType="DINT" ExternalAccess="None">
        <ConsumeInfo Producer="RemoteCtl" RemoteTag="ProdTag" RemoteInstance="0" RPI="20" Unicast="true"/>
      </Tag>
      <Tag Name="Plain" TagType="Base" DataType="BOOL"/>
    </Tags>
  </Controller>
</RSLogix5000Content>`;

  it("preserves Constant, TagType produced/consumed, and ExternalAccess through export -> import", () => {
    const { project: p1 } = importL5X(TAG_META_XML);
    const { project: p2 } = importL5X(exportL5X(p1).xml);
    const tag = (name: string) => p2.controllers[0]!.controllerTags.find((t) => t.name === name)!;
    expect(tag("ConstTag").constant).toBe(true);
    expect(tag("ConstTag").externalAccess).toBe("read-only");
    expect(tag("ProdTag").produced).toBe(true);
    expect(tag("ProdTag").externalAccess).toBe("read-write");
    expect(tag("ConsTag").consumed).toBe(true);
    expect(tag("ConsTag").externalAccess).toBe("none");
    expect(tag("Plain").produced).toBeUndefined();
  });

  it("preserves consumed-tag ConsumeInfo (producer binding) through export -> import", () => {
    const { project: p1 } = importL5X(TAG_META_XML);
    const { project: p2 } = importL5X(exportL5X(p1).xml);
    const consTag = p2.controllers[0]!.controllerTags.find((t) => t.name === "ConsTag")!;
    expect(consTag.consumeInfo).toEqual({
      producer: "RemoteCtl",
      remoteTag: "ProdTag",
      remoteInstance: "0",
      rpi: 20,
      unicast: true,
    });
  });

  it("preserves produced-tag ProduceInfo (connection settings) through export -> import", () => {
    const { project: p1 } = importL5X(TAG_META_XML);
    const { project: p2 } = importL5X(exportL5X(p1).xml);
    const prodTag = p2.controllers[0]!.controllerTags.find((t) => t.name === "ProdTag")!;
    expect(prodTag.produceInfo).toEqual({
      produceCount: 3,
      unicastPermitted: true,
      programmaticallySendEventTrigger: false,
    });
  });

  it("preserves OpcUaAccess through export -> import", () => {
    const { project: p1 } = importL5X(TAG_META_XML);
    const exported = exportL5X(p1).xml;
    expect(exported).toContain('OpcUaAccess="None"');
    const { project: p2 } = importL5X(exported);
    const constTag = p2.controllers[0]!.controllerTags.find((t) => t.name === "ConstTag")!;
    expect(constTag.opcUaAccess).toBe("None");
    // Tags without the attribute stay undefined rather than gaining a default.
    const plain = p2.controllers[0]!.controllerTags.find((t) => t.name === "Plain")!;
    expect(plain.opcUaAccess).toBeUndefined();
  });
});

describe("exportL5X — program metadata round trip", () => {
  const PROGRAM_META_XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="ProgramMetaCtl" ProcessorType="1756-L85E">
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main" FaultRoutineName="Fault" Disabled="true">
        <Parameters>
          <Parameter Name="InParam" DataType="DINT" Usage="Input" Required="true"><Description><![CDATA[in val]]></Description></Parameter>
          <Parameter Name="OutParam" DataType="BOOL" Usage="Output"/>
        </Parameters>
        <Routines>
          <Routine Name="Main" Type="RLL"><RLLContent>
            <Rung Number="0"><Text><![CDATA[XIC(A)OTE(A);]]></Text></Rung>
          </RLLContent></Routine>
          <Routine Name="Fault" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

  it("preserves Disabled, FaultRoutineName, and program Parameters through export -> import", () => {
    const { project: p1 } = importL5X(PROGRAM_META_XML);
    const { project: p2 } = importL5X(exportL5X(p1).xml);
    const program = p2.controllers[0]!.programs[0]!;
    const fault = program.routines.find((r) => r.name === "Fault")!;
    expect(program.inhibited).toBe(true);
    expect(program.faultRoutineId).toBe(fault.id);
    expect(program.parameters?.map((p) => `${p.name}:${p.usage}:${p.required === true}`)).toEqual([
      "InParam:Input:true",
      "OutParam:Output:false",
    ]);
    expect(program.parameters?.[0]?.description).toBe("in val");
  });
});

describe("exportL5X — provenance, documentation, and I/O metadata round trip", () => {
  const DOC_IO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.01" TargetName="DocIoCtl" ContentType="Controller" Owner="Controls Team" ExportOptions="References NoRawData Context" ContainsContext="true" ExportDate="Tue Jan 02 14:03:11 2024">
  <Controller Use="Target" Name="DocIoCtl" ProcessorType="1756-L85E">
    <Description><![CDATA[Controller documentation]]></Description>
    <Modules>
      <Module Name="Remote_EN2T" CatalogNumber="1756-EN2T" Slot="1" Vendor="1" ProductType="12">
        <Description><![CDATA[Remote Ethernet bridge]]></Description>
        <Ports>
          <Port Id="1" Type="Backplane" Address="1" Upstream="true"><Bus Size="17"/></Port>
        </Ports>
        <Communications>
          <Connections>
            <Connection Name="Input" RPI="20000" Type="Input" Priority="Scheduled" Unicast="true" InputConnectionType="Multicast"/>
          </Connections>
        </Communications>
      </Module>
    </Modules>
    <Tags>
      <Tag Name="Motor" TagType="Base" DataType="DINT">
        <Description><![CDATA[Motor command word]]></Description>
        <Comments>
          <Comment Operand=".0"><![CDATA[Run request]]></Comment>
        </Comments>
      </Tag>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Description><![CDATA[Main program docs]]></Description>
        <Tags>
          <Tag Name="LocalMode" TagType="Base" DataType="BOOL">
            <Description><![CDATA[Local mode enabled]]></Description>
          </Tag>
        </Tags>
        <Routines>
          <Routine Name="Main" Type="RLL">
            <Description><![CDATA[Main ladder docs]]></Description>
            <RLLContent>
              <Rung Number="0"><Comment><![CDATA[Drive command]]></Comment><Text><![CDATA[XIC(LocalMode)OTE(Motor.0);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

  it("preserves root provenance, descriptions/comments, and I/O connection metadata", () => {
    const { project: p1 } = importL5X(DOC_IO_XML);
    const { xml: exported } = exportL5X(p1);

    expect(exported).toContain('SoftwareRevision="35.01"');
    expect(exported).toContain('Owner="Controls Team"');
    expect(exported).toContain('ExportOptions="References NoRawData Context"');
    expect(exported).toContain('ContainsContext="true"');
    expect(exported).toContain("Controller documentation");
    expect(exported).toContain("Run request");
    expect(exported).toContain('RPI="20000"');
    expect(exported).toContain('InputConnectionType="Multicast"');

    const { project: p2 } = importL5X(exported);
    const controller = p2.controllers[0]!;
    expect(controller.softwareRevision).toBe("35.01");
    expect(controller.exportOwner).toBe("Controls Team");
    expect(controller.exportOptions).toBe("References NoRawData Context");
    expect(controller.containsContext).toBe("true");
    expect(controller.description).toBe("Controller documentation");
    expect(controller.controllerTags[0]?.comments).toEqual([{ operand: ".0", text: "Run request" }]);
    expect(controller.programs[0]?.description).toBe("Main program docs");
    expect(controller.programs[0]?.programTags[0]?.description).toBe("Local mode enabled");
    expect(controller.programs[0]?.routines[0]?.description).toBe("Main ladder docs");
    expect(ladderOf(controller.programs[0]!.routines[0]!)?.rungs[0]?.comment).toBe("Drive command");
    expect(controller.ioConfiguration.modules[0]).toMatchObject({
      name: "Remote_EN2T",
      description: "Remote Ethernet bridge",
      ports: [{ id: "1", type: "Backplane", address: "1", upstream: true, busSize: 17 }],
      connections: [
        {
          name: "Input",
          rpi: 20000,
          type: "Input",
          priority: "Scheduled",
          unicast: true,
          inputConnectionType: "Multicast",
        },
      ],
    });
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

describe("exportL5X — Structured Text source survives a full round-trip", () => {
  // ST routinely contains XML-significant comparison operators (<, >, <=, <>)
  // and — rarely but legally, inside a string literal or comment — the CDATA
  // terminator "]]>". The exporter wraps each <Line> in CDATA and splits any
  // embedded "]]>" so the file stays well-formed and re-imports byte-for-byte.
  const ST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="STRT" ContentType="Controller">
  <Controller Use="Target" Name="STRT">
    <Programs><Program Name="P" MainRoutineName="R"><Routines>
      <Routine Name="R" Type="ST"><STContent>
        <Line Number="0"><![CDATA[IF a <> b AND c <= 5 THEN]]></Line>
        <Line Number="1"><![CDATA[    Note := 'guard ]]]]><![CDATA[> end';]]></Line>
        <Line Number="2"><![CDATA[END_IF;]]></Line>
      </STContent></Routine>
    </Routines></Program></Programs>
  </Controller>
</RSLogix5000Content>`;

  it("preserves comparison operators and an embedded ]]> sentinel through export -> re-import", () => {
    const imported = importL5X(ST_XML).project.controllers[0]!.programs[0]!.routines[0]!;
    expect(imported.language).toBe("structured-text");
    expect(imported.structuredText).toBe(
      "IF a <> b AND c <= 5 THEN\n    Note := 'guard ]]> end';\nEND_IF;",
    );

    const { xml } = exportL5X(importL5X(ST_XML).project);
    const roundTripped = importL5X(xml).project.controllers[0]!.programs[0]!.routines[0]!;
    expect(roundTripped.language).toBe("structured-text");
    expect(roundTripped.structuredText).toBe(imported.structuredText);
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
