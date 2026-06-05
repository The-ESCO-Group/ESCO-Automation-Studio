import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type AddOnInstruction,
  type Controller,
  type IoModule,
  type PlcProject,
  type RoutineLanguage,
  type UserDefinedType,
} from "@esco/core";
import { analyzeProjectStructure, type GapSeverity } from "./project-structure-analysis";

// --- synthetic builders (no large L5X; everything is tiny + explicit) --------

function udt(name: string, memberCount: number): UserDefinedType {
  return {
    id: `udt-${name}`,
    name,
    members: Array.from({ length: memberCount }, (_, index) => ({
      name: `M${index}`,
      dataType: "DINT",
    })),
  };
}

function aoi(
  name: string,
  opts: { params?: number; locals?: number; routines?: number; protected?: boolean } = {},
): AddOnInstruction {
  const params = opts.params ?? 1;
  const locals = opts.locals ?? 0;
  const routines = opts.routines ?? 0;
  return {
    id: `aoi-${name}`,
    name,
    parameters: Array.from({ length: params }, (_, i) => ({ name: `P${i}`, dataType: "REAL" })),
    localTags: Array.from({ length: locals }, (_, i) => ({ name: `L${i}`, dataType: "DINT" })),
    routineNames: Array.from({ length: routines }, (_, i) => `R${i}`),
    ...(opts.protected ? { protected: true } : {}),
  };
}

function mod(name: string, catalogNumber: string, vendor = "Example Automation Vendor"): IoModule {
  return { id: `mod-${name}`, name, catalogNumber, vendor };
}

/** Attach a ladder body with `rungCount` placeholder rungs to a routine id. */
function ladderRoutine(programId: string, name: string, rungCount: number) {
  const routine = createRoutine(programId, name, "ladder");
  routine.ladder = { id: `ladder-${name}`, rungs: Array.from({ length: rungCount }, (_, i) => ({ number: i })) };
  return routine;
}

interface BuildOptions {
  routines?: { language: RoutineLanguage; rungs?: number; sourceText?: string }[];
  controllerTags?: { dataType: string; count: number }[];
  udts?: UserDefinedType[];
  aois?: AddOnInstruction[];
  modules?: IoModule[];
  extraPrograms?: number;
}

function build(options: BuildOptions = {}): PlcProject {
  const project = createProject("Synthetic");
  const controller = createController(project.id, "Ctl");

  const program = createProgram(controller.id, "Main");
  for (const [index, spec] of (options.routines ?? [{ language: "ladder", rungs: 1 }]).entries()) {
    const name = `R${index}`;
    const routine =
      spec.language === "ladder"
        ? ladderRoutine(program.id, name, spec.rungs ?? 0)
        : createRoutine(program.id, name, spec.language);
    if (spec.sourceText) routine.sourceText = spec.sourceText;
    if (index === 0) program.mainRoutineId = routine.id;
    program.routines.push(routine);
  }
  controller.programs.push(program);
  controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));

  for (const spec of options.controllerTags ?? []) {
    for (let i = 0; i < spec.count; i += 1) {
      controller.controllerTags.push(createTag(controller.id, `${spec.dataType}_${i}`, spec.dataType));
    }
  }

  controller.dataTypes.push(...(options.udts ?? []));
  controller.addOnInstructions.push(...(options.aois ?? []));
  controller.ioConfiguration.modules.push(...(options.modules ?? []));

  for (let p = 0; p < (options.extraPrograms ?? 0); p += 1) {
    const extra = createProgram(controller.id, `Extra${p}`);
    extra.routines.push(ladderRoutine(extra.id, `ExtraR${p}`, 1));
    controller.programs.push(extra);
  }

  project.controllers.push(controller);
  return project;
}

function gapBy(report: ReturnType<typeof analyzeProjectStructure>, area: string) {
  return report.gaps.find((gap) => gap.area === area);
}

function severities(report: ReturnType<typeof analyzeProjectStructure>): GapSeverity[] {
  return report.gaps.map((gap) => gap.severity);
}

// --- tests -------------------------------------------------------------------

