import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
} from "@esco/core";
import { addRung, appendInstruction, createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { downloadToSoftController, exportEscoRuntime, parseRuntimeFile } from "@esco/project-actions";
import { EscoSoftController } from "./soft-controller";
import { EscoSoftControllerTargetAdapter } from "./project-actions-adapter";
import {
  SOFT_CONTROLLER_CATALOG_NUMBER,
  SOFT_CONTROLLER_RUNTIME_VERSION,
  SOFT_CONTROLLER_VENDOR,
} from "./types";
import { programTagPath } from "./runtime-loader";

const AT = "2026-06-03T12:00:00.000Z";

// --- fixtures --------------------------------------------------------------

/** Controller-scoped ladder: XIC(StartPB) OTE(MotorRun). */
function ladderProject(): PlcProject {
  const project = createProject("Soft Line");
  const controller = createController(project.id, "SoftCtl");
  controller.processorType = "ESCO Software";
  controller.catalogNumber = "ESCO-SOFT-CTRL";

  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  let ladder = addRung(createLadderRoutine());
  const rungId = ladder.rungs[0]!.id;
  ladder = appendInstruction(ladder, rungId, "XIC", "StartPB");
  ladder = appendInstruction(ladder, rungId, "OTE", "MotorRun");
  routine.ladder = ladder;
  program.mainRoutineId = routine.id;
  program.routines.push(routine);
  controller.programs.push(program);
  controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
  controller.controllerTags.push(
    createTag(controller.id, "StartPB", "BOOL", { value: false }),
    createTag(controller.id, "MotorRun", "BOOL", { value: false }),
  );
  project.controllers.push(controller);
  return project;
}

/** Controller-scoped Structured Text counter: Count := Count + 1. */
function counterProject(): PlcProject {
  const project = createProject("Counter Line");
  const controller = createController(project.id, "CountCtl");
  const program = createProgram(controller.id, "CountProgram");
  const routine = createRoutine(program.id, "CountRoutine", "structured-text");
  routine.structuredText = "Count := Count + 1;";
  program.mainRoutineId = routine.id;
  program.routines.push(routine);
  controller.programs.push(program);
  controller.tasks.push(createContinuousTask(controller.id, "CountTask", [program.id]));
  controller.controllerTags.push(createTag(controller.id, "Count", "DINT", { value: 0 }));
  project.controllers.push(controller);
  return project;
}

function scheduledCounterProject(): PlcProject {
  const project = createProject("Scheduled Counter Line");
  const controller = createController(project.id, "SchedCtl");

  const fastProgram = createProgram(controller.id, "FastProgram");
  const fastRoutine = createRoutine(fastProgram.id, "FastRoutine", "structured-text");
  fastRoutine.structuredText = "FastCount := FastCount + 1;";
  fastProgram.mainRoutineId = fastRoutine.id;
  fastProgram.routines.push(fastRoutine);

  const slowProgram = createProgram(controller.id, "SlowProgram");
  const slowRoutine = createRoutine(slowProgram.id, "SlowRoutine", "structured-text");
  slowRoutine.structuredText = "SlowCount := SlowCount + 1;";
  slowProgram.mainRoutineId = slowRoutine.id;
  slowProgram.routines.push(slowRoutine);

  const eventProgram = createProgram(controller.id, "EventProgram");
  const eventRoutine = createRoutine(eventProgram.id, "EventRoutine", "structured-text");
  eventRoutine.structuredText = "EventCount := EventCount + 1;";
  eventProgram.mainRoutineId = eventRoutine.id;
  eventProgram.routines.push(eventRoutine);

  const fastTask = createContinuousTask(controller.id, "FastPeriodic", [fastProgram.id]);
  fastTask.type = "periodic";
  fastTask.periodMs = 10;

  const slowTask = createContinuousTask(controller.id, "SlowPeriodic", [slowProgram.id]);
  slowTask.type = "periodic";
  slowTask.periodMs = 30;

  const eventTask = createContinuousTask(controller.id, "ExternalEvent", [eventProgram.id]);
  eventTask.type = "event";
  eventTask.eventInfo = { eventTrigger: "EVENT Instruction Only" };

  controller.programs.push(fastProgram, slowProgram, eventProgram);
  controller.tasks.push(fastTask, slowTask, eventTask);
  controller.controllerTags.push(
    createTag(controller.id, "FastCount", "DINT", { value: 0 }),
    createTag(controller.id, "SlowCount", "DINT", { value: 0 }),
    createTag(controller.id, "EventCount", "DINT", { value: 0 }),
  );
  project.controllers.push(controller);
  return project;
}

/** Program-scoped Structured Text accumulator: Acc := Acc + 2 (Acc is a program tag). */
function programScopedProject(initialValue = 0): PlcProject {
  const project = createProject("Scoped Line");
  const controller = createController(project.id, "ScopeCtl");
  const program = createProgram(controller.id, "P1");
  const routine = createRoutine(program.id, "AccRoutine", "structured-text");
  routine.structuredText = "Acc := Acc + 2;";
  program.mainRoutineId = routine.id;
  program.routines.push(routine);
  program.programTags.push(createTag(controller.id, "Acc", "DINT", { scope: "program", programId: program.id, value: initialValue }));
  controller.programs.push(program);
  controller.tasks.push(createContinuousTask(controller.id, "ScopeTask", [program.id]));
  project.controllers.push(controller);
  return project;
}

function metadataRuntimeProject(): PlcProject {
  const project = createProject("Metadata Runtime Line");
  const controller = createController(project.id, "MetaRuntimeCtl");
  controller.dataTypes.push({
    id: "udt-motor-status",
    name: "MotorStatus",
    members: [
      { name: "Running", dataType: "BOOL" },
      { name: "Speed", dataType: "DINT" },
    ],
  });

  const aoiRoutine = createRoutine("aoi-DBL", "Logic", "ladder");
  const aoiLadder = createLadderRoutine();
  aoiLadder.rungs.push(
    createRung(aoiLadder.id, 0, [
      createNode("ADD", [
        tagOperand("sourceA", "In"),
        tagOperand("sourceB", "In"),
        tagOperand("dest", "Out"),
      ]),
    ]),
  );
  aoiRoutine.ladder = aoiLadder;
  controller.addOnInstructions.push({
    id: "aoi-DBL",
    name: "DBL",
    parameters: [
      { name: "In", dataType: "DINT", usage: "Input" },
      { name: "Out", dataType: "DINT", usage: "Output" },
    ],
    localTags: [],
    routineNames: ["Logic"],
    routines: [aoiRoutine],
  });

  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(ladder.id, 0, [createNode("DBL", [tagOperand("instance", "DBL_01")])]));
  routine.ladder = ladder;
  program.mainRoutineId = routine.id;
  program.routines.push(routine);
  controller.programs.push(program);
  controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
  controller.controllerTags.push(
    createTag(controller.id, "Motor", "MotorStatus"),
    createTag(controller.id, "DBL_01", "DBL"),
  );
  project.controllers.push(controller);
  return project;
}

