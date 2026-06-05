import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  createDemoProject,
  type PlcProject,
} from "@esco/core";
import {
  createDefaultHmiProject,
  createHmiElement,
  createHmiScreen,
  getHmiProject,
  type HmiProject,
} from "@esco/hmi-model";
import { addRung, appendInstruction, createLadderRoutine, routineNodes } from "@esco/ladder";
import { buildRuntime } from "./runtime-build";
import { buildEscoRuntime, exportEscoRuntime, importEscoRuntime } from "./runtime-actions";
import {
  EASRT_EXTENSION,
  EASRT_FORMAT_NAME,
  EASRT_SCHEMA_VERSION,
  parseRuntimeFile,
  runtimeChecksumInput,
  serializeRuntime,
  sha256Hex,
} from "./runtime-format";

const AT = "2026-06-02T12:00:00.000Z";

/** A project with two programs, a ladder routine carrying rungs, and an ST routine. */
function multiRoutineProject(): PlcProject {
  const project = createProject("Line A", "Multi-routine runtime test");
  const controller = createController(project.id, "LineCtl");
  controller.processorType = "Emulated";

  const main = createProgram(controller.id, "MainProgram");
  const mainRoutine = createRoutine(main.id, "MainRoutine", "ladder");
  main.mainRoutineId = mainRoutine.id;
  let ladder = addRung(createLadderRoutine());
  const rungId = ladder.rungs[0]!.id;
  ladder = appendInstruction(ladder, rungId, "XIC", "StartPB");
  ladder = appendInstruction(ladder, rungId, "OTE", "MotorRun");
  mainRoutine.ladder = ladder;
  main.routines.push(mainRoutine);
  main.programTags.push(createTag(controller.id, "Local1", "DINT", { scope: "program", programId: main.id }));

  const aux = createProgram(controller.id, "AuxProgram");
  const stRoutine = createRoutine(aux.id, "AuxRoutine", "structured-text");
  stRoutine.structuredText = "MotorRun := StartPB AND NOT StopPB;\nCount := Count + 1;";
  aux.mainRoutineId = stRoutine.id;
  aux.routines.push(stRoutine);

  controller.programs.push(main, aux);
  controller.tasks.push(createContinuousTask(controller.id, "MainTask", [main.id, aux.id]));
  controller.controllerTags.push(
    createTag(controller.id, "StartPB", "BOOL", { value: false }),
    createTag(controller.id, "StopPB", "BOOL", { value: false }),
    createTag(controller.id, "MotorRun", "BOOL", { value: false }),
    createTag(controller.id, "Count", "DINT", { value: 0 }),
  );
  project.controllers.push(controller);
  return project;
}

/**
 * A project mixing executable (XIC/OTE), model-only (MSG), and unsupported (ZZZ)
 * ladder instructions, plus an I/O module — to exercise the instruction fidelity
 * summary and the model-only / unsupported / I/O metadata-only warnings.
 */
function fidelityProject(): PlcProject {
  const project = createProject("Fidelity Line", "Instruction fidelity test");
  const controller = createController(project.id, "FidelityCtl");
  controller.processorType = "Emulated";
  controller.ioConfiguration.modules.push({
    id: "mod-en2t",
    name: "ENet",
    catalogNumber: "1756-EN2T",
    slot: 1,
  });

  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = routine.id;
  let ladder = addRung(createLadderRoutine());
  const r0 = ladder.rungs[0]!.id;
  ladder = appendInstruction(ladder, r0, "XIC", "Start");
  ladder = appendInstruction(ladder, r0, "OTE", "Run");
  ladder = addRung(ladder);
  const r1 = ladder.rungs[1]!.id;
  ladder = appendInstruction(ladder, r1, "MSG", "MsgCtl"); // model-only
  ladder = addRung(ladder);
  const r2 = ladder.rungs[2]!.id;
  ladder = appendInstruction(ladder, r2, "ZZZ", "Spare"); // unsupported
  routine.ladder = ladder;
  program.routines.push(routine);

  controller.programs.push(program);
  controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
  controller.controllerTags.push(
    createTag(controller.id, "Start", "BOOL", { value: false }),
    createTag(controller.id, "Run", "BOOL", { value: false }),
  );
  project.controllers.push(controller);
  return project;
}

