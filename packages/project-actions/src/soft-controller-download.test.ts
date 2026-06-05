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
import { createDefaultHmiProject, createHmiScreen } from "@esco/hmi-model";
import { addRung, appendInstruction, createLadderRoutine } from "@esco/ladder";
import {
  InMemorySoftController,
  ESCO_SOFT_CONTROLLER_PLATFORM,
  type SoftControllerApplyInput,
  type SoftControllerBackup,
  type SoftControllerTargetIdentity,
  type SoftControllerReceiveResult,
  type SoftControllerTarget,
} from "./soft-controller";
import {
  compareTarget,
  downloadToSoftController,
  projectTargetIdentity,
} from "./soft-controller-download";
import { buildRuntime } from "./runtime-build";
import { parseRuntimeFile, serializeRuntime } from "./runtime-format";

const AT = "2026-06-03T12:00:00.000Z";

/** A small, valid project: one controller, one ladder routine with a rung. */
function validProject(name = "Line A"): PlcProject {
  const project = createProject(name, "SoftController download test");
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

  controller.programs.push(main);
  controller.tasks.push(createContinuousTask(controller.id, "MainTask", [main.id]));
  controller.controllerTags.push(
    createTag(controller.id, "StartPB", "BOOL", { value: false }),
    createTag(controller.id, "MotorRun", "BOOL", { value: false }),
  );
  project.controllers.push(controller);
  return project;
}

function hmiProject() {
  const hmi = createDefaultHmiProject("Line HMI");
  const overview = createHmiScreen("Overview");
  hmi.screens.push(overview);
  hmi.homeScreenId = overview.id;
  return hmi;
}

