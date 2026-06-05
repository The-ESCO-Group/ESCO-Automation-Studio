import { describe, expect, it } from "vitest";
import { createContinuousTask, createController, createProgram, createProject, createRoutine, createTag, type Program, type Routine } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { processLoopReviewReport } from "./process-loop-review";

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
  const program = createProgram(controllerId, "MainProgram");
  const routine = ladderRoutine(program.id);
  program.routines.push(routine);
  program.mainRoutineId = routine.id;
  return { program, routine };
}

describe("processLoopReviewReport", () => {
  it("projects PID and process block tags with explicit no-execution boundaries", () => {
    const project = createProject("Process Review");
    const controller = createController(project.id, "Ctl");
    const { program, routine } = programWithRoutine(controller.id);
    const task = createContinuousTask(controller.id, "FastTask", [program.id]);
    task.type = "periodic";
    task.periodMs = 20;
    task.watchdogMs = 500;
    controller.tasks.push(task);
    controller.controllerTags.push(
      createTag(controller.id, "Loop1", "PID"),
      createTag(controller.id, "PV", "REAL"),
      createTag(controller.id, "CV", "REAL"),
      createTag(controller.id, "Scale1", "SCL"),
    );
    addRung(routine, 0, [
      createNode("PID", [
        tagOperand("loop", "Loop1"),
        tagOperand("pv", "PV"),
        tagOperand("tieback", "0"),
        tagOperand("cv", "CV"),
      ]),
    ]);
    addRung(routine, 1, [createNode("SCL", [tagOperand("block", "Scale1")])]);
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = processLoopReviewReport(project);
    expect(report.instructionCount).toBe(2);
    expect(report.reviewableCount).toBe(2);
    expect(report.tuningReviewCount).toBe(2);
    expect(report.tuningParameterCount).toBe(3);
    expect(report.tuningComparisonReadyCount).toBe(1);
    expect(report.tuningComparisonGapCount).toBe(1);
    expect(report.timingPreviewCount).toBe(2);
    expect(report.scheduledTimingPreviewCount).toBe(2);
    expect(report.timingPreviewScanCount).toBe(50);
    expect(report.warnings).toEqual([]);
    expect(report.rows[0]).toMatchObject({
      instructionType: "PID",
      loopTag: "Loop1",
      loopTagDataType: "PID",
      modelOnly: true,
      loopExecutionModelled: false,
      offlineTimingPreviewModelled: true,
      runtimeTagWritesModelled: false,
      timingPreview: {
        samplePeriodMs: 20,
        previewHorizonMs: 500,
        previewScanCount: 25,
        source: "scheduled-task-period",
        taskName: "FastTask",
        taskType: "periodic",
        watchdogMs: 500,
        controllerTimingModelled: false,
        closedLoopExecutionModelled: false,
        runtimeWriteModelled: false,
      },
      offlinePreview: {
        available: true,
        status: "previewable",
        timingSource: "imported-task-period",
        estimatedOnly: true,
        controllerTimingModelled: false,
        runtimeWritesModelled: false,
        executionModelled: false,
      },
      tuning: {
        loopTag: "Loop1",
        loopDataType: "PID",
        parameterCount: 9,
        tuningParameterCount: 3,
        setpointPresent: true,
        processVariablePresent: true,
        controlOutputPresent: true,
        limitsPresent: true,
        comparisonReady: true,
        missingComparisonRoles: [],
        valueComparisonModelled: false,
        tuningExecutionModelled: false,
        runtimeWritesModelled: false,
      },
      status: "reviewable",
    });
    expect(report.rows[0]?.tuning.parameters.map((parameter) => parameter.path)).toEqual(expect.arrayContaining([
      "Loop1.SP",
      "Loop1.KP",
      "Loop1.KI",
      "Loop1.KD",
    ]));
    expect(report.rows[0]?.tuning.parameters.every((parameter) => parameter.valueModelled === false && parameter.runtimeWriteModelled === false)).toBe(true);
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-process-loop-execution",
      "no-runtime-tag-memory-write",
      "no-closed-loop-tuning",
      "offline-process-timing-estimate-only",
    ]));
    expect(report.rows[0]?.operands.find((operand) => operand.role === "control-variable")?.references[0]).toMatchObject({
      baseTag: "CV",
      resolved: true,
      scope: "controller",
    });
  });

  it("flags missing process block tags and mismatched loop data types", () => {
    const project = createProject("Process Faults");
    const controller = createController(project.id, "Ctl");
    const { program, routine } = programWithRoutine(controller.id);
    controller.controllerTags.push(createTag(controller.id, "WrongLoop", "PID"));
    addRung(routine, 0, [createNode("PIDE", [tagOperand("loop", "WrongLoop")])]);
    addRung(routine, 1, [createNode("TOT", [tagOperand("block", "MissingTotalizer")])]);
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = processLoopReviewReport(project);
    expect(report.instructionCount).toBe(2);
    expect(report.reviewableCount).toBe(0);
    expect(report.typeMismatchCount).toBe(1);
    expect(report.missingLoopTagCount).toBe(1);
    expect(report.tuningReviewCount).toBe(1);
    expect(report.tuningComparisonReadyCount).toBe(1);
    expect(report.timingPreviewCount).toBe(0);
    expect(report.timingPreviewScanCount).toBe(0);
    expect(report.rows.map((row) => row.status)).toEqual([
      "loop-tag-type-mismatch",
      "missing-loop-tag",
    ]);
    expect(report.rows.every((row) => row.offlineTimingPreviewModelled === false)).toBe(true);
    expect(report.rows.every((row) => row.offlinePreview.status === "blocked")).toBe(true);
    expect(report.warnings[0]).toMatch(/expected PIDE/);
    expect(report.warnings[1]).toMatch(/TOT is missing/);
  });

  it("resolves program-scoped and qualified PV/CV references for review", () => {
    const project = createProject("Process Scope");
    const controller = createController(project.id, "Ctl");
    const { program, routine } = programWithRoutine(controller.id);
    const remoteProgram = createProgram(controller.id, "Utilities");
    program.programTags.push(
      createTag(controller.id, "LocalLoop", "PID", { scope: "program", programId: program.id }),
      createTag(controller.id, "LocalPV", "REAL", { scope: "program", programId: program.id }),
    );
    remoteProgram.programTags.push(
      createTag(controller.id, "RemoteCV", "REAL", { scope: "program", programId: remoteProgram.id }),
    );
    addRung(routine, 0, [
      createNode("PID", [
        tagOperand("loop", "LocalLoop"),
        tagOperand("pv", "LocalPV"),
        tagOperand("tieback", "0"),
        tagOperand("cv", "Program:Utilities.RemoteCV"),
      ]),
    ]);
    controller.programs.push(program, remoteProgram);
    project.controllers.push(controller);

    const report = processLoopReviewReport(project);
    const row = report.rows[0]!;
    expect(report.tuningParameterCount).toBe(3);
    expect(report.tuningComparisonReadyCount).toBe(1);
    expect(row.status).toBe("reviewable");
    expect(row.operands.find((operand) => operand.role === "block-tag")?.references[0]).toMatchObject({
      baseTag: "LocalLoop",
      scope: "program",
      resolved: true,
    });
    expect(row.operands.find((operand) => operand.role === "control-variable")?.references[0]).toMatchObject({
      baseTag: "RemoteCV",
      programName: "Utilities",
      scope: "qualified-program",
      resolved: true,
    });
    expect(row.tuning.parameters.map((parameter) => parameter.path)).toContain("LocalLoop.KP");
    expect(row.tuning.valueComparisonModelled).toBe(false);
    expect(row.offlineTimingPreviewModelled).toBe(true);
    expect(row.timingPreview).toMatchObject({
      source: "unscheduled-default",
      samplePeriodMs: 100,
      controllerTimingModelled: false,
      runtimeWriteModelled: false,
    });
  });
});