/** An HMI project with a bound element, a model-only command, an unsupported element, and unsupported content. */
function hmiProjectWithBindings(): HmiProject {
  const hmi = createDefaultHmiProject("Line HMI");
  const overview = createHmiScreen("Overview");
  const detail = createHmiScreen("Detail");

  const lamp = createHmiElement("common.indicator-lamp", "RunLamp");
  lamp.bindings.push({
    id: "bind1",
    targetProperty: "value",
    source: { kind: "tag", path: "Run" },
    mode: "read",
  });

  const button = createHmiElement("common.button", "StartBtn");
  button.events.push({
    id: "evt1",
    eventType: "press",
    commands: [{ id: "cmd1", type: "device-command", safety: "hardware-only", args: {} }],
  });

  const exotic = createHmiElement("vendor.exotic-widget", "Exotic"); // unknown type -> .unsupported

  overview.elements.push(lamp, button, exotic);
  hmi.screens.push(overview, detail);
  hmi.unsupportedContent.push({
    id: "uc1",
    sourcePath: "legacy/Faceplate.gfx",
    kind: "faceplate",
    displayName: "Legacy Faceplate",
    readonlyReason: "Imported faceplate type is not supported.",
  });
  return hmi;
}

describe("sha256Hex", () => {
  it("matches the standard FIPS test vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("buildRuntime", () => {
  it("builds an ESCO-native runtime from the default/demo project", () => {
    const result = buildRuntime(createDemoProject(), { builtAt: AT, appVersion: "9.9.9" });
    expect(result.ok).toBe(true);
    const runtime = result.runtime!;
    expect(runtime.formatName).toBe(EASRT_FORMAT_NAME);
    expect(runtime.extension).toBe(EASRT_EXTENSION);
    expect(runtime.schemaVersion).toBe(EASRT_SCHEMA_VERSION);
    expect(runtime.provenance).toMatchObject({ source: "esco-native", builtBy: "ESCO Automation Studio", appVersion: "9.9.9", builtAt: AT });
    expect(runtime.build.controllerCount).toBe(1);
    expect(runtime.build.taskCount).toBe(1);
    expect(runtime.build.programCount).toBe(1);
    expect(runtime.tags.length).toBeGreaterThanOrEqual(3);
    // Power-up state present and simulation-ready.
    expect(Object.keys(runtime.initialValues).length).toBeGreaterThan(0);
  });

  it("compiles ordered tasks/programs/routines and flattened payloads from a multi-routine project", () => {
    const result = buildRuntime(multiRoutineProject(), { builtAt: AT });
    expect(result.ok).toBe(true);
    const runtime = result.runtime!;
    expect(runtime.build.routineCount).toBe(2);
    expect(runtime.build.executionOrder.length).toBeGreaterThanOrEqual(2);
    expect(runtime.build.rungCount).toBe(1);

    const controller = runtime.controllers[0]!;
    const routines = controller.tasks.flatMap((task) => task.programs.flatMap((program) => program.routines));
    const ladder = routines.find((routine) => routine.language === "ladder")!;
    const st = routines.find((routine) => routine.language === "structured-text")!;

    expect(ladder.payload.kind).toBe("ladder");
    if (ladder.payload.kind === "ladder") {
      expect(ladder.payload.rungs[0]!.text).toMatch(/XIC\(StartPB\)/);
      expect(ladder.payload.rungs[0]!.text).toMatch(/OTE\(MotorRun\)/);
    }
    expect(ladder.executable).toBe(true);
    expect(ladder.executionIndex).toBeGreaterThanOrEqual(0);

    expect(st.payload.kind).toBe("structured-text");
    if (st.payload.kind === "structured-text") {
      expect(st.payload.lines.length).toBe(2);
    }
  });

  it("fails professionally when the project has no controller", () => {
    const empty = createProject("Empty");
    const result = buildRuntime(empty);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/no controller/i);
  });

  it("derives HMI runtime references and warnings from a supplied HMI project", () => {
    const hmiProject = hmiProjectWithBindings();
    const result = buildRuntime(fidelityProject(), { builtAt: AT, hmiProject });
    expect(result.ok).toBe(true);
    const runtime = result.runtime!;
    expect(runtime.hmi).toMatchObject({
      screenCount: 2,
      popupCount: 0,
      bindingCount: 1,
      unsupportedCount: 3,
    });
    expect(runtime.hmi?.screenNames).toEqual(["Detail", "Overview"]);
    expect(runtime.hmi?.projectSnapshot).not.toBe(hmiProject);
    expect(runtime.hmi?.projectSnapshot).toMatchObject({
      name: "Line HMI",
      screens: [{ name: "Overview" }, { name: "Detail" }],
    });

    const imported = importEscoRuntime(serializeRuntime(runtime), "line-hmi.easruntime");
    expect(imported.ok).toBe(true);
    const restoredHmi = getHmiProject(imported.project);
    expect(restoredHmi?.name).toBe("Line HMI");
    expect(restoredHmi?.screens.map((screen) => screen.name)).toEqual(["Overview", "Detail"]);
    expect(result.warnings.some((warning) => /HMI: .*unsupported/i.test(warning))).toBe(true);
    expect(result.summary?.instructionFidelity.total).toBeGreaterThan(0);
  });
});

