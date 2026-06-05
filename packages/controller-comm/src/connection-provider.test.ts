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
import { addRung, appendInstruction, createLadderRoutine } from "@esco/ladder";
import { exportEscoRuntime, uploadFromSoftController } from "@esco/project-actions";
import {
  EscoSoftControllerConnectionProvider,
  NoHardwareConnectionProvider,
  SimulatorConnectionProvider,
  UnsupportedControllerConnectionError,
} from "./connection-provider";

const AT = "2026-06-03T12:00:00.000Z";

function runnableProject(name = "Provider Line"): PlcProject {
  const project = createProject(name);
  const controller = createController(project.id, "ProviderCtl");
  controller.processorType = "ESCO-SOFT-CTRL";
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

function runtimeText(project = runnableProject()): string {
  const exported = exportEscoRuntime(project, { builtAt: AT });
  expect(exported.ok).toBe(true);
  return exported.data!.text;
}

describe("controller connection providers", () => {
  it("connects to the simulator without enabling real hardware operations", async () => {
    const provider = new SimulatorConnectionProvider({
      now: () => "2026-06-03T12:00:00.000Z",
      initialTags: { StartPB: false, Speed: 1200 },
    });

    const session = await provider.connect({ target: "local-sim", runtimeMode: "hmi-preview" });

    expect(session).toMatchObject({
      providerId: "esco.simulator",
      providerName: "ESCO Simulator",
      providerKind: "simulator",
      state: "simulation",
      runtimeMode: "hmi-preview",
      connectedAt: "2026-06-03T12:00:00.000Z",
      target: "local-sim",
    });
    expect(session.capabilities).toMatchObject({
      realControllerIo: false,
      verified: false,
      readTags: true,
      writeTags: true,
      subscribeTags: true,
      browseNetwork: false,
      discoverModules: false,
      upload: false,
      download: false,
      restoreBackup: false,
      onlineEdit: false,
      modeChange: false,
      clearFaults: false,
    });
    expect(await provider.readTag(session.sessionId, "StartPB")).toBe(false);
    expect(await provider.readTag(session.sessionId, "Speed")).toBe(1200);
  });

  it("publishes simulator tag writes to subscribers and stops after unsubscribe", async () => {
    const provider = new SimulatorConnectionProvider({ initialTags: { MotorRun: false } });
    const session = await provider.connect();
    const seen: string[] = [];
    const unsubscribe = provider.subscribeTag(session.sessionId, "MotorRun", (value, tagPath) => {
      seen.push(`${tagPath}=${String(value)}`);
    });

    await provider.writeTag(session.sessionId, "MotorRun", true);
    unsubscribe();
    await provider.writeTag(session.sessionId, "MotorRun", false);

    expect(seen).toEqual(["MotorRun=true"]);
    expect(await provider.readTag(session.sessionId, "MotorRun")).toBe(false);
  });

  it("rejects simulator reads after disconnect so stale sessions cannot look alive", async () => {
    const provider = new SimulatorConnectionProvider();
    const session = await provider.connect();
    await provider.disconnect(session.sessionId);

    await expect(provider.readTag(session.sessionId, "StartPB")).rejects.toThrow(/not active/i);
  });

  it("runs the ESCO SoftController download, tag, scan, and upload reconstruction path", async () => {
    const provider = new EscoSoftControllerConnectionProvider({ now: () => AT });
    const session = await provider.connect({ target: "local-soft-controller" });

    expect(session).toMatchObject({
      providerId: "esco.soft-controller",
      providerName: "ESCO SoftController",
      providerKind: "soft-controller",
      state: "soft-controller-connected",
      runtimeMode: "soft-controller",
      connectedAt: AT,
      target: "local-soft-controller",
    });
    expect(session.capabilities).toMatchObject({
      realControllerIo: false,
      verified: true,
      upload: true,
      download: true,
      restoreBackup: true,
      modeChange: true,
      clearFaults: true,
      readTags: true,
      writeTags: true,
      subscribeTags: true,
      browseNetwork: false,
      discoverModules: false,
      onlineEdit: false,
    });
    expect(session.backupAvailable).toBe(false);
    expect(session.rollbackBackup?.available).toBe(false);

    const downloaded = await provider.downloadRuntimePackage!(
      session.sessionId,
      runtimeText(),
      "provider-line.easruntime",
    );
    expect(downloaded).toMatchObject({
      state: "soft-controller-connected",
      runtimeMode: "soft-controller",
      runtimeLoaded: true,
      mode: "program",
    });
    expect(downloaded.runtimeChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(downloaded.backupAvailable).toBe(false);

    const seen: string[] = [];
    const unsubscribe = provider.subscribeTag(session.sessionId, "MotorRun", (value, tagPath) => {
      seen.push(`${tagPath}=${String(value)}`);
    });
    await provider.writeTag(session.sessionId, "StartPB", true);
    await provider.setMode!(session.sessionId, "run");
    const scanned = await provider.scanOnce!(session.sessionId, 10);

    expect(scanned.mode).toBe("run");
    expect(await provider.readTag(session.sessionId, "MotorRun")).toBe(true);
    expect(seen).toEqual(["MotorRun=true"]);
    unsubscribe();

    const snapshot = await provider.uploadControllerImage!(session.sessionId);
    expect(snapshot.runtimeText).toContain("ESCO Automation Studio Runtime");
    const upload = uploadFromSoftController(
      {
        connected: true,
        identity: snapshot.identity,
        runtimeImage: snapshot.runtimeText ?? undefined,
        installedAt: snapshot.runtime?.loadedAt,
      },
      { uploadedAt: AT, fileName: "provider-line-upload.easruntime" },
    );
    expect(upload.ok).toBe(true);
    expect(upload.project.name).toBe("Provider Line");
    expect(upload.data?.preview.counts.tags).toBe(2);
    expect(upload.data?.checksumValid).toBe(true);
    expect(upload.project.provenance?.sourceType).toBe("esco-softcontroller-upload");
  });

  it("tracks backup availability and restores the previous runtime through the SoftController provider", async () => {
    const provider = new EscoSoftControllerConnectionProvider({ now: () => AT });
    const session = await provider.connect();

    const noBackup = await provider.restorePreviousRuntime!(session.sessionId);
    expect(noBackup.restored).toBe(false);
    expect(noBackup.outcome).toBe("blocked");
    expect(noBackup.reason).toBe("no-backup");
    expect(noBackup.backupAvailable).toBe(false);
    expect(noBackup.audit.physicalHardware).toBe(false);

    const first = await provider.downloadRuntimePackage!(
      session.sessionId,
      runtimeText(runnableProject("Provider Line")),
      "provider-line.easruntime",
    );
    expect(first.backupAvailable).toBe(false);

    const second = await provider.downloadRuntimePackage!(
      session.sessionId,
      runtimeText(runnableProject("Replacement Line")),
      "replacement-line.easruntime",
    );
    expect(second.backupAvailable).toBe(true);
    expect(second.rollbackBackup).toMatchObject({
      available: true,
      projectName: "Provider Line",
    });

    const restored = await provider.restorePreviousRuntime!(session.sessionId);
    expect(restored.restored).toBe(true);
    expect(restored.outcome).toBe("success");
    expect(restored.audit.imageChecksumValid).toBe(true);
    expect(restored.audit.runtimeChecksumValid).toBe(true);
    expect(restored.audit.restoredProjectName).toBe("Provider Line");
    expect(restored.backupAvailable).toBe(true);
    expect(restored.rollbackBackup?.projectName).toBe("Replacement Line");

    const snapshot = await provider.uploadControllerImage!(session.sessionId);
    expect(snapshot.runtime?.projectName).toBe("Provider Line");
  });

  it("keeps the no-hardware provider fully unsupported with clear errors", async () => {
    const provider = new NoHardwareConnectionProvider();

    expect(Object.values(provider.capabilities).every((enabled) => enabled === false)).toBe(true);
    await expect(provider.connect()).rejects.toThrow(UnsupportedControllerConnectionError);
    await expect(provider.readTag("missing", "StartPB")).rejects.toThrow(/no verified hardware adapter/i);
    await expect(provider.writeTag("missing", "StartPB", true)).rejects.toThrow(/no verified hardware adapter/i);
    await expect(provider.restorePreviousRuntime("missing")).rejects.toThrow(/no verified hardware adapter/i);
    expect(() => provider.subscribeTag("missing", "StartPB", () => {})).toThrow(/no verified hardware adapter/i);
  });
});
