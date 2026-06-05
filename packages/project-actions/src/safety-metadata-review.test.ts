import { describe, expect, it } from "vitest";
import {
  createController,
  createContinuousTask,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type AddOnInstruction,
  type Program,
  type Routine,
} from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { safetyMetadataReviewReport } from "./safety-metadata-review";

function ladderRoutine(programId: string, name = "Main"): Routine {
  const routine = createRoutine(programId, name);
  routine.ladder = createLadderRoutine();
  return routine;
}

function addRung(routine: Routine, number: number, nodes: ReturnType<typeof createNode>[]): void {
  const ladder = routine.ladder as ReturnType<typeof createLadderRoutine>;
  ladder.rungs.push(createRung(routine.id, number, nodes));
}

function programWithRoutine(controllerId: string): { program: Program; routine: Routine } {
  const program = createProgram(controllerId, "SafetyProgram");
  const routine = ladderRoutine(program.id);
  program.routines.push(routine);
  program.mainRoutineId = routine.id;
  return { program, routine };
}

describe("safetyMetadataReviewReport", () => {
  it("projects imported task safety Class metadata", () => {
    const project = createProject("Safety Task Review");
    const controller = createController(project.id, "SafetyCtl");
    const safetyTask = createContinuousTask(controller.id, "SafetyTask");
    safetyTask.safetyClass = "Safety";
    const standardTask = createContinuousTask(controller.id, "StandardTask");
    standardTask.safetyClass = "Standard";
    const vendorTask = createContinuousTask(controller.id, "VendorTask");
    vendorTask.safetyClass = "Guarded";
    controller.tasks.push(safetyTask, standardTask, vendorTask);
    project.controllers.push(controller);

    const report = safetyMetadataReviewReport(project);

    expect(report.partitionRowCount).toBe(3);
    expect(report.safetyTaskCount).toBe(1);
    expect(report.safetyPartitionCount).toBe(1);
    expect(report.standardPartitionCount).toBe(1);
    expect(report.unknownPartitionCount).toBe(1);
    expect(report.issueCount).toBe(1);
    expect(report.partitionRows.map((row) => [row.objectKind, row.objectName, row.normalizedSafetyClass])).toEqual([
      ["task", "SafetyTask", "safety"],
      ["task", "StandardTask", "standard"],
      ["task", "VendorTask", "unknown"],
    ]);
    expect(report.partitionRows[0]).toMatchObject({
      objectKind: "task",
      objectName: "SafetyTask",
      safetyTaskSchedulingModelled: false,
      safetyMemoryPartitionEnforced: false,
      controllerSafetyStatusModelled: false,
    });
    expect(report.warnings[0]).toMatch(/task "VendorTask" has unrecognised safety Class "Guarded"/);
  });

  it("projects GuardLogix safety partitions and safety backing tags with offline boundaries", () => {
    const project = createProject("Safety Review");
    const controller = createController(project.id, "SafetyCtl");
    const { program, routine } = programWithRoutine(controller.id);
    program.safetyClass = "Safety";
    const localGate = createTag(controller.id, "LocalGate", "DCS", {
      scope: "program",
      programId: program.id,
    });
    localGate.safetyClass = "Safety";
    program.programTags.push(localGate);
    const estopButton = createTag(controller.id, "EStopButton", "ESTOP");
    estopButton.safetyClass = "Safety";
    const stdMotorRun = createTag(controller.id, "StdMotorRun", "BOOL");
    stdMotorRun.safetyClass = "Standard";
    controller.controllerTags.push(
      estopButton,
      stdMotorRun,
    );
    const safetyAoi: AddOnInstruction = {
      id: "aoi_safety_gate",
      name: "SafetyGate",
      safetyClass: "Safety",
      parameters: [],
      localTags: [],
      routineNames: [],
    };
    controller.addOnInstructions.push(safetyAoi);
    addRung(routine, 0, [createNode("ESTOP", [tagOperand("safety", "EStopButton")])]);
    addRung(routine, 1, [createNode("DCS", [tagOperand("safety", "LocalGate")])]);
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = safetyMetadataReviewReport(project);

    expect(report.partitionRowCount).toBe(5);
    expect(report.safetyPartitionCount).toBe(4);
    expect(report.standardPartitionCount).toBe(1);
    expect(report.safetyProgramCount).toBe(1);
    expect(report.safetyTagCount).toBe(2);
    expect(report.safetyAoiCount).toBe(1);
    expect(report.instructionCount).toBe(2);
    expect(report.reviewableInstructionCount).toBe(2);
    expect(report.issueCount).toBe(0);
    expect(report.partitionRows[0]).toMatchObject({
      objectKind: "program",
      objectName: "SafetyProgram",
      safetyClass: "Safety",
      normalizedSafetyClass: "safety",
      safetySignatureVerified: false,
      safetyMemoryPartitionEnforced: false,
      controllerSafetyStatusModelled: false,
    });
    expect(report.instructionRows[0]).toMatchObject({
      instructionType: "ESTOP",
      backingTag: "EStopButton",
      backingTagDataType: "ESTOP",
      backingTagSafetyClass: "Safety",
      backingTagResolved: true,
      safetyInstructionExecutionModelled: false,
      safetyEvaluationModelled: false,
      safetySignatureVerified: false,
    });
    expect(report.instructionRows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-safety-task-scheduling",
      "no-safety-signature-verification",
      "no-safety-lock-unlock",
      "no-safety-memory-partition-enforcement",
      "no-safety-instruction-execution",
      "no-controller-safety-status",
    ]));
  });

  it("flags unknown Class metadata and safety instructions wired to missing or standard tags", () => {
    const project = createProject("Safety Issues");
    const controller = createController(project.id, "SafetyCtl");
    const { program, routine } = programWithRoutine(controller.id);
    program.safetyClass = "Guarded";
    const stdStop = createTag(controller.id, "StdStop", "ESTOP");
    stdStop.safetyClass = "Standard";
    controller.controllerTags.push(stdStop);
    addRung(routine, 0, [createNode("ESTOP", [tagOperand("safety", "StdStop")])]);
    addRung(routine, 1, [createNode("DCS", [tagOperand("safety", "MissingGate")])]);
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = safetyMetadataReviewReport(project);

    expect(report.unknownPartitionCount).toBe(1);
    expect(report.missingBackingTagCount).toBe(1);
    expect(report.nonSafetyBackingTagCount).toBe(1);
    expect(report.issueCount).toBe(3);
    expect(report.partitionRows[0]).toMatchObject({
      normalizedSafetyClass: "unknown",
      status: "needs-attention",
      issues: ["unknown-safety-class"],
    });
    expect(report.instructionRows.map((row) => row.status)).toEqual(["needs-attention", "needs-attention"]);
    expect(report.warnings[0]).toMatch(/unrecognised safety Class/);
    expect(report.warnings[1]).toMatch(/expected Safety/);
    expect(report.warnings[2]).toMatch(/missing its imported backing safety tag/);
  });

  it("resolves qualified program-scoped safety backing tags", () => {
    const project = createProject("Qualified Safety");
    const controller = createController(project.id, "SafetyCtl");
    const { program, routine } = programWithRoutine(controller.id);
    const remoteProgram = createProgram(controller.id, "RemoteSafety");
    const remoteGate = createTag(controller.id, "RemoteGate", "DCS", {
      scope: "program",
      programId: remoteProgram.id,
    });
    remoteGate.safetyClass = "Safety";
    remoteProgram.programTags.push(remoteGate);
    addRung(routine, 0, [createNode("DCS", [tagOperand("safety", "Program:RemoteSafety.RemoteGate")])]);
    controller.programs.push(program, remoteProgram);
    project.controllers.push(controller);

    const row = safetyMetadataReviewReport(project).instructionRows[0]!;

    expect(row).toMatchObject({
      instructionType: "DCS",
      backingTag: "Program:RemoteSafety.RemoteGate",
      backingTagDataType: "DCS",
      backingTagSafetyClass: "Safety",
      backingTagResolved: true,
      status: "reviewable",
    });
  });
});
