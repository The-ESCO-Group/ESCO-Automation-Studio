import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type Program,
  type Routine,
} from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { advancedDomainReviewReport, motionInstructionReviewRows } from "./advanced-domain-review";

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

describe("advancedDomainReviewReport", () => {
  it("rolls safety, motion, process, and phase review lanes into one offline report", () => {
    const project = createProject("Advanced Domain Review");
    const controller = createController(project.id, "Ctl");
    controller.safetyInfo = {
      safetyEnabled: "true",
      safetyLocked: true,
      safetySignatureId: "16#1234_ABCD",
      safetySignatureTimestamp: "2026-06-03T12:00:00.000Z",
      signatureRunModeProtect: true,
      configureSafetyIOAlways: true,
      safetyLevel: "SIL2",
      safetyTagMap: "SafeOK = StdOK",
    };
    controller.sfcExecutionControl = "CurrentActive";
    controller.sfcRestartPosition = "MostRecent";
    controller.sfcLastScan = "DontScan";
    const { program, routine } = programWithRoutine(controller.id);
    const estop = createTag(controller.id, "EStop", "ESTOP");
    estop.safetyClass = "Safety";
    const safeOk = createTag(controller.id, "SafeOK", "BOOL");
    safeOk.safetyClass = "Safety";
    const stdOk = createTag(controller.id, "StdOK", "BOOL");
    stdOk.safetyClass = "Standard";
    controller.controllerTags.push(
      estop,
      safeOk,
      stdOk,
      createTag(controller.id, "Axis1", "AXIS_VIRTUAL"),
      createTag(controller.id, "MoveCtl", "MOTION_INSTRUCTION"),
      createTag(controller.id, "Loop1", "PID"),
      createTag(controller.id, "PV", "REAL"),
      createTag(controller.id, "CV", "REAL"),
      createTag(controller.id, "Mixer1", "EQUIPMENT_PHASE"),
    );
    addRung(routine, 0, [createNode("ESTOP", [tagOperand("safety", "EStop")])]);
    addRung(routine, 1, [createNode("MSO", [tagOperand("axis", "Axis1"), tagOperand("motionControl", "MoveCtl")])]);
    addRung(routine, 2, [
      createNode("PID", [
        tagOperand("loop", "Loop1"),
        tagOperand("pv", "PV"),
        tagOperand("tieback", "0"),
        tagOperand("cv", "CV"),
      ]),
    ]);
    addRung(routine, 3, [createNode("PCMD", [tagOperand("phase", "Mixer1")])]);
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = advancedDomainReviewReport(project);

    expect(report.totalItemCount).toBeGreaterThanOrEqual(4);
    expect(report.issueCount).toBe(0);
    expect(report.status).toBe("reviewable");
    expect(report.readinessPercent).toBe(100);
    expect(report.domains.map((domain) => domain.domain)).toEqual(["safety", "motion", "process", "phase", "sfc"]);
    expect(report.domains.find((domain) => domain.domain === "motion")).toMatchObject({
      itemCount: 1,
      reviewableCount: 1,
      issueCount: 0,
      readinessPercent: 100,
    });
    expect(report.boundaries).toEqual(expect.arrayContaining([
      "no-motion-command",
      "no-process-loop-execution",
      "no-phase-state-engine",
      "no-sfc-step-engine",
      "no-safety-instruction-execution",
      "no-controller-verified-tag-resolution",
    ]));
    expect(report.detailRows.map((row) => row.domain)).toEqual(expect.arrayContaining([
      "safety",
      "motion",
      "process",
      "phase",
      "sfc",
    ]));
    expect(report.detailRows.every((row) => row.offlineOnly && row.executionModelled === false)).toBe(true);
    expect(report.detailRows.find((row) => row.rowKind === "controller-safety-info")).toMatchObject({
      domain: "safety",
      controllerName: "Ctl",
      status: "safety-locked",
      offlineOnly: true,
      executionModelled: false,
    });
    expect(report.detailRows.find((row) => row.rowKind === "controller-safety-tag-map")).toMatchObject({
      domain: "safety",
      controllerName: "Ctl",
      subject: "Controller SafetyTagMap",
      status: "reviewable",
      issueCount: 0,
      offlineOnly: true,
      executionModelled: false,
    });
    expect(report.detailRows.find((row) => row.rowKind === "controller-sfc-execution")).toMatchObject({
      domain: "sfc",
      controllerName: "Ctl",
      subject: "Controller SFC Execution",
      status: "reviewable",
      needsAttention: false,
      offlineOnly: true,
      executionModelled: false,
    });
    expect(report.detailRows.find((row) => row.rowKind === "safety-instruction")).toMatchObject({
      domain: "safety",
      programName: "MainProgram",
      routineName: "Main",
      rungNumber: 0,
      instructionType: "ESTOP",
      needsAttention: false,
    });
    expect(report.detailRows.find((row) => row.rowKind === "motion-instruction")).toMatchObject({
      domain: "motion",
      programName: "MainProgram",
      routineName: "Main",
      rungNumber: 1,
      instructionType: "MSO",
      needsAttention: false,
    });
    expect(report.detailRows.find((row) => row.rowKind === "process-instruction")).toMatchObject({
      domain: "process",
      rungNumber: 2,
      instructionType: "PID",
      needsAttention: false,
      offlinePreview: {
        available: true,
        status: "previewable",
        estimatedOnly: true,
        controllerTimingModelled: false,
        runtimeWritesModelled: false,
        executionModelled: false,
      },
    });
    expect(report.detailRows.find((row) => row.rowKind === "phase-instruction")).toMatchObject({
      domain: "phase",
      rungNumber: 3,
      instructionType: "PCMD",
      needsAttention: false,
      offlinePreview: {
        available: true,
        status: "previewable",
        estimatedOnly: true,
        controllerTimingModelled: false,
        runtimeWritesModelled: false,
        executionModelled: false,
      },
    });
    expect(report.inspectorReport).toMatchObject({
      rowCount: 3,
      reviewableCount: 3,
      issueCount: 0,
    });
    expect(report.inspectorReport.rows.map((row) => row.kind)).toEqual(expect.arrayContaining([
      "motion-axis",
      "process-loop",
      "equipment-phase",
    ]));
    expect(report.inspectorReport.rows.find((row) => row.kind === "motion-axis")).toMatchObject({
      subject: "Axis1",
      itemCount: 1,
      issueCount: 0,
      offlineOnly: true,
      executionModelled: false,
      instructionTypes: ["MSO"],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ status: "ok", label: "Virtual axis profile" }),
        expect.objectContaining({ status: "ok", label: "Motion control tags" }),
        expect.objectContaining({ status: "info", label: "Offline boundary" }),
      ]),
    });
    expect(report.motionTree).toMatchObject({
      axisCount: 1,
      motionObjectCount: 1,
      motionDeviceCount: 0,
      linkedDeviceCount: 0,
      unlinkedAxisCount: 0,
      issueCount: 0,
    });
    expect(report.motionTree.nodes.find((row) => row.kind === "axis")).toMatchObject({
      name: "Axis1",
      dataType: "AXIS_VIRTUAL",
      commandCount: 1,
      status: "reviewable",
      offlineOnly: true,
      executionModelled: false,
    });
    expect(report.inspectorReport.rows.find((row) => row.kind === "process-loop")).toMatchObject({
      title: "PIDE / Process Loop Inspector",
      subject: "Loop1",
      dataTypes: ["PID"],
      diagnosticCount: 7,
      diagnosticErrorCount: 0,
      offlinePreview: {
        available: true,
        status: "previewable",
        estimatedOnly: true,
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ status: "ok", label: "Loop tag" }),
        expect.objectContaining({ status: "ok", label: "PV/CV references" }),
        expect.objectContaining({ status: "info", label: "Timing preview" }),
        expect.objectContaining({ status: "info", label: "Tuning parameters" }),
        expect.objectContaining({ status: "info", label: "Tuning comparison" }),
        expect.objectContaining({ status: "info", label: "Offline boundary" }),
      ]),
    });
    expect(report.inspectorReport.rows.find((row) => row.kind === "equipment-phase")).toMatchObject({
      title: "Equipment Phase Inspector",
      subject: "Mixer1",
      dataTypes: ["EQUIPMENT_PHASE"],
      diagnosticCount: 6,
      diagnosticErrorCount: 0,
      offlinePreview: {
        available: true,
        status: "previewable",
        estimatedOnly: true,
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ status: "ok", label: "Phase target" }),
        expect.objectContaining({ status: "info", label: "Command/request operands" }),
        expect.objectContaining({ status: "info", label: "State/timing preview" }),
        expect.objectContaining({ status: "info", label: "State transition map" }),
        expect.objectContaining({ status: "info", label: "Offline boundary" }),
      ]),
    });
  });

  it("rolls partial controller SFC execution metadata into advanced-domain attention rows", () => {
    const project = createProject("Advanced Domain SFC Issues");
    const controller = createController(project.id, "Ctl");
    controller.sfcExecutionControl = "CurrentActive";
    project.controllers.push(controller);

    const report = advancedDomainReviewReport(project);
    const sfc = report.domains.find((domain) => domain.domain === "sfc")!;

    expect(sfc).toMatchObject({
      domain: "sfc",
      itemCount: 1,
      reviewableCount: 0,
      issueCount: 1,
      status: "needs-attention",
    });
    expect(report.issueCount).toBe(1);
    expect(report.warnings[0]).toMatch(/missing SFCRestartPosition/);
    expect(report.detailRows.find((row) => row.rowKind === "controller-sfc-execution")).toMatchObject({
      domain: "sfc",
      status: "needs-attention",
      needsAttention: true,
      issueCount: 2,
      boundaries: expect.arrayContaining([
        "no-sfc-step-engine",
        "no-sfc-transition-evaluation",
        "no-controller-verified-sfc-scheduling",
      ]),
      offlineOnly: true,
      executionModelled: false,
    });
  });

  it("flags motion target/control problems without modelling motion execution", () => {
    const project = createProject("Motion Issues");
    const controller = createController(project.id, "Ctl");
    const { program, routine } = programWithRoutine(controller.id);
    controller.controllerTags.push(createTag(controller.id, "WrongAxis", "DINT"));
    addRung(routine, 0, [createNode("MAM", [tagOperand("axis", "WrongAxis"), tagOperand("motionControl", "MissingCtl")])]);
    controller.programs.push(program);
    project.controllers.push(controller);

    const rows = motionInstructionReviewRows(project);
    const report = advancedDomainReviewReport(project);
    const motion = report.domains.find((domain) => domain.domain === "motion")!;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      instructionType: "MAM",
      status: "needs-attention",
      motionCommandModelled: false,
      motionPlannerModelled: false,
      axisStateModelled: false,
      driveCommandModelled: false,
      motionFeedbackModelled: false,
    });
    expect(rows[0]?.issues).toEqual(expect.arrayContaining([
      "motion-target-type-mismatch",
      "missing-motion-control",
    ]));
    expect(rows[0]?.boundaries).toEqual(expect.arrayContaining([
      "no-motion-command",
      "no-motion-planner-execution",
      "no-axis-state-update",
      "no-drive-command",
      "no-motion-feedback",
    ]));
    expect(motion).toMatchObject({
      itemCount: 1,
      reviewableCount: 0,
      issueCount: 1,
      readinessPercent: 0,
      status: "needs-attention",
    });
    expect(report.issueCount).toBe(1);
    expect(report.warnings[0]).toMatch(/MAM motion metadata needs attention/);
    expect(report.detailRows.find((row) => row.rowKind === "motion-instruction")).toMatchObject({
      domain: "motion",
      instructionType: "MAM",
      needsAttention: true,
      issueCount: 2,
      offlineOnly: true,
      executionModelled: false,
    });
    expect(report.inspectorReport.rows[0]).toMatchObject({
      kind: "motion-axis",
      subject: "WrongAxis",
      status: "needs-attention",
      itemCount: 1,
      issueCount: 2,
      dataTypes: ["DINT"],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ status: "error", label: "Target type mismatch" }),
        expect.objectContaining({ status: "error", label: "Motion control tag" }),
      ]),
    });
    expect(report.inspectorReport.rows[0]?.diagnosticErrorCount).toBe(2);
  });

  it("adds actionable diagnostics for process-loop and phase inspector issues", () => {
    const project = createProject("Advanced Domain Issue Diagnostics");
    const controller = createController(project.id, "Ctl");
    const { program, routine } = programWithRoutine(controller.id);
    controller.controllerTags.push(
      createTag(controller.id, "WrongLoop", "PID"),
      createTag(controller.id, "WrongPhase", "DINT"),
    );
    addRung(routine, 0, [createNode("PIDE", [tagOperand("loop", "WrongLoop")])]);
    addRung(routine, 1, [createNode("PCMD", [tagOperand("phase", "WrongPhase")])]);
    addRung(routine, 2, [createNode("PXRQ", [tagOperand("phaseInstruction", "MissingReq")])]);
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = advancedDomainReviewReport(project);
    const processRow = report.inspectorReport.rows.find((row) => row.kind === "process-loop")!;
    const wrongPhaseRow = report.inspectorReport.rows.find((row) => row.kind === "equipment-phase" && row.subject === "WrongPhase")!;
    const missingRequestRow = report.inspectorReport.rows.find((row) => row.kind === "equipment-phase" && row.subject === "MissingReq")!;

    expect(processRow).toMatchObject({
      status: "needs-attention",
      diagnosticErrorCount: 1,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ status: "error", label: "Loop tag type" }),
        expect.objectContaining({ status: "info", label: "Tuning parameters" }),
        expect.objectContaining({ status: "info", label: "Tuning comparison" }),
        expect.objectContaining({ status: "info", label: "Offline boundary" }),
      ]),
    });
    expect(wrongPhaseRow).toMatchObject({
      status: "needs-attention",
      diagnosticErrorCount: 1,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ status: "error", label: "Phase target type" }),
        expect.objectContaining({ status: "info", label: "State transition map" }),
        expect.objectContaining({ status: "info", label: "Offline boundary" }),
      ]),
    });
    expect(missingRequestRow).toMatchObject({
      status: "needs-attention",
      diagnosticErrorCount: 1,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ status: "error", label: "Phase target" }),
        expect.objectContaining({ status: "info", label: "State transition map" }),
        expect.objectContaining({ status: "info", label: "Offline boundary" }),
      ]),
    });
  });

  it("builds a read-only motion axis/device tree from tags, commands, and imported modules", () => {
    const project = createProject("Motion Tree");
    const controller = createController(project.id, "Ctl");
    const { program, routine } = programWithRoutine(controller.id);
    controller.controllerTags.push(
      createTag(controller.id, "MotionGroup", "MOTION_GROUP"),
      createTag(controller.id, "Coord1", "COORDINATE_SYSTEM"),
      createTag(controller.id, "Axis1", "AXIS_CIP_DRIVE"),
      createTag(controller.id, "GroupCtl", "MOTION_INSTRUCTION"),
      createTag(controller.id, "CoordCtl", "MOTION_INSTRUCTION"),
      createTag(controller.id, "MoveCtl", "MOTION_INSTRUCTION"),
    );
    controller.ioConfiguration.modules.push({
      id: "mod-axis1-drive",
      name: "ServoDrive_Axis1",
      catalogNumber: "Servo drive",
      productType: "Servo",
      parentModule: "Local",
      parentPortId: "2",
    });
    addRung(routine, 0, [createNode("MGS", [tagOperand("motionGroup", "MotionGroup"), tagOperand("motionControl", "GroupCtl")])]);
    addRung(routine, 1, [createNode("MCLM", [tagOperand("coordinateSystem", "Coord1"), tagOperand("motionControl", "CoordCtl")])]);
    addRung(routine, 2, [createNode("MAM", [tagOperand("axis", "Axis1"), tagOperand("motionControl", "MoveCtl")])]);
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = advancedDomainReviewReport(project);
    const tree = report.motionTree;
    const group = tree.nodes.find((row) => row.kind === "motion-group")!;
    const coord = tree.nodes.find((row) => row.kind === "coordinate-system")!;
    const axis = tree.nodes.find((row) => row.kind === "axis")!;
    const device = tree.nodes.find((row) => row.kind === "motion-device")!;

    expect(tree).toMatchObject({
      motionObjectCount: 3,
      axisCount: 1,
      coordinateSystemCount: 1,
      motionGroupCount: 1,
      motionDeviceCount: 1,
      linkedDeviceCount: 1,
      unlinkedAxisCount: 0,
      issueCount: 0,
    });
    expect(group.childIds).toEqual(expect.arrayContaining([coord.id, axis.id]));
    expect(axis).toMatchObject({
      name: "Axis1",
      dataType: "AXIS_CIP_DRIVE",
      parentName: "MotionGroup",
      commandCount: 1,
      moduleCount: 1,
      controlTagCount: 1,
      status: "reviewable",
      offlineOnly: true,
      executionModelled: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ status: "ok", label: "Drive-backed axis profile" }),
        expect.objectContaining({ status: "ok", label: "Device link" }),
      ]),
    });
    expect(device).toMatchObject({
      name: "ServoDrive_Axis1",
      parentName: "Axis1",
      status: "reviewable",
      offlineOnly: true,
      executionModelled: false,
    });
    expect(device.boundaries).toEqual(expect.arrayContaining([
      "no-motion-device-connection",
      "no-drive-command",
    ]));
  });

  it("flags drive-backed axes that have no imported motion device link", () => {
    const project = createProject("Unlinked Axis");
    const controller = createController(project.id, "Ctl");
    controller.controllerTags.push(createTag(controller.id, "AxisDrive", "AXIS_SERVO_DRIVE"));
    project.controllers.push(controller);

    const tree = advancedDomainReviewReport(project).motionTree;
    const axis = tree.nodes.find((row) => row.kind === "axis")!;

    expect(tree).toMatchObject({
      axisCount: 1,
      motionDeviceCount: 0,
      linkedDeviceCount: 0,
      unlinkedAxisCount: 1,
      issueCount: 1,
    });
    expect(axis).toMatchObject({
      name: "AxisDrive",
      status: "unlinked",
      issueCount: 1,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ status: "warning", label: "Device link" }),
      ]),
      offlineOnly: true,
      executionModelled: false,
    });
  });
});