function runtimeText(project: PlcProject): string {
  const result = exportEscoRuntime(project, { builtAt: AT });
  expect(result.ok).toBe(true);
  return result.data!.text;
}

function loadedController(project: PlcProject, options = {}): EscoSoftController {
  const controller = new EscoSoftController({ now: () => AT, ...options });
  const result = controller.loadRuntimeText(runtimeText(project), "fixture.easruntime");
  expect(result.ok).toBe(true);
  return controller;
}

// --- identity --------------------------------------------------------------

describe("identity", () => {
  it("reports an honest software identity with the ESCO-SOFT-CTRL catalog", () => {
    const controller = new EscoSoftController({ controllerId: "soft-1", name: "Line SoftController", serialNumber: "SOFT-0001" });
    const identity = controller.getIdentity();
    expect(identity).toMatchObject({
      controllerId: "soft-1",
      name: "Line SoftController",
      catalogNumber: SOFT_CONTROLLER_CATALOG_NUMBER,
      runtimeVersion: SOFT_CONTROLLER_RUNTIME_VERSION,
      serialNumber: "SOFT-0001",
      vendor: SOFT_CONTROLLER_VENDOR,
      kind: "software",
    });
    expect(identity.firmwareRevision).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("generates a stable serial number and id when none is supplied", () => {
    const controller = new EscoSoftController();
    const identity = controller.getIdentity();
    expect(identity.serialNumber).toMatch(/^ESCO-SC-/);
    expect(identity.controllerId.length).toBeGreaterThan(0);
  });

  it("mirrors the current mode in identity.runtimeState", () => {
    const controller = loadedController(ladderProject());
    expect(controller.getIdentity().runtimeState).toBe("program");
    controller.startScan();
    expect(controller.getIdentity().runtimeState).toBe("run");
  });
});

// --- runtime loading -------------------------------------------------------

describe("runtime loading", () => {
  it("loads a valid checksummed .easruntime and enters Program mode", () => {
    const controller = new EscoSoftController({ now: () => AT });
    const result = controller.loadRuntimeText(runtimeText(ladderProject()), "soft-line.easruntime");

    expect(result.ok).toBe(true);
    expect(result.backup).toBeNull();
    expect(result.status.mode).toBe("program");
    expect(result.status.runtimeLoaded).toBe(true);
    expect(result.runtime).toMatchObject({ projectName: "Soft Line", controllerCount: 1, programCount: 1 });
    expect(result.runtime!.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.runtime!.scheduledRoutineCount).toBe(1);
  });

  it("rejects malformed JSON honestly and faults", () => {
    const controller = new EscoSoftController({ now: () => AT });
    const result = controller.loadRuntimeText("}{ not json", "bad.easruntime");

    expect(result.ok).toBe(false);
    expect(result.runtime).toBeNull();
    expect(result.status.mode).toBe("faulted");
    expect(result.status.faults[0]).toMatchObject({ type: "validation", source: "runtime-load", clearable: true });
    expect(result.status.faults[0]!.message).toMatch(/not valid JSON/i);
    // The validation fault is clearable; with no runtime loaded it recovers to stopped.
    expect(controller.clearFaults().status.mode).toBe("stopped");
  });

  it("rejects a tampered (checksum-mismatch) runtime", () => {
    const controller = new EscoSoftController({ now: () => AT });
    const file = JSON.parse(runtimeText(ladderProject()));
    file.runtime.identity.projectName = "Tampered";
    const result = controller.loadRuntimeText(JSON.stringify(file), "tampered.easruntime");

    expect(result.ok).toBe(false);
    expect(result.status.mode).toBe("faulted");
    expect(result.status.faults[0]!.message).toMatch(/integrity check failed/i);
  });

  it("rejects a wrong file extension", () => {
    const controller = new EscoSoftController({ now: () => AT });
    const result = controller.loadRuntimeText(runtimeText(ladderProject()), "soft-line.txt");
    expect(result.ok).toBe(false);
    expect(result.status.faults[0]!.message).toMatch(/must use the \.easruntime extension/i);
  });

  it("refuses to swap the runtime while scanning, and a clean load clears prior validation faults", () => {
    const controller = loadedController(ladderProject());
    controller.startScan();
    const blocked = controller.loadRuntimeText(runtimeText(counterProject()));
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/stop the controller/i);

    // Stop, fail a load (fault), then a clean load clears the load fault.
    controller.stopScan();
    expect(controller.loadRuntimeText("nope", "x.easruntime").status.mode).toBe("faulted");
    const recovered = controller.loadRuntimeText(runtimeText(counterProject()));
    expect(recovered.ok).toBe(true);
    expect(recovered.status.mode).toBe("program");
    expect(recovered.status.faults).toHaveLength(0);
  });
});

// --- modes / scan control --------------------------------------------------

describe("modes and scan control", () => {
  it("powers up Stopped with no runtime, and blocks Run until a runtime is loaded", () => {
    const controller = new EscoSoftController({ now: () => AT });
    expect(controller.getMode()).toBe("stopped");
    const run = controller.startScan();
    expect(run.ok).toBe(false);
    expect(run.message).toMatch(/requires a loaded ESCO runtime/i);
    expect(controller.getMode()).toBe("stopped");
  });

  it("transitions program -> run -> stopped", () => {
    const controller = loadedController(ladderProject());
    expect(controller.startScan().status.mode).toBe("run");
    expect(controller.isRunning()).toBe(true);
    expect(controller.stopScan().status.mode).toBe("stopped");
    expect(controller.isRunning()).toBe(false);
  });

  it("does not scan unless in Run mode", () => {
    const controller = loadedController(ladderProject());
    const result = controller.scanOnce();
    expect(result.ok).toBe(false);
    expect(result.scansExecuted).toBe(0);
    expect(controller.status().scanCount).toBe(0);
  });
});

// --- deterministic scanning ------------------------------------------------

describe("deterministic scan execution", () => {
  it("executes ladder logic against tag memory", () => {
    const controller = loadedController(ladderProject());
    controller.writeTag("StartPB", true);
    controller.startScan();

    const result = controller.scanOnce(10);
    expect(result.ok).toBe(true);
    expect(result.scansExecuted).toBe(1);
    expect(controller.readTag("MotorRun")).toBe(true);

    controller.writeTag("StartPB", false);
    controller.scanOnce(10);
    expect(controller.readTag("MotorRun")).toBe(false);
  });

  it("overwrites a manually-written output on the next scan (honest PLC behavior)", () => {
    const controller = loadedController(ladderProject());
    controller.startScan();
    controller.writeTag("MotorRun", true); // force an output high with the input low
    controller.scanOnce();
    expect(controller.readTag("MotorRun")).toBe(false);
  });

  it("counts deterministically across many scan ticks", () => {
    const controller = loadedController(counterProject());
    controller.startScan();
    expect(controller.scanOnce().ok).toBe(true);
    expect(controller.readTag("Count")).toBe(1);
    const batch = controller.runScans(4);
    expect(batch.scansExecuted).toBe(4);
    expect(controller.readTag("Count")).toBe(5);
    expect(controller.status().scanCount).toBe(5);
  });

  it("uses modeled periodic task release cadence and holds event tasks offline", () => {
    const controller = loadedController(scheduledCounterProject());
    controller.startScan();

    const batch = controller.runScans(3, 10);
    expect(batch.ok).toBe(true);
    expect(batch.scansExecuted).toBe(3);
    expect(controller.readTag("FastCount")).toBe(3);
    expect(controller.readTag("SlowCount")).toBe(1);
    expect(controller.readTag("EventCount")).toBe(0);
    expect(batch.lastScanEvidence?.softwareOnly).toBe(true);
    expect(batch.lastScanEvidence?.heldEventTaskKeys).toHaveLength(1);
    expect(batch.lastScanEvidence?.triggeredEventTaskKeys).toHaveLength(0);

    controller.scanOnce(10);
    expect(controller.readTag("FastCount")).toBe(4);
    expect(controller.readTag("SlowCount")).toBe(2);
    expect(controller.readTag("EventCount")).toBe(0);

    const queued = controller.triggerEventTask("ExternalEvent");
    expect(queued.ok).toBe(true);
    expect(controller.status().pendingEventTaskTriggers).toEqual(["ExternalEvent"]);

    const eventScan = controller.scanOnce(10);
    expect(eventScan.ok).toBe(true);
    expect(controller.readTag("FastCount")).toBe(5);
    expect(controller.readTag("SlowCount")).toBe(2);
    expect(controller.readTag("EventCount")).toBe(1);
    expect(eventScan.lastScanEvidence?.triggeredEventTaskKeys).toHaveLength(1);
    expect(eventScan.lastScanEvidence?.heldEventTaskKeys).toHaveLength(0);
    expect(controller.status().pendingEventTaskTriggers).toEqual([]);

    const heldAgain = controller.scanOnce(10);
    expect(heldAgain.lastScanEvidence?.triggeredEventTaskKeys).toHaveLength(0);
    expect(heldAgain.lastScanEvidence?.heldEventTaskKeys).toHaveLength(1);
    expect(controller.readTag("EventCount")).toBe(1);
  });

  it("reset restores power-up state and the scan counter", () => {
    const controller = loadedController(counterProject());
    controller.startScan();
    controller.runScans(7);
    expect(controller.readTag("Count")).toBe(7);

    const reset = controller.resetScan();
    expect(reset.status.mode).toBe("program");
    expect(controller.readTag("Count")).toBe(0);
    expect(controller.status().scanCount).toBe(0);
  });

  it("loads UDT member paths and executable AOI logic from .easruntime metadata", () => {
    const controller = loadedController(metadataRuntimeProject());

    expect(controller.readTag("Motor.Running")).toBe(false);
    expect(controller.readTag("Motor.Speed")).toBe(0);
    expect(controller.writeTag("DBL_01.In", 11).ok).toBe(true);
    controller.startScan();
    expect(controller.scanOnce(10).ok).toBe(true);
    expect(controller.readTag("DBL_01.Out")).toBe(22);
  });
});

// --- software force table --------------------------------------------------

describe("software force table", () => {
  it("forces an input before scan so logic uses the forced value", () => {
    const controller = loadedController(ladderProject());
    const forced = controller.forceTag("StartPB", true);
    expect(forced.ok).toBe(true);
    expect(forced.status.forceCount).toBe(1);
    expect(controller.listForces()).toEqual([{ path: "StartPB", value: true }]);

    controller.startScan();
    controller.scanOnce();
    expect(controller.readTag("StartPB")).toBe(true);
    expect(controller.readTag("MotorRun")).toBe(true);
  });

  it("forces an output after scan and resumes normal logic once cleared", () => {
    const controller = loadedController(ladderProject());
    expect(controller.forceTag("MotorRun", true).ok).toBe(true);
    controller.startScan();
    controller.scanOnce();
    expect(controller.readTag("MotorRun")).toBe(true);

    const cleared = controller.clearForce("MotorRun");
    expect(cleared.ok).toBe(true);
    expect(cleared.status.forceCount).toBe(0);
    controller.scanOnce();
    expect(controller.readTag("MotorRun")).toBe(false);
  });

  it("normalizes program-scoped force paths and clears all forces", () => {
    const controller = loadedController(programScopedProject());
    expect(controller.forceTag("P1::Acc", 100).ok).toBe(true);
    expect(controller.listForces()).toEqual([{ path: "Program:P1.Acc", value: 100 }]);
    controller.startScan();
    controller.scanOnce();
    expect(controller.readTag("Program:P1.Acc")).toBe(100);

    const cleared = controller.clearForces();
    expect(cleared.ok).toBe(true);
    expect(cleared.status.forceCount).toBe(0);
    controller.scanOnce();
    expect(controller.readTag("Program:P1.Acc")).toBe(102);
  });

  it("clears the software force table when a new runtime is loaded", () => {
    const controller = loadedController(ladderProject());
    expect(controller.forceTag("StartPB", true).status.forceCount).toBe(1);
    const loaded = controller.loadRuntimeText(runtimeText(counterProject()), "counter.easruntime");
    expect(loaded.ok).toBe(true);
    expect(loaded.status.forceCount).toBe(0);
    expect(controller.listForces()).toEqual([]);
  });
});

// --- tag scoping -----------------------------------------------------------

describe("controller- and program-scoped tag paths", () => {
  it("reads/writes a program-scoped tag via every path form", () => {
    const controller = loadedController(programScopedProject());
    controller.startScan();
    controller.runScans(3);

    const canonical = programTagPath("P1", "Acc");
    expect(controller.readTag(canonical)).toBe(6);
    expect(controller.readTag("P1::Acc")).toBe(6);
    expect(controller.readTag("Program:P1.Acc")).toBe(6);
  });

  it("lists addressable tag paths with scope metadata", () => {
    const controller = loadedController(programScopedProject());
    const acc = controller.listTags().find((tag) => tag.name === "Acc");
    expect(acc).toMatchObject({ scope: "program", programName: "P1", path: "Program:P1.Acc", dataType: "DINT" });
  });

  it("restores authored program-scoped initial values on load and reset", () => {
    const controller = loadedController(programScopedProject(10));
    expect(controller.readTag("Program:P1.Acc")).toBe(10);
    controller.startScan();
    controller.runScans(2);
    expect(controller.readTag("Program:P1.Acc")).toBe(14);

    const reset = controller.resetScan();
    expect(reset.status.mode).toBe("program");
    expect(controller.readTag("Program:P1.Acc")).toBe(10);
  });

  it("rejects writes to unknown tag paths", () => {
    const controller = loadedController(ladderProject());
    const result = controller.writeTag("DoesNotExist", true);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/unknown tag path/i);
  });
});

