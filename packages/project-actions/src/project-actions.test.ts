import { beforeEach, describe, expect, it } from "vitest";
import {
  createController,
  createContinuousTask,
  createProgram,
  createProject,
  createRoutine,
  createTag as makeTag,
  type AddOnInstruction,
  type IoModule,
  type PlcProject,
  type UserDefinedType,
} from "@esco/core";
import { createLadderRoutine, routineNodes, type LadderRoutine } from "@esco/ladder";
import {
  addBranchLeg,
  addInstruction,
  addInstructionToBranch,
  addIoModule,
  addParallelBranch,
  addRung,
  addRungFromText,
  aoiReferences,
  collectTagReferences,
  createRoutine as createRoutineAction,
  createTag,
  defaultValues,
  deleteRung,
  deleteTag,
  duplicateRung,
  exportProjectJson,
  generateLargeProject,
  importL5XFile,
  importProjectFile,
  outputTags,
  pasteRung,
  removeBranchLeg,
  removeIoModule,
  removeInstruction,
  renameTag,
  scanProject,
  setControllerProperties,
  setProgramProperties,
  setProjectProperties,
  setTaskProperties,
  setTagAlias,
  setTagDataType,
  setTagDescription,
  setTagDimensions,
  setTagMetadata,
  tagsUsingType,
  traceScan,
  udtMemberPaths,
  updateInstructionOperand,
  updateIoModule,
  validateProject,
  type TagValues,
} from "./index";

/** The root branch of a rung, read straight from the demo project structure. */
function rootOf(project: PlcProject, rungId: string) {
  const ladder = project.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
  return ladder.rungs.find((r) => r.id === rungId)!.root;
}

interface Base {
  project: PlcProject;
  routineId: string;
  programId: string;
}

interface MetadataBase extends Base {
  controllerId: string;
  taskId: string;
  faultRoutineId: string;
}

function baseProject(): Base {
  const project = createProject("Test");
  const controller = createController(project.id, "DemoController");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  routine.ladder = createLadderRoutine();
  program.mainRoutineId = routine.id;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return { project, routineId: routine.id, programId: program.id };
}

function metadataProject(): MetadataBase {
  const base = baseProject();
  const controller = base.project.controllers[0]!;
  const program = controller.programs[0]!;
  const task = createContinuousTask(controller.id, "MainTask", [program.id]);
  const faultRoutine = createRoutine(program.id, "FaultRoutine", "ladder");
  faultRoutine.ladder = createLadderRoutine();

  program.routines.push(faultRoutine);
  controller.tasks.push(task);

  return {
    ...base,
    controllerId: controller.id,
    taskId: task.id,
    faultRoutineId: faultRoutine.id,
  };
}

/** Build the XIC(StartPB) XIO(StopPB) OTE(MotorRun) rung + tags through actions. */
function buildMotorRung(base: Base) {
  let p = base.project;
  const { routineId } = base;

  const rung = addRung(p, { routineId });
  p = rung.project;
  const rungId = rung.data!.rungId;

  const ids: Record<string, string> = {};
  for (const [type, tag] of [["XIC", "StartPB"], ["XIO", "StopPB"], ["OTE", "MotorRun"]] as const) {
    const added = addInstruction(p, { routineId, rungId, instructionType: type });
    p = added.project;
    const nodeId = added.data!.nodeId;
    ids[tag] = nodeId;
    p = updateInstructionOperand(p, { routineId, rungId, nodeId, index: 0, value: tag }).project;
  }
  for (const name of ["StartPB", "StopPB", "MotorRun"]) {
    p = createTag(p, { name, dataType: "BOOL" }).project;
  }
  return { project: p, routineId, rungId, ids };
}

describe("project-actions: immutability", () => {
  let base: Base;
  beforeEach(() => {
    base = baseProject();
  });

  it("never mutates the input project", () => {
    const snapshot = JSON.stringify(base.project);
    addRung(base.project, { routineId: base.routineId });
    createTag(base.project, { name: "Foo", dataType: "BOOL" });
    expect(JSON.stringify(base.project)).toBe(snapshot);
  });
});

describe("project-actions: project metadata", () => {
  it("sets project properties immutably and returns validation findings", () => {
    const { project } = metadataProject();
    const snapshot = JSON.stringify(project);

    const result = setProjectProperties(project, {
      name: " Renamed Project ",
      description: "Line one",
    });

    expect(result.ok).toBe(true);
    expect(result.project).not.toBe(project);
    expect(result.project.name).toBe("Renamed Project");
    expect(result.project.description).toBe("Line one");
    expect(result.findings).toBeDefined();
    expect(JSON.stringify(project)).toBe(snapshot);
  });

  it("updates controller, task, and program metadata without mutating originals", () => {
    const base = metadataProject();
    const { project, controllerId, taskId, programId, routineId, faultRoutineId } = base;
    const snapshot = JSON.stringify(project);

    const controllerResult = setControllerProperties(project, {
      controllerId,
      name: " PlantController ",
      processorType: " 1756-L85E ",
      catalogNumber: " 1756-L85E/B ",
      firmwareRevision: " 35.011 ",
      chassis: " 1756-A10 ",
      slot: 2,
      faultRoutineName: " FaultRoutine ",
      powerUpRoutineName: " PowerUpRoutine ",
    });
    const taskResult = setTaskProperties(controllerResult.project, {
      taskId,
      name: " FastTask ",
      type: "periodic",
      periodMs: 10,
      priority: 4,
      watchdogMs: 500,
      inhibited: true,
      scheduledProgramIds: [programId],
    });
    const programResult = setProgramProperties(taskResult.project, {
      programId,
      name: " ConveyorProgram ",
      description: "Conveyor sequence",
      mainRoutineId: routineId,
      faultRoutineId,
      inhibited: true,
    });

    expect(controllerResult.ok).toBe(true);
    expect(taskResult.ok).toBe(true);
    expect(programResult.ok).toBe(true);
    expect(JSON.stringify(project)).toBe(snapshot);

    const controller = programResult.project.controllers[0]!;
    const task = controller.tasks[0]!;
    const program = controller.programs[0]!;

    expect(controller).not.toBe(project.controllers[0]);
    expect(controller.name).toBe("PlantController");
    expect(controller.processorType).toBe("1756-L85E");
    expect(controller.catalogNumber).toBe("1756-L85E/B");
    expect(controller.firmwareRevision).toBe("35.011");
    expect(controller.chassis).toBe("1756-A10");
    expect(controller.slot).toBe(2);
    expect(controller.faultRoutineName).toBe("FaultRoutine");
    expect(controller.powerUpRoutineName).toBe("PowerUpRoutine");

    expect(task.name).toBe("FastTask");
    expect(task.type).toBe("periodic");
    expect(task.periodMs).toBe(10);
    expect(task.priority).toBe(4);
    expect(task.watchdogMs).toBe(500);
    expect(task.inhibited).toBe(true);
    expect(task.scheduledProgramIds).toEqual([programId]);

    expect(program.name).toBe("ConveyorProgram");
    expect(program.description).toBe("Conveyor sequence");
    expect(program.mainRoutineId).toBe(routineId);
    expect(program.faultRoutineId).toBe(faultRoutineId);
    expect(program.inhibited).toBe(true);
  });

  it("rejects missing ids and blank names without changing the project", () => {
    const { project, controllerId, taskId, programId } = metadataProject();
    const snapshot = JSON.stringify(project);
    const failures = [
      setProjectProperties(project, { name: "   " }),
      setControllerProperties(project, { controllerId: "missing", name: "Controller" }),
      setControllerProperties(project, { controllerId, name: " " }),
      setTaskProperties(project, { taskId: "missing", name: "Task", type: "continuous" }),
      setTaskProperties(project, { taskId, name: " ", type: "continuous" }),
      setProgramProperties(project, { programId: "missing", name: "Program" }),
      setProgramProperties(project, { programId, name: " " }),
    ];

    for (const result of failures) {
      expect(result.ok).toBe(false);
      expect(result.project).toBe(project);
      expect(result.error).toBeTruthy();
      expect(result.findings).toBeDefined();
    }
    expect(JSON.stringify(project)).toBe(snapshot);
  });

  it("rejects missing scheduled program and routine references", () => {
    const { project, taskId, programId } = metadataProject();

    const taskResult = setTaskProperties(project, {
      taskId,
      name: "MainTask",
      type: "continuous",
      scheduledProgramIds: ["missing-program"],
    });
    const programResult = setProgramProperties(project, {
      programId,
      name: "MainProgram",
      mainRoutineId: "missing-routine",
    });

    expect(taskResult.ok).toBe(false);
    expect(taskResult.error).toContain("missing-program");
    expect(programResult.ok).toBe(false);
    expect(programResult.error).toContain("missing-routine");
  });
});