/** Deterministic id factory so audit/backup ids are stable in assertions. */
function seqIds(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

const DOWNLOAD_OPTS = { builtAt: AT, now: () => AT };

describe("compareTarget", () => {
  const softIdentity = (overrides: Partial<SoftControllerTargetIdentity> = {}): SoftControllerTargetIdentity => ({
    name: "ESCO SoftController",
    platform: ESCO_SOFT_CONTROLLER_PLATFORM,
    firmwareRevision: "1.0.0",
    catalogNumber: "ESCO-SOFT-1",
    vendor: "ESCO Automation",
    isPhysicalHardware: false,
    maxRuntimeSchemaVersion: 1,
    accepts: "any",
    loadedProjectId: null,
    ...overrides,
  });

  it("accepts a compatible project and warns that it runs in software", () => {
    const project = validProject();
    const runtime = buildRuntime(project, DOWNLOAD_OPTS).runtime!;
    const comparison = compareTarget(projectTargetIdentity(project, runtime), softIdentity());
    expect(comparison.rejected).toBe(false);
    expect(comparison.status).toBe("compatible-with-warnings");
    expect(comparison.warnings.some((w) => /software/i.test(w))).toBe(true);
  });

  it("rejects a runtime schema the SoftController cannot load", () => {
    const project = validProject();
    const runtime = buildRuntime(project, DOWNLOAD_OPTS).runtime!;
    const identity = projectTargetIdentity(project, runtime);
    const comparison = compareTarget({ ...identity, runtimeSchemaVersion: 99 }, softIdentity());
    expect(comparison.rejected).toBe(true);
    expect(comparison.rejectReason).toMatch(/schema version/i);
  });

  it("rejects a processor type a restricted SoftController does not accept", () => {
    const project = validProject();
    const runtime = buildRuntime(project, DOWNLOAD_OPTS).runtime!;
    const identity = { ...projectTargetIdentity(project, runtime), processorType: "ControlLogix-5580" };
    const comparison = compareTarget(identity, softIdentity({ accepts: ["Emulated", "ESCO-SOFT"] }));
    expect(comparison.rejected).toBe(true);
    expect(comparison.rejectReason).toMatch(/does not accept/i);
  });
});

describe("downloadToSoftController — successful download", () => {
  it("builds, compares, backs up, transfers, and applies in Program mode", () => {
    const project = validProject();
    const soft = new InMemorySoftController({ now: () => AT, createId: seqIds("bak") });
    const result = downloadToSoftController(project, soft, {
      ...DOWNLOAD_OPTS,
      createId: seqIds("audit"),
    });

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("success");
    expect(result.stage).toBe("complete");
    // Preflight built a checksummed runtime.
    expect(result.preflight.ok).toBe(true);
    expect(result.preflight.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.preflight.fileName).toMatch(/\.easruntime$/);
    // Transfer validated the checksum on the target.
    expect(result.transfer?.checksumValid).toBe(true);
    expect(result.transfer?.checksum).toBe(result.preflight.checksum);
    // Applied and returned to Program mode (default).
    expect(result.apply?.applied).toBe(true);
    expect(result.apply?.mode).toBe("program");
    // The SoftController now holds the image.
    expect(soft.getImage()?.projectId).toBe(project.id);
    expect(soft.getMode()).toBe("program");
    expect(soft.isScanning()).toBe(false);
  });

  it("includes supplied HMI project references in the downloaded .easruntime", () => {
    const project = validProject();
    const soft = new InMemorySoftController({ now: () => AT, createId: seqIds("bak") });
    const result = downloadToSoftController(project, soft, {
      ...DOWNLOAD_OPTS,
      hmiProject: hmiProject(),
    });

    expect(result.ok).toBe(true);
    const loaded = parseRuntimeFile(soft.getImage()!.runtimeText);
    expect(loaded.ok).toBe(true);
    expect(loaded.runtime?.hmi).toMatchObject({
      screenCount: 1,
      screenNames: ["Overview"],
    });
    expect(loaded.runtime?.hmi?.projectSnapshot).toMatchObject({
      name: "Line HMI",
      screens: [{ name: "Overview" }],
    });
  });

  it("returns to Run mode and resets tag memory when requested", () => {
    const project = validProject();
    const soft = new InMemorySoftController({ now: () => AT });
    const before = soft.getTagMemoryGeneration();
    const result = downloadToSoftController(project, soft, {
      ...DOWNLOAD_OPTS,
      returnToMode: "run",
      resetTagMemory: true,
    });

    expect(result.ok).toBe(true);
    expect(result.apply?.mode).toBe("run");
    expect(result.apply?.tagMemoryReset).toBe(true);
    expect(soft.getMode()).toBe("run");
    expect(soft.isScanning()).toBe(true);
    expect(soft.getTagMemoryGeneration()).toBe(before + 1);
  });

  it("stops an active scan before applying the new runtime", () => {
    const project = validProject();
    const soft = new InMemorySoftController({ now: () => AT, initialMode: "run", scanning: true });
    expect(soft.isScanning()).toBe(true);
    const result = downloadToSoftController(project, soft, { ...DOWNLOAD_OPTS, returnToMode: "program" });
    expect(result.ok).toBe(true);
    expect(result.apply?.scanStopped).toBe(true);
    expect(soft.isScanning()).toBe(false);
  });
});

describe("downloadToSoftController — validation failure blocks download", () => {
  it("blocks at preflight when the project has hard validation errors", () => {
    // A project with no controller cannot compile a runtime (hard error).
    const project = createProject("Empty");
    const soft = new InMemorySoftController({ now: () => AT });
    const result = downloadToSoftController(project, soft, DOWNLOAD_OPTS);

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("blocked");
    expect(result.stage).toBe("preflight");
    expect(result.error).toMatch(/no controller|build failed|validation/i);
    expect(result.preflight.ok).toBe(false);
    // Nothing was transferred or applied; the controller stays empty.
    expect(result.transfer).toBeUndefined();
    expect(result.backup).toBeUndefined();
    expect(soft.getImage()).toBeNull();
    // Still audited.
    expect(result.audit.outcome).toBe("blocked");
    expect(result.audit.stage).toBe("preflight");
  });
});

describe("downloadToSoftController — checksum mismatch fails", () => {
  it("fails at transfer when the runtime is corrupted in transit", () => {
    const project = validProject();
    const soft = new InMemorySoftController({ now: () => AT, corruptOnReceive: true });
    const result = downloadToSoftController(project, soft, DOWNLOAD_OPTS);

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(result.stage).toBe("transfer");
    expect(result.transfer?.checksumValid).toBe(false);
    expect(result.error).toMatch(/checksum|integrity/i);
    // The bad image is never applied.
    expect(result.apply).toBeUndefined();
    expect(soft.getImage()).toBeNull();
    expect(soft.getStaged()).toBeNull();
    // Audit records the failed checksum and that a backup was taken first.
    expect(result.audit.checksumValid).toBe(false);
    expect(result.audit.backupId).toBeDefined();
  });
});

describe("downloadToSoftController — incompatible controller rejected", () => {
  it("blocks at compare for a processor the SoftController does not accept", () => {
    const project = validProject();
    project.controllers[0]!.processorType = "ControlLogix-5580";
    const soft = new InMemorySoftController({ now: () => AT, accepts: ["Emulated"] });
    const result = downloadToSoftController(project, soft, DOWNLOAD_OPTS);

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("blocked");
    expect(result.stage).toBe("compare");
    expect(result.comparison?.rejected).toBe(true);
    expect(result.error).toMatch(/incompatible/i);
    // Rejected before any transfer/backup/apply.
    expect(result.backup).toBeUndefined();
    expect(result.transfer).toBeUndefined();
    expect(soft.getImage()).toBeNull();
    // Audit captured the compared identities.
    expect(result.audit.targetIdentity?.controller.accepts).toEqual(["Emulated"]);
  });
});

describe("downloadToSoftController — backup created before overwrite", () => {
  it("records an empty backup for a fresh (empty) controller", () => {
    const project = validProject();
    const soft = new InMemorySoftController({ now: () => AT });
    const result = downloadToSoftController(project, soft, DOWNLOAD_OPTS);

    expect(result.ok).toBe(true);
    expect(result.backup).toBeDefined();
    expect(result.backup?.empty).toBe(true);
    expect(result.audit.backupId).toBe(result.backup?.id);
  });

  it("backs up the prior image before overwriting a non-empty controller", () => {
    // Seed the SoftController with a prior project image.
    const priorProject = validProject("Old Line");
    const priorRuntime = buildRuntime(priorProject, DOWNLOAD_OPTS).runtime!;
    const priorText = serializeRuntime(priorRuntime);
    const soft = new InMemorySoftController({ now: () => AT, initialImage: { runtimeText: priorText } });
    expect(soft.getImage()?.projectName).toBe("Old Line");

    const newProject = validProject("New Line");
    const result = downloadToSoftController(newProject, soft, DOWNLOAD_OPTS);

    expect(result.ok).toBe(true);
    // The backup captured the OLD image (with its restorable bytes) before overwrite.
    expect(result.backup?.empty).toBe(false);
    expect(result.backup?.projectName).toBe("Old Line");
    expect(result.backup?.runtimeText).toBe(priorText);
    expect(result.backup?.checksum).toMatch(/^[0-9a-f]{64}$/);
    // And the controller now holds the NEW image.
    expect(soft.getImage()?.projectName).toBe("New Line");
    // A warning notes that a different image was overwritten.
    expect(result.warnings.some((w) => /different project image/i.test(w))).toBe(true);
  });
});

describe("downloadToSoftController — no physical hardware path is enabled", () => {
  it("reports the target as software, never physical hardware", () => {
    const soft = new InMemorySoftController({ now: () => AT });
    expect(soft.identify().isPhysicalHardware).toBe(false);
    expect(InMemorySoftController.isPhysicalHardware).toBe(false);
  });

  it("always records physicalHardware: false in the audit, on success and failure", () => {
    const okResult = downloadToSoftController(validProject(), new InMemorySoftController({ now: () => AT }), DOWNLOAD_OPTS);
    expect(okResult.audit.physicalHardware).toBe(false);

    const badResult = downloadToSoftController(createProject("Empty"), new InMemorySoftController({ now: () => AT }), DOWNLOAD_OPTS);
    expect(badResult.audit.physicalHardware).toBe(false);
  });

  it("exposes no method that could reach a real device (software protocol only)", () => {
    const soft = new InMemorySoftController({ now: () => AT });
    // The device protocol is the only surface, and it is software-only.
    const protocol: SoftControllerTarget = soft;
    expect(typeof protocol.identify).toBe("function");
    expect(typeof protocol.createBackup).toBe("function");
    expect(typeof protocol.receiveRuntime).toBe("function");
    expect(typeof protocol.applyStaged).toBe("function");
    // No "connect to hardware" affordance exists on the SoftController surface.
    expect((soft as unknown as Record<string, unknown>).connectHardware).toBeUndefined();
    expect((soft as unknown as Record<string, unknown>).goOnlineHardware).toBeUndefined();
  });
});

describe("downloadToSoftController — audit completeness", () => {
  it("records the attempt, preflight result, warnings, checksum, identity, and backup id on success", () => {
    const project = validProject();
    const soft = new InMemorySoftController({ now: () => AT, createId: seqIds("bak") });
    const result = downloadToSoftController(project, soft, {
      ...DOWNLOAD_OPTS,
      createId: seqIds("audit"),
    });

    const audit = result.audit;
    expect(audit.id).toBe("audit-1");
    expect(audit.at).toBe(AT);
    expect(audit.outcome).toBe("success");
    expect(audit.stage).toBe("complete");
    expect(audit.attempt.projectId).toBe(project.id);
    expect(audit.attempt.projectName).toBe("Line A");
    expect(audit.attempt.target).toBe("ESCO SoftController");
    expect(audit.preflight.ok).toBe(true);
    expect(audit.checksum).toBe(result.preflight.checksum);
    expect(audit.checksumValid).toBe(true);
    expect(audit.targetIdentity?.project.projectId).toBe(project.id);
    expect(audit.targetIdentity?.controller.platform).toBe(ESCO_SOFT_CONTROLLER_PLATFORM);
    expect(audit.backupId).toBe(result.backup?.id);
    expect(audit.physicalHardware).toBe(false);
  });

  it("surfaces model-only / review-only build warnings through preflight and audit", () => {
    // An SFC routine is preserved for inspection but not executed → a build warning.
    const project = validProject("Graphical Line");
    const controller = project.controllers[0]!;
    const sfcProgram = createProgram(controller.id, "SfcProgram");
    const sfcRoutine = createRoutine(sfcProgram.id, "SfcRoutine", "sfc");
    sfcRoutine.sourceText = "<SFC/>";
    sfcProgram.mainRoutineId = sfcRoutine.id;
    sfcProgram.routines.push(sfcRoutine);
    controller.programs.push(sfcProgram);
    controller.tasks[0]!.scheduledProgramIds.push(sfcProgram.id);

    const soft = new InMemorySoftController({ now: () => AT });
    const result = downloadToSoftController(project, soft, DOWNLOAD_OPTS);

    expect(result.ok).toBe(true);
    expect(result.preflight.warnings.some((w) => /not executed/i.test(w))).toBe(true);
    expect(result.audit.preflight.warnings.some((w) => /not executed/i.test(w))).toBe(true);
    expect(result.warnings.some((w) => /not executed/i.test(w))).toBe(true);
  });
});

describe("custom SoftControllerTarget fake", () => {
  it("drives the orchestration through an injected provider", () => {
    const project = validProject();
    const runtime = buildRuntime(project, DOWNLOAD_OPTS).runtime!;
    const text = serializeRuntime(runtime);

    const calls: string[] = [];
    const fake: SoftControllerTarget = {
      identify(): SoftControllerTargetIdentity {
        calls.push("identify");
        return {
          name: "Fake Soft PLC",
          platform: ESCO_SOFT_CONTROLLER_PLATFORM,
          firmwareRevision: "9.9.9",
          catalogNumber: "FAKE-1",
          vendor: "ESCO Automation",
          isPhysicalHardware: false,
          maxRuntimeSchemaVersion: 1,
          accepts: "any",
          loadedProjectId: null,
        };
      },
      createBackup(at: string): SoftControllerBackup {
        calls.push("backup");
        return { id: "fake-backup", at, empty: true };
      },
      receiveRuntime(runtimeText: string, declaredChecksum: string): SoftControllerReceiveResult {
        calls.push("receive");
        expect(runtimeText).toBe(text);
        return { accepted: true, checksum: declaredChecksum, checksumValid: true, bytes: runtimeText.length };
      },
      applyStaged(input: SoftControllerApplyInput, _at: string) {
        calls.push("apply");
        return { applied: true, scanStopped: false, tagMemoryReset: !!input.resetTagMemory, mode: input.mode ?? "program" };
      },
    };

    const result = downloadToSoftController(project, fake, DOWNLOAD_OPTS);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["identify", "backup", "receive", "apply"]);
    expect(result.audit.attempt.target).toBe("Fake Soft PLC");
  });
});
