import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type IoModule,
  type PlcProject,
} from "@esco/core";
import { addRung, appendInstruction, createLadderRoutine, routineNodes } from "@esco/ladder";
import { exportEscoRuntime } from "./runtime-actions";
import { serializeRuntime } from "./runtime-format";
import { buildRuntime } from "./runtime-build";
import {
  createDefaultHmiProject,
  createHmiElement,
  createHmiScreen,
  getHmiProject,
  type HmiProject,
} from "@esco/hmi-model";
import {
  previewSoftControllerUpload,
  uploadFromSoftController,
  type SoftControllerImage,
} from "./softcontroller-upload";

const AT = "2026-06-03T12:00:00.000Z";
const INSTALLED_AT = "2026-06-03T11:00:00.000Z";

/** A project with two programs (ladder + ST), tags, an I/O module, and HMI screens. */
function richProject(): PlcProject {
  const project = createProject("Line A", "SoftController upload test");
  const controller = createController(project.id, "LineCtl");
  controller.processorType = "ESCO-SOFT-CTRL";
  controller.catalogNumber = "ESCO-SOFT-CTRL";
  controller.firmwareRevision = "1.0.0";

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
  stRoutine.structuredText = "MotorRun := StartPB AND NOT StopPB;";
  aux.mainRoutineId = stRoutine.id;
  aux.routines.push(stRoutine);

  controller.programs.push(main, aux);
  controller.tasks.push(createContinuousTask(controller.id, "MainTask", [main.id, aux.id]));
  controller.controllerTags.push(
    createTag(controller.id, "StartPB", "BOOL", { value: false }),
    createTag(controller.id, "StopPB", "BOOL", { value: false }),
    createTag(controller.id, "MotorRun", "BOOL", { value: false }),
  );

  const ioModule: IoModule = {
    id: "iomod-seed",
    name: "DI_Card",
    catalogNumber: "ESCO-IB16",
    slot: 1,
    description: "Digital input card",
    parentModule: "DI_Card",
    parentPortId: "1",
    commPath: "Local,1",
    vendor: "ESCO Automation",
    majorRevision: "1",
    minorRevision: "2",
    electronicKeying: "CompatibleModule",
    majorFault: true,
    ports: [{ id: "1", type: "Backplane", address: "1", upstream: true, busSize: 17, safetyNetwork: "16#0000_0001" }],
    connections: [
      {
        name: "Input",
        rpi: 20000,
        type: "Input",
        priority: "Scheduled",
        unicast: true,
        eventId: 7,
        programmaticallySendEventTrigger: true,
        inputConnectionType: "Unicast",
        inputProductionTrigger: "Cyclic",
      },
    ],
  };
  (ioModule as IoModule & { profileChannels?: { id?: string; label?: string; enabled?: boolean; dataFormat?: string }[] }).profileChannels = [
    { id: "Ch0", label: "Channel 0", enabled: false, dataFormat: "Input" },
  ];
  controller.ioConfiguration.modules.push(ioModule);

  project.controllers.push(controller);
  return project;
}

/** Build the `.easruntime` image text a SoftController would hold after a download. */
function runtimeImageText(project = richProject()): string {
  const exported = exportEscoRuntime(project, {
    builtAt: AT,
    hmi: { screenCount: 2, screenNames: ["Overview", "Alarms"] },
  });
  expect(exported.ok).toBe(true);
  return exported.data!.text;
}

function hmiProjectSnapshot(): HmiProject {
  const hmi = createDefaultHmiProject("Line A HMI");
  const overview = createHmiScreen("Overview");
  const alarms = createHmiScreen("Alarms");
  const lamp = createHmiElement("common.indicator-lamp", "MotorRunLamp");
  lamp.bindings.push({
    id: "bind-motor-run",
    targetProperty: "value",
    source: { kind: "tag", path: "MotorRun" },
    mode: "read",
  });
  overview.elements.push(lamp);
  hmi.screens.push(overview, alarms);
  hmi.homeScreenId = overview.id;
  return hmi;
}

function runtimeImageTextWithHmiProject(project = richProject()): string {
  const exported = exportEscoRuntime(project, {
    builtAt: AT,
    hmiProject: hmiProjectSnapshot(),
  });
  expect(exported.ok).toBe(true);
  return exported.data!.text;
}

const SOFT_IDENTITY = {
  name: "ESCO SoftController",
  serialNumber: "ESCO-SN-0001",
  firmwareRevision: "1.0.0",
  catalogNumber: "ESCO-SOFT-CTRL",
  vendor: "ESCO Automation",
};

function connectedImage(overrides: Partial<SoftControllerImage> = {}): SoftControllerImage {
  return {
    connected: true,
    identity: SOFT_IDENTITY,
    runtimeImage: runtimeImageText(),
    installedAt: INSTALLED_AT,
    ...overrides,
  };
}