describe("project-actions: build a rung and scan it", () => {
  it("adds a rung, XIC/XIO/OTE, tags, then simulates", () => {
    const { project } = buildMotorRung(baseProject());

    // Start pressed, stop clear -> MotorRun energizes.
    let values: TagValues = { ...defaultValues(project), StartPB: true };
    values = scanProject(project, values).data!.values;
    expect(values.MotorRun).toBe(true);

    // Stop pressed -> MotorRun drops.
    values = scanProject(project, { ...values, StopPB: true }).data!.values;
    expect(values.MotorRun).toBe(false);
  });

  it("scans task-scheduled program main routines by default", () => {
    const base = baseProject();
    const controller = base.project.controllers[0]!;
    const auxProgram = createProgram(controller.id, "AuxProgram");
    const auxRoutine = createRoutine(auxProgram.id, "AuxMain", "ladder");
    auxRoutine.ladder = createLadderRoutine();
    auxProgram.mainRoutineId = auxRoutine.id;
    auxProgram.routines.push(auxRoutine);
    controller.programs.push(auxProgram);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [base.programId, auxProgram.id]));

    const built = buildMotorRung(base);
    let p = createTag(built.project, { name: "AuxStart", dataType: "BOOL" }).project;
    p = createTag(p, { name: "AuxRun", dataType: "BOOL" }).project;
    const rung = addRung(p, { routineId: auxRoutine.id });
    p = rung.project;
    const contact = addInstruction(p, { routineId: auxRoutine.id, rungId: rung.data!.rungId, instructionType: "XIC" });
    p = updateInstructionOperand(contact.project, {
      routineId: auxRoutine.id,
      rungId: rung.data!.rungId,
      nodeId: contact.data!.nodeId,
      index: 0,
      value: "AuxStart",
    }).project;
    const coil = addInstruction(p, { routineId: auxRoutine.id, rungId: rung.data!.rungId, instructionType: "OTE" });
    p = updateInstructionOperand(coil.project, {
      routineId: auxRoutine.id,
      rungId: rung.data!.rungId,
      nodeId: coil.data!.nodeId,
      index: 0,
      value: "AuxRun",
    }).project;

    const scheduled = scanProject(p, { ...defaultValues(p), StartPB: true, AuxStart: true }).data!.values;
    expect(scheduled.MotorRun).toBe(true);
    expect(scheduled.AuxRun).toBe(true);
    expect([...outputTags(p)]).toEqual(expect.arrayContaining(["MotorRun", "AuxRun"]));

    const selectedOnly = scanProject(
      p,
      { ...defaultValues(p), StartPB: true, AuxStart: true },
      { routineId: built.routineId },
    ).data!.values;
    expect(selectedOnly.MotorRun).toBe(true);
    expect(selectedOnly.AuxRun).toBe(false);
  });

  it("keeps same-named program tags isolated during scheduled scans", () => {
    const project = createProject("Scoped");
    const controller = createController(project.id, "ScopedCtl");
    controller.controllerTags.push(makeTag(controller.id, "StartA", "BOOL"));
    controller.controllerTags.push(makeTag(controller.id, "StartB", "BOOL"));
    controller.controllerTags.push(makeTag(controller.id, "Local", "BOOL"));
    controller.controllerTags.push(makeTag(controller.id, "SeenRemote", "BOOL"));
    controller.controllerTags.push(makeTag(controller.id, "RemotePlusOne", "DINT"));

    const progA = createProgram(controller.id, "ProgA");
    const mainA = createRoutine(progA.id, "Main", "ladder");
    mainA.ladder = createLadderRoutine();
    progA.mainRoutineId = mainA.id;
    progA.routines.push(mainA);
    progA.programTags.push(makeTag(controller.id, "Local", "BOOL", { scope: "program", programId: progA.id }));

    const progB = createProgram(controller.id, "ProgB");
    const mainB = createRoutine(progB.id, "Main", "ladder");
    mainB.ladder = createLadderRoutine();
    progB.mainRoutineId = mainB.id;
    progB.routines.push(mainB);
    progB.programTags.push(makeTag(controller.id, "Local", "BOOL", { scope: "program", programId: progB.id }));
    progB.programTags.push(makeTag(controller.id, "Count", "DINT", { scope: "program", programId: progB.id }));

    controller.programs.push(progA, progB);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [progA.id, progB.id]));
    project.controllers.push(controller);

    let p = addRungFromText(project, { routineId: mainA.id, text: "XIC(StartA)OTE(Local)" }).project;
    p = addRungFromText(p, { routineId: mainA.id, text: "XIC(Program:ProgB.Local)OTE(SeenRemote)" }).project;
    p = addRungFromText(p, { routineId: mainA.id, text: "CPT(RemotePlusOne,Program:ProgB.Count+1)" }).project;
    p = addRungFromText(p, { routineId: mainB.id, text: "XIC(StartB)OTE(Local)" }).project;

    const defaults = defaultValues(p);
    expect(defaults["Program:ProgA.Local"]).toBe(false);
    expect(defaults["Program:ProgB.Local"]).toBe(false);
    expect([...outputTags(p)]).toEqual(expect.arrayContaining(["Program:ProgA.Local", "Program:ProgB.Local"]));

    const qualifiedRefs = collectTagReferences(p, "Program:ProgB.Local");
    expect(qualifiedRefs).toHaveLength(1);
    expect(qualifiedRefs[0]?.operand).toBe("Program:ProgB.Local");
    const expressionRefs = collectTagReferences(p, "Program:ProgB.Count");
    expect(expressionRefs).toHaveLength(1);
    expect(expressionRefs[0]?.operand).toBe("Program:ProgB.Count+1");

    const values = scanProject(p, {
      ...defaults,
      StartA: true,
      StartB: false,
      Local: true,
      "Program:ProgB.Local": true,
      "Program:ProgB.Count": 41,
    }).data!.values;
    expect(values.Local).toBe(true); // controller tag with the same name is restored after local scan scope.
    expect(values["Program:ProgA.Local"]).toBe(true);
    expect(values["Program:ProgB.Local"]).toBe(false);
    expect(values.SeenRemote).toBe(true);
    expect(values.RemotePlusOne).toBe(42);

    const forced = scanProject(p, { ...defaults, StartA: false, StartB: false }, {
      forces: { "Program:ProgA.Local": true },
    }).data!.values;
    expect(forced["Program:ProgA.Local"]).toBe(true);
    expect(forced["Program:ProgB.Local"]).toBe(false);
  });
});

describe("project-actions: structure helpers", () => {
  const xml = `<?xml version="1.0"?>
<RSLogix5000Content><Controller Name="C">
  <DataTypes><DataType Name="MotorUdt"><Members>
    <Member Name="Running" DataType="BOOL"/><Member Name="Speed" DataType="DINT"/>
  </Members></DataType></DataTypes>
  <AddOnInstructionDefinitions>
    <AddOnInstructionDefinition Name="ScaleAOI"><Parameters>
      <Parameter Name="In" DataType="REAL" Usage="Input"/>
    </Parameters></AddOnInstructionDefinition>
  </AddOnInstructionDefinitions>
  <Tags><Tag Name="M1" DataType="MotorUdt"/><Tag Name="Inst" DataType="ScaleAOI"/></Tags>
  <Programs><Program Name="MainProgram" MainRoutineName="Main">
    <Routines><Routine Name="Main" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[ScaleAOI(Inst);]]></Text></Rung>
    </RLLContent></Routine></Routines>
  </Program></Programs>
</Controller></RSLogix5000Content>`;

  it("finds AOI call references in routines", () => {
    const project = importL5XFile(xml).project;
    const refs = aoiReferences(project, "ScaleAOI");
    expect(refs).toHaveLength(1);
    expect(refs[0]!.routineName).toBe("Main");
    expect(refs[0]!.rungNumber).toBe(0);
  });

  it("validates project-defined AOI calls as model-only instead of unsupported", () => {
    const project = importL5XFile(xml).project;
    const result = validateProject(project);
    expect(result.findings?.some((f) => f.ruleId === "unsupported-instruction" && f.message.includes("SCALEAOI"))).toBe(false);
    expect(result.findings?.some((f) => f.ruleId === "model-only-instruction" && f.message.includes("ScaleAOI"))).toBe(true);
    expect(result.findings?.some((f) => f.ruleId === "operand-type-mismatch")).toBe(false);
  });

  it("validates AOI call instance tags even though the call is model-only", () => {
    const badXml = xml.replace('<Tag Name="Inst" DataType="ScaleAOI"/>', '<Tag Name="Inst" DataType="DINT"/>');
    const project = importL5XFile(badXml).project;
    const result = validateProject(project);
    expect(result.findings?.some((f) => f.ruleId === "model-only-instruction" && f.message.includes("ScaleAOI"))).toBe(true);
    expect(result.findings?.some((f) => f.ruleId === "operand-type-mismatch" && f.message.includes("ScaleAOI"))).toBe(true);
  });

  it("executes imported unprotected RLL AOI logic against instance members", () => {
    const aoiXml = xml.replace(
      `<AddOnInstructionDefinition Name="ScaleAOI"><Parameters>
      <Parameter Name="In" DataType="REAL" Usage="Input"/>
    </Parameters></AddOnInstructionDefinition>`,
      `<AddOnInstructionDefinition Name="ScaleAOI"><Parameters>
      <Parameter Name="In" DataType="DINT" Usage="Input"/>
      <Parameter Name="Out" DataType="DINT" Usage="Output"/>
    </Parameters><LocalTags><LocalTag Name="Scratch" DataType="DINT"/></LocalTags>
    <Routines><Routine Name="Logic" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[ADD(In,1,Scratch);]]></Text></Rung>
      <Rung Number="1"><Text><![CDATA[MOV(Scratch,Out);]]></Text></Rung>
    </RLLContent></Routine></Routines></AddOnInstructionDefinition>`,
    );
    const project = importL5XFile(aoiXml).project;
    const validated = validateProject(project);
    expect(validated.findings?.some((f) => f.ruleId === "model-only-instruction" && f.message.includes("ScaleAOI"))).toBe(false);
    expect(validated.findings?.some((f) => f.ruleId === "unsupported-instruction" && f.message.includes("SCALEAOI"))).toBe(false);
    const values = scanProject(
      project,
      { ...defaultValues(project), "Inst.In": 41 },
      { routineId: project.controllers[0]!.programs[0]!.mainRoutineId },
    ).data!.values;
    expect(values["Inst.Out"]).toBe(42);
    expect(values["Inst.Scratch"]).toBe(42);
    expect(outputTags(project).has("Inst.Out")).toBe(true);
  });

  it("executes nested imported RLL AOI calls through AOI-local instance tags", () => {
    const nestedXml = `<?xml version="1.0"?>
<RSLogix5000Content><Controller Name="C">
  <AddOnInstructionDefinitions>
    <AddOnInstructionDefinition Name="InnerAOI"><Parameters>
      <Parameter Name="In" DataType="DINT" Usage="Input"/>
      <Parameter Name="Out" DataType="DINT" Usage="Output"/>
    </Parameters>
    <Routines><Routine Name="Logic" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[ADD(In,2,Out);]]></Text></Rung>
    </RLLContent></Routine></Routines></AddOnInstructionDefinition>
    <AddOnInstructionDefinition Name="OuterAOI"><Parameters>
      <Parameter Name="In" DataType="DINT" Usage="Input"/>
      <Parameter Name="Out" DataType="DINT" Usage="Output"/>
    </Parameters><LocalTags><LocalTag Name="InnerInst" DataType="InnerAOI"/></LocalTags>
    <Routines><Routine Name="Logic" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[MOV(In,InnerInst.In);]]></Text></Rung>
      <Rung Number="1"><Text><![CDATA[InnerAOI(InnerInst);]]></Text></Rung>
      <Rung Number="2"><Text><![CDATA[MOV(InnerInst.Out,Out);]]></Text></Rung>
    </RLLContent></Routine></Routines></AddOnInstructionDefinition>
  </AddOnInstructionDefinitions>
  <Tags><Tag Name="Inst" DataType="OuterAOI"/></Tags>
  <Programs><Program Name="MainProgram" MainRoutineName="Main">
    <Routines><Routine Name="Main" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[OuterAOI(Inst);]]></Text></Rung>
    </RLLContent></Routine></Routines>
  </Program></Programs>
</Controller></RSLogix5000Content>`;
    const project = importL5XFile(nestedXml).project;
    const values = scanProject(
      project,
      { ...defaultValues(project), "Inst.In": 40 },
      { routineId: project.controllers[0]!.programs[0]!.mainRoutineId },
    ).data!.values;
    expect(values["Inst.InnerInst.In"]).toBe(40);
    expect(values["Inst.InnerInst.Out"]).toBe(42);
    expect(values["Inst.Out"]).toBe(42);
  });

  it("finds tags that use a UDT type", () => {
    const project = importL5XFile(xml).project;
    expect(tagsUsingType(project, "MotorUdt").map((t) => t.name)).toContain("M1");
    expect(tagsUsingType(project, "ScaleAOI").map((t) => t.name)).toContain("Inst");
  });

  it("previews UDT member access paths", () => {
    const project = importL5XFile(xml).project;
    const udt = project.controllers[0]!.dataTypes[0]!;
    expect(udtMemberPaths(udt)).toEqual(["MotorUdt.Running", "MotorUdt.Speed"]);
  });
});

describe("project-actions: large project stress", () => {
  it("validates, cross-references, and scans a large synthetic project", () => {
    // ~640 rungs, 300 tags, 16 routines.
    const project = generateLargeProject({
      controllerTags: 300,
      programs: 4,
      routinesPerProgram: 4,
      rungsPerRoutine: 40,
    });
    expect(project.controllers[0]!.controllerTags).toHaveLength(300);

    const validated = validateProject(project);
    expect(validated.ok).toBe(true);
    // Every operand resolves (tags exist) → no undefined-tag findings.
    expect(validated.findings?.some((f) => f.ruleId === "undefined-tag")).toBe(false);

    const refs = collectTagReferences(project);
    expect(refs.length).toBeGreaterThan(1000);

    const scan = scanProject(project, defaultValues(project));
    expect(scan.ok).toBe(true);
  });
});