describe("instruction fidelity + model-only/unsupported warnings", () => {
  it("accounts for executable, model-only, and unsupported instructions without faking execution", () => {
    const result = buildRuntime(fidelityProject(), { builtAt: AT });
    expect(result.ok).toBe(true);
    const fidelity = result.summary!.instructionFidelity;

    expect(fidelity.total).toBe(4);
    expect(fidelity.executable).toBe(2); // XIC + OTE
    expect(fidelity.modelOnly).toBe(1); // MSG
    expect(fidelity.unsupported).toBe(1); // ZZZ
    expect(fidelity.byStatus["executable-simulation"]).toBe(2);
    expect(fidelity.byStatus["model-only"]).toBe(1);
    expect(fidelity.byStatus.unsupported).toBe(1);

    // Distinct preserved opcodes, sorted by type for deterministic output.
    expect(fidelity.preserved.map((entry) => entry.type)).toEqual(["MSG", "ZZZ"]);
    expect(fidelity.preserved.find((entry) => entry.type === "MSG")!.status).toBe("model-only");
    expect(fidelity.preserved.find((entry) => entry.type === "ZZZ")!.status).toBe("unsupported");

    // Honest warnings — surfaced, not silently executed.
    const warnings = result.warnings;
    expect(warnings.some((w) => /Instruction "MSG" \(model-only\).*preserved for review/i.test(w))).toBe(true);
    expect(warnings.some((w) => /Instruction "ZZZ" is not in the ESCO instruction catalog/i.test(w))).toBe(true);

    // The model-only/unsupported logic is preserved in the compiled payload, never dropped.
    const routine = result.runtime!.controllers[0]!.tasks[0]!.programs[0]!.routines[0]!;
    expect(routine.payload.kind).toBe("ladder");
    if (routine.payload.kind === "ladder") {
      const text = routine.payload.rungs.map((rung) => rung.text).join("\n");
      expect(text).toMatch(/MSG/);
      expect(text).toMatch(/ZZZ/);
    }
  });

  it("accounts for Structured Text instruction calls alongside ladder", () => {
    const project = createProject("ST Fidelity");
    const controller = createController(project.id, "Ctl");
    const program = createProgram(controller.id, "MainProgram");
    const routine = createRoutine(program.id, "MainST", "structured-text");
    routine.structuredText = "MOV();\nMSG();\nALMA();\nZZZ();";
    program.mainRoutineId = routine.id;
    program.routines.push(routine);
    controller.programs.push(program);
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
    project.controllers.push(controller);

    const result = buildRuntime(project, { builtAt: AT });
    expect(result.ok).toBe(true);
    const fidelity = result.summary!.instructionFidelity;

    expect(fidelity.total).toBe(4);
    expect(fidelity.executable).toBe(1);
    expect(fidelity.modelOnly).toBe(2);
    expect(fidelity.unsupported).toBe(1);
    expect(fidelity.byStatus["model-only"]).toBe(1);
    expect(fidelity.byStatus["review-only"]).toBe(1);
    expect(fidelity.preserved.map((entry) => [entry.type, entry.status, entry.sourceLanguages])).toEqual([
      ["ALMA", "review-only", ["structured-text"]],
      ["MSG", "model-only", ["structured-text"]],
      ["ZZZ", "unsupported", ["structured-text"]],
    ]);
    expect(result.warnings.some((w) => /Instruction "MSG".*Structured Text/i.test(w))).toBe(true);
    expect(result.warnings.some((w) => /Instruction "ALMA".*review-only.*Structured Text/i.test(w))).toBe(true);
    expect(result.warnings.some((w) => /Instruction "ZZZ".*Structured Text/i.test(w))).toBe(true);
  });

  it("classifies a project AOI with a ladder body as executable, not unsupported", () => {
    const project = fidelityProject();
    const controller = project.controllers[0]!;
    // Define an AOI with a ladder body, then call it from logic.
    const aoiBody = createRoutine("aoi-prog", "Logic", "ladder");
    let body = addRung(createLadderRoutine());
    body = appendInstruction(body, body.rungs[0]!.id, "XIC", "Start");
    aoiBody.ladder = body;
    controller.addOnInstructions.push({
      id: "aoi-1",
      name: "MyAoi",
      parameters: [],
      localTags: [],
      routineNames: ["Logic"],
      routines: [aoiBody],
    });
    const routine = controller.programs[0]!.routines[0]!;
    let ladder = routine.ladder as ReturnType<typeof createLadderRoutine>;
    ladder = addRung(ladder);
    ladder = appendInstruction(ladder, ladder.rungs[ladder.rungs.length - 1]!.id, "MyAoi", "Inst");
    routine.ladder = ladder;
    controller.controllerTags.push(createTag(controller.id, "Inst", "MyAoi"));

    const result = buildRuntime(project, { builtAt: AT });
    expect(result.ok).toBe(true);
    const fidelity = result.summary!.instructionFidelity;
    // The AOI call counts as executable; it must NOT appear as an unsupported opcode.
    expect(fidelity.byStatus["executable-partial"]).toBe(1);
    expect(fidelity.preserved.some((entry) => entry.type === "MYAOI" || entry.type === "MyAoi")).toBe(false);
  });
});

