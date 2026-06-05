import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type AddOnInstruction,
  type ControllerTrend,
  type PlcProject,
  type Program,
  type Routine,
  type Tag,
  type UserDefinedType,
} from "@esco/core";
import {
  exportControllerComponent,
  exportCustomInstructionComponent,
  exportDataTypeComponent,
  exportProgramComponent,
  exportRoutineComponent,
  exportTagComponent,
  exportTaskComponent,
} from "./component-export";
import {
  importControllerComponent,
  importComponents,
  importProgramComponent,
  importRoutineComponent,
  importTagComponent,
  importTaskComponent,
  previewControllerComponentImport,
  previewComponentImport,
  previewProgramComponentImport,
  previewRoutineComponentImport,
  previewTagComponentImport,
  previewTaskComponentImport,
} from "./component-import";
import { exportEscoLibrary } from "./library-actions";

function buildProject(): PlcProject {
  const project = {
    ...createProject("Packaging Line"),
    id: "proj-demo",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
  const controller = {
    ...createController(project.id, "Controller_1"),
    id: "ctrl-1",
    controllerTags: [{ ...createTag("ctrl-1", "StartPB", "BOOL"), id: "tag-start" }],
  };
  const program = { ...createProgram(controller.id, "MainProgram"), id: "prog-1" };
  const dataType: UserDefinedType = {
    id: "udt-1",
    name: "MotorStatus",
    members: [{ name: "Ready", dataType: "BOOL" }],
  };
  const instruction: AddOnInstruction = {
    id: "aoi-1",
    name: "ScaleValue",
    revision: "1.0",
    parameters: [{ name: "In", dataType: "REAL", usage: "Input" }],
    localTags: [{ name: "Span", dataType: "REAL" }],
    routineNames: ["Logic"],
  };
  const trend: ControllerTrend = {
    id: "trend-1",
    name: "LineSpeed",
    pens: [{ id: "pen-1", name: "StartPB" }],
  };
  return {
    ...project,
    controllers: [
      { ...controller, programs: [program], dataTypes: [dataType], addOnInstructions: [instruction], trends: [trend] },
    ],
  };
}

function buildRoutineProject(): PlcProject {
  const project = buildProject();
  const controller = project.controllers[0];
  const program = controller.programs[0];
  const routine: Routine = {
    ...createRoutine(program.id, "MainRoutine", "ladder"),
    id: "rtn-main",
    ladder: {
      id: "ladder-main",
      rungs: [
        {
          id: "rung-1",
          routineId: "rtn-main",
          number: 0,
          root: {
            id: "branch-1",
            nodes: [
              { id: "ins-1", instructionType: "XIC", operands: [{ name: "Tag", kind: "tag", value: "StartPB" }] },
              { id: "ins-2", instructionType: "OTE", operands: [{ name: "Dest", kind: "tag", value: "MotorRun" }] },
            ],
          },
        },
      ],
    },
  };
  const localTag = { ...createTag(controller.id, "LocalMode", "BOOL", { scope: "program", programId: program.id }), id: "tag-local" };
  return {
    ...project,
    controllers: [
      {
        ...controller,
        controllerTags: [...controller.controllerTags, { ...createTag(controller.id, "MotorRun", "BOOL"), id: "tag-motor" }],
        tasks: [{ id: "task-main", controllerId: controller.id, name: "MainTask", type: "continuous", scheduledProgramIds: [program.id] }],
        programs: [{ ...program, mainRoutineId: routine.id, routines: [routine], programTags: [localTag] }],
      },
    ],
  };
}

const AOI_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="L5XScale" ContentType="AddOnInstructionDefinition">
  <Controller Use="Context" Name="ImportSource">
    <AddOnInstructionDefinitions>
      <AddOnInstructionDefinition Name="L5XScale" Revision="1.0">
        <Parameters>
          <Parameter Name="In" DataType="REAL" Usage="Input"/>
          <Parameter Name="Out" DataType="REAL" Usage="Output"/>
        </Parameters>
        <LocalTags>
          <LocalTag Name="Scratch" DataType="REAL"/>
        </LocalTags>
      </AddOnInstructionDefinition>
    </AddOnInstructionDefinitions>
  </Controller>
</RSLogix5000Content>`;

const UDT_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="MotorStatus" ContentType="DataType">
  <DataType Name="MotorStatus" Family="NoFamily">
    <Members>
      <Member Name="Ready" DataType="BOOL"/>
      <Member Name="Speed" DataType="REAL"/>
    </Members>
  </DataType>
</RSLogix5000Content>`;

const TREND_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="L5XTrend" ContentType="Trend">
  <Controller Use="Context" Name="ImportSource">
    <Trends>
      <Trend Name="L5XTrend" SamplePeriod="10" NumberOfCaptures="1">
        <Pens>
          <Pen Name="StartPB" Color="Red"/>
        </Pens>
      </Trend>
    </Trends>
  </Controller>
</RSLogix5000Content>`;

describe("component import", () => {
  it("imports an Add-On Instruction from a single-component export envelope", () => {
    const project = buildProject();
    const exported = exportCustomInstructionComponent(project, "aoi-1");
    expect(exported.ok).toBe(true);
    // Re-name the source so it does not collide with the existing AOI.
    const text = exported.data!.text.replace(/ScaleValue/g, "ScaleValueCopy");

    const result = importComponents(project, "ctrl-1", "aoi", text);
    expect(result.ok).toBe(true);
    expect(result.data?.created).toBe(1);
    const controller = result.project.controllers[0];
    expect(controller.addOnInstructions.map((a) => a.name)).toContain("ScaleValueCopy");
    // Fresh id, not the source id.
    const imported = controller.addOnInstructions.find((a) => a.name === "ScaleValueCopy");
    expect(imported?.id).not.toBe("aoi-1");
    expect(result.receipt).toMatchObject({
      title: "Import Add-On Instruction",
      status: "succeeded",
      evidence: expect.arrayContaining([
        expect.objectContaining({ label: "Source", detail: "ESCO component export" }),
        expect.objectContaining({ label: "Imported names", detail: "ScaleValueCopy" }),
      ]),
      nextSteps: expect.arrayContaining([expect.objectContaining({ label: "Run Verify Controller" })]),
    });
    // Input project is untouched.
    expect(buildProject().controllers[0].addOnInstructions).toHaveLength(1);
  });

  it("auto-renames a colliding component instead of overwriting", () => {
    const project = buildProject();
    const exported = exportCustomInstructionComponent(project, "aoi-1");
    const result = importComponents(project, "ctrl-1", "aoi", exported.data!.text);
    expect(result.ok).toBe(true);
    const names = result.project.controllers[0].addOnInstructions.map((a) => a.name);
    expect(names).toContain("ScaleValue");
    expect(names).toContain("ScaleValue_1");
    expect(result.data?.renamed).toBe(1);
    expect(result.receipt?.status).toBe("warnings");
    expect(result.receipt?.warnings.join("\n")).toContain('imported as "ScaleValue_1"');
  });

  it("imports a full controller component with fresh nested ids and remapped scheduling", () => {
    const base = buildRoutineProject();
    const project: PlcProject = {
      ...base,
      controllers: [
        {
          ...base.controllers[0],
          ioConfiguration: {
            modules: [
              {
                id: "mod-rack",
                name: "MainRack",
                catalogNumber: "1756-A4",
                ports: [{ id: "port-backplane", type: "backplane" }],
              },
            ],
          },
        },
      ],
    };
    const exported = exportControllerComponent(project, "ctrl-1");
    expect(exported.ok).toBe(true);

    const preview = previewControllerComponentImport(project, exported.data!.text);
    expect(preview.ok).toBe(true);
    expect(preview.sourceFormat).toBe("controller-component");
    expect(preview.items[0]).toMatchObject({
      sourceName: "Controller_1",
      finalName: "Controller_1_1",
      status: "rename",
      conflict: true,
    });

    const result = importControllerComponent(project, exported.data!.text);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ kindLabel: "Controller", renamed: 1, importedNames: ["Controller_1_1"] });
    const imported = result.project.controllers.find((controller) => controller.name === "Controller_1_1");
    expect(imported).toBeDefined();
    expect(imported?.id).not.toBe("ctrl-1");
    expect(imported?.projectId).toBe(project.id);

    const importedProgram = imported!.programs.find((program) => program.name === "MainProgram");
    const importedTask = imported!.tasks.find((task) => task.name === "MainTask");
    expect(importedProgram?.id).not.toBe("prog-1");
    expect(importedTask?.scheduledProgramIds).toEqual([importedProgram!.id]);
    expect(imported!.controllerTags.find((tag) => tag.name === "StartPB")?.controllerId).toBe(imported!.id);
    expect(importedProgram!.programTags.find((tag) => tag.name === "LocalMode")?.programId).toBe(importedProgram!.id);
    const importedRoutine = importedProgram!.routines.find((routine) => routine.name === "MainRoutine");
    const ladder = importedRoutine?.ladder as { rungs?: Array<{ routineId?: string }> } | undefined;
    expect(importedRoutine?.id).not.toBe("rtn-main");
    expect(ladder?.rungs?.[0]?.routineId).toBe(importedRoutine!.id);
    expect(imported!.ioConfiguration.modules[0].id).not.toBe("mod-rack");
    expect(imported!.ioConfiguration.modules[0].ports?.[0]?.id).not.toBe("port-backplane");
    expect(project.controllers).toHaveLength(1);
  });

  it("imports an Add-On Instruction from an L5X component export", () => {
    const project = buildProject();
    const preview = previewComponentImport(project, "ctrl-1", "aoi", AOI_L5X);
    expect(preview.ok).toBe(true);
    expect(preview.sourceFormat).toBe("studio-l5x-component");
    expect(preview.items[0]).toMatchObject({ sourceName: "L5XScale", finalName: "L5XScale", status: "create" });

    const result = importComponents(project, "ctrl-1", "aoi", AOI_L5X);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ sourceFormat: "studio-l5x-component", created: 1, importedNames: ["L5XScale"] });
    const imported = result.project.controllers[0].addOnInstructions.find((aoi) => aoi.name === "L5XScale");
    expect(imported?.parameters.map((parameter) => parameter.name)).toEqual(["In", "Out"]);
    expect(imported?.localTags.map((tag) => tag.name)).toEqual(["Scratch"]);
    expect(result.receipt?.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Source", detail: "Studio L5X XML component export" })]),
    );
  });

  it("imports a Data Type from a direct L5X component and conflict-renames it", () => {
    const project = buildProject();
    const preview = previewComponentImport(project, "ctrl-1", "udt", UDT_L5X);
    expect(preview.ok).toBe(true);
    expect(preview.items[0]).toMatchObject({ sourceName: "MotorStatus", finalName: "MotorStatus_1", status: "rename" });

    const result = importComponents(project, "ctrl-1", "udt", UDT_L5X);
    expect(result.ok).toBe(true);
    expect(result.data?.renamed).toBe(1);
    const imported = result.project.controllers[0].dataTypes.find((udt) => udt.name === "MotorStatus_1");
    expect(imported?.members.map((member) => member.name)).toEqual(["Ready", "Speed"]);
  });

  it("imports a Trend from L5X and regenerates pen ids", () => {
    const project = buildProject();
    const result = importComponents(project, "ctrl-1", "trend", TREND_L5X);
    expect(result.ok).toBe(true);
    const imported = result.project.controllers[0].trends?.find((trend) => trend.name === "L5XTrend");
    expect(imported?.pens[0]).toMatchObject({ name: "StartPB" });
    expect(imported?.pens[0]?.id).not.toBe("pen-1");
  });

  it("rejects a wrong-family L5X component with a clear message", () => {
    const project = buildProject();
    const result = importComponents(project, "ctrl-1", "aoi", UDT_L5X);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Data Type");
    expect(result.error).toContain("Import Data Type");
    expect(result.project).toBe(project);
  });

  it("rejects invalid L5X without mutating the project", () => {
    const project = buildProject();
    const result = importComponents(project, "ctrl-1", "udt", "<NotL5X/>");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid L5X");
    expect(result.project).toBe(project);
  });

  it("imports a Data Type and preview reports create/rename counts", () => {
    const project = buildProject();
    const exported = exportDataTypeComponent(project, "udt-1");
    const text = exported.data!.text.replace(/MotorStatus/g, "MotorStatus2");
    const preview = previewComponentImport(project, "ctrl-1", "udt", text);
    expect(preview.ok).toBe(true);
    expect(preview.createCount).toBe(1);
    expect(preview.items[0]?.finalName).toBe("MotorStatus2");

    const result = importComponents(project, "ctrl-1", "udt", text);
    expect(result.ok).toBe(true);
    expect(result.project.controllers[0].dataTypes.map((u) => u.name)).toContain("MotorStatus2");
  });

  it("imports trends from a controller-assets bundle and regenerates pen ids", () => {
    const project = buildProject();
    const bundle = JSON.stringify({
      format: "esco.controller-assets.export.v1",
      kind: "controller-trends",
      payload: [{ id: "trend-1", name: "LineSpeed", pens: [{ id: "pen-1", name: "StartPB" }] }],
    });
    const result = importComponents(project, "ctrl-1", "trend", bundle);
    expect(result.ok).toBe(true);
    const trends = result.project.controllers[0].trends!;
    expect(trends.map((t) => t.name)).toContain("LineSpeed_1");
    // Pen ids regenerated so they do not collide with the existing trend's pens.
    const imported = trends.find((t) => t.name === "LineSpeed_1");
    expect(imported?.pens[0]?.id).not.toBe("pen-1");
  });

  it("imports Add-On Instructions from a checksummed ESCO library artifact", () => {
    const project = buildProject();
    const library = exportEscoLibrary(project, { createdAt: "2026-06-04T00:00:00.000Z" });
    expect(library.ok).toBe(true);

    const preview = previewComponentImport(project, "ctrl-1", "aoi", library.data!.text);
    expect(preview.ok).toBe(true);
    expect(preview.sourceFormat).toBe("esco-library");
    expect(preview.items[0]).toMatchObject({ sourceName: "ScaleValue", finalName: "ScaleValue_1", status: "rename" });

    const result = importComponents(project, "ctrl-1", "aoi", library.data!.text);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ sourceFormat: "esco-library", renamed: 1, importedNames: ["ScaleValue_1"] });
    expect(result.receipt?.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Source", detail: "ESCO library artifact" })]),
    );
    const imported = result.project.controllers[0].addOnInstructions.find((aoi) => aoi.name === "ScaleValue_1");
    expect(imported?.parameters.map((parameter) => parameter.name)).toEqual(["In"]);
  });

  it("imports Data Types and Trends from an ESCO library through the matching family commands", () => {
    const project = buildProject();
    const text = exportEscoLibrary(project, { createdAt: "2026-06-04T00:00:00.000Z" }).data!.text;

    const udtResult = importComponents(project, "ctrl-1", "udt", text);
    expect(udtResult.ok).toBe(true);
    expect(udtResult.data).toMatchObject({ sourceFormat: "esco-library", renamed: 1, importedNames: ["MotorStatus_1"] });
    expect(udtResult.project.controllers[0].dataTypes.find((udt) => udt.name === "MotorStatus_1")?.members).toEqual([
      { name: "Ready", dataType: "BOOL" },
    ]);

    const trendResult = importComponents(project, "ctrl-1", "trend", text);
    expect(trendResult.ok).toBe(true);
    expect(trendResult.data).toMatchObject({ sourceFormat: "esco-library", renamed: 1, importedNames: ["LineSpeed_1"] });
    const importedTrend = trendResult.project.controllers[0].trends?.find((trend) => trend.name === "LineSpeed_1");
    expect(importedTrend?.pens[0]?.name).toBe("StartPB");
    expect(importedTrend?.pens[0]?.id).not.toBe("pen-1");
  });

  it("rejects a tampered ESCO library before importing components", () => {
    const project = buildProject();
    const exported = exportEscoLibrary(project, { createdAt: "2026-06-04T00:00:00.000Z" });
    const tampered = JSON.parse(exported.data!.text);
    tampered.payload.controllers[0].addOnInstructions[0].name = "TamperedScale";

    const result = importComponents(project, "ctrl-1", "aoi", JSON.stringify(tampered));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/integrity check failed|checksum does not match/i);
    expect(result.project).toBe(project);
  });

  it("rejects a file whose components belong to a different family", () => {
    const project = buildProject();
    const exported = exportDataTypeComponent(project, "udt-1");
    const result = importComponents(project, "ctrl-1", "aoi", exported.data!.text);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Data Type");
  });

  it("fails clearly on invalid JSON", () => {
    const project = buildProject();
    const result = importComponents(project, "ctrl-1", "udt", "not json {");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("valid JSON");
  });
});

describe("component import conflict resolution", () => {
  it("preview flags a colliding row with overwrite/rename/skip options", () => {
    const project = buildProject();
    const exported = exportCustomInstructionComponent(project, "aoi-1");
    const preview = previewComponentImport(project, "ctrl-1", "aoi", exported.data!.text);
    expect(preview.ok).toBe(true);
    expect(preview.conflictCount).toBe(1);
    const row = preview.items[0];
    expect(row.id).toBe("0");
    expect(row.conflict).toBe(true);
    expect(row.existingName).toBe("ScaleValue");
    expect(row.availableOptions).toEqual(["rename", "overwrite", "skip"]);
    // Default reconciliation is a rename so nothing is silently overwritten.
    expect(row.status).toBe("rename");
  });

  it("overwrites the existing component in place, preserving its id", () => {
    const project = buildProject();
    const exported = exportCustomInstructionComponent(project, "aoi-1");
    // Change the payload so we can prove the contents were replaced.
    const text = exported.data!.text.replace('"revision": "1.0"', '"revision": "2.5"');

    const result = importComponents(project, "ctrl-1", "aoi", text, { "0": { option: "overwrite" } });
    expect(result.ok).toBe(true);
    expect(result.data?.overwritten).toBe(1);
    const aois = result.project.controllers[0].addOnInstructions;
    // Replaced in place — still a single AOI named ScaleValue with the original id.
    expect(aois).toHaveLength(1);
    expect(aois[0]?.name).toBe("ScaleValue");
    expect(aois[0]?.id).toBe("aoi-1");
    expect(aois[0]?.revision).toBe("2.5");
  });

  it("honours an explicit rename target", () => {
    const project = buildProject();
    const exported = exportCustomInstructionComponent(project, "aoi-1");
    const result = importComponents(project, "ctrl-1", "aoi", exported.data!.text, {
      "0": { option: "rename", renameTo: "ScaleValueV2" },
    });
    expect(result.ok).toBe(true);
    expect(result.data?.renamed).toBe(1);
    const names = result.project.controllers[0].addOnInstructions.map((a) => a.name);
    expect(names).toEqual(["ScaleValue", "ScaleValueV2"]);
  });

  it("falls back to an auto name when the explicit rename target is taken", () => {
    const project = buildProject();
    const exported = exportCustomInstructionComponent(project, "aoi-1");
    // Rename onto the existing name — the resolver must not collide.
    const result = importComponents(project, "ctrl-1", "aoi", exported.data!.text, {
      "0": { option: "rename", renameTo: "ScaleValue" },
    });
    expect(result.ok).toBe(true);
    const names = result.project.controllers[0].addOnInstructions.map((a) => a.name);
    expect(names).toContain("ScaleValue_1");
  });

  it("skips a row and fails when every row is skipped", () => {
    const project = buildProject();
    const exported = exportCustomInstructionComponent(project, "aoi-1");
    const result = importComponents(project, "ctrl-1", "aoi", exported.data!.text, { "0": { option: "skip" } });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("skipped or invalid");
    // Input project untouched.
    expect(project.controllers[0].addOnInstructions).toHaveLength(1);
  });

  it("preview recomputes final names as resolutions change", () => {
    const project = buildProject();
    const exported = exportCustomInstructionComponent(project, "aoi-1");
    const overwritePreview = previewComponentImport(project, "ctrl-1", "aoi", exported.data!.text, {
      "0": { option: "overwrite" },
    });
    expect(overwritePreview.items[0]?.status).toBe("overwrite");
    expect(overwritePreview.items[0]?.finalName).toBe("ScaleValue");
    expect(overwritePreview.overwriteCount).toBe(1);

    const skipPreview = previewComponentImport(project, "ctrl-1", "aoi", exported.data!.text, {
      "0": { option: "skip" },
    });
    expect(skipPreview.items[0]?.status).toBe("skip");
    expect(skipPreview.skipCount).toBe(1);
  });
});

describe("routine component import", () => {
  it("imports a routine from an ESCO routine component export", () => {
    const project = buildRoutineProject();
    const exported = exportRoutineComponent(project, "rtn-main");
    expect(exported.ok).toBe(true);
    const text = exported.data!.text.replace(/MainRoutine/g, "AuxRoutine");

    const preview = previewRoutineComponentImport(project, "prog-1", text);
    expect(preview).toMatchObject({
      ok: true,
      kindLabel: "Routine",
      sourceFormat: "component-envelope",
      createCount: 1,
      targetLabel: "MainProgram",
    });
    expect(preview.items[0]).toMatchObject({ sourceName: "AuxRoutine", finalName: "AuxRoutine", status: "create" });

    const result = importRoutineComponent(project, "prog-1", text);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ created: 1, importedNames: ["AuxRoutine"], programName: "MainProgram" });
    const routines = result.project.controllers[0].programs[0].routines;
    expect(routines.map((routine) => routine.name)).toContain("AuxRoutine");
    const imported = routines.find((routine) => routine.name === "AuxRoutine");
    expect(imported?.id).not.toBe("rtn-main");
    expect(imported?.programId).toBe("prog-1");
    expect(result.receipt).toMatchObject({
      title: "Import Routine",
      status: "succeeded",
      evidence: expect.arrayContaining([
        expect.objectContaining({ label: "Source", detail: "ESCO component export" }),
        expect.objectContaining({ label: "Target program", detail: "MainProgram" }),
      ]),
    });
    expect(project.controllers[0].programs[0].routines).toHaveLength(1);
  });

  it("auto-renames a colliding routine and honours explicit rename choices", () => {
    const project = buildRoutineProject();
    const exported = exportRoutineComponent(project, "rtn-main");
    const preview = previewRoutineComponentImport(project, "prog-1", exported.data!.text);
    expect(preview.ok).toBe(true);
    expect(preview.items[0]).toMatchObject({
      sourceName: "MainRoutine",
      finalName: "MainRoutine_1",
      status: "rename",
      availableOptions: ["rename", "overwrite", "skip"],
    });

    const result = importRoutineComponent(project, "prog-1", exported.data!.text, {
      "0": { option: "rename", renameTo: "MainRoutine_Copy" },
    });
    expect(result.ok).toBe(true);
    expect(result.data?.renamed).toBe(1);
    expect(result.project.controllers[0].programs[0].routines.map((routine) => routine.name)).toEqual([
      "MainRoutine",
      "MainRoutine_Copy",
    ]);
  });

  it("overwrites an existing routine in place by explicit resolution", () => {
    const project = buildRoutineProject();
    const exported = exportRoutineComponent(project, "rtn-main");
    const parsed = JSON.parse(exported.data!.text);
    parsed.payload.description = "Imported replacement";

    const result = importRoutineComponent(project, "prog-1", JSON.stringify(parsed), {
      "0": { option: "overwrite" },
    });
    expect(result.ok).toBe(true);
    expect(result.data?.overwritten).toBe(1);
    const routines = result.project.controllers[0].programs[0].routines;
    expect(routines).toHaveLength(1);
    expect(routines[0]).toMatchObject({ id: "rtn-main", name: "MainRoutine", description: "Imported replacement" });
  });

  it("rejects wrong-family component exports for routine import", () => {
    const project = buildRoutineProject();
    const exported = exportDataTypeComponent(project, "udt-1");
    const result = importRoutineComponent(project, "prog-1", exported.data!.text);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Data Type");
    expect(result.error).toContain(".esco-routine.json");
    expect(result.project).toBe(project);
  });

  it("surfaces missing exported dependencies in the preview and receipt", () => {
    const project = buildRoutineProject();
    const text = JSON.stringify({
      format: "esco.component.export.v1",
      kind: "routine",
      name: "RemoteStart",
      exportedAt: "2026-06-04T00:00:00.000Z",
      project: { id: "source", name: "Source Project" },
      owner: { id: "prog-source", name: "SourceProgram", type: "program" },
      dependencies: {
        tags: ["MissingStart"],
        dataTypes: ["MissingStatus"],
        routines: ["MissingHelper"],
        devices: ["RemoteRack"],
      },
      payload: { id: "rtn-source", programId: "prog-source", name: "RemoteStart", language: "ladder" },
    });

    const preview = previewRoutineComponentImport(project, "prog-1", text);
    expect(preview.ok).toBe(true);
    expect(preview.items[0]?.message).toContain("Dependency review");
    expect(preview.items[0]?.message).toContain("MissingStart");

    const result = importRoutineComponent(project, "prog-1", text);
    expect(result.ok).toBe(true);
    expect(result.data?.dependencyWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("MissingStart"),
        expect.stringContaining("MissingStatus"),
        expect.stringContaining("MissingHelper"),
        expect.stringContaining("RemoteRack"),
      ]),
    );
    expect(result.receipt?.status).toBe("warnings");
    expect(result.receipt?.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Dependency review", status: "warning" })]),
    );
  });
});

describe("program component import", () => {
  it("imports a Program from an ESCO program component export without scheduling it", () => {
    const project = buildRoutineProject();
    const exported = exportProgramComponent(project, "prog-1");
    expect(exported.ok).toBe(true);
    const text = exported.data!.text.replace(/MainProgram/g, "AuxProgram").replace(/MainRoutine/g, "AuxRoutine");

    const preview = previewProgramComponentImport(project, "ctrl-1", text);
    expect(preview).toMatchObject({
      ok: true,
      kindLabel: "Program",
      sourceFormat: "component-envelope",
      createCount: 1,
      targetLabel: "Controller_1",
    });
    expect(preview.items[0]).toMatchObject({ sourceName: "AuxProgram", finalName: "AuxProgram", status: "create" });

    const result = importProgramComponent(project, "ctrl-1", text);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ created: 1, importedNames: ["AuxProgram"], controllerName: "Controller_1" });
    const controller = result.project.controllers[0];
    const imported = controller.programs.find((candidate) => candidate.name === "AuxProgram")!;
    expect(imported.id).not.toBe("prog-1");
    expect(imported.controllerId).toBe("ctrl-1");
    expect(imported.mainRoutineId).toBe(imported.routines[0]?.id);
    expect(imported.routines[0]).toMatchObject({ name: "AuxRoutine", programId: imported.id });
    expect(imported.routines[0]?.id).not.toBe("rtn-main");
    expect(imported.programTags[0]).toMatchObject({ name: "LocalMode", controllerId: "ctrl-1", programId: imported.id, scope: "program" });
    expect(imported.programTags[0]?.id).not.toBe("tag-local");
    expect(controller.tasks[0]?.scheduledProgramIds).toEqual(["prog-1"]);
    expect(result.receipt?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Scheduling", status: "warning" }),
        expect.objectContaining({ label: "Target controller", detail: "Controller_1" }),
      ]),
    );
  });

  it("auto-renames a colliding Program and honours explicit rename choices", () => {
    const project = buildRoutineProject();
    const exported = exportProgramComponent(project, "prog-1");
    const preview = previewProgramComponentImport(project, "ctrl-1", exported.data!.text);
    expect(preview.ok).toBe(true);
    expect(preview.items[0]).toMatchObject({
      sourceName: "MainProgram",
      finalName: "MainProgram_1",
      status: "rename",
      availableOptions: ["rename", "overwrite", "skip"],
    });

    const result = importProgramComponent(project, "ctrl-1", exported.data!.text, {
      "0": { option: "rename", renameTo: "MainProgram_Copy" },
    });
    expect(result.ok).toBe(true);
    expect(result.data?.renamed).toBe(1);
    expect(result.project.controllers[0].programs.map((program) => program.name)).toEqual([
      "MainProgram",
      "MainProgram_Copy",
    ]);
  });

  it("overwrites an existing Program in place by explicit resolution", () => {
    const project = buildRoutineProject();
    const exported = exportProgramComponent(project, "prog-1");
    const parsed = JSON.parse(exported.data!.text);
    parsed.payload.description = "Imported replacement";
    parsed.payload.routines[0].description = "Replacement routine";

    const result = importProgramComponent(project, "ctrl-1", JSON.stringify(parsed), {
      "0": { option: "overwrite" },
    });
    expect(result.ok).toBe(true);
    expect(result.data?.overwritten).toBe(1);
    const controller = result.project.controllers[0];
    const programs = controller.programs;
    expect(programs).toHaveLength(1);
    expect(programs[0]).toMatchObject({ id: "prog-1", name: "MainProgram", description: "Imported replacement" });
    expect(programs[0]?.routines[0]).toMatchObject({ programId: "prog-1", description: "Replacement routine" });
    expect(controller.tasks[0]?.scheduledProgramIds).toEqual(["prog-1"]);
  });

  it("rejects wrong-family component exports for program import", () => {
    const project = buildRoutineProject();
    const exported = exportRoutineComponent(project, "rtn-main");
    const result = importProgramComponent(project, "ctrl-1", exported.data!.text);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Routine");
    expect(result.error).toContain(".esco-program.json");
    expect(result.project).toBe(project);
  });

  it("surfaces missing exported dependencies for imported Programs", () => {
    const project = buildRoutineProject();
    const payload: Program = {
      id: "prog-source",
      controllerId: "ctrl-source",
      name: "RemoteProgram",
      routines: [{ id: "rtn-source", programId: "prog-source", name: "RemoteStart", language: "ladder" }],
      programTags: [],
    };
    const text = JSON.stringify({
      format: "esco.component.export.v1",
      kind: "program",
      name: "RemoteProgram",
      exportedAt: "2026-06-04T00:00:00.000Z",
      project: { id: "source", name: "Source Project" },
      controller: { id: "ctrl-source", name: "SourceController" },
      dependencies: {
        tags: ["MissingStart"],
        dataTypes: ["MissingStatus"],
        routines: ["RemoteStart", "MissingHelper"],
        devices: ["RemoteRack"],
      },
      payload,
    });

    const preview = previewProgramComponentImport(project, "ctrl-1", text);
    expect(preview.ok).toBe(true);
    expect(preview.items[0]?.message).toContain("Dependency review");
    expect(preview.items[0]?.message).toContain("MissingStart");

    const result = importProgramComponent(project, "ctrl-1", text);
    expect(result.ok).toBe(true);
    expect(result.data?.dependencyWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("MissingStart"),
        expect.stringContaining("MissingStatus"),
        expect.stringContaining("MissingHelper"),
        expect.stringContaining("RemoteRack"),
      ]),
    );
    expect(result.receipt?.status).toBe("warnings");
  });
});

describe("tag component import", () => {
  it("imports a controller Tag from an ESCO tag component export", () => {
    const project = buildRoutineProject();
    const exported = exportTagComponent(project, "tag-start");
    expect(exported.ok).toBe(true);
    const text = exported.data!.text.replace(/StartPB/g, "AuxStartPB");

    const target = { scope: "controller", controllerId: "ctrl-1" } as const;
    const preview = previewTagComponentImport(project, target, text);
    expect(preview).toMatchObject({
      ok: true,
      kindLabel: "Tag",
      sourceFormat: "component-envelope",
      createCount: 1,
      targetLabel: "Controller Tags",
    });
    expect(preview.items[0]).toMatchObject({ sourceName: "AuxStartPB", finalName: "AuxStartPB", status: "create" });

    const result = importTagComponent(project, target, text);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ created: 1, importedNames: ["AuxStartPB"], targetScope: "controller" });
    const imported = result.project.controllers[0].controllerTags.find((tag) => tag.name === "AuxStartPB");
    expect(imported).toMatchObject({ controllerId: "ctrl-1", scope: "controller", dataType: "BOOL" });
    expect(imported?.id).not.toBe("tag-start");
    expect(imported?.programId).toBeUndefined();
    expect(project.controllers[0].controllerTags.map((tag) => tag.name)).not.toContain("AuxStartPB");
  });

  it("imports a program Tag into the selected Program scope", () => {
    const project = buildRoutineProject();
    const exported = exportTagComponent(project, "tag-local");
    expect(exported.ok).toBe(true);
    const text = exported.data!.text.replace(/LocalMode/g, "LocalModeCopy");

    const result = importTagComponent(project, { scope: "program", controllerId: "ctrl-1", programId: "prog-1" }, text);
    expect(result.ok).toBe(true);
    const tags = result.project.controllers[0].programs[0].programTags;
    const imported = tags.find((tag) => tag.name === "LocalModeCopy");
    expect(imported).toMatchObject({ scope: "program", controllerId: "ctrl-1", programId: "prog-1", dataType: "BOOL" });
    expect(result.data).toMatchObject({ programName: "MainProgram", targetScope: "program", importedNames: ["LocalModeCopy"] });
  });

  it("auto-renames colliding Tags and honours explicit rename choices", () => {
    const project = buildRoutineProject();
    const exported = exportTagComponent(project, "tag-start");
    const target = { scope: "controller", controllerId: "ctrl-1" } as const;
    const preview = previewTagComponentImport(project, target, exported.data!.text);
    expect(preview.ok).toBe(true);
    expect(preview.items[0]).toMatchObject({
      sourceName: "StartPB",
      finalName: "StartPB_1",
      status: "rename",
      availableOptions: ["rename", "overwrite", "skip"],
    });

    const result = importTagComponent(project, target, exported.data!.text, {
      "0": { option: "rename", renameTo: "StartPB_Copy" },
    });
    expect(result.ok).toBe(true);
    expect(result.data?.renamed).toBe(1);
    expect(result.project.controllers[0].controllerTags.map((tag) => tag.name)).toEqual(["StartPB", "MotorRun", "StartPB_Copy"]);
  });

  it("overwrites an existing Tag in place by explicit resolution", () => {
    const project = buildRoutineProject();
    const exported = exportTagComponent(project, "tag-start");
    const parsed = JSON.parse(exported.data!.text);
    parsed.payload.description = "Imported replacement";
    parsed.payload.value = true;

    const result = importTagComponent(project, { scope: "controller", controllerId: "ctrl-1" }, JSON.stringify(parsed), {
      "0": { option: "overwrite" },
    });
    expect(result.ok).toBe(true);
    expect(result.data?.overwritten).toBe(1);
    const tags = result.project.controllers[0].controllerTags;
    expect(tags).toHaveLength(2);
    expect(tags[0]).toMatchObject({ id: "tag-start", name: "StartPB", description: "Imported replacement", value: true });
  });

  it("rejects wrong-family component exports for tag import", () => {
    const project = buildRoutineProject();
    const exported = exportRoutineComponent(project, "rtn-main");
    const result = importTagComponent(project, { scope: "controller", controllerId: "ctrl-1" }, exported.data!.text);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Routine");
    expect(result.error).toContain(".esco-tag.json");
    expect(result.project).toBe(project);
  });

  it("surfaces scope and dependency warnings for imported Tags", () => {
    const project = buildRoutineProject();
    const payload: Tag = {
      id: "tag-source",
      controllerId: "ctrl-source",
      programId: "prog-source",
      name: "RemoteStatus",
      scope: "program",
      dataType: "MissingStatus",
      aliasFor: "MissingAlias",
    };
    const text = JSON.stringify({
      format: "esco.component.export.v1",
      kind: "tag",
      name: "RemoteStatus",
      exportedAt: "2026-06-04T00:00:00.000Z",
      project: { id: "source", name: "Source Project" },
      controller: { id: "ctrl-source", name: "SourceController" },
      owner: { id: "prog-source", name: "RemoteProgram", type: "program" },
      dependencies: {
        tags: ["MissingAlias"],
        dataTypes: ["MissingStatus"],
        routines: [],
        devices: ["RemoteRack"],
      },
      payload,
    });

    const preview = previewTagComponentImport(project, { scope: "controller", controllerId: "ctrl-1" }, text);
    expect(preview.ok).toBe(true);
    expect(preview.items[0]?.message).toContain("Dependency review");
    expect(preview.items[0]?.message).toContain("RemoteProgram");
    expect(preview.items[0]?.message).toContain("MissingStatus");

    const result = importTagComponent(project, { scope: "controller", controllerId: "ctrl-1" }, text);
    expect(result.ok).toBe(true);
    expect(result.data?.dependencyWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("RemoteProgram"),
        expect.stringContaining("MissingAlias"),
        expect.stringContaining("MissingStatus"),
        expect.stringContaining("RemoteRack"),
      ]),
    );
    const imported = result.project.controllers[0].controllerTags.find((tag) => tag.name === "RemoteStatus");
    expect(imported).toMatchObject({ scope: "controller" });
    expect(imported?.programId).toBeUndefined();
    expect(result.receipt?.status).toBe("warnings");
  });
});

describe("task component import", () => {
  it("imports a Task from an ESCO task component export without scheduling Programs", () => {
    const project = buildRoutineProject();
    const exported = exportTaskComponent(project, "task-main");
    expect(exported.ok).toBe(true);
    const text = exported.data!.text.replace(/MainTask/g, "AuxTask");

    const preview = previewTaskComponentImport(project, "ctrl-1", text);
    expect(preview).toMatchObject({
      ok: true,
      kindLabel: "Task",
      sourceFormat: "component-envelope",
      createCount: 1,
      targetLabel: "Controller_1",
    });
    expect(preview.items[0]).toMatchObject({ sourceName: "AuxTask", finalName: "AuxTask", status: "create" });

    const result = importTaskComponent(project, "ctrl-1", text);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ created: 1, importedNames: ["AuxTask"], controllerName: "Controller_1" });
    const controller = result.project.controllers[0];
    const imported = controller.tasks.find((task) => task.name === "AuxTask");
    expect(imported).toMatchObject({ controllerId: "ctrl-1", type: "continuous", scheduledProgramIds: [] });
    expect(imported?.id).not.toBe("task-main");
    expect(controller.tasks.find((task) => task.name === "MainTask")?.scheduledProgramIds).toEqual(["prog-1"]);
    expect(result.receipt?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Scheduling", status: "warning" }),
        expect.objectContaining({ label: "Target controller", detail: "Controller_1" }),
      ]),
    );
  });

  it("auto-renames a colliding Task and honours explicit rename choices", () => {
    const project = buildRoutineProject();
    const exported = exportTaskComponent(project, "task-main");
    const preview = previewTaskComponentImport(project, "ctrl-1", exported.data!.text);
    expect(preview.ok).toBe(true);
    expect(preview.items[0]).toMatchObject({
      sourceName: "MainTask",
      finalName: "MainTask_1",
      status: "rename",
      availableOptions: ["rename", "overwrite", "skip"],
    });

    const result = importTaskComponent(project, "ctrl-1", exported.data!.text, {
      "0": { option: "rename", renameTo: "MainTask_Copy" },
    });
    expect(result.ok).toBe(true);
    expect(result.data?.renamed).toBe(1);
    expect(result.project.controllers[0].tasks.map((task) => task.name)).toEqual(["MainTask", "MainTask_Copy"]);
    expect(result.project.controllers[0].tasks.find((task) => task.name === "MainTask_Copy")?.scheduledProgramIds).toEqual([]);
  });

  it("overwrites an existing Task in place while preserving its scheduled Programs", () => {
    const project = buildRoutineProject();
    const exported = exportTaskComponent(project, "task-main");
    const parsed = JSON.parse(exported.data!.text);
    parsed.payload.description = "Imported replacement";
    parsed.payload.type = "periodic";
    parsed.payload.periodMs = 100;
    parsed.payload.scheduledProgramIds = ["foreign-program"];

    const result = importTaskComponent(project, "ctrl-1", JSON.stringify(parsed), {
      "0": { option: "overwrite" },
    });
    expect(result.ok).toBe(true);
    expect(result.data?.overwritten).toBe(1);
    const tasks = result.project.controllers[0].tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "task-main",
      name: "MainTask",
      description: "Imported replacement",
      type: "periodic",
      periodMs: 100,
      scheduledProgramIds: ["prog-1"],
    });
  });

  it("rejects wrong-family component exports for task import", () => {
    const project = buildRoutineProject();
    const exported = exportProgramComponent(project, "prog-1");
    const result = importTaskComponent(project, "ctrl-1", exported.data!.text);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Program");
    expect(result.error).toContain(".esco-task.json");
    expect(result.project).toBe(project);
  });

  it("surfaces missing exported dependencies for imported Tasks", () => {
    const project = buildRoutineProject();
    const text = JSON.stringify({
      format: "esco.component.export.v1",
      kind: "task",
      name: "RemoteTask",
      exportedAt: "2026-06-04T00:00:00.000Z",
      project: { id: "source", name: "Source Project" },
      controller: { id: "ctrl-source", name: "SourceController" },
      dependencies: {
        tags: ["MissingStart"],
        dataTypes: ["MissingStatus"],
        routines: ["MissingProgram"],
        devices: [],
      },
      payload: {
        id: "task-source",
        controllerId: "ctrl-source",
        name: "RemoteTask",
        type: "periodic",
        periodMs: 20,
        scheduledProgramIds: ["source-prog"],
      },
    });

    const preview = previewTaskComponentImport(project, "ctrl-1", text);
    expect(preview.ok).toBe(true);
    expect(preview.items[0]?.message).toContain("Dependency review");
    expect(preview.items[0]?.message).toContain("MissingStart");

    const result = importTaskComponent(project, "ctrl-1", text);
    expect(result.ok).toBe(true);
    expect(result.data?.dependencyWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("MissingStart"),
        expect.stringContaining("MissingStatus"),
        expect.stringContaining("MissingProgram"),
      ]),
    );
    expect(result.project.controllers[0].tasks.find((task) => task.name === "RemoteTask")?.scheduledProgramIds).toEqual([]);
    expect(result.receipt?.status).toBe("warnings");
  });
});