describe("project-actions: trace and forces", () => {
  it("captures a per-instruction execution trace", () => {
    const { project } = buildMotorRung(baseProject());
    const { trace } = traceScan(project, { ...defaultValues(project), StartPB: true });
    expect(trace.length).toBeGreaterThan(0);
    const ote = trace.find((entry) => entry.instruction === "OTE");
    expect(ote).toBeDefined();
    expect(ote!.conditionIn).toBe(true);
    expect(ote!.writes.some((w) => w.path === "MotorRun" && w.value === true)).toBe(true);
  });

  it("a forced tag overrides logic during a scan (force wins)", () => {
    const { project } = buildMotorRung(baseProject());
    // StartPB true would energize MotorRun, but a force pins it false.
    const values = scanProject(
      project,
      { ...defaultValues(project), StartPB: true },
      { forces: { MotorRun: false } },
    ).data!.values;
    expect(values.MotorRun).toBe(false);
  });
});

describe("project-actions: tags", () => {
  it("creates a tag and rejects duplicates", () => {
    const base = baseProject();
    const created = createTag(base.project, { name: "Lamp", dataType: "BOOL" });
    expect(created.ok).toBe(true);
    expect(created.data?.tagId).toBeTruthy();

    const dup = createTag(created.project, { name: "Lamp", dataType: "BOOL" });
    expect(dup.ok).toBe(false);
    expect(dup.error).toMatch(/already exists/);
  });

  it("creates program-scoped tags only in a resolved program scope", () => {
    const base = baseProject();
    const controller = base.project.controllers[0]!;
    const mainProgram = controller.programs[0]!;
    const auxProgram = createProgram(controller.id, "AuxProgram");
    controller.programs.push(auxProgram);

    const localA = createTag(base.project, {
      name: "Local",
      dataType: "BOOL",
      scope: "program",
      programId: mainProgram.id,
    });
    expect(localA.ok).toBe(true);
    expect(localA.project.controllers[0]!.controllerTags.some((tag) => tag.name === "Local")).toBe(false);
    expect(localA.project.controllers[0]!.programs[0]!.programTags.find((tag) => tag.name === "Local"))
      .toMatchObject({ scope: "program", programId: mainProgram.id });

    const localB = createTag(localA.project, {
      name: "Local",
      dataType: "DINT",
      scope: "program",
      programId: auxProgram.id,
    });
    expect(localB.ok).toBe(true);
    expect(localB.project.controllers[0]!.programs[1]!.programTags.find((tag) => tag.name === "Local"))
      .toMatchObject({ dataType: "DINT", scope: "program", programId: auxProgram.id });

    const duplicateLocal = createTag(localB.project, {
      name: "local",
      dataType: "BOOL",
      scope: "program",
      programId: mainProgram.id,
    });
    expect(duplicateLocal.ok).toBe(false);
    expect(duplicateLocal.error).toMatch(/already exists/);

    const controllerSameName = createTag(localB.project, { name: "Local", dataType: "REAL" });
    expect(controllerSameName.ok).toBe(true);
    expect(controllerSameName.project.controllers[0]!.controllerTags.find((tag) => tag.name === "Local"))
      .toMatchObject({ scope: "controller", dataType: "REAL" });

    const duplicateController = createTag(controllerSameName.project, { name: "local", dataType: "BOOL" });
    expect(duplicateController.ok).toBe(false);
    expect(duplicateController.error).toMatch(/Controller tag/);

    expect(createTag(base.project, { name: "MissingProgram", dataType: "BOOL", scope: "program" }).error)
      .toMatch(/Program id is required/);
    expect(createTag(base.project, { name: "BadProgram", dataType: "BOOL", scope: "program", programId: "missing" }).error)
      .toMatch(/not found/);
    expect(createTag(base.project, { name: "BadController", dataType: "BOOL", programId: mainProgram.id }).error)
      .toMatch(/cannot specify a program id/);
  });

  it("edits, renames, and deletes tags within the selected Logix scope", () => {
    const base = baseProject();
    const controller = base.project.controllers[0]!;
    const mainProgram = controller.programs[0]!;
    const auxProgram = createProgram(controller.id, "AuxProgram");
    const auxRoutine = createRoutine(auxProgram.id, "MainRoutine", "ladder");
    auxRoutine.ladder = createLadderRoutine();
    auxProgram.mainRoutineId = auxRoutine.id;
    auxProgram.routines.push(auxRoutine);
    controller.programs.push(auxProgram);

    let p = createTag(base.project, {
      name: "Local",
      dataType: "BOOL",
      scope: "program",
      programId: mainProgram.id,
    }).project;
    p = createTag(p, {
      name: "Local",
      dataType: "DINT",
      scope: "program",
      programId: auxProgram.id,
    }).project;
    p = createTag(p, { name: "Local", dataType: "REAL" }).project;

    const ambiguous = setTagDescription(p, { name: "Local", description: "Wrong tag" });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.error).toMatch(/multiple controller scopes/);

    const described = setTagDescription(p, {
      name: "Local",
      scope: "program",
      programId: auxProgram.id,
      description: "Aux local only",
    });
    expect(described.ok).toBe(true);
    expect(described.project.controllers[0]!.programs[0]!.programTags.find((tag) => tag.name === "Local")?.description)
      .toBeUndefined();
    expect(described.project.controllers[0]!.programs[1]!.programTags.find((tag) => tag.name === "Local")?.description)
      .toBe("Aux local only");
    expect(described.project.controllers[0]!.controllerTags.find((tag) => tag.name === "Local")?.description)
      .toBeUndefined();

    const controllerMetadata = setTagMetadata(described.project, {
      name: "Local",
      scope: "controller",
      externalAccess: "read-only",
    });
    expect(controllerMetadata.project.controllers[0]!.controllerTags.find((tag) => tag.name === "Local")?.externalAccess)
      .toBe("read-only");

    const retypedAux = setTagDataType(controllerMetadata.project, {
      name: "Local",
      scope: "program",
      programId: auxProgram.id,
      dataType: "REAL",
    });
    expect(retypedAux.project.controllers[0]!.programs[1]!.programTags.find((tag) => tag.name === "Local")?.dataType)
      .toBe("REAL");

    p = addRungFromText(retypedAux.project, { routineId: base.routineId, text: "XIC(Local)OTE(MainSeen)" }).project;
    p = addRungFromText(p, { routineId: auxRoutine.id, text: "XIC(Local)OTE(AuxSeen)" }).project;
    p = addRungFromText(p, { routineId: base.routineId, text: "XIC(Program:AuxProgram.Local)OTE(RemoteSeen)" }).project;

    const blockedAuxDelete = deleteTag(p, { name: "Local", scope: "program", programId: auxProgram.id });
    expect(blockedAuxDelete.ok).toBe(false);
    expect(blockedAuxDelete.error).toMatch(/referenced by 2 operand/);

    const renamedAux = renameTag(p, {
      from: "Local",
      to: "AuxLocal",
      scope: "program",
      programId: auxProgram.id,
    });
    expect(renamedAux.ok).toBe(true);
    const renamedController = renamedAux.project.controllers[0]!;
    expect(renamedController.programs[0]!.programTags.find((tag) => tag.name === "Local")).toBeTruthy();
    expect(renamedController.programs[1]!.programTags.find((tag) => tag.name === "AuxLocal")).toBeTruthy();
    expect(renamedController.controllerTags.find((tag) => tag.name === "Local")).toBeTruthy();

    const mainOperands = routineNodes(renamedController.programs[0]!.routines[0]!.ladder as LadderRoutine)
      .flatMap((node) => node.operands.map((operand) => operand.value));
    const auxOperands = routineNodes(renamedController.programs[1]!.routines[0]!.ladder as LadderRoutine)
      .flatMap((node) => node.operands.map((operand) => operand.value));
    expect(mainOperands).toEqual(expect.arrayContaining(["Local", "Program:AuxProgram.AuxLocal"]));
    expect(auxOperands).toContain("AuxLocal");

    const removedController = deleteTag(renamedAux.project, { name: "Local", scope: "controller" });
    expect(removedController.ok).toBe(true);
    expect(removedController.project.controllers[0]!.controllerTags.find((tag) => tag.name === "Local"))
      .toBeUndefined();
    expect(removedController.project.controllers[0]!.programs[0]!.programTags.find((tag) => tag.name === "Local"))
      .toBeTruthy();
  });

  it("validates and canonicalizes tag data types at creation", () => {
    const base = baseProject();
    const controller = base.project.controllers[0]!;
    controller.dataTypes.push({ id: "udt_motor", name: "MotorUdt", members: [] });
    controller.addOnInstructions.push({
      id: "aoi_scale",
      name: "ScaleAOI",
      parameters: [],
      localTags: [],
      routineNames: [],
    } satisfies AddOnInstruction);

    const scalar = createTag(base.project, { name: "SmallCounter", dataType: "sint" });
    expect(scalar.ok).toBe(true);
    expect(scalar.project.controllers[0]!.controllerTags.find((tag) => tag.name === "SmallCounter")?.dataType)
      .toBe("SINT");

    const modelOnly = createTag(base.project, { name: "LocalModule", dataType: "module" });
    expect(modelOnly.ok).toBe(true);
    expect(modelOnly.project.controllers[0]!.controllerTags.find((tag) => tag.name === "LocalModule")?.dataType)
      .toBe("MODULE");

    const udt = createTag(base.project, { name: "Motor1", dataType: "motorudt" });
    expect(udt.ok).toBe(true);
    expect(udt.project.controllers[0]!.controllerTags.find((tag) => tag.name === "Motor1")?.dataType)
      .toBe("MotorUdt");

    const aoi = createTag(base.project, { name: "Scale1", dataType: "scaleaoi" });
    expect(aoi.ok).toBe(true);
    expect(aoi.project.controllers[0]!.controllerTags.find((tag) => tag.name === "Scale1")?.dataType)
      .toBe("ScaleAOI");

    const invalid = createTag(base.project, { name: "Ghost", dataType: "MissingType" });
    expect(invalid.ok).toBe(false);
    expect(invalid.error).toMatch(/Unknown data type "MissingType"/);
    expect(invalid.project).toBe(base.project);
  });

  it("rejects tag names that Studio 5000 rejects at edit time", () => {
    const base = baseProject();
    const cases = [
      ["Trailing_", /must not end with an underscore/],
      ["Has__Gap", /consecutive underscores/],
      ["T".repeat(41), /limit is 40/],
    ] as const;

    for (const [name, reason] of cases) {
      const result = createTag(base.project, { name, dataType: "BOOL" });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(reason);
    }

    const created = createTag(base.project, { name: "GoodTag", dataType: "BOOL" });
    const renamed = renameTag(created.project, { from: "GoodTag", to: "Bad__Name" });
    expect(renamed.ok).toBe(false);
    expect(renamed.error).toMatch(/consecutive underscores/);
  });

  it("creates a tag with full multi-dimensional array metadata", () => {
    const base = baseProject();
    const created = createTag(base.project, { name: "Matrix", dataType: "DINT", dimensions: [2, 3] });
    expect(created.ok).toBe(true);
    const tag = created.project.controllers[0]!.controllerTags.find((candidate) => candidate.name === "Matrix");
    expect(tag).toMatchObject({ dimension: 2, dimensions: [2, 3] });

    const invalid = createTag(base.project, { name: "BadMatrix", dataType: "DINT", dimensions: [2, 0] });
    expect(invalid.ok).toBe(false);
    expect(invalid.error).toMatch(/dimensions/i);
  });

  it("creates, updates, and clears Studio 5000 tag metadata", () => {
    const base = baseProject();
    const created = createTag(base.project, {
      name: "Setpoint",
      dataType: "DINT",
      constant: true,
      externalAccess: "read-only",
    });
    expect(created.ok).toBe(true);
    expect(created.project.controllers[0]!.controllerTags.find((tag) => tag.name === "Setpoint")).toMatchObject({
      constant: true,
      externalAccess: "read-only",
    });

    const updated = setTagMetadata(created.project, {
      name: "Setpoint",
      constant: false,
      externalAccess: "none",
    });
    const tag = updated.project.controllers[0]!.controllerTags.find((candidate) => candidate.name === "Setpoint");
    expect(tag?.constant).toBeUndefined();
    expect(tag?.externalAccess).toBe("none");

    const cleared = setTagMetadata(updated.project, { name: "Setpoint", externalAccess: "" });
    expect(cleared.project.controllers[0]!.controllerTags.find((candidate) => candidate.name === "Setpoint")?.externalAccess)
      .toBeUndefined();

    const invalid = setTagMetadata(cleared.project, {
      name: "Setpoint",
      externalAccess: "invalid" as never,
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.error).toMatch(/ExternalAccess/);
  });

  it("sets, canonicalizes, clears, and validates a tag's display radix", () => {
    const base = baseProject();
    const created = createTag(base.project, { name: "Counter", dataType: "DINT" });
    const findTag = (project: typeof created.project) =>
      project.controllers[0]!.controllerTags.find((tag) => tag.name === "Counter");

    // Case-insensitive input is stored in canonical Studio 5000 capitalization.
    const set = setTagMetadata(created.project, { name: "Counter", radix: "hex" });
    expect(set.ok).toBe(true);
    expect(findTag(set.project)?.radix).toBe("Hex");

    // Editing radix leaves other metadata untouched (independent fields).
    const withAccess = setTagMetadata(set.project, { name: "Counter", externalAccess: "read-only" });
    expect(findTag(withAccess.project)?.radix).toBe("Hex");
    expect(findTag(withAccess.project)?.externalAccess).toBe("read-only");

    const cleared = setTagMetadata(withAccess.project, { name: "Counter", radix: "" });
    expect(findTag(cleared.project)?.radix).toBeUndefined();
    expect(findTag(cleared.project)?.externalAccess).toBe("read-only");

    const invalid = setTagMetadata(cleared.project, { name: "Counter", radix: "Roman" });
    expect(invalid.ok).toBe(false);
    expect(invalid.error).toMatch(/radix/i);
  });

  it("changes a tag's data type, resets the value, and validates the type", () => {
    const base = baseProject();
    const created = createTag(base.project, { name: "Level", dataType: "BOOL" });
    const findTag = (project: typeof created.project) =>
      project.controllers[0]!.controllerTags.find((tag) => tag.name === "Level");

    // Atomic retype is case-insensitive and resets the value to the type default.
    const toReal = setTagDataType(created.project, { name: "Level", dataType: "real" });
    expect(toReal.ok).toBe(true);
    expect(findTag(toReal.project)).toMatchObject({ dataType: "REAL", value: 0 });

    const toString = setTagDataType(toReal.project, { name: "Level", dataType: "STRING" });
    expect(findTag(toString.project)?.value).toBe("");

    // A predefined structured type is accepted.
    const toTimer = setTagDataType(toString.project, { name: "Level", dataType: "TIMER" });
    expect(findTag(toTimer.project)?.dataType).toBe("TIMER");

    // Smaller/larger Logix scalar types are valid declarations, even though
    // offline values are represented with the nearest primitive JS value.
    const toSint = setTagDataType(toTimer.project, { name: "Level", dataType: "sint" });
    expect(findTag(toSint.project)).toMatchObject({ dataType: "SINT", value: 0 });

    // Unknown types are rejected and the project is unchanged.
    const invalid = setTagDataType(toSint.project, { name: "Level", dataType: "WIDGET" });
    expect(invalid.ok).toBe(false);
    expect(invalid.error).toMatch(/Unknown data type/);
    expect(invalid.project).toBe(toSint.project);
  });

  it("warns when retyping a referenced tag and refuses to retype an alias", () => {
    const base = baseProject();
    const created = createTag(base.project, { name: "Source", dataType: "DINT" });
    const rung = addRungFromText(created.project, {
      routineId: base.routineId,
      text: "MOV(Source,Source)",
    });
    expect(rung.ok).toBe(true);

    const retyped = setTagDataType(rung.project, { name: "Source", dataType: "REAL" });
    expect(retyped.ok).toBe(true);
    expect(retyped.warnings?.[0]).toMatch(/referenced by/);

    // Aliases derive their type from the base tag, so retyping is rejected.
    const mirror = createTag(retyped.project, { name: "Mirror", dataType: "REAL" });
    const aliased = setTagAlias(mirror.project, { name: "Mirror", aliasFor: "Source" });
    expect(aliased.ok).toBe(true);
    const blocked = setTagDataType(aliased.project, { name: "Mirror", dataType: "DINT" });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/alias/i);
  });

  it("updates and clears a tag's full array dimensions", () => {
    const base = baseProject();
    const created = createTag(base.project, { name: "Matrix", dataType: "DINT", dimension: 8 });
    const updated = setTagDimensions(created.project, { name: "Matrix", dimensions: [2, 3] });
    expect(updated.ok).toBe(true);
    expect(updated.project.controllers[0]!.controllerTags.find((tag) => tag.name === "Matrix")).toMatchObject({
      dimension: 2,
      dimensions: [2, 3],
    });

    const cleared = setTagDimensions(updated.project, { name: "Matrix", dimensions: [] });
    const tag = cleared.project.controllers[0]!.controllerTags.find((candidate) => candidate.name === "Matrix");
    expect(tag?.dimension).toBeUndefined();
    expect(tag?.dimensions).toBeUndefined();
  });

  it("flags an undefined operand, then create-tag clears it", () => {
    const base = baseProject();
    const rung = addRung(base.project, { routineId: base.routineId });
    const added = addInstruction(rung.project, {
      routineId: base.routineId,
      rungId: rung.data!.rungId,
      instructionType: "XIC",
    });
    const edited = updateInstructionOperand(added.project, {
      routineId: base.routineId,
      rungId: rung.data!.rungId,
      nodeId: added.data!.nodeId,
      index: 0,
      value: "Ghost",
    });
    expect(edited.findings?.some((f) => f.ruleId === "undefined-tag")).toBe(true);

    const fixed = createTag(edited.project, { name: "Ghost", dataType: "BOOL" });
    expect(fixed.findings?.some((f) => f.ruleId === "undefined-tag")).toBe(false);
  });

  it("updates a tag description", () => {
    const base = baseProject();
    const created = createTag(base.project, { name: "Lamp", dataType: "BOOL" });
    const described = setTagDescription(created.project, { name: "Lamp", description: "Status lamp" });
    expect(described.ok).toBe(true);
    const tag = described.project.controllers[0]!.controllerTags.find((t) => t.name === "Lamp");
    expect(tag?.description).toBe("Status lamp");
  });

  it("renames a tag and remaps operand references", () => {
    const built = buildMotorRung(baseProject());
    const renamed = renameTag(built.project, { from: "StartPB", to: "RunCmd" });
    expect(renamed.ok).toBe(true);
    // No dangling reference to the old name.
    expect(renamed.findings?.some((f) => f.message.includes("StartPB"))).toBe(false);

    let values: TagValues = { ...defaultValues(renamed.project), RunCmd: true };
    values = scanProject(renamed.project, values).data!.values;
    expect(values.MotorRun).toBe(true);
  });

  it("refuses to delete a referenced tag, allows deleting an unused one", () => {
    const built = buildMotorRung(baseProject());
    const blocked = deleteTag(built.project, { name: "StartPB" });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/referenced/);

    const withUnused = createTag(built.project, { name: "Spare", dataType: "BOOL" });
    const removed = deleteTag(withUnused.project, { name: "Spare" });
    expect(removed.ok).toBe(true);
  });
});