describe("runtime power-up values", () => {
  it("compiles authored controller and program scalar tag values into the runtime", () => {
    const project = multiRoutineProject();
    const controller = project.controllers[0]!;
    controller.controllerTags.find((tag) => tag.name === "StartPB")!.value = true;
    controller.controllerTags.find((tag) => tag.name === "Count")!.value = 42;
    controller.programs[0]!.programTags[0]!.value = 77;

    const runtime = buildRuntime(project, { builtAt: AT }).runtime!;
    expect(runtime.initialValues.StartPB).toBe(true);
    expect(runtime.initialValues.Count).toBe(42);
    expect(runtime.initialValues["Program:MainProgram.Local1"]).toBe(77);

    expect(runtime.tags.find((tag) => tag.name === "StartPB")?.initialValue).toBe(true);
    expect(runtime.tags.find((tag) => tag.programName === "MainProgram" && tag.name === "Local1")?.initialValue).toBe(77);

    const imported = importEscoRuntime(serializeRuntime(runtime), "line-a.easruntime");
    expect(imported.ok).toBe(true);
    const restoredController = imported.project.controllers[0]!;
    expect(restoredController.controllerTags.find((tag) => tag.name === "StartPB")?.value).toBe(true);
    expect(restoredController.controllerTags.find((tag) => tag.name === "Count")?.value).toBe(42);
    expect(restoredController.programs[0]!.programTags.find((tag) => tag.name === "Local1")?.value).toBe(77);
  });
});