describe("analyzeProjectStructure — structural counts", () => {
  it("counts routine languages and rungs, including function-block and structured-text", () => {
    const report = analyzeProjectStructure(
      build({
        routines: [
          { language: "ladder", rungs: 3 },
          { language: "structured-text" },
          { language: "function-block" },
          { language: "function-block" },
          { language: "sfc" },
        ],
      }),
    );
    expect(report.routineCount).toBe(5);
    expect(report.routineCountByLanguage).toEqual({
      ladder: 1,
      "structured-text": 1,
      "function-block": 2,
      sfc: 1,
    });
    expect(report.rungCount).toBe(3);
    expect(report.routineLanguagesUsed).toEqual(["function-block", "ladder", "sfc", "structured-text"]);
  });

  it("ranks top tag data types in descending order", () => {
    const report = analyzeProjectStructure(
      build({
        controllerTags: [
          { dataType: "BOOL", count: 3 },
          { dataType: "DINT", count: 2 },
          { dataType: "REAL", count: 1 },
        ],
      }),
    );
    expect(report.tagCounts.total).toBe(6);
    expect(report.tagCounts.controller).toBe(6);
    expect(report.topTagDataTypes.map((row) => [row.key, row.count])).toEqual([
      ["BOOL", 3],
      ["DINT", 2],
      ["REAL", 1],
    ]);
    // Strictly non-increasing counts.
    const counts = report.topTagDataTypes.map((row) => row.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it("ranks the largest UDTs by member count and AOIs by definition weight", () => {
    const report = analyzeProjectStructure(
      build({
        udts: [udt("Small", 2), udt("Big", 8), udt("Mid", 5)],
        aois: [
          aoi("P_Light", { params: 1 }),
          aoi("P_Heavy", { params: 6, locals: 3, routines: 2 }), // weight 11
          aoi("P_Mid", { params: 3, locals: 1 }), // weight 4
        ],
      }),
    );
    expect(report.udt.count).toBe(3);
    expect(report.udt.largest.map((row) => row.name)).toEqual(["Big", "Mid", "Small"]);
    expect(report.udt.largest[0]).toEqual({ name: "Big", memberCount: 8 });

    expect(report.aoi.count).toBe(3);
    expect(report.aoi.largest[0]).toMatchObject({ name: "P_Heavy", weight: 11, parameterCount: 6, localTagCount: 3, routineCount: 2 });
    expect(report.aoi.largest.map((row) => row.name)).toEqual(["P_Heavy", "P_Mid", "P_Light"]);
  });

  it("detects module catalog numbers, vendors, and families", () => {
    const report = analyzeProjectStructure(
      build({
        modules: [
          mod("DI1", "1756-IB16"),
          mod("DI2", "1756-IB16"),
          mod("Drive", "PF755"),
          mod("Flex", "5094-IF8IH"),
          mod("Bridge", "1756-EN2TR"),
        ],
      }),
    );
    expect(report.io.moduleCount).toBe(5);
    expect(report.io.topCatalogNumbers[0]).toEqual({ key: "1756-IB16", count: 2 });
    expect(report.io.familyCounts.find((row) => row.key === "1756")?.count).toBe(3);
    expect(report.io.vendorCounts[0]).toEqual({ key: "Example Automation Vendor", count: 5 });

    expect(report.moduleSignals.powerFlex).toBe(true);
    expect(report.moduleSignals.flex5094).toBe(true);
    expect(report.moduleSignals.hart).toBe(true); // 5094-IF8IH is a process instrumentation distributed I/O module
    expect(report.moduleSignals.bridge).toBe(true); // 1756-EN2TR
  });
});

describe("analyzeProjectStructure — gap classification", () => {
  it("flags vendor process-library/process usage as a high or critical gap", () => {
    const report = analyzeProjectStructure(
      build({
        aois: [aoi("P_AIn"), aoi("P_DIn"), aoi("P_PIDE"), aoi("raC_Valve")],
        udts: [udt("P_AInData", 4)],
      }),
    );
    expect(report.processSignals.plantPax).toBe(true);
    expect(report.processSignals.matchedPrefixes.length).toBeGreaterThan(0);
    const gap = gapBy(report, "Vendor process library");
    expect(gap).toBeDefined();
    expect(["high", "critical"]).toContain(gap!.severity);
    expect(gap!.recommendedNextStep).toMatch(/inspector/i);
  });

  it("flags heavy FBD usage as a critical/high gap", () => {
    const report = analyzeProjectStructure(
      build({
        routines: [
          { language: "ladder", rungs: 1 },
          { language: "ladder", rungs: 1 },
          { language: "function-block", sourceText: `<FBDContent><Block Type="PIDE" Operand="Loop0"/></FBDContent>` },
          { language: "function-block" },
          { language: "function-block" },
          { language: "function-block" },
          { language: "function-block" },
          { language: "function-block" },
        ],
      }),
    );
    expect(report.routineCountByLanguage["function-block"]).toBe(6);
    expect(report.fbd).toMatchObject({
      routineCount: 6,
      programRoutineCount: 6,
      aoiRoutineCount: 0,
      parseableRoutineCount: 1,
      preservedOnlyRoutineCount: 5,
      sheetCount: 1,
      blockCount: 1,
    });
    expect(report.fbd.topBlockTypes).toEqual([{ key: "PIDE", count: 1 }]);
    const gap = gapBy(report, "Function Block Diagram (FBD)");
    expect(gap).toBeDefined();
    // 6/8 = 75% FBD ≥ 25% → critical.
    expect(gap!.severity).toBe("critical");
    expect(["critical", "high"]).toContain(gap!.severity);
    expect(gap!.evidence).toMatch(/1 parseable for offline review/i);
    expect(gap!.evidence).toMatch(/PIDE x1/i);
    expect(gap!.currentEscoSupport).toMatch(/project-wide coverage evidence/i);
    expect(gap!.currentEscoSupport).toMatch(/never executed or edited/i);
    expect(gap!.recommendedNextStep).toMatch(/FBD viewer coverage/i);
  });

  it("rolls up AOI FBD bodies separately from program FBD routines", () => {
    const aoiFbd = createRoutine("aoi-mix", "AoiFbd", "function-block");
    aoiFbd.sourceText = `<FBDContent>
      <Sheet Number="0">
        <Block Type="TOT" Operand="BatchTotal">
          <OutputParameter Name="Total" Operand="BatchTotal.ACC"/>
        </Block>
        <Block Type="PIDE" Operand="Loop">
          <InputParameter Name="PV" Operand="Loop.PV"/>
        </Block>
        <Wire FromID="1"/>
        <VendorBox Code="KeepMe"/>
      </Sheet>
    </FBDContent>`;
    const report = analyzeProjectStructure(
      build({
        routines: [
          { language: "ladder", rungs: 1 },
          { language: "function-block", sourceText: `<FBDContent><Block Type="PIDE" Operand="ProgLoop"><InputParameter Name="PV" Operand="PV"/></Block></FBDContent>` },
        ],
        aois: [
          {
            id: "aoi-mix",
            name: "MixAoi",
            parameters: [],
            localTags: [],
            routineNames: ["AoiFbd"],
            routines: [aoiFbd],
          },
        ],
      }),
    );

    expect(report.fbd).toMatchObject({
      routineCount: 2,
      programRoutineCount: 1,
      aoiRoutineCount: 1,
      parseableRoutineCount: 2,
      preservedOnlyRoutineCount: 0,
      sheetCount: 2,
      blockCount: 3,
      wireCount: 1,
      connectedWireCount: 0,
      wireEndpointGapCount: 1,
      unresolvedWireEndpointCount: 1,
      parameterCount: 3,
      inputParameterCount: 2,
      outputParameterCount: 1,
      missingParameterNameCount: 0,
      diagnosticCount: 2,
      diagnosticWarningCount: 2,
      unknownElementCount: 1,
    });
    expect(report.fbd.topBlockTypes).toEqual([
      { key: "PIDE", count: 2 },
      { key: "TOT", count: 1 },
    ]);
    expect(report.fbd.unknownElements).toEqual([{ key: "VendorBox", count: 1 }]);
    expect(report.fbd.routines.find((row) => row.sourceKind === "aoi")).toMatchObject({
      aoiName: "MixAoi",
      routineName: "AoiFbd",
      topBlockTypes: [
        { key: "PIDE", count: 1 },
        { key: "TOT", count: 1 },
      ],
      warnings: expect.arrayContaining([
        "1 unrecognized FBD element(s) preserved for source review.",
        "1 FBD wire(s) are missing imported endpoint metadata.",
      ]),
    });
    expect(gapBy(report, "Function Block Diagram (FBD)")!.evidence).toMatch(/1 AOI routine/i);
    expect(gapBy(report, "Function Block Diagram (FBD)")!.evidence).toMatch(/3 block parameter\/pin row/i);
    expect(gapBy(report, "Function Block Diagram (FBD)")!.evidence).toMatch(/Semantic review warnings: 2/i);
    expect(gapBy(report, "Function Block Diagram (FBD)")!.currentEscoSupport).toMatch(/semantic diagnostics/i);
    expect(gapBy(report, "Function Block Diagram (FBD)")!.currentEscoSupport).toMatch(/parameter-pin/i);
  });

  it("flags large projects as a performance gap above thresholds", () => {
    const report = analyzeProjectStructure(build({ extraPrograms: 120 }));
    expect(report.programCount).toBeGreaterThanOrEqual(100);
    const gap = gapBy(report, "Large-project navigation / performance");
    expect(gap).toBeDefined();
    expect(["high", "critical"]).toContain(gap!.severity);
    expect(gap!.evidence).toMatch(/programs/i);
  });

  it("flags advanced module profiles when AC drives, instrumentation I/O, or bridges are present", () => {
    const report = analyzeProjectStructure(
      build({ modules: [mod("Drive", "PF753"), mod("Hart", "1794-IF8IH")] }),
    );
    const gap = gapBy(report, "Advanced module profiles");
    expect(gap).toBeDefined();
    expect(gap!.severity).toBe("high"); // AC drive or process instrumentation I/O -> high
  });

  it("describes phase/PID remaining work without hiding the existing offline inspectors", () => {
    const report = analyzeProjectStructure(
      build({
        controllerTags: [
          { dataType: "PID", count: 1 },
          { dataType: "EQUIPMENT_PHASE", count: 1 },
        ],
      }),
    );
    const gap = gapBy(report, "Equipment phases / process / PID");
    expect(gap).toBeDefined();
    expect(gap!.currentEscoSupport).toMatch(/dedicated offline process-loop and PhaseManager review inspectors/i);
    expect(gap!.currentEscoSupport).toMatch(/tuning-member review/i);
    expect(gap!.currentEscoSupport).toMatch(/offline process timing previews/i);
    expect(gap!.currentEscoSupport).toMatch(/state\/timing preview evidence/i);
    expect(gap!.missingForParity).toMatch(/Controller-verified timing/i);
    expect(gap!.missingForParity).toMatch(/value comparison\/calculation workflows/i);
    expect(gap!.recommendedNextStep).toMatch(/tuning comparison\/worksheet views/i);
    expect(gap!.currentEscoSupport).not.toMatch(/no dedicated review surface/i);
  });

  it("flags alarm definitions when ALARM types or *Alarm* objects are present", () => {
    const report = analyzeProjectStructure({
      ...build(),
      controllers: buildWithAlarmTag(),
    });
    expect(report.controllerMetadata.alarmDefinitions).toBe(true);
    expect(gapBy(report, "Alarm definitions / process alarms")).toBeDefined();
  });

  it("returns no critical gaps for a small ladder-only project", () => {
    const report = analyzeProjectStructure(
      build({
        routines: [
          { language: "ladder", rungs: 2 },
          { language: "ladder", rungs: 1 },
        ],
        controllerTags: [{ dataType: "BOOL", count: 4 }],
      }),
    );
    expect(severities(report)).not.toContain("critical");
    expect(gapBy(report, "Function Block Diagram (FBD)")).toBeUndefined();
    expect(gapBy(report, "Vendor process library")).toBeUndefined();
    expect(report.gaps).toEqual([]);
  });

  it("orders gaps most-severe first and is deterministic", () => {
    const project = build({
      routines: [
        { language: "function-block" },
        { language: "function-block" },
        { language: "ladder", rungs: 1 },
      ],
      aois: [aoi("P_PIDE")],
      modules: [mod("Drive", "PF755")],
      extraPrograms: 0,
    });
    const a = analyzeProjectStructure(project);
    const b = analyzeProjectStructure(project);
    expect(a.gaps).toEqual(b.gaps);
    const ranks = a.gaps.map((gap) => gap.severity);
    const order: GapSeverity[] = ["critical", "high", "medium", "low"];
    const indices = ranks.map((severity) => order.indexOf(severity));
    expect([...indices].sort((x, y) => x - y)).toEqual(indices);
  });
});

/** A controller list whose tag carries an ALARM_ANALOG data type. */
function buildWithAlarmTag(): Controller[] {
  const project = createProject("AlarmProj");
  const controller = createController(project.id, "Ctl");
  const program = createProgram(controller.id, "Main");
  program.routines.push(createRoutine(program.id, "R0", "ladder"));
  controller.programs.push(program);
  controller.controllerTags.push(createTag(controller.id, "HiHi", "ALARM_ANALOG"));
  return [controller];
}
