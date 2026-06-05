import { describe, expect, it } from "vitest";
import {
  ESCO_VIRTUAL_PATHS,
  VirtualControllerSession,
  softwareCommandGuardReport,
  type ProjectDownloadInput,
  type SoftwareCommandGuardContext,
  type SoftwareCommandKind,
} from "./index";

const SUMMARY = { controllerName: "ESCO_Controller", taskCount: 1, programCount: 1, routineCount: 1, tagCount: 3 };

const project = (signature = "sig", valid = true, errors: string[] = []): ProjectDownloadInput => ({
  projectId: "proj-1",
  projectName: "Line A",
  signature,
  valid,
  errors,
  summary: SUMMARY,
});

function row(ctx: SoftwareCommandGuardContext, kind: SoftwareCommandKind) {
  return softwareCommandGuardReport(ctx).rows.find((item) => item.commandKind === kind)!;
}

function baseContext(overrides: Partial<SoftwareCommandGuardContext> = {}): SoftwareCommandGuardContext {
  const session = new VirtualControllerSession();
  return {
    snapshot: session.getSnapshot(),
    projectOpen: true,
    projectValid: true,
    softControllerRuntimeLoaded: false,
    softControllerBackupAvailable: false,
    ...overrides,
  };
}

describe("softwareCommandGuardReport", () => {
  it("keeps every command explicitly software-only", () => {
    const report = softwareCommandGuardReport(baseContext());

    expect(report.softwareOnly).toBe(true);
    expect(report.rows.length).toBeGreaterThan(8);
    for (const item of report.rows) {
      const hardwareCheck = item.checks.find((check) => check.id === "no-physical-hardware");
      expect(hardwareCheck).toMatchObject({ level: "required", passed: true });
    }
  });

  it("blocks virtual online and transfer commands until a virtual path exists", () => {
    const ctx = baseContext();

    expect(row(ctx, "virtual-go-online")).toMatchObject({
      available: false,
      firstBlocker: "virtual-path-selected",
    });
    expect(row(ctx, "virtual-download")).toMatchObject({
      available: false,
      firstBlocker: "virtual-path-selected",
    });
    expect(row(ctx, "virtual-upload")).toMatchObject({
      available: false,
      firstBlocker: "virtual-path-selected",
    });
  });

  it("marks the core virtual workflow ready after path selection and a clean download", () => {
    const session = new VirtualControllerSession();
    session.selectPath(ESCO_VIRTUAL_PATHS[0]!.id);
    session.download(project("sig-ready"));
    const ctx = baseContext({
      snapshot: session.getSnapshot(),
      softControllerRuntimeLoaded: true,
      softControllerBackupAvailable: true,
    });
    const report = softwareCommandGuardReport(ctx);

    expect(row(ctx, "virtual-go-online").available).toBe(true);
    expect(row(ctx, "virtual-monitor").available).toBe(true);
    expect(row(ctx, "virtual-download").available).toBe(true);
    expect(row(ctx, "virtual-upload").available).toBe(true);
    expect(row(ctx, "virtual-mode-run").available).toBe(true);
    expect(row(ctx, "soft-download-runtime").available).toBe(true);
    expect(row(ctx, "soft-upload-runtime").available).toBe(true);
    expect(row(ctx, "soft-restore-runtime").available).toBe(true);
    expect(report.availableSoftwareCommands).toBeGreaterThan(report.blockedSoftwareCommands);
  });

  it("blocks project download commands when the open project has validation errors", () => {
    const session = new VirtualControllerSession();
    session.selectPath(ESCO_VIRTUAL_PATHS[0]!.id);
    const ctx = baseContext({
      snapshot: session.getSnapshot(),
      projectValid: false,
      projectErrors: ["Tag MotorStart has no data type"],
    });

    expect(row(ctx, "virtual-download")).toMatchObject({
      available: false,
      firstBlocker: "project-valid",
    });
    expect(row(ctx, "soft-download-runtime")).toMatchObject({
      available: false,
      firstBlocker: "project-valid",
    });
  });

  it("blocks Run modes when the virtual image is mismatched", () => {
    const session = new VirtualControllerSession();
    session.selectPath(ESCO_VIRTUAL_PATHS[0]!.id);
    session.download(project("sig-controller"));
    session.goOnline({ projectId: "proj-1", projectName: "Line A", signature: "sig-offline" });
    const ctx = baseContext({ snapshot: session.getSnapshot() });

    expect(row(ctx, "virtual-mode-program").available).toBe(true);
    expect(row(ctx, "virtual-mode-run")).toMatchObject({
      available: false,
      firstBlocker: "image-matched",
    });
    expect(row(ctx, "virtual-mode-remote-run")).toMatchObject({
      available: false,
      firstBlocker: "image-matched",
    });
  });

  it("reports SoftController upload and restore blockers independently", () => {
    const unloaded = baseContext({
      softControllerRuntimeLoaded: false,
      softControllerBackupAvailable: false,
    });
    const loadedNoBackup = baseContext({
      softControllerRuntimeLoaded: true,
      softControllerBackupAvailable: false,
    });

    expect(row(unloaded, "soft-upload-runtime")).toMatchObject({
      available: false,
      firstBlocker: "soft-runtime-loaded",
    });
    expect(row(unloaded, "soft-restore-runtime")).toMatchObject({
      available: false,
      firstBlocker: "rollback-backup-available",
    });
    expect(row(loadedNoBackup, "soft-upload-runtime").available).toBe(true);
    expect(row(loadedNoBackup, "soft-restore-runtime").available).toBe(false);
  });
});