// --- faults ----------------------------------------------------------------

describe("fault model", () => {
  it("blocks Run while a fault is active", () => {
    const controller = loadedController(ladderProject());
    controller.injectFault({ message: "simulated runtime fault", clearable: true });
    expect(controller.getMode()).toBe("faulted");
    const run = controller.startScan();
    expect(run.ok).toBe(false);
    expect(run.message).toMatch(/clear active faults/i);
  });

  it("keeps a non-clearable fault after Clear Faults", () => {
    const controller = loadedController(ladderProject());
    controller.injectFault({ message: "hard runtime fault", clearable: false, code: "SC-HARD" });
    const cleared = controller.clearFaults();
    expect(cleared.ok).toBe(false);
    expect(cleared.status.mode).toBe("faulted");
    expect(cleared.status.faults).toHaveLength(1);
  });

  it("recovers to Program mode once all faults clear", () => {
    const controller = loadedController(ladderProject());
    controller.injectFault({ message: "transient", clearable: true });
    const cleared = controller.clearFaults();
    expect(cleared.ok).toBe(true);
    expect(cleared.status.mode).toBe("program");
    expect(controller.startScan().status.mode).toBe("run");
  });
});

// --- tag subscriptions -----------------------------------------------------

describe("tag subscriptions", () => {
  it("publishes value changes from scans", () => {
    const controller = loadedController(ladderProject());
    const seen: string[] = [];
    controller.subscribeTag("MotorRun", (value, path) => seen.push(`${path}=${String(value)}`));
    controller.writeTag("StartPB", true);
    controller.startScan();
    controller.scanOnce();
    expect(seen).toEqual(["MotorRun=true"]);
  });
});