describe("uploadFromSoftController — success", () => {
  it("reconstructs an ESCO project model from a valid downloaded runtime image", () => {
    const result = uploadFromSoftController(connectedImage(), { uploadedAt: AT });
    expect(result.ok).toBe(true);
    expect(result.project.name).toBe("Line A");

    const controller = result.project.controllers[0]!;
    expect(controller.name).toBe("LineCtl");
    expect(controller.programs.length).toBe(2);
    expect(controller.programs.flatMap((p) => p.routines).length).toBe(2);
    // Routine bodies restored as editable ladder AST when the runtime rung text parses cleanly.
    const mainRoutine = controller.programs[0]!.routines[0]!;
    expect(mainRoutine.ladder).toBeDefined();
    expect(routineNodes(mainRoutine.ladder as ReturnType<typeof createLadderRoutine>).map((node) => node.instructionType)).toEqual([
      "XIC",
      "OTE",
    ]);
    expect(mainRoutine.sourceText).toBeUndefined();
  });

  it("reconstructs tags, I/O modules, and surfaces HMI references in the preview counts", () => {
    const result = uploadFromSoftController(connectedImage(), { uploadedAt: AT });
    const preview = result.data!.preview;
    expect(preview.counts.tags).toBe(4); // 3 controller + 1 program tag
    expect(preview.counts.ioModules).toBe(1);
    expect(preview.counts.routines).toBe(2);
    expect(preview.counts.hmiReferences).toBe(2);
    expect(result.data!.hmiReferences).toEqual(["Overview", "Alarms"]);

    // I/O reconstructed as offline metadata (catalog/identity, not live connections).
    const module = result.project.controllers[0]!.ioConfiguration.modules[0]!;
    expect(module.name).toBe("DI_Card");
    expect(module.catalogNumber).toBe("ESCO-IB16");
    expect(module.majorRevision).toBe("1");
    expect(module.description).toBe("Digital input card");
    expect(module.parentModule).toBe("DI_Card");
    expect(module.parentPortId).toBe("1");
    expect(module.commPath).toBe("Local,1");
    expect(module.electronicKeying).toBe("CompatibleModule");
    expect(module.majorFault).toBe(true);
    expect(module.ports).toEqual([
      { id: "1", type: "Backplane", address: "1", upstream: true, busSize: 17, safetyNetwork: "16#0000_0001" },
    ]);
    expect(module.connections).toEqual([
      {
        name: "Input",
        rpi: 20000,
        type: "Input",
        priority: "Scheduled",
        unicast: true,
        eventId: 7,
        programmaticallySendEventTrigger: true,
        inputConnectionType: "Unicast",
        inputProductionTrigger: "Cyclic",
      },
    ]);
    expect((module as IoModule & { profileChannels?: unknown[] }).profileChannels).toEqual([
      { id: "Ch0", label: "Channel 0", enabled: false, dataFormat: "Input" },
    ]);
  });

  it("reconstructs a full HMI project snapshot from snapshot-capable runtimes", () => {
    const result = uploadFromSoftController(
      connectedImage({ runtimeImage: runtimeImageTextWithHmiProject() }),
      { uploadedAt: AT },
    );

    expect(result.ok).toBe(true);
    expect(result.data!.hmiProjectReconstructed).toBe(true);
    expect(result.data!.preview.hmiProjectReconstructed).toBe(true);
    expect(result.data!.preview.counts.hmiReferences).toBe(2);
    const hmi = getHmiProject(result.project);
    expect(hmi?.name).toBe("Line A HMI");
    expect(hmi?.screens.map((screen) => screen.name)).toEqual(["Overview", "Alarms"]);
    expect(hmi?.screens[0]?.elements[0]?.bindings[0]?.source.path).toBe("MotorRun");
    expect(result.warnings?.some((warning) => /Reconstructed HMI project snapshot/i.test(warning))).toBe(true);
    expect(result.warnings?.some((warning) => /not reconstructed by upload/i.test(warning))).toBe(false);
  });

  it("verifies the runtime image checksum on read", () => {
    const result = uploadFromSoftController(connectedImage(), { uploadedAt: AT });
    expect(result.data!.checksumValid).toBe(true);
    expect(result.data!.preview.runtimeChecksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stamps honest, read-only SoftController provenance (source/serial/version/checksum/uploadedAt)", () => {
    const result = uploadFromSoftController(connectedImage(), { uploadedAt: AT, fileName: "line-a.easruntime" });
    const provenance = result.project.provenance!;
    expect(provenance.sourceType).toBe("esco-softcontroller-upload");
    expect(provenance.importedAt).toBe(AT);
    expect(provenance.fileName).toBe("line-a.easruntime");
    expect(provenance.softController).toMatchObject({
      serialNumber: "ESCO-SN-0001",
      firmwareRevision: "1.0.0",
      catalogNumber: "ESCO-SOFT-CTRL",
      runtimeVersion: "1.0.0",
      uploadedAt: AT,
    });
    expect(provenance.softController!.runtimeChecksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("warns about runtime-only data that cannot be fully reconstructed", () => {
    const result = uploadFromSoftController(connectedImage(), { uploadedAt: AT });
    const warnings = result.warnings ?? [];
    expect(warnings.some((w) => /read-only/i.test(w))).toBe(true);
    expect(warnings.some((w) => /I\/O module/i.test(w))).toBe(true);
    expect(warnings.some((w) => /HMI screen reference/i.test(w))).toBe(true);
    expect(warnings.some((w) => /power-up state/i.test(w))).toBe(true);
    expect(result.data!.preview.counts.warnings).toBe(warnings.length);
  });

  it("falls back to read-only ladder source and warns when rung parsing is lossy", () => {
    const runtime = buildRuntime(richProject(), { builtAt: AT }).runtime!;
    const routine = runtime.controllers[0]!.tasks[0]!.programs[0]!.routines[0]!;
    expect(routine.payload.kind).toBe("ladder");
    if (routine.payload.kind === "ladder") {
      routine.payload.rungs[0]!.text = "[XIC(StartPB)";
    }
    const result = uploadFromSoftController(
      connectedImage({ runtimeImage: serializeRuntime(runtime) }),
      { uploadedAt: AT },
    );

    expect(result.ok).toBe(true);
    const restoredRoutine = result.project.controllers[0]!.programs[0]!.routines[0]!;
    expect(restoredRoutine.ladder).toBeUndefined();
    expect(restoredRoutine.sourceText).toContain("[XIC(StartPB)");
    expect(result.warnings?.some((warning) => /could not be reconstructed as editable AST/i.test(warning))).toBe(true);
  });

  it("reconstructs a project that validates without blocking errors", () => {
    const result = uploadFromSoftController(connectedImage(), { uploadedAt: AT });
    const errors = (result.findings ?? []).filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
  });

  it("makes no physical-hardware claim in its messages or provenance", () => {
    const result = uploadFromSoftController(connectedImage(), { uploadedAt: AT });
    const text = JSON.stringify({ warnings: result.warnings, preview: result.data!.preview });
    expect(text).not.toMatch(/physical (hardware|controller)/i);
    expect(text).not.toMatch(/\.ACD|L5X/i);
  });
});

describe("uploadFromSoftController — failure paths", () => {
  it("fails cleanly when the SoftController is disconnected", () => {
    const result = uploadFromSoftController(connectedImage({ connected: false }), { uploadedAt: AT });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/disconnected/i);
    expect(result.data).toBeUndefined();
  });

  it("fails cleanly when the SoftController is empty (no downloaded project)", () => {
    const result = uploadFromSoftController(connectedImage({ runtimeImage: undefined }), { uploadedAt: AT });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty|no project has been downloaded/i);
  });

  it("treats a blank runtime image as an empty controller", () => {
    const result = uploadFromSoftController(connectedImage({ runtimeImage: "   " }), { uploadedAt: AT });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it("fails cleanly on a corrupt (tampered) runtime image", () => {
    const file = JSON.parse(runtimeImageText());
    file.runtime.identity.projectName = "Tampered";
    const result = uploadFromSoftController(connectedImage({ runtimeImage: JSON.stringify(file) }), { uploadedAt: AT });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/corrupt esco softcontroller runtime image/i);
    expect(result.error).toMatch(/integrity check failed/i);
  });

  it("fails cleanly on a non-runtime / malformed image", () => {
    const result = uploadFromSoftController(connectedImage({ runtimeImage: "}{ not json" }), { uploadedAt: AT });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/corrupt esco softcontroller runtime image/i);
  });
});

describe("previewSoftControllerUpload", () => {
  it("returns the reconstruction preview without committing a project", () => {
    const preview = previewSoftControllerUpload(connectedImage(), { uploadedAt: AT });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.preview.projectName).toBe("Line A");
      expect(preview.preview.controllerName).toBe("LineCtl");
      expect(preview.preview.serialNumber).toBe("ESCO-SN-0001");
      expect(preview.preview.installedAt).toBe(INSTALLED_AT);
      expect(preview.preview.counts.programs).toBe(2);
    }
  });

  it("surfaces the clean error for an empty controller", () => {
    const preview = previewSoftControllerUpload(connectedImage({ runtimeImage: undefined }), { uploadedAt: AT });
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.error).toMatch(/empty/i);
  });
});

describe("uploadFromSoftController — round-trips a runtime built directly", () => {
  it("reconstructs from a serialized runtime payload (not just exported text)", () => {
    const built = buildRuntime(richProject(), { builtAt: AT });
    const text = serializeRuntime(built.runtime!);
    const result = uploadFromSoftController({ connected: true, runtimeImage: text }, { uploadedAt: AT });
    expect(result.ok).toBe(true);
    expect(result.project.controllers[0]!.programs.length).toBe(2);
  });
});