describe("project-actions: rungs and routines", () => {
  it("deletes a rung and reports a missing rung", () => {
    const built = buildMotorRung(baseProject());
    const removed = deleteRung(built.project, { routineId: built.routineId, rungId: built.rungId });
    expect(removed.ok).toBe(true);

    const missing = deleteRung(built.project, { routineId: built.routineId, rungId: "nope" });
    expect(missing.ok).toBe(false);
  });

  it("removes an instruction", () => {
    const built = buildMotorRung(baseProject());
    const removed = removeInstruction(built.project, {
      routineId: built.routineId,
      rungId: built.rungId,
      nodeId: built.ids.StartPB,
    });
    expect(removed.ok).toBe(true);
  });

  it("duplicates a rung with fresh ids right after the original", () => {
    const built = buildMotorRung(baseProject());
    const result = duplicateRung(built.project, { routineId: built.routineId, rungId: built.rungId });
    expect(result.ok).toBe(true);
    const ladder = rootOf(result.project, built.rungId); // original still there
    expect(ladder).toBeDefined();

    const rungs = result.project.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    expect(rungs.rungs).toHaveLength(2);
    const [first, second] = rungs.rungs;
    expect(second!.id).not.toBe(first!.id); // fresh rung id
    expect(second!.id).toBe(result.data!.rungId);
    // Same logic, different node ids (deep clone).
    const firstNodes = first!.root.nodes.map((n) => n.instructionType);
    const secondNodes = second!.root.nodes.map((n) => n.instructionType);
    expect(secondNodes).toEqual(firstNodes);
    expect(second!.root.nodes[0]!.id).not.toBe(first!.root.nodes[0]!.id);
    // Renumbered 0,1.
    expect(rungs.rungs.map((r) => r.number)).toEqual([0, 1]);
  });

  it("copies a rung (root) and pastes it as a new rung with fresh ids", () => {
    const built = buildMotorRung(baseProject());
    const sourceRoot = rootOf(built.project, built.rungId);

    const pasted = pasteRung(built.project, { routineId: built.routineId, root: sourceRoot, comment: "Pasted" });
    expect(pasted.ok).toBe(true);
    const ladder = pasted.project.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    expect(ladder.rungs).toHaveLength(2);
    const newRung = ladder.rungs.find((r) => r.id === pasted.data!.rungId)!;
    expect(newRung.comment).toBe("Pasted");
    expect(newRung.root.id).not.toBe(sourceRoot.id); // cloned, not the same branch object
    expect(newRung.root.nodes.map((n) => n.instructionType)).toEqual(
      sourceRoot.nodes.map((n) => n.instructionType),
    );

    // Pasting again does not collide ids (clone each time).
    const twice = pasteRung(pasted.project, { routineId: built.routineId, root: sourceRoot });
    expect(twice.ok).toBe(true);
    const ladder2 = twice.project.controllers[0]!.programs[0]!.routines[0]!.ladder as LadderRoutine;
    const ids = ladder2.rungs.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it("creates a routine in a program", () => {
    const base = baseProject();
    const result = createRoutineAction(base.project, { programId: base.programId, name: "Faults" });
    expect(result.ok).toBe(true);
    expect(result.data?.routineId).toBeTruthy();
  });

  it("rejects routine names that Studio 5000 rejects at create time", () => {
    const base = baseProject();
    const cases = [
      ["Routine_", /must not end with an underscore/],
      ["Routine__Gap", /consecutive underscores/],
      ["R".repeat(41), /limit is 40/],
    ] as const;

    for (const [name, reason] of cases) {
      const result = createRoutineAction(base.project, { programId: base.programId, name });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(reason);
    }
  });

  it("addRungFromText builds a seal-in branch rung that simulates", () => {
    const base = baseProject();
    let p = addRungFromText(base.project, {
      routineId: base.routineId,
      text: "[XIC(StartPB),XIC(MotorRun)]XIO(StopPB)OTE(MotorRun)",
    }).project;
    for (const name of ["StartPB", "StopPB", "MotorRun"]) {
      p = createTag(p, { name, dataType: "BOOL" }).project;
    }

    let values: TagValues = { ...defaultValues(p), StartPB: true };
    values = scanProject(p, values).data!.values;
    expect(values.MotorRun).toBe(true);

    // Seal-in: release Start, MotorRun stays on.
    values = scanProject(p, { ...values, StartPB: false }).data!.values;
    expect(values.MotorRun).toBe(true);

    // Stop breaks it.
    values = scanProject(p, { ...values, StopPB: true }).data!.values;
    expect(values.MotorRun).toBe(false);
  });
});

describe("project-actions: branch editing", () => {
  // Build [XIC(StartPB) , XIC(MotorRun)] XIO(StopPB) OTE(MotorRun) entirely
  // through the controlled branch actions — the way the UI buttons drive it.
  function buildSealInByBranch() {
    const base = baseProject();
    const { routineId } = base;
    const rung = addRung(base.project, { routineId });
    let p = rung.project;
    const rungId = rung.data!.rungId;

    // Parallel branch → leg 1 = main line (root), leg 2 = first alternate.
    p = addParallelBranch(p, { routineId, rungId }).project;
    const root = rootOf(p, rungId);
    const leg1 = root.id;
    const leg2 = root.parallelBranches![0]!.id;

    const addToLeg = (branchId: string, type: string, tag: string) => {
      const added = addInstructionToBranch(p, { routineId, rungId, branchId, instructionType: type });
      p = added.project;
      p = updateInstructionOperand(p, { routineId, rungId, nodeId: added.data!.nodeId, value: tag }).project;
    };
    addToLeg(leg1, "XIC", "StartPB"); // leg 1: start contact
    addToLeg(leg2, "XIC", "MotorRun"); // leg 2: seal-in contact

    // Downstream series after the parallel merge.
    for (const [type, tag] of [["XIO", "StopPB"], ["OTE", "MotorRun"]] as const) {
      const a = addInstruction(p, { routineId, rungId, instructionType: type });
      p = a.project;
      p = updateInstructionOperand(p, { routineId, rungId, nodeId: a.data!.nodeId, value: tag }).project;
    }
    for (const name of ["StartPB", "StopPB", "MotorRun"]) {
      p = createTag(p, { name, dataType: "BOOL" }).project;
    }
    return { project: p, routineId, rungId, leg2 };
  }

  it("adds a parallel branch, then a second leg", () => {
    const base = baseProject();
    const { routineId } = base;
    const rung = addRung(base.project, { routineId });
    const rungId = rung.data!.rungId;

    const withBranch = addParallelBranch(rung.project, { routineId, rungId });
    expect(withBranch.ok).toBe(true);
    expect(rootOf(withBranch.project, rungId).parallelBranches).toHaveLength(1);

    const twoLegs = addBranchLeg(withBranch.project, { routineId, rungId });
    expect(twoLegs.ok).toBe(true);
    expect(rootOf(twoLegs.project, rungId).parallelBranches).toHaveLength(2);
  });

  it("rejects adding a leg before a parallel branch exists", () => {
    const base = baseProject();
    const rung = addRung(base.project, { routineId: base.routineId });
    const res = addBranchLeg(rung.project, { routineId: base.routineId, rungId: rung.data!.rungId });
    expect(res.ok).toBe(false);
  });

  it("removes an empty leg but refuses a populated one", () => {
    const { project, routineId, rungId, leg2 } = buildSealInByBranch();
    const blocked = removeBranchLeg(project, { routineId, rungId, branchId: leg2 });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/empty/i);

    const added = addBranchLeg(project, { routineId, rungId });
    const legs = rootOf(added.project, rungId).parallelBranches!;
    const emptyLeg = legs[legs.length - 1]!.id;
    const removed = removeBranchLeg(added.project, { routineId, rungId, branchId: emptyLeg });
    expect(removed.ok).toBe(true);
    expect(rootOf(removed.project, rungId).parallelBranches).toHaveLength(1);
  });

  it("prunes an alternate branch leg when its last instruction is deleted", () => {
    const { project, routineId, rungId } = buildSealInByBranch();
    const alternateNodeId = rootOf(project, rungId).parallelBranches![0]!.nodes[0]!.id;
    const removed = removeInstruction(project, { routineId, rungId, nodeId: alternateNodeId });
    expect(removed.ok).toBe(true);
    expect(rootOf(removed.project, rungId).parallelBranches).toBeUndefined();
  });

  it("blocks deleting the primary branch instruction while alternate legs remain", () => {
    const { project, routineId, rungId } = buildSealInByBranch();
    const primaryNodeId = rootOf(project, rungId).nodes[0]!.id;
    const removed = removeInstruction(project, { routineId, rungId, nodeId: primaryNodeId });
    expect(removed.ok).toBe(false);
    expect(removed.error).toMatch(/parallel branch legs/i);
  });

  it("simulates the hand-built seal-in (latches, then stop breaks it)", () => {
    const { project } = buildSealInByBranch();
    let values: TagValues = { ...defaultValues(project), StartPB: true };
    values = scanProject(project, values).data!.values;
    expect(values.MotorRun).toBe(true);

    values = scanProject(project, { ...values, StartPB: false }).data!.values;
    expect(values.MotorRun).toBe(true); // sealed in by the parallel branch

    values = scanProject(project, { ...values, StopPB: true }).data!.values;
    expect(values.MotorRun).toBe(false); // stop breaks the seal
  });

  it("export/import preserves the branch structure", () => {
    const { project, rungId } = buildSealInByBranch();
    const restored = importProjectFile(exportProjectJson(project).data!.text);
    expect(restored.ok).toBe(true);
    expect(restored.project).toEqual(project);
    expect(rootOf(restored.project, rungId).parallelBranches).toHaveLength(1);
  });

  it("cross reference sees tags inside branch legs", () => {
    const { project } = buildSealInByBranch();
    const motor = collectTagReferences(project).filter((r) => r.tag === "MotorRun");
    // The seal-in contact lives inside leg 2; the coil is on the main line.
    expect(motor.some((r) => r.instructionType === "XIC" && r.direction === "read")).toBe(true);
    expect(motor.some((r) => r.instructionType === "OTE" && r.direction === "write")).toBe(true);
  });

  it("validation catches an undefined tag inside a branch leg", () => {
    const base = baseProject();
    const { routineId } = base;
    const rung = addRung(base.project, { routineId });
    const rungId = rung.data!.rungId;
    let p = addParallelBranch(rung.project, { routineId, rungId }).project;
    const leg2 = rootOf(p, rungId).parallelBranches![0]!.id;
    const added = addInstructionToBranch(p, { routineId, rungId, branchId: leg2, instructionType: "XIC" });
    p = added.project;
    const result = updateInstructionOperand(p, {
      routineId,
      rungId,
      nodeId: added.data!.nodeId,
      value: "GhostInBranch",
    });
    expect(
      result.findings?.some((f) => f.ruleId === "undefined-tag" && f.message.includes("GhostInBranch")),
    ).toBe(true);
  });
});

describe("project-actions: array tags", () => {
  it("expands an array tag into element value-paths and simulates them", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    ctrl.controllerTags.push(makeTag(ctrl.id, "Arr", "DINT", { dimension: 8 }));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Dest", "DINT"));
    const p = addRungFromText(base.project, {
      routineId: base.routineId,
      text: "MOV(7,Arr[2])MOV(Arr[2],Dest)",
    }).project;

    const defaults = defaultValues(p);
    expect(defaults["Arr[0]"]).toBe(0);
    expect(defaults["Arr[7]"]).toBe(0);
    expect("Arr[8]" in defaults).toBe(false); // dimension is 8 → indices 0..7

    const values = scanProject(p, defaults).data!.values;
    expect(values["Arr[2]"]).toBe(7); // written by MOV(7, Arr[2])
    expect(values["Dest"]).toBe(7); // read back via MOV(Arr[2], Dest)
  });

  it("resolves alias reads/writes to the base tag in simulation", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    ctrl.controllerTags.push(makeTag(ctrl.id, "StartPB", "BOOL"));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Run", "BOOL"));
    const alias = makeTag(ctrl.id, "MotorCmd", "BOOL");
    alias.aliasFor = "Run";
    ctrl.controllerTags.push(alias);

    // XIC(StartPB) OTE(MotorCmd) — writing the alias must land on its base, Run.
    const p = addRungFromText(base.project, { routineId: base.routineId, text: "XIC(StartPB)OTE(MotorCmd)" }).project;
    const values = scanProject(p, { ...defaultValues(p), StartPB: true }).data!.values;
    expect(values.Run).toBe(true);
  });

  it("feeds declared array dimensions to the SIZE instruction during simulation", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    ctrl.controllerTags.push(makeTag(ctrl.id, "Arr", "DINT", { dimension: 8 }));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Sz", "DINT"));

    const p = addRungFromText(base.project, { routineId: base.routineId, text: "SIZE(Arr,0,Sz)" }).project;
    const values = scanProject(p, defaultValues(p)).data!.values;
    expect(values.Sz).toBe(8);
  });

  it("flags an out-of-range array index and accepts an in-range one", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    ctrl.controllerTags.push(makeTag(ctrl.id, "Arr", "DINT", { dimension: 4 }));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Dest", "DINT"));

    const bad = addRungFromText(base.project, { routineId: base.routineId, text: "MOV(Arr[10],Dest)" }).project;
    expect(validateProject(bad).findings?.some((f) => f.ruleId === "array-index-out-of-range")).toBe(true);

    const good = addRungFromText(base.project, { routineId: base.routineId, text: "MOV(Arr[3],Dest)" }).project;
    expect(validateProject(good).findings?.some((f) => f.ruleId === "array-index-out-of-range")).toBe(false);
  });

  it("resolves indirect array subscripts during scans and output classification", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    ctrl.controllerTags.push(makeTag(ctrl.id, "Flags", "BOOL", { dimension: 32 }));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Index", "DINT"));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Enable", "BOOL"));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Out", "BOOL"));

    let p = addRungFromText(base.project, { routineId: base.routineId, text: "XIC(Flags[Index+1])OTE(Out)" }).project;
    p = addRungFromText(p, { routineId: base.routineId, text: "XIC(Enable)OTE(Flags[Index+1])" }).project;

    expect(validateProject(p).findings?.some((f) => f.severity === "error")).toBe(false);
    expect([...outputTags(p)]).toEqual(expect.arrayContaining(["Out", "Flags[0]", "Flags[1]", "Flags[2]"]));

    const first = scanProject(p, { ...defaultValues(p), Index: 0, Enable: true }).data!.values;
    expect(first.Out).toBe(false);
    expect(first["Flags[1]"]).toBe(true);

    const second = scanProject(p, first).data!.values;
    expect(second.Out).toBe(true);
  });

  it("expands, validates, sizes, and scans multi-dimensional array tags", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    ctrl.controllerTags.push(makeTag(ctrl.id, "Matrix", "DINT", { dimensions: [2, 3] }));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Dest", "DINT"));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Rows", "DINT"));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Cols", "DINT"));

    const p = addRungFromText(base.project, {
      routineId: base.routineId,
      text: "MOV(7,Matrix[1,2])MOV(Matrix[1,2],Dest)SIZE(Matrix,0,Rows)SIZE(Matrix,1,Cols)",
    }).project;

    const defaults = defaultValues(p);
    expect(defaults["Matrix[0,0]"]).toBe(0);
    expect(defaults["Matrix[1,2]"]).toBe(0);
    expect("Matrix[2,0]" in defaults).toBe(false);
    expect(validateProject(p).findings?.some((f) => f.severity === "error")).toBe(false);

    const values = scanProject(p, defaults).data!.values;
    expect(values["Matrix[1,2]"]).toBe(7);
    expect(values.Dest).toBe(7);
    expect(values.Rows).toBe(2);
    expect(values.Cols).toBe(3);

    const bad = addRungFromText(base.project, { routineId: base.routineId, text: "MOV(Matrix[1,3],Dest)" }).project;
    expect(validateProject(bad).findings?.some((f) => f.ruleId === "array-index-out-of-range")).toBe(true);
  });
});