// --- controller image (upload) ---------------------------------------------

describe("controller image export", () => {
  it("exports a checksummed image with identity, runtime, and tag state", () => {
    const controller = loadedController(counterProject());
    controller.startScan();
    controller.runScans(3);

    const image = controller.exportImage();
    expect(image.formatName).toBe("ESCO SoftController Image");
    expect(image.identity.catalogNumber).toBe(SOFT_CONTROLLER_CATALOG_NUMBER);
    expect(image.runtime?.projectName).toBe("Counter Line");
    expect(image.runtimeText).toContain("ESCO Automation Studio Runtime");
    expect(image.runtimeChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(image.tags.Count).toBe(3);
    expect(image.scan).toEqual({ count: 3, lastScanMs: controller.status().lastScanMs });
    expect(image.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("serializes to deterministic JSON whose embedded runtime re-parses cleanly", () => {
    const controller = loadedController(ladderProject());
    const text = controller.serializeImage();
    const parsed = JSON.parse(text);
    expect(parsed.formatName).toBe("ESCO SoftController Image");
    // The embedded runtime text is itself a valid, checksummed .easruntime.
    const reloaded = parseRuntimeFile(parsed.runtimeText);
    expect(reloaded.ok).toBe(true);
    expect(reloaded.checksum?.valid).toBe(true);
  });

  it("captures a rollback backup of the prior image when a runtime is replaced", () => {
    const controller = loadedController(counterProject());
    controller.startScan();
    controller.runScans(2);
    controller.stopScan();

    const result = controller.loadRuntimeText(runtimeText(ladderProject()));
    expect(result.ok).toBe(true);
    expect(result.backup).not.toBeNull();
    expect(result.backup!.runtime?.projectName).toBe("Counter Line");
    expect(result.backup!.tags.Count).toBe(2);
    expect(result.status.backupAvailable).toBe(true);
    expect(result.status.backup.projectName).toBe("Counter Line");
  });
});

// --- restore / rollback ----------------------------------------------------

describe("restore previous runtime", () => {
  it("blocks cleanly when no backup is available", () => {
    const controller = loadedController(ladderProject());

    const result = controller.restorePreviousRuntime();

    expect(result.restored).toBe(false);
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toBe("no-backup");
    expect(result.audit.physicalHardware).toBe(false);
    expect(result.audit.backupAvailable).toBe(false);
    expect(result.status.runtime?.projectName).toBe("Soft Line");
    expect(result.status.backupAvailable).toBe(false);
  });

  it("restores the prior runtime and preserves rollback audit data", () => {
    const controller = loadedController(counterProject());
    controller.startScan();
    controller.runScans(2);
    controller.stopScan();

    const replacement = controller.loadRuntimeText(runtimeText(ladderProject()));
    expect(replacement.ok).toBe(true);
    expect(controller.status().runtime?.projectName).toBe("Soft Line");
    expect(controller.status().backup.projectName).toBe("Counter Line");

    const restored = controller.restorePreviousRuntime();

    expect(restored.restored).toBe(true);
    expect(restored.outcome).toBe("success");
    expect(restored.audit.imageChecksumValid).toBe(true);
    expect(restored.audit.runtimeChecksumValid).toBe(true);
    expect(restored.audit.physicalHardware).toBe(false);
    expect(restored.audit.restoredProjectName).toBe("Counter Line");
    expect(restored.status.runtime?.projectName).toBe("Counter Line");
    expect(controller.readTag("Count")).toBe(2);
    expect(restored.status.backupAvailable).toBe(true);
    expect(restored.status.backup.projectName).toBe("Soft Line");
  });

  it("rejects a corrupt rollback image without changing the loaded runtime", () => {
    const controller = loadedController(counterProject());
    const replacement = controller.loadRuntimeText(runtimeText(ladderProject()));
    expect(replacement.ok).toBe(true);
    const corrupt = controller.getRollbackBackupImage();
    expect(corrupt).not.toBeNull();
    corrupt!.tags.Count = 99;

    const restored = controller.restoreControllerImage(corrupt!);

    expect(restored.restored).toBe(false);
    expect(restored.outcome).toBe("failed");
    expect(restored.reason).toBe("corrupt-backup");
    expect(restored.audit.imageChecksumValid).toBe(false);
    expect(restored.audit.runtimeChecksumValid).toBe(false);
    expect(restored.audit.physicalHardware).toBe(false);
    expect(controller.status().runtime?.projectName).toBe("Soft Line");
    expect(controller.status().backup.projectName).toBe("Counter Line");
  });
});

// --- project-actions adapter ----------------------------------------------

describe("project-actions SoftControllerTarget adapter", () => {
  it("lets downloadToSoftController target the executable scan-capable controller", () => {
    const controller = new EscoSoftController({ now: () => AT });
    const target = new EscoSoftControllerTargetAdapter(controller, { createBackupId: () => "bak-1" });

    const result = downloadToSoftController(ladderProject(), target, {
      builtAt: AT,
      now: () => AT,
      createId: () => "audit-1",
      returnToMode: "program",
    });

    expect(result.ok).toBe(true);
    expect(result.audit.physicalHardware).toBe(false);
    expect(target.identify().isPhysicalHardware).toBe(false);
    expect(controller.status().runtime?.projectName).toBe("Soft Line");

    controller.writeTag("StartPB", true);
    controller.startScan();
    expect(controller.scanOnce(10).ok).toBe(true);
    expect(controller.readTag("MotorRun")).toBe(true);
  });
});
