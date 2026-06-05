import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag, type Program, type Routine } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { equipmentPhaseReviewReport } from "./equipment-phase-review";

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

describe("equipmentPhaseReviewReport", () => {
  it("projects PhaseManager targets with explicit no-state-engine boundaries", () => {
    const project = createProject("Phase Review");
    const controller = createController(project.id, "Ctl");
    const { program, routine } = programWithRoutine(controller.id);
    controller.controllerTags.push(
      createTag(controller.id, "Mixer1", "EQUIPMENT_PHASE"),
      createTag(controller.id, "XferReq", "PHASE_INSTRUCTION"),
    );
    addRung(routine, 0, [createNode("PATT", [tagOperand("phase", "Mixer1")])]);
    addRung(routine, 1, [
      createNode("PCMD", [
        tagOperand("phase", "Mixer1"),
        tagOperand("command", "RESET"),
        tagOperand("result", "Result"),
      ]),
    ]);
    addRung(routine, 2, [
      createNode("PXRQ", [
        tagOperand("phaseInstruction", "XferReq"),
        tagOperand("request", "DOWNLOAD INPUT PARAMETERS"),
        tagOperand("done", "Done"),
        tagOperand("error", "Error"),
      ]),
    ]);
    addRung(routine, 3, [createNode("PSC", [])]);
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = equipmentPhaseReviewReport(project);

    expect(report.instructionCount).toBe(4);
    expect(report.reviewableCount).toBe(4);
    expect(report.issueCount).toBe(0);
    expect(report.equipmentPhaseInstructionCount).toBe(2);
    expect(report.phaseInstructionRequestCount).toBe(1);
    expect(report.inPhaseInstructionCount).toBe(1);
    expect(report.stateTimingPreviewCount).toBe(4);
    expect(report.nominalPreviewDurationMsTotal).toBe(650);
    expect(report.rows[0]).toMatchObject({
      instructionType: "PATT",
      targetKind: "equipment-phase",
      targetTag: "Mixer1",
      targetDataType: "EQUIPMENT_PHASE",
      modelOnly: true,
      phaseStateEngineModelled: false,
      offlineStateTimingPreviewModelled: true,
      timingPreviewModelled: true,
      commandArbitrationModelled: false,
      ownershipTransferModelled: false,
      batchSequencerRequestsModelled: false,
      runtimeParameterTransferModelled: false,
      offlinePreview: {
        available: true,
        status: "previewable",
        timingSource: "instruction-family",
        estimatedOnly: true,
        controllerTimingModelled: false,
        runtimeWritesModelled: false,
        executionModelled: false,
      },
      transition: {
        family: "ownership",
        label: "Attach ownership",
        stateTransitionModelled: false,
        offlineStateTransitionPreviewModelled: true,
        runtimeWriteModelled: false,
      },
      stateTimingPreview: {
        fromState: "Unowned",
        toState: "Owned",
        nominalDurationMs: 100,
        scanWindowMs: 100,
        phaseStateEngineModelled: false,
        commandArbitrationModelled: false,
        runtimeWriteModelled: false,
        controllerVerified: false,
      },
      status: "reviewable",
    });
    expect(report.rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-phase-state-engine",
      "no-phase-command-arbitration",
      "no-phase-ownership-transfer",
      "no-batch-sequencer-requests",
      "no-runtime-phase-parameter-transfer",
      "no-controller-verified-phase-scheduling",
      "offline-phase-state-timing-preview-only",
    ]));
    expect(report.rows[2]?.operands[0]?.references[0]).toMatchObject({
      baseTag: "XferReq",
      dataType: "PHASE_INSTRUCTION",
      scope: "controller",
      resolved: true,
      typeMatches: true,
    });
    expect(report.rows[1]?.transition).toMatchObject({
      family: "command",
      label: "Command request",
      stateTransitionModelled: false,
      offlineStateTransitionPreviewModelled: true,
      runtimeWriteModelled: false,
    });
    expect(report.rows[2]?.transition).toMatchObject({
      family: "external-request",
      label: "External request / parameter handoff",
      stateTransitionModelled: false,
      offlineStateTransitionPreviewModelled: true,
      runtimeWriteModelled: false,
    });
    expect(report.rows[3]?.transition).toMatchObject({
      family: "state-feedback",
      label: "State complete indication",
      stateTransitionModelled: false,
      offlineStateTransitionPreviewModelled: true,
      runtimeWriteModelled: false,
    });
    expect(report.rows[2]?.stateTimingPreview).toMatchObject({
      fromState: "Request idle",
      toState: "Request pending",
      nominalDurationMs: 200,
    });
  });

  it("flags missing and mismatched equipment-phase and PXRQ control tags", () => {
    const project = createProject("Phase Issues");
    const controller = createController(project.id, "Ctl");
    const { program, routine } = programWithRoutine(controller.id);
    controller.controllerTags.push(
      createTag(controller.id, "WrongPhase", "DINT"),
      createTag(controller.id, "WrongReq", "CONTROL"),
    );
    addRung(routine, 0, [createNode("PCMD", [tagOperand("phase", "WrongPhase")])]);
    addRung(routine, 1, [createNode("PATT", [tagOperand("phase", "MissingPhase")])]);
    addRung(routine, 2, [createNode("PXRQ", [tagOperand("phaseInstruction", "WrongReq")])]);
    addRung(routine, 3, [createNode("PXRQ", [tagOperand("phaseInstruction", "MissingReq")])]);
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = equipmentPhaseReviewReport(project);

    expect(report.instructionCount).toBe(4);
    expect(report.reviewableCount).toBe(0);
    expect(report.issueCount).toBe(4);
    expect(report.equipmentPhaseTypeMismatchCount).toBe(1);
    expect(report.missingEquipmentPhaseCount).toBe(1);
    expect(report.phaseInstructionTypeMismatchCount).toBe(1);
    expect(report.missingPhaseInstructionCount).toBe(1);
    expect(report.stateTimingPreviewCount).toBe(0);
    expect(report.nominalPreviewDurationMsTotal).toBe(0);
    expect(report.rows.map((row) => row.status)).toEqual([
      "equipment-phase-type-mismatch",
      "missing-equipment-phase",
      "phase-instruction-type-mismatch",
      "missing-phase-instruction",
    ]);
    expect(report.rows.every((row) => row.offlineStateTimingPreviewModelled === false)).toBe(true);
    expect(report.rows.every((row) => row.offlinePreview.status === "blocked")).toBe(true);
    expect(report.warnings[0]).toMatch(/not an EQUIPMENT_PHASE/);
    expect(report.warnings[2]).toMatch(/not a PHASE_INSTRUCTION/);
  });

  it("resolves program-scoped and qualified phase operands for review", () => {
    const project = createProject("Scoped Phase Review");
    const controller = createController(project.id, "Ctl");
    const { program, routine } = programWithRoutine(controller.id);
    const remoteProgram = createProgram(controller.id, "Utilities");
    program.programTags.push(
      createTag(controller.id, "LocalPhase", "EQUIPMENT_PHASE", { scope: "program", programId: program.id }),
    );
    remoteProgram.programTags.push(
      createTag(controller.id, "RemoteReq", "PHASE_INSTRUCTION", { scope: "program", programId: remoteProgram.id }),
    );
    addRung(routine, 0, [createNode("PCMD", [tagOperand("phase", "LocalPhase")])]);
    addRung(routine, 1, [createNode("PXRQ", [tagOperand("phaseInstruction", "Program:Utilities.RemoteReq")])]);
    controller.programs.push(program, remoteProgram);
    project.controllers.push(controller);

    const report = equipmentPhaseReviewReport(project);

    expect(report.reviewableCount).toBe(2);
    expect(report.stateTimingPreviewCount).toBe(2);
    expect(report.rows[0]?.operands[0]?.references[0]).toMatchObject({
      baseTag: "LocalPhase",
      scope: "program",
      resolved: true,
      typeMatches: true,
    });
    expect(report.rows[1]?.operands[0]?.references[0]).toMatchObject({
      baseTag: "RemoteReq",
      programName: "Utilities",
      scope: "qualified-program",
      resolved: true,
      typeMatches: true,
    });
    expect(report.rows[0]?.offlinePreview).toMatchObject({
      available: true,
      status: "previewable",
      timingSource: "instruction-family",
    });
  });
});