describe("project-actions: UDT tag values", () => {
  it("expands UDT member value paths and scans member references", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    const motorUdt: UserDefinedType = {
      id: "udt_motor",
      name: "MotorUdt",
      members: [
        { name: "Running", dataType: "BOOL" },
        { name: "Speed", dataType: "DINT" },
        { name: "Faults", dataType: "BOOL", dimension: 2 },
        { name: "Label", dataType: "STRING" },
      ],
    };
    ctrl.dataTypes.push(motorUdt);
    ctrl.controllerTags.push(makeTag(ctrl.id, "M1", "MotorUdt"));
    ctrl.controllerTags.push(makeTag(ctrl.id, "MotorOn", "BOOL"));
    ctrl.controllerTags.push(makeTag(ctrl.id, "SpeedCopy", "DINT"));

    const p = addRungFromText(base.project, {
      routineId: base.routineId,
      text: "XIC(M1.Running)MOV(42,M1.Speed)MOV(M1.Speed,SpeedCopy)XIC(M1.Faults[1])OTE(MotorOn)",
    }).project;

    const defaults = defaultValues(p);
    expect(defaults["M1.Running"]).toBe(false);
    expect(defaults["M1.Speed"]).toBe(0);
    expect(defaults["M1.Faults[0]"]).toBe(false);
    expect(defaults["M1.Faults[1]"]).toBe(false);
    expect(defaults["M1.Label"]).toBe("");
    expect("M1.Faults[2]" in defaults).toBe(false);

    const values = scanProject(p, { ...defaults, "M1.Running": true, "M1.Faults[1]": true }).data!.values;
    expect(values["M1.Speed"]).toBe(42);
    expect(values.SpeedCopy).toBe(42);
    expect(values.MotorOn).toBe(true);
  });

  it("resolves alias tags to UDT member paths during simulation", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    const motorUdt: UserDefinedType = {
      id: "udt_motor",
      name: "MotorUdt",
      members: [{ name: "Running", dataType: "BOOL" }],
    };
    ctrl.dataTypes.push(motorUdt);
    ctrl.controllerTags.push(makeTag(ctrl.id, "M1", "MotorUdt"));
    const runAlias = makeTag(ctrl.id, "M1_Run", "BOOL");
    runAlias.aliasFor = "M1.Running";
    ctrl.controllerTags.push(runAlias);
    ctrl.controllerTags.push(makeTag(ctrl.id, "Out", "BOOL"));

    const p = addRungFromText(base.project, {
      routineId: base.routineId,
      text: "XIC(M1_Run)OTE(Out)",
    }).project;

    const values = scanProject(p, { ...defaultValues(p), "M1.Running": true }).data!.values;
    expect(values.Out).toBe(true);
    expect(values.M1_Run).toBe(true);
  });
});

