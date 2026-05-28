import { beforeEach, describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  type PlcProject,
} from "@esco/core";
import { createLadderRoutine } from "@esco/ladder";
import {
  addInstruction,
  addRung,
  createRoutine as createRoutineAction,
  createTag,
  defaultValues,
  deleteRung,
  deleteTag,
  exportProjectJson,
  importL5XFile,
  importProjectFile,
  removeInstruction,
  renameTag,
  scanProject,
  updateInstructionOperand,
  validateProject,
  type TagValues,
} from "./index";

interface Base {
  project: PlcProject;
  routineId: string;
  programId: string;
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

  it("creates a routine in a program", () => {
    const base = baseProject();
    const result = createRoutineAction(base.project, { programId: base.programId, name: "Faults" });
    expect(result.ok).toBe(true);
    expect(result.data?.routineId).toBeTruthy();
  });
});

describe("project-actions: validation and IO", () => {
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