describe("I/O metadata-only warnings", () => {
  it("warns that I/O modules are preserved as binding metadata only", () => {
    const result = buildRuntime(fidelityProject(), { builtAt: AT });
    expect(result.ok).toBe(true);
    expect(result.summary!.ioModuleCount).toBe(1);
    expect(
      result.warnings.some((w) => /I\/O module.*preserved as binding metadata only/i.test(w)),
    ).toBe(true);
  });
});

describe("UDT/AOI runtime metadata", () => {
  it("preserves UDT and AOI metadata and warns on AOI execution gaps", () => {
    const project = fidelityProject();
    const controller = project.controllers[0]!;
    controller.dataTypes.push({
      id: "udt-motor",
      name: "MotorStatus",
      family: "NoFamily",
      safetyClass: "Standard",
      members: [
        { name: "Running", dataType: "BOOL", description: "Run feedback", externalAccess: "read-only" },
        { name: "Speed", dataType: "DINT", radix: "Decimal" },
      ],
    });
    controller.addOnInstructions.push({
      id: "aoi-sealed",
      name: "SealedAoi",
      revision: "1.2",
      vendor: "ESCO",
      protected: true,
      protectionType: "Protected",
      parameters: [{ name: "In", dataType: "BOOL", usage: "Input", required: true, visible: true }],
      localTags: [{ name: "Work", dataType: "DINT", radix: "Decimal" }],
      routineNames: ["Logic"],
    });

    const runtime = buildRuntime(project, { builtAt: AT }).runtime!;
    const runtimeController = runtime.controllers[0]!;
    expect(runtimeController.dataTypes[0]).toMatchObject({
      name: "MotorStatus",
      family: "NoFamily",
      members: [{ name: "Running", externalAccess: "read-only" }, { name: "Speed", radix: "Decimal" }],
    });
    expect(runtimeController.addOnInstructions[0]).toMatchObject({
      name: "SealedAoi",
      revision: "1.2",
      protected: true,
      parameters: [{ name: "In", required: true, visible: true }],
      localTags: [{ name: "Work", radix: "Decimal" }],
    });
    expect(runtime.build.warnings.some((warning) => /SealedAoi.*review-only/i.test(warning))).toBe(true);

    const imported = importEscoRuntime(serializeRuntime(runtime), "fidelity.easruntime");
    expect(imported.ok).toBe(true);
    const restored = imported.project.controllers[0]!;
    expect(restored.dataTypes[0]).toMatchObject({
      name: "MotorStatus",
      members: [{ name: "Running", externalAccess: "read-only" }, { name: "Speed", radix: "Decimal" }],
    });
    expect(restored.addOnInstructions[0]).toMatchObject({
      name: "SealedAoi",
      protected: true,
      parameters: [{ name: "In", required: true }],
    });
  });
});