describe("project-actions: MESSAGE control values", () => {
  it("expands MESSAGE status/configuration members without simulating communications", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    ctrl.controllerTags.push(makeTag(ctrl.id, "MsgCtl", "MESSAGE"));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Done", "BOOL"));

    const p = addRungFromText(base.project, {
      routineId: base.routineId,
      text: "XIC(MsgCtl.DN)OTE(Done)",
    }).project;

    const defaults = defaultValues(p);
    expect(defaults["MsgCtl.EN"]).toBe(false);
    expect(defaults["MsgCtl.DN"]).toBe(false);
    expect(defaults["MsgCtl.ERR"]).toBe(0);
    expect(defaults["MsgCtl.Path"]).toBe("");

    const values = scanProject(p, { ...defaults, "MsgCtl.DN": true }).data!.values;
    expect(values.Done).toBe(true);
    expect(validateProject(p).findings?.some((f) => f.ruleId === "unknown-member")).toBe(false);
  });
});

describe("project-actions: string tags", () => {
  it("creates string defaults and scans executable string instructions", () => {
    const base = baseProject();
    const ctrl = base.project.controllers[0]!;
    ctrl.controllerTags.push(makeTag(ctrl.id, "StrA", "STRING"));
    ctrl.controllerTags.push(makeTag(ctrl.id, "StrB", "STRING"));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Dest", "STRING"));
    ctrl.controllerTags.push(makeTag(ctrl.id, "Len", "DINT"));

    const p = addRungFromText(base.project, {
      routineId: base.routineId,
      text: "CONCAT(StrA,StrB,Dest)LEN(Dest,Len)",
    }).project;

    const defaults = defaultValues(p);
    expect(defaults.StrA).toBe("");
    const values = scanProject(p, { ...defaults, StrA: "Hi", StrB: "There" }).data!.values;
    expect(values.Dest).toBe("HiThere");
    expect(values.Len).toBe(7);
  });
});

describe("project-actions: nested branch editing", () => {
  // Build  [ XIC(Sel0) , [ XIC(Sel1) , XIC(Sel2) ] ] OTE(Out)  through actions:
  // a parallel on the root, then a nested parallel inside leg 2.
  function buildNested() {
    const base = baseProject();
    const { routineId } = base;
    const rung = addRung(base.project, { routineId });
    let p = rung.project;
    const rungId = rung.data!.rungId;

    const addToBranch = (branchId: string, type: string, tag: string) => {
      const added = addInstructionToBranch(p, { routineId, rungId, branchId, instructionType: type });
      p = added.project;
      p = updateInstructionOperand(p, { routineId, rungId, nodeId: added.data!.nodeId, value: tag }).project;
    };

    // Parallel on the root: root = leg1(main) | leg2.
    p = addParallelBranch(p, { routineId, rungId }).project;
    const rootId = rootOf(p, rungId).id;
    const leg2Id = rootOf(p, rungId).parallelBranches![0]!.id;

    // Nested parallel inside leg 2: leg2 = legA | legB.
    p = addParallelBranch(p, { routineId, rungId, branchId: leg2Id }).project;
    const nestedLegId = rootOf(p, rungId).parallelBranches![0]!.parallelBranches![0]!.id;

    addToBranch(rootId, "XIC", "Sel0"); // main line
    addToBranch(leg2Id, "XIC", "Sel1"); // leg 2 series
    addToBranch(nestedLegId, "XIC", "Sel2"); // nested leg

    // Downstream output after the root merge.
    const ote = addInstruction(p, { routineId, rungId, instructionType: "OTE" });
    p = ote.project;
    p = updateInstructionOperand(p, { routineId, rungId, nodeId: ote.data!.nodeId, value: "Out" }).project;

    for (const name of ["Sel0", "Sel1", "Sel2", "Out"]) {
      p = createTag(p, { name, dataType: "BOOL" }).project;
    }
    return { project: p, routineId, rungId, leg2Id, nestedLegId };
  }

  it("creates a nested parallel branch inside a leg", () => {
    const { project, rungId } = buildNested();
    const leg2 = rootOf(project, rungId).parallelBranches![0]!;
    expect(leg2.parallelBranches).toHaveLength(1); // nesting present
  });

  it("simulates nested OR logic (any of the selectors energizes the output)", () => {
    const { project } = buildNested();
    const off = scanProject(project, defaultValues(project)).data!.values;
    expect(off.Out).toBe(false);

    // Only the deeply-nested selector is true → still energizes via the nested OR.
    const viaNested = scanProject(project, { ...defaultValues(project), Sel2: true }).data!.values;
    expect(viaNested.Out).toBe(true);

    const viaMain = scanProject(project, { ...defaultValues(project), Sel0: true }).data!.values;
    expect(viaMain.Out).toBe(true);
  });

  it("cross-references an operand inside a nested branch", () => {
    const { project } = buildNested();
    const refs = collectTagReferences(project, "Sel2");
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0]!.instructionType).toBe("XIC");
  });

  it("validates an undefined tag inside a nested branch", () => {
    const { project, routineId, rungId, nestedLegId } = buildNested();
    const added = addInstructionToBranch(project, { routineId, rungId, branchId: nestedLegId, instructionType: "XIC" });
    const result = updateInstructionOperand(added.project, {
      routineId,
      rungId,
      nodeId: added.data!.nodeId,
      value: "GhostNested",
    });
    expect(
      result.findings?.some((f) => f.ruleId === "undefined-tag" && f.message.includes("GhostNested")),
    ).toBe(true);
  });

  it("preserves the nested branch through export/import", () => {
    const { project, rungId } = buildNested();
    const restored = importProjectFile(exportProjectJson(project).data!.text);
    expect(restored.ok).toBe(true);
    const leg2 = rootOf(restored.project, rungId).parallelBranches![0]!;
    expect(leg2.parallelBranches).toHaveLength(1);
  });

  it("removes an empty nested leg, refuses a populated one", () => {
    const { project, routineId, rungId, nestedLegId } = buildNested();
    // nestedLeg has XIC(Sel2) → cannot remove.
    expect(removeBranchLeg(project, { routineId, rungId, branchId: nestedLegId }).ok).toBe(false);

    // Add an empty nested leg and remove it.
    const leg2Id = rootOf(project, rungId).parallelBranches![0]!.id;
    const withLeg = addBranchLeg(project, { routineId, rungId, branchId: leg2Id });
    const legs = rootOf(withLeg.project, rungId).parallelBranches![0]!.parallelBranches!;
    const emptyLeg = legs[legs.length - 1]!.id;
    const removed = removeBranchLeg(withLeg.project, { routineId, rungId, branchId: emptyLeg });
    expect(removed.ok).toBe(true);
  });
});

