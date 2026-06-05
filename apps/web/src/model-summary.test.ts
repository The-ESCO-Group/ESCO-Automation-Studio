import { describe, expect, it } from "vitest";
import { createRoutine, createTag } from "@esco/core";
import { createDefaultEngine } from "@esco/validator";
import { appendRungWithRoot, createBranch, createLadderRoutine, createNode } from "@esco/ladder";
import type { LadderRoutine } from "@esco/ladder";
import { buildModelSummary } from "./model-summary";
import { createBlankRoutineProject, createInitialProject } from "./project-edit";

const UNKNOWN_SENTINEL = "UNSUPPORTED_VENDOR_BLOCK";

describe("buildModelSummary", () => {
  it("aggregates counts for a blank routine project", () => {
    const project = createBlankRoutineProject();
    const summary = buildModelSummary(project, createDefaultEngine().run(project));

    expect(summary.projectName).toBe(project.name);
    expect(summary.controllerName).toBe(project.controllers[0]?.name);
    expect(summary.counts.controllers).toBe(1);
    expect(summary.counts.programs).toBeGreaterThanOrEqual(1);
    expect(summary.counts.routines).toBeGreaterThanOrEqual(1);
    // A blank routine is seeded with a single empty rung 0 (standard new-routine behavior).
    expect(summary.counts.rungs).toBe(1);
    expect(summary.counts.tags).toBe(summary.counts.controllerTags + summary.counts.programTags);
  });

  it("reports no unsupported instructions for an empty workspace", () => {
    const project = createInitialProject();
    const summary = buildModelSummary(project);
    expect(summary.unsupportedTotal).toBe(0);
    expect(summary.unsupportedInstructions).toEqual([]);
    expect(summary.modelOnlyTotal).toBe(0);
    expect(summary.modelOnlyInstructions).toEqual([]);
    expect(summary.instructionFidelity).toMatchObject({
      total: 0,
      executable: 0,
      preserved: 0,
      unsupported: 0,
    });
  });

  it("counts unsupported instruction types found in ladders", () => {
    const project = createBlankRoutineProject();
    // Inject two occurrences of an unknown instruction type into the main routine ladder.
    const controller = project.controllers[0]!;
    const program = controller.programs[0]!;
    const main = program.routines.find((r) => r.id === program.mainRoutineId) ?? program.routines[0]!;
    let ladder = main.ladder as LadderRoutine;
    ladder = appendRungWithRoot(ladder, createBranch([createNode(UNKNOWN_SENTINEL, []), createNode("XIC", [])]));
    ladder = appendRungWithRoot(ladder, createBranch([createNode(UNKNOWN_SENTINEL, [])]));
    main.ladder = ladder;

    const summary = buildModelSummary(project);
    const unknown = summary.unsupportedInstructions.find((u) => u.type === UNKNOWN_SENTINEL);
    expect(unknown?.count).toBe(2);
    expect(summary.unsupportedTotal).toBe(2);
    expect(summary.modelOnlyTotal).toBe(0);
    expect(summary.instructionFidelity.byStatus.unsupported).toBe(2);
    expect(summary.instructionFidelity.attentionRows.find((row) => row.type === UNKNOWN_SENTINEL)).toMatchObject({
      status: "unsupported",
      sourceLanguages: ["ladder"],
      needsAttention: true,
    });
  });

  it("counts registered model-only instructions separately from unknown unsupported instructions", () => {
    const project = createBlankRoutineProject();
    const controller = project.controllers[0]!;
    const program = controller.programs[0]!;
    const main = program.routines.find((r) => r.id === program.mainRoutineId) ?? program.routines[0]!;
    let ladder = main.ladder as LadderRoutine;
    ladder = appendRungWithRoot(ladder, createBranch([createNode("MSG", []), createNode(UNKNOWN_SENTINEL, [])]));
    main.ladder = ladder;

    const summary = buildModelSummary(project);
    expect(summary.modelOnlyInstructions.find((u) => u.type === "MSG")?.count).toBe(1);
    expect(summary.modelOnlyTotal).toBe(1);
    expect(summary.unsupportedInstructions.find((u) => u.type === UNKNOWN_SENTINEL)?.count).toBe(1);
    expect(summary.unsupportedTotal).toBe(1);
    expect(summary.instructionFidelity).toMatchObject({
      total: 2,
      executable: 0,
      preserved: 2,
      unsupported: 1,
    });
    expect(summary.instructionFidelity.byStatus["model-only"]).toBe(1);
  });

  it("summarizes executable, partial, model-only, and unsupported Structured Text instruction calls", () => {
    const project = createBlankRoutineProject();
    const controller = project.controllers[0]!;
    const program = controller.programs[0]!;
    controller.controllerTags.push(createTag(controller.id, "Shot", "FBD_ONESHOT"));
    const stRoutine = createRoutine(program.id, "CalcST", "structured-text");
    stRoutine.structuredText = `
VAR
  LocalScratch : DINT;
END_VAR
MOV(1, Count);
IF Count > 0 THEN
  Count := Count + 1;
END_IF;
OSRI(Shot);
MSG(MessageCtrl);
${UNKNOWN_SENTINEL}();
`;
    program.routines.push(stRoutine);

    const summary = buildModelSummary(project);

    expect(summary.instructionFidelity.byStatus["executable-simulation"]).toBe(1);
    expect(summary.instructionFidelity.byStatus["executable-partial"]).toBe(1);
    expect(summary.instructionFidelity.byStatus["model-only"]).toBe(1);
    expect(summary.instructionFidelity.byStatus.unsupported).toBe(1);
    expect(summary.instructionFidelity.rows.find((row) => row.type === "MOV")).toMatchObject({
      count: 1,
      status: "executable-simulation",
      sourceLanguages: ["structured-text"],
      needsAttention: false,
    });
    expect(summary.instructionFidelity.rows.find((row) => row.type === "OSRI")).toMatchObject({
      status: "executable-partial",
      sourceLanguages: ["structured-text"],
      needsAttention: false,
    });
    expect(summary.instructionFidelity.rows.find((row) => row.type === "MSG")).toMatchObject({
      status: "model-only",
      sourceLanguages: ["structured-text"],
    });
    expect(summary.structuredTextCoverage).toMatchObject({
      routineCount: 1,
      executableCallCount: 2,
      preservedCallCount: 1,
      unsupportedCallCount: 1,
      routinesWithControlFlow: 1,
    });
    expect(summary.structuredTextCoverage.rows[0]).toMatchObject({
      routineName: "CalcST",
      callCount: 4,
      executableCallCount: 2,
      preservedCallCount: 1,
      unsupportedCallCount: 1,
      controlFlow: expect.arrayContaining(["Assignments", "IF/ELSIF"]),
    });
  });

  it("passes through FBD review coverage without treating FBD blocks as simulated instruction fidelity", () => {
    const project = createBlankRoutineProject();
    const controller = project.controllers[0]!;
    const program = controller.programs[0]!;
    const fbdRoutine = createRoutine(program.id, "LoopFBD", "function-block");
    fbdRoutine.sourceText = `<FBDContent>
      <Sheet Number="0" Name="Loop">
        <Block ID="1" Type="PIDE" Operand="Loop01">
          <InputParameter Name="PV" Operand="PV"/>
          <OutputParameter Name="CV" Operand="CV"/>
        </Block>
        <IRef ID="2" Operand="PV"/>
        <ORef ID="3" Operand="CV"/>
        <Wire ID="4" FromID="2" ToID="1"/>
      </Sheet>
    </FBDContent>`;
    program.routines.push(fbdRoutine);

    const summary = buildModelSummary(project);

    expect(summary.structureAnalysis.fbd).toMatchObject({
      routineCount: 1,
      programRoutineCount: 1,
      aoiRoutineCount: 0,
      parseableRoutineCount: 1,
      preservedOnlyRoutineCount: 0,
      sheetCount: 1,
      blockCount: 1,
      parameterCount: 2,
      wireCount: 1,
      diagnosticWarningCount: 0,
    });
    expect(summary.structureAnalysis.fbd.topBlockTypes).toEqual([{ key: "PIDE", count: 1 }]);
    expect(summary.instructionFidelity.rows.find((row) => row.type === "PIDE")).toBeUndefined();
    expect(summary.unsupportedInstructions.find((row) => row.type === "PIDE")).toBeUndefined();
  });

  it("includes the advanced-domain offline review rollup", () => {
    const project = createBlankRoutineProject();
    const controller = project.controllers[0]!;
    controller.safetyInfo = { safetyTagMap: "SafeOK = StdOK" };
    controller.sfcExecutionControl = "CurrentActive";
    controller.sfcRestartPosition = "MostRecent";
    controller.sfcLastScan = "DontScan";
    const safeOk = createTag(controller.id, "SafeOK", "BOOL");
    safeOk.safetyClass = "Safety";
    const stdOk = createTag(controller.id, "StdOK", "BOOL");
    stdOk.safetyClass = "Standard";
    controller.controllerTags.push(
      safeOk,
      stdOk,
      createTag(controller.id, "Axis1", "AXIS_VIRTUAL"),
      createTag(controller.id, "MoveCtl", "MOTION_INSTRUCTION"),
      createTag(controller.id, "Loop1", "PID"),
      createTag(controller.id, "PV", "REAL"),
      createTag(controller.id, "CV", "REAL"),
      createTag(controller.id, "Mixer1", "EQUIPMENT_PHASE"),
    );
    const program = controller.programs[0]!;
    const main = program.routines.find((r) => r.id === program.mainRoutineId) ?? program.routines[0]!;
    let ladder = main.ladder as LadderRoutine;
    ladder = appendRungWithRoot(ladder, createBranch([createNode("MSO", [
      { name: "axis", value: "Axis1", kind: "tag" },
      { name: "motionControl", value: "MoveCtl", kind: "tag" },
    ])]));
    ladder = appendRungWithRoot(ladder, createBranch([createNode("PID", [
      { name: "loop", value: "Loop1", kind: "tag" },
      { name: "pv", value: "PV", kind: "tag" },
      { name: "tieback", value: "0", kind: "literal" },
      { name: "cv", value: "CV", kind: "tag" },
    ])]));
    ladder = appendRungWithRoot(ladder, createBranch([createNode("PCMD", [
      { name: "phase", value: "Mixer1", kind: "tag" },
    ])]));
    main.ladder = ladder;

    const summary = buildModelSummary(project);
    const motion = summary.advancedDomainReview.domains.find((domain) => domain.domain === "motion");
    const sfc = summary.advancedDomainReview.domains.find((domain) => domain.domain === "sfc");

    expect(summary.advancedDomainReview.totalItemCount).toBeGreaterThanOrEqual(3);
    expect(summary.advancedDomainReview.detailRows.find((row) => row.rowKind === "motion-instruction")).toMatchObject({
      domain: "motion",
      instructionType: "MSO",
      offlineOnly: true,
      executionModelled: false,
      needsAttention: false,
    });
    expect(summary.advancedDomainReview.detailRows.find((row) => row.rowKind === "controller-safety-tag-map")).toMatchObject({
      domain: "safety",
      subject: "Controller SafetyTagMap",
      status: "reviewable",
      offlineOnly: true,
      executionModelled: false,
      needsAttention: false,
    });
    expect(summary.advancedDomainReview.detailRows.find((row) => row.rowKind === "controller-sfc-execution")).toMatchObject({
      domain: "sfc",
      subject: "Controller SFC Execution",
      status: "reviewable",
      offlineOnly: true,
      executionModelled: false,
      needsAttention: false,
    });
    expect(motion).toMatchObject({
      itemCount: 1,
      reviewableCount: 1,
      issueCount: 0,
      readinessPercent: 100,
    });
    expect(sfc).toMatchObject({
      itemCount: 1,
      reviewableCount: 1,
      issueCount: 0,
      readinessPercent: 100,
    });
    expect(summary.advancedDomainReview.inspectorReport).toMatchObject({
      rowCount: 3,
      reviewableCount: 3,
      issueCount: 0,
    });
    expect(summary.advancedDomainReview.inspectorReport.rows.map((row) => row.kind)).toEqual(expect.arrayContaining([
      "motion-axis",
      "process-loop",
      "equipment-phase",
    ]));
    expect(summary.advancedDomainReview.inspectorReport.rows.find((row) => row.kind === "process-loop")).toMatchObject({
      offlinePreview: {
        available: true,
        status: "previewable",
        estimatedOnly: true,
        controllerTimingModelled: false,
        runtimeWritesModelled: false,
        executionModelled: false,
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ label: "Loop tag", status: "ok" }),
        expect.objectContaining({ label: "PV/CV references", status: "ok" }),
        expect.objectContaining({ label: "Timing preview", status: "info" }),
        expect.objectContaining({ label: "Tuning parameters", status: "info" }),
        expect.objectContaining({ label: "Tuning comparison", status: "info" }),
        expect.objectContaining({ label: "Offline boundary", status: "info" }),
      ]),
    });
    expect(summary.advancedDomainReview.inspectorReport.rows.find((row) => row.kind === "equipment-phase")).toMatchObject({
      offlinePreview: {
        available: true,
        status: "previewable",
        estimatedOnly: true,
        controllerTimingModelled: false,
        runtimeWritesModelled: false,
        executionModelled: false,
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ label: "Phase target", status: "ok" }),
        expect.objectContaining({ label: "State/timing preview", status: "info" }),
        expect.objectContaining({ label: "State transition map", status: "info" }),
        expect.objectContaining({ label: "Offline boundary", status: "info" }),
      ]),
    });
    expect(summary.advancedDomainReview.motionTree).toMatchObject({
      axisCount: 1,
      motionObjectCount: 1,
      motionDeviceCount: 0,
      unlinkedAxisCount: 0,
      issueCount: 0,
    });
    expect(summary.advancedDomainReview.motionTree.nodes.find((row) => row.kind === "axis")).toMatchObject({
      name: "Axis1",
      status: "reviewable",
      commandCount: 1,
      offlineOnly: true,
      executionModelled: false,
    });
  });

  it("counts project-defined AOI calls as model-only instead of unsupported", () => {
    const project = createBlankRoutineProject();
    const controller = project.controllers[0]!;
    controller.addOnInstructions.push({
      id: "aoi-scale",
      name: "ScaleAOI",
      parameters: [],
      localTags: [],
      routineNames: [],
    });
    const program = controller.programs[0]!;
    const main = program.routines.find((r) => r.id === program.mainRoutineId) ?? program.routines[0]!;
    let ladder = main.ladder as LadderRoutine;
    ladder = appendRungWithRoot(ladder, createBranch([createNode("SCALEAOI", [])]));
    main.ladder = ladder;

    const summary = buildModelSummary(project);
    const row = summary.instructionFidelity.rows.find((item) => item.type === "ScaleAOI");
    expect(summary.modelOnlyInstructions.find((u) => u.type === "ScaleAOI")?.count).toBe(1);
    expect(summary.modelOnlyTotal).toBe(1);
    expect(summary.unsupportedTotal).toBe(0);
    expect(row).toMatchObject({
      status: "review-only",
      needsAttention: true,
      sourceLanguages: ["ladder"],
    });
  });

  it("does not count project-defined AOIs with imported RLL routines as model-only", () => {
    const project = createBlankRoutineProject();
    const controller = project.controllers[0]!;
    controller.addOnInstructions.push({
      id: "aoi-scale",
      name: "ScaleAOI",
      parameters: [],
      localTags: [],
      routineNames: ["Logic"],
      routines: [
        {
          id: "aoi-logic",
          programId: "aoi-scale",
          name: "Logic",
          language: "ladder",
          ladder: createLadderRoutine(),
        },
      ],
    });
    const program = controller.programs[0]!;
    const main = program.routines.find((r) => r.id === program.mainRoutineId) ?? program.routines[0]!;
    let ladder = main.ladder as LadderRoutine;
    ladder = appendRungWithRoot(ladder, createBranch([createNode("SCALEAOI", [])]));
    main.ladder = ladder;

    const summary = buildModelSummary(project);
    expect(summary.modelOnlyInstructions.find((u) => u.type === "ScaleAOI")).toBeUndefined();
    expect(summary.modelOnlyTotal).toBe(0);
    expect(summary.unsupportedTotal).toBe(0);
    expect(summary.instructionFidelity.rows.find((row) => row.type === "ScaleAOI")).toMatchObject({
      status: "executable-partial",
      needsAttention: false,
    });
  });

  it("tallies validator error and warning findings", () => {
    const project = createInitialProject();
    const findings = [
      { ruleId: "x", severity: "error", message: "e" } as const,
      { ruleId: "y", severity: "warning", message: "w" } as const,
      { ruleId: "z", severity: "warning", message: "w2" } as const,
    ];
    const summary = buildModelSummary(project, findings as never);
    expect(summary.errorCount).toBe(1);
    expect(summary.warningCount).toBe(2);
  });
});