describe("HMI references + unsupported binding warnings", () => {
  it("derives deterministic HMI references and warns on what the offline runtime cannot drive", () => {
    const result = buildRuntime(multiRoutineProject(), { builtAt: AT, hmiProject: hmiProjectWithBindings() });
    expect(result.ok).toBe(true);
    const hmi = result.runtime!.hmi!;

    expect(hmi.screenCount).toBe(2);
    expect(hmi.screenNames).toEqual(["Detail", "Overview"]); // sorted
    expect(hmi.projectSnapshot?.screens.map((screen) => screen.name)).toEqual(["Overview", "Detail"]);
    expect(hmi.popupCount).toBe(0);
    expect(hmi.controllerReferenceCount).toBe(0);
    expect(hmi.bindingCount).toBe(1);
    // 1 unsupported element + 1 model-only command + 1 unsupported content item.
    expect(hmi.unsupportedCount).toBe(3);

    const warnings = result.warnings;
    expect(warnings.some((w) => /HMI:.*graphic element.*unsupported element types/i.test(w))).toBe(true);
    expect(warnings.some((w) => /HMI:.*command.*model-only\/hardware-only\/unsupported/i.test(w))).toBe(true);
    expect(warnings.some((w) => /HMI:.*unsupported content item/i.test(w))).toBe(true);
  });

  it("passes a precompiled hmi option through, and lets hmiProject take precedence", () => {
    const precompiled = { screenCount: 9, screenNames: ["Z"] };
    const a = buildRuntime(multiRoutineProject(), { builtAt: AT, hmi: precompiled }).runtime!;
    expect(a.hmi).toEqual(precompiled);

    const b = buildRuntime(multiRoutineProject(), {
      builtAt: AT,
      hmi: precompiled,
      hmiProject: hmiProjectWithBindings(),
    }).runtime!;
    expect(b.hmi!.screenCount).toBe(2); // derived from hmiProject, not the precompiled 9
  });
});

describe("deterministic builds with fixed timestamps", () => {
  it("produces byte-identical .easruntime output and checksum for the same project", () => {
    const project = fidelityProject();
    const options = { builtAt: AT, appVersion: "1.2.3" };
    const first = serializeRuntime(buildRuntime(project, options).runtime!);
    // A structurally identical project (deep clone) must compile to the same bytes.
    const clone = JSON.parse(JSON.stringify(project)) as PlcProject;
    const second = serializeRuntime(buildRuntime(clone, options).runtime!);

    expect(second).toBe(first);
    expect(parseRuntimeFile(first).checksum!.actual).toBe(parseRuntimeFile(second).checksum!.actual);
  });
});

describe("buildEscoRuntime / exportEscoRuntime actions", () => {
  it("returns an action result with the compiled runtime", () => {
    const result = buildEscoRuntime(createDemoProject(), { builtAt: AT });
    expect(result.ok).toBe(true);
    expect(result.data?.runtime.provenance.source).toBe("esco-native");
  });

  it("exports a checksummed .easruntime file with build metadata", () => {
    const result = exportEscoRuntime(createDemoProject(), { builtAt: AT });
    expect(result.ok).toBe(true);
    expect(result.data!.fileName.endsWith(EASRT_EXTENSION)).toBe(true);
    expect(result.data!.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data!.summary.controllerCount).toBe(1);
    // The file text is a self-describing ESCO Runtime envelope.
    expect(result.data!.text).toContain(EASRT_FORMAT_NAME);
  });
});