describe("project-actions: subroutine execution (JSR / RET)", () => {
  it("runs a subroutine via JSR against shared memory", () => {
    const base = baseProject();
    const created = createRoutineAction(base.project, { programId: base.programId, name: "Sub" });
    let p = created.project;
    const subId = created.data!.routineId;
    p = addRungFromText(p, { routineId: subId, text: "MOV(99,Result)" }).project;
    p = addRungFromText(p, { routineId: base.routineId, text: "XIC(Run)JSR(Sub)" }).project;
    p = createTag(p, { name: "Run", dataType: "BOOL" }).project;
    p = createTag(p, { name: "Result", dataType: "DINT" }).project;

    // Run = true → JSR(Sub) executes → Result = 99.
    let values = scanProject(p, { ...defaultValues(p), Run: true }, { routineId: base.routineId }).data!.values;
    expect(values.Result).toBe(99);

    // Run = false → the JSR is not taken → Result stays 0.
    values = scanProject(p, defaultValues(p), { routineId: base.routineId }).data!.values;
    expect(values.Result).toBe(0);
  });

  it("RET ends a subroutine early (later rungs do not run)", () => {
    const base = baseProject();
    const created = createRoutineAction(base.project, { programId: base.programId, name: "Sub" });
    let p = created.project;
    const subId = created.data!.routineId;
    p = addRungFromText(p, { routineId: subId, text: "MOV(1,A)" }).project; // runs
    p = addRungFromText(p, { routineId: subId, text: "RET()" }).project; // returns
    p = addRungFromText(p, { routineId: subId, text: "MOV(2,B)" }).project; // skipped
    p = addRungFromText(p, { routineId: base.routineId, text: "JSR(Sub)" }).project;
    for (const name of ["A", "B"]) p = createTag(p, { name, dataType: "DINT" }).project;

    const values = scanProject(p, defaultValues(p), { routineId: base.routineId }).data!.values;
    expect(values.A).toBe(1); // executed before RET
    expect(values.B).toBe(0); // RET ended the routine before this rung
  });

  it("passes Studio-style JSR input and return parameters through SBR/RET", () => {
    const base = baseProject();
    const created = createRoutineAction(base.project, { programId: base.programId, name: "Sub" });
    let p = created.project;
    const subId = created.data!.routineId;
    p = addRungFromText(p, { routineId: subId, text: "SBR(InA,InB)" }).project;
    p = addRungFromText(p, { routineId: subId, text: "ADD(InA,InB,Sum)" }).project;
    p = addRungFromText(p, { routineId: subId, text: "RET(Sum)" }).project;
    p = addRungFromText(p, { routineId: base.routineId, text: "JSR(Sub,2,A,B,Result)" }).project;
    for (const name of ["A", "B", "InA", "InB", "Sum", "Result"]) {
      p = createTag(p, { name, dataType: "DINT" }).project;
    }

    const values = scanProject(
      p,
      { ...defaultValues(p), A: 12, B: 30 },
      { routineId: base.routineId },
    ).data!.values;
    expect(values.InA).toBe(12);
    expect(values.InB).toBe(30);
    expect(values.Sum).toBe(42);
    expect(values.Result).toBe(42);

    const refs = collectTagReferences(p);
    expect(refs.some((ref) => ref.tag === "Sub")).toBe(false);
    expect(refs.some((ref) => ref.tag === "A" && ref.instructionType === "JSR" && ref.direction === "read")).toBe(true);
    expect(refs.some((ref) => ref.tag === "Result" && ref.instructionType === "JSR" && ref.direction === "write")).toBe(true);
    expect(refs.some((ref) => ref.tag === "InA" && ref.instructionType === "SBR" && ref.direction === "write")).toBe(true);
    expect(refs.some((ref) => ref.tag === "Sum" && ref.instructionType === "RET" && ref.direction === "read")).toBe(true);
  });

  it("flags a JSR to an unknown routine as a warning (not an undefined tag)", () => {
    const base = baseProject();
    const p = addRungFromText(base.project, { routineId: base.routineId, text: "JSR(DoesNotExist)" }).project;
    const result = validateProject(p);
    expect(result.findings?.some((f) => f.ruleId === "unknown-routine")).toBe(true);
    expect(
      result.findings?.some((f) => f.ruleId === "undefined-tag" && f.message.includes("DoesNotExist")),
    ).toBe(false);
  });
});

describe("project-actions: validation and IO", () => {
  it("adds an offline I/O module through the controlled action layer", () => {
    const { project } = metadataProject();
    const controller = project.controllers[0]!;
    const snapshot = JSON.stringify(project);

    const result = addIoModule(project, {
      controllerId: controller.id,
      name: "Local_DI_01",
      catalogNumber: "1756-IB16",
      slot: 1,
      vendor: "ESCO Compatible",
      productType: "Digital Input",
      majorRevision: "3",
      minorRevision: "1",
      electronicKeying: "CompatibleModule",
      description: "Offline-added input module",
      connection: {
        name: "Data",
        type: "Input",
        rpi: 100000,
        priority: "Scheduled",
        inputConnectionType: "Multicast",
        inputProductionTrigger: "Cyclic",
      },
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(project)).toBe(snapshot);
    expect(result.project.controllers[0]!.ioConfiguration.modules).toHaveLength(1);
    expect(result.project.controllers[0]!.ioConfiguration.modules[0]).toMatchObject({
      name: "Local_DI_01",
      catalogNumber: "1756-IB16",
      slot: 1,
      productType: "Digital Input",
      electronicKeying: "CompatibleModule",
      connections: [
        {
          name: "Data",
          type: "Input",
          rpi: 100000,
          priority: "Scheduled",
          inputConnectionType: "Multicast",
          inputProductionTrigger: "Cyclic",
        },
      ],
    });
    expect(result.data?.moduleId).toBeTruthy();
  });

  it("normalizes app-authored I/O keying and connection aliases to validator tokens", () => {
    const { project } = metadataProject();
    const controller = project.controllers[0]!;

    const result = addIoModule(project, {
      controllerId: controller.id,
      name: "Local_AI_HART",
      catalogNumber: "1756-IF8H",
      slot: 5,
      electronicKeying: "DisableKeying",
      connection: {
        name: "Data",
        type: "Input",
        rpi: 100000,
        inputConnectionType: "Analog and HART",
        inputProductionTrigger: "change of state",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.project.controllers[0]!.ioConfiguration.modules[0]).toMatchObject({
      electronicKeying: "Disabled",
      connections: [
        {
          inputConnectionType: "Multicast",
          inputProductionTrigger: "COS",
        },
      ],
    });
    expect(validateProject(result.project).findings?.some((finding) => finding.ruleId === "module-electronic-keying")).toBe(false);
    expect(validateProject(result.project).findings?.some((finding) => finding.ruleId === "module-connection-input-config")).toBe(false);
  });

  it("preserves unknown I/O keying and connection tokens so validation can flag them", () => {
    const { project } = metadataProject();
    const controller = project.controllers[0]!;

    const result = addIoModule(project, {
      controllerId: controller.id,
      name: "Local_Generic_Bad",
      catalogNumber: "GENERIC-ETHERNET",
      slot: 6,
      electronicKeying: "VendorSpecific",
      connection: {
        name: "Data",
        type: "Input",
        rpi: 100000,
        inputConnectionType: "Broadcast",
        inputProductionTrigger: "OnDemand",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.project.controllers[0]!.ioConfiguration.modules[0]).toMatchObject({
      electronicKeying: "VendorSpecific",
      connections: [
        {
          inputConnectionType: "Broadcast",
          inputProductionTrigger: "OnDemand",
        },
      ],
    });
    const findings = validateProject(result.project).findings ?? [];
    expect(findings.some((finding) => finding.ruleId === "module-electronic-keying")).toBe(true);
    expect(findings.filter((finding) => finding.ruleId === "module-connection-input-config")).toHaveLength(2);
  });

  it("rejects duplicate I/O module names and slots", () => {
    const { project } = metadataProject();
    const controller = project.controllers[0]!;
    const created = addIoModule(project, {
      controllerId: controller.id,
      name: "Local_DO_01",
      catalogNumber: "1756-OB16E",
      slot: 2,
    });

    const duplicateName = addIoModule(created.project, {
      controllerId: controller.id,
      name: "local_do_01",
      catalogNumber: "1756-OB16E",
      slot: 3,
    });
    const duplicateSlot = addIoModule(created.project, {
      controllerId: controller.id,
      name: "Local_DO_02",
      catalogNumber: "1756-OB16E",
      slot: 2,
    });

    expect(duplicateName.ok).toBe(false);
    expect(duplicateName.error).toContain("already exists");
    expect(duplicateSlot.ok).toBe(false);
    expect(duplicateSlot.error).toContain("slot 2");
  });

  it("rejects invalid I/O connection defaults while adding a module", () => {
    const { project } = metadataProject();
    const controller = project.controllers[0]!;
    const result = addIoModule(project, {
      controllerId: controller.id,
      name: "Local_AI_Bad",
      catalogNumber: "1756-IF8",
      slot: 4,
      connection: { name: "Data", rpi: 0 },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("RPI");
    expect(project.controllers[0]!.ioConfiguration.modules).toHaveLength(0);
  });

  it("updates offline I/O module properties and first connection metadata immutably", () => {
    const { project } = metadataProject();
    const controller = project.controllers[0]!;
    const created = addIoModule(project, {
      controllerId: controller.id,
      name: "Local_AI_01",
      catalogNumber: "1756-IF8",
      slot: 3,
      parentModule: "Local",
    });
    const moduleId = created.data!.moduleId;
    const snapshot = JSON.stringify(created.project);

    const updated = updateIoModule(created.project, {
      controllerId: controller.id,
      moduleId,
      name: "Local_AI_03",
      catalogNumber: "1756-IF8",
      slot: 4,
      parentModule: "Local",
      parentPortId: "1",
      commPath: "Local,1,4",
      vendor: "ESCO Compatible",
      productType: "Analog Input",
      productCode: "8",
      majorRevision: "4",
      minorRevision: "2",
      electronicKeying: "ExactMatch",
      inhibited: true,
      description: "Updated analog input module",
      connection: {
        name: "Data",
        type: "Input",
        rpi: 100000,
        priority: "Scheduled",
        unicast: true,
        inputConnectionType: "Multicast",
        inputProductionTrigger: "Cyclic",
      },
    });

    expect(updated.ok).toBe(true);
    expect(JSON.stringify(created.project)).toBe(snapshot);
    expect(updated.data?.moduleId).toBe(moduleId);
    expect(updated.project.controllers[0]!.ioConfiguration.modules[0]).toMatchObject({
      id: moduleId,
      name: "Local_AI_03",
      slot: 4,
      parentPortId: "1",
      commPath: "Local,1,4",
      inhibited: true,
      connections: [
        {
          name: "Data",
          type: "Input",
          rpi: 100000,
          priority: "Scheduled",
          unicast: true,
          inputConnectionType: "Multicast",
          inputProductionTrigger: "Cyclic",
        },
      ],
    });
  });

  it("repairs legacy I/O keying and connection aliases when module properties are saved", () => {
    const { project } = metadataProject();
    const controller = project.controllers[0]!;
    const legacyModule: IoModule = {
      id: "legacy-module",
      name: "Local_AI_Legacy",
      catalogNumber: "1756-IF8H",
      slot: 7,
      electronicKeying: "DisableKeying",
      connections: [
        {
          name: "Data",
          type: "Input",
          rpi: 100000,
          inputConnectionType: "Analog Only",
          inputProductionTrigger: "cyclic",
        },
      ],
    };
    const legacyProject = {
      ...project,
      controllers: project.controllers.map((candidate) =>
        candidate.id === controller.id
          ? {
              ...candidate,
              ioConfiguration: {
                ...candidate.ioConfiguration,
                modules: [legacyModule],
              },
            }
          : candidate,
      ),
    };

    const updated = updateIoModule(legacyProject, {
      controllerId: controller.id,
      moduleId: legacyModule.id,
      name: legacyModule.name,
      catalogNumber: legacyModule.catalogNumber,
      slot: legacyModule.slot,
      electronicKeying: legacyModule.electronicKeying,
      connection: legacyModule.connections![0]!,
    });

    expect(updated.ok).toBe(true);
    expect(updated.project.controllers[0]!.ioConfiguration.modules[0]).toMatchObject({
      electronicKeying: "Disabled",
      connections: [
        {
          inputConnectionType: "Multicast",
          inputProductionTrigger: "Cyclic",
        },
      ],
    });
  });

  it("rejects I/O module property edits that collide with existing names or slots", () => {
    const { project } = metadataProject();
    const controller = project.controllers[0]!;
    const first = addIoModule(project, {
      controllerId: controller.id,
      name: "Local_DI_01",
      catalogNumber: "1756-IB16",
      slot: 1,
    });
    const second = addIoModule(first.project, {
      controllerId: controller.id,
      name: "Local_DO_02",
      catalogNumber: "1756-OB16E",
      slot: 2,
    });
    const secondId = second.data!.moduleId;

    const duplicateName = updateIoModule(second.project, {
      controllerId: controller.id,
      moduleId: secondId,
      name: "local_di_01",
      catalogNumber: "1756-OB16E",
      slot: 2,
    });
    const duplicateSlot = updateIoModule(second.project, {
      controllerId: controller.id,
      moduleId: secondId,
      name: "Local_DO_02",
      catalogNumber: "1756-OB16E",
      slot: 1,
    });
    const invalidRpi = updateIoModule(second.project, {
      controllerId: controller.id,
      moduleId: secondId,
      name: "Local_DO_02",
      catalogNumber: "1756-OB16E",
      slot: 2,
      connection: { name: "Data", rpi: 0 },
    });

    expect(duplicateName.ok).toBe(false);
    expect(duplicateName.error).toContain("already exists");
    expect(duplicateSlot.ok).toBe(false);
    expect(duplicateSlot.error).toContain("slot 1");
    expect(invalidRpi.ok).toBe(false);
    expect(invalidRpi.error).toContain("RPI");
  });

  it("removes offline I/O modules while protecting parent topology", () => {
    const { project } = metadataProject();
    const controller = project.controllers[0]!;
    const parent = addIoModule(project, {
      controllerId: controller.id,
      name: "Local_ENBT_01",
      catalogNumber: "1756-EN2T",
      slot: 1,
    });
    const child = addIoModule(parent.project, {
      controllerId: controller.id,
      name: "Remote_DI_01",
      catalogNumber: "1756-IB16",
      slot: 0,
      parentModule: "Local_ENBT_01",
      parentPortId: "2",
    });
    const parentId = parent.data!.moduleId;
    const childId = child.data!.moduleId;
    const snapshot = JSON.stringify(child.project);

    const blockedParent = removeIoModule(child.project, { controllerId: controller.id, moduleId: parentId });
    expect(blockedParent.ok).toBe(false);
    expect(blockedParent.error).toContain("child module");

    const removedChild = removeIoModule(child.project, { controllerId: controller.id, moduleId: childId });
    expect(removedChild.ok).toBe(true);
    expect(JSON.stringify(child.project)).toBe(snapshot);
    expect(removedChild.project.controllers[0]!.ioConfiguration.modules.map((module) => module.name)).toEqual([
      "Local_ENBT_01",
    ]);

    const removedParent = removeIoModule(removedChild.project, { controllerId: controller.id, moduleId: parentId });
    expect(removedParent.ok).toBe(true);
    expect(removedParent.project.controllers[0]!.ioConfiguration.modules).toHaveLength(0);
  });

  it("validateProject returns findings", () => {
    const built = buildMotorRung(baseProject());
    const result = validateProject(built.project);
    expect(result.ok).toBe(true);
    expect(result.data?.findingCount).toBe(result.findings?.length);
  });

  it("round-trips export -> import", () => {
    const { project } = buildMotorRung(baseProject());
    const exported = exportProjectJson(project);
    const imported = importProjectFile(exported.data!.text);
    expect(imported.ok).toBe(true);
    expect(imported.project).toEqual(project);
  });

  it("reports a clear error for an invalid project file", () => {
    const result = importProjectFile("{ not json");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("collects tag cross-references with direction and location", () => {
    const base = baseProject();
    const p = addRungFromText(base.project, {
      routineId: base.routineId,
      text: "XIC(StartPB)TON(Timer1,1000)",
    }).project;

    const refs = collectTagReferences(p);
    const start = refs.find((r) => r.tag === "StartPB");
    expect(start?.instructionType).toBe("XIC");
    expect(start?.direction).toBe("read");
    expect(start?.routineName).toBe("MainRoutine");
    expect(start?.rungNumber).toBe(0);

    const timer = refs.find((r) => r.tag === "Timer1");
    expect(timer?.instructionType).toBe("TON");
    expect(timer?.direction).toBe("write");

    // Filtering by tag name works (member paths resolve to the base tag).
    expect(collectTagReferences(p, "Timer1").every((r) => r.tag === "Timer1")).toBe(true);
  });

  it("cross-references model-only MSG/GSV/SSV review operands without keyword noise", () => {
    const xml = `<?xml version="1.0"?>
<RSLogix5000Content><Controller Name="C">
  <Tags>
    <Tag Name="MsgCtl" DataType="MESSAGE"/>
    <Tag Name="Dest" DataType="DINT"/>
    <Tag Name="Source" DataType="DINT"/>
  </Tags>
  <Programs><Program Name="MainProgram" MainRoutineName="Main">
    <Routines><Routine Name="Main" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[MSG(MsgCtl);]]></Text></Rung>
      <Rung Number="1"><Text><![CDATA[GSV(WALLCLOCKTIME,0,DateTime,Dest);]]></Text></Rung>
      <Rung Number="2"><Text><![CDATA[SSV(WALLCLOCKTIME,0,DateTime,Source);]]></Text></Rung>
    </RLLContent></Routine></Routines>
  </Program></Programs>
</Controller></RSLogix5000Content>`;
    const project = importL5XFile(xml).project;
    const refs = collectTagReferences(project);

    expect(refs.find((ref) => ref.tag === "MsgCtl")?.direction).toBe("write");
    expect(refs.find((ref) => ref.tag === "Dest")?.direction).toBe("write");
    expect(refs.find((ref) => ref.tag === "Source")?.direction).toBe("read");
    expect(refs.some((ref) => ref.tag === "WALLCLOCKTIME")).toBe(false);
    expect(refs.some((ref) => ref.tag === "DateTime")).toBe(false);
  });

  it("cross-references model-only ALMA/ALMD with the backing alarm tag as destructive", () => {
    const xml = `<?xml version="1.0"?>
<RSLogix5000Content><Controller Name="C">
  <Tags>
    <Tag Name="LevelAlarm" DataType="ALARM_ANALOG"/>
    <Tag Name="Level" DataType="REAL"/>
    <Tag Name="FaultAlarm" DataType="ALARM_DIGITAL"/>
    <Tag Name="Fault" DataType="BOOL"/>
  </Tags>
  <Programs><Program Name="MainProgram" MainRoutineName="Main">
    <Routines><Routine Name="Main" Type="RLL"><RLLContent>
      <Rung Number="0"><Text><![CDATA[ALMA(LevelAlarm,Level);]]></Text></Rung>
      <Rung Number="1"><Text><![CDATA[ALMD(FaultAlarm,Fault);]]></Text></Rung>
    </RLLContent></Routine></Routines>
  </Program></Programs>
</Controller></RSLogix5000Content>`;
    const project = importL5XFile(xml).project;
    const refs = collectTagReferences(project);

    // The instruction owns and updates its alarm tag → destructive reference.
    expect(refs.find((ref) => ref.tag === "LevelAlarm")?.direction).toBe("write");
    expect(refs.find((ref) => ref.tag === "FaultAlarm")?.direction).toBe("write");
    // The input value is read.
    expect(refs.find((ref) => ref.tag === "Level")?.direction).toBe("read");
    expect(refs.find((ref) => ref.tag === "Fault")?.direction).toBe("read");
  });

  it("validates a richer imported L5X cleanly (members/arrays resolve, unknown block flagged)", () => {
    const xml = `<?xml version="1.0"?>
<RSLogix5000Content>
  <Controller Name="Imported">
    <Tags>
      <Tag Name="Start" DataType="BOOL"/><Tag Name="Run" DataType="BOOL"/>
      <Tag Name="Stop" DataType="BOOL"/><Tag Name="Dwell" DataType="TIMER"/>
      <Tag Name="Cnt" DataType="COUNTER"/><Tag Name="Arr" DataType="DINT" Dimensions="4"/>
      <Tag Name="Dest" DataType="DINT"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0"><Text><![CDATA[[XIC(Start),XIC(Run)]XIO(Stop)OTE(Run);]]></Text></Rung>
          <Rung Number="1"><Text><![CDATA[XIC(Run)RTO(Dwell,1000);]]></Text></Rung>
          <Rung Number="2"><Text><![CDATA[XIC(Dwell.DN)CTU(Cnt,5);]]></Text></Rung>
          <Rung Number="3"><Text><![CDATA[MOV(Arr[0],Dest);]]></Text></Rung>
          <Rung Number="4"><Text><![CDATA[XIC(Start)XUNKNOWN(Sub);]]></Text></Rung>
        </RLLContent></Routine></Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;
    const imported = importL5XFile(xml);
    expect(imported.ok).toBe(true);

    const result = validateProject(imported.project);
    expect(result.ok).toBe(true);
    // Member (Dwell.DN) and array (Arr[0]) paths resolve to defined base tags.
    expect(result.findings?.some((f) => f.ruleId === "undefined-tag")).toBe(false);
    // The truly unknown vendor block is reported as info, not an error.
    expect(result.findings?.some((f) => f.ruleId === "unsupported-instruction")).toBe(true);
  });

  it("imports an L5X file through the action layer", () => {
    const xml = `<?xml version="1.0"?>
<RSLogix5000Content>
  <Controller Name="Imported">
    <Tags><Tag Name="StartPB" DataType="BOOL"/><Tag Name="MotorRun" DataType="BOOL"/></Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="Main">
        <Routines><Routine Name="Main" Type="RLL"><RLLContent>
          <Rung Number="0"><Text><![CDATA[XIC(StartPB)OTE(MotorRun);]]></Text></Rung>
        </RLLContent></Routine></Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;
    const result = importL5XFile(xml);
    expect(result.ok).toBe(true);
    expect(result.project.name).toBe("Imported");
    expect(result.data?.summary.rungs).toBe(1);
  });
});