describe("serialize / parse round trip + integrity", () => {
  it("round-trips a runtime through .easruntime text with a valid checksum", () => {
    const runtime = buildRuntime(multiRoutineProject(), { builtAt: AT }).runtime!;
    const text = serializeRuntime(runtime);
    const loaded = parseRuntimeFile(text, "line-a.easruntime");
    expect(loaded.ok).toBe(true);
    expect(loaded.checksum?.valid).toBe(true);
    expect(loaded.runtime).toEqual(runtime);
    expect(loaded.runtime!.provenance.source).toBe("esco-native");
  });

  it("keeps runtime checksum input stable across object insertion order", () => {
    const runtime = buildRuntime(createDemoProject(), { builtAt: AT }).runtime!;
    const clone = JSON.parse(JSON.stringify(runtime)) as typeof runtime;
    const reordered: typeof runtime = {
      build: clone.build,
      initialValues: clone.initialValues,
      tags: clone.tags,
      controllers: clone.controllers,
      identity: clone.identity,
      provenance: clone.provenance,
      runtimeVersion: clone.runtimeVersion,
      schemaVersion: clone.schemaVersion,
      extension: clone.extension,
      formatName: clone.formatName,
    };
    expect(runtimeChecksumInput(runtime)).toBe(runtimeChecksumInput(reordered));
  });

  it("still accepts legacy .easrt filenames on load", () => {
    const runtime = buildRuntime(multiRoutineProject(), { builtAt: AT }).runtime!;
    expect(parseRuntimeFile(serializeRuntime(runtime), "line-a.easrt").ok).toBe(true);
  });

  it("rejects a checksum mismatch (tampered runtime content)", () => {
    const runtime = buildRuntime(createDemoProject(), { builtAt: AT }).runtime!;
    const file = JSON.parse(serializeRuntime(runtime));
    file.runtime.identity.projectName = "Tampered Name";
    const loaded = parseRuntimeFile(JSON.stringify(file));
    expect(loaded.ok).toBe(false);
    expect(loaded.checksum?.valid).toBe(false);
    expect(loaded.error).toMatch(/integrity check failed/i);
  });

  it("rejects an unsupported schema version", () => {
    const runtime = buildRuntime(createDemoProject(), { builtAt: AT }).runtime!;
    const file = JSON.parse(serializeRuntime(runtime));
    file.schemaVersion = EASRT_SCHEMA_VERSION + 99;
    const loaded = parseRuntimeFile(JSON.stringify(file));
    expect(loaded.ok).toBe(false);
    expect(loaded.error).toMatch(/unsupported esco runtime schema version/i);
  });

  it("rejects corrupt / malformed runtime files", () => {
    expect(parseRuntimeFile("}{ not json").error).toMatch(/not valid JSON/i);
    expect(parseRuntimeFile(JSON.stringify({ hello: "world" })).error).toMatch(/format marker/i);
    expect(
      parseRuntimeFile(JSON.stringify({ formatName: EASRT_FORMAT_NAME, extension: EASRT_EXTENSION, schemaVersion: 1 })).error,
    ).toMatch(/missing runtime payload/i);
  });

  it("rejects a wrong file extension", () => {
    const text = serializeRuntime(buildRuntime(createDemoProject(), { builtAt: AT }).runtime!);
    expect(parseRuntimeFile(text, "line.txt").error).toMatch(/must use the \.easruntime extension/i);
  });
});

describe("importEscoRuntime", () => {
  it("imports a runtime as an inspectable, read-only ESCO Runtime source", () => {
    const exported = exportEscoRuntime(multiRoutineProject(), { builtAt: AT });
    const result = importEscoRuntime(exported.data!.text, "line-a.easruntime");
    expect(result.ok).toBe(true);
    expect(result.data!.checksumValid).toBe(true);
    expect(result.data!.runtimeOnly).toBe(true);
    // Provenance marks it clearly as compiled runtime source, not a normal project.
    expect(result.project.provenance?.sourceType).toBe("esco-runtime");
    // Structure is inspectable: controllers/programs/routines/tags rebuilt.
    const controller = result.project.controllers[0]!;
    expect(controller.programs.length).toBe(2);
    expect(controller.programs.flatMap((p) => p.routines).length).toBe(2);
    expect(controller.controllerTags.length).toBe(4);
    const ladder = controller.programs[0]!.routines[0]!.ladder;
    expect(ladder).toBeDefined();
    expect(routineNodes(ladder as ReturnType<typeof createLadderRoutine>).map((node) => node.instructionType)).toEqual(["XIC", "OTE"]);
    // The import is flagged with a read-only caveat.
    expect(result.warnings?.some((w) => /read-only/i.test(w))).toBe(true);
  });

  it("rejects an invalid runtime file at import", () => {
    const result = importEscoRuntime("not a runtime", "x.easruntime");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/corrupt esco runtime|not valid json/i);
  });
});
