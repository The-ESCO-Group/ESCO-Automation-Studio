import { useCallback, useMemo, useRef, useState } from "react";
import type { PlcProject } from "@esco/core";
import type {
  HmiProject,
  HmiTagMetadata,
  HmiTagSample,
  HmiTagWriteRequest,
  HmiTagWriteResult,
  RuntimeTagProvider,
} from "@esco/hmi-model";
import {
  VirtualControllerSession,
  softwareCommandGuardReport,
  type CommPath,
  type ControllerMode,
  type ProjectDownloadInput,
  type ProjectIdentity,
  type SoftwareCommandGuardReport,
  type UploadResult,
  type VirtualActionResult,
  type VirtualSessionSnapshot,
} from "@esco/controller-comm";
import {
  downloadToSoftController,
  sha256Hex,
  uploadFromSoftController as reconstructFromSoftController,
  validate,
  type ProjectActionResult,
  type SoftControllerDownloadResult,
  type SoftControllerUploadData,
  type SoftControllerUploadImage,
  type SoftControllerUploadOptions,
} from "@esco/project-actions";
import { serializeProject } from "@esco/project-store";
import {
  EscoSoftController,
  createSoftControllerTarget,
  type RestorePreviousRuntimeResult,
  type ScanResult,
  type SoftControllerBackupInfo,
  type SoftControllerResult,
  type SoftControllerScanEvidence,
  type SoftControllerStatus,
  type TagValue,
} from "@esco/soft-controller";

const RECENT_PATHS_KEY = "esco.virtual-controller.recent-paths";
const SOFT_CONTROLLER_MONITOR_TAG_LIMIT = 8;

function loadRecentPaths(): CommPath[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(RECENT_PATHS_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CommPath[]) : [];
  } catch {
    return [];
  }
}

function saveRecentPaths(paths: CommPath[]): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(paths));
  } catch {
    /* best-effort persistence only */
  }
}

export function virtualCommPathDisplayLabel(path: CommPath): string {
  switch (path.kind) {
    case "ethernet-ip":
      return `Virtual EtherNet/IP backplane (offline) - slot ${path.slot ?? 0}`;
    case "local-emulation":
      return `Local emulation backplane (offline) - slot ${path.slot ?? 0}`;
    case "usb-virtual":
    default:
      return "USB virtual controller (offline)";
  }
}

/** Stable content signature of a project (changes when the project changes). */
function projectSignature(project: PlcProject): string {
  return sha256Hex(JSON.stringify(project));
}

function projectIdentity(project: PlcProject): ProjectIdentity {
  return { projectId: project.id, projectName: project.name, signature: projectSignature(project) };
}

function projectSummary(project: PlcProject) {
  const controller = project.controllers[0];
  return {
    controllerName: controller?.name ?? project.name,
    taskCount: project.controllers.reduce((sum, c) => sum + c.tasks.length, 0),
    programCount: project.controllers.reduce((sum, c) => sum + c.programs.length, 0),
    routineCount: project.controllers.reduce(
      (sum, c) => sum + c.programs.reduce((s, p) => s + p.routines.length, 0),
      0,
    ),
    tagCount: project.controllers.reduce(
      (sum, c) => sum + c.controllerTags.length + c.programs.reduce((s, p) => s + p.programTags.length, 0),
      0,
    ),
  };
}

function downloadInput(project: PlcProject): ProjectDownloadInput {
  const errors = validate(project)
    .filter((finding) => finding.severity === "error")
    .map((finding) => `${finding.message}${finding.target ? ` (${finding.target})` : ""}`);
  return {
    ...projectIdentity(project),
    valid: errors.length === 0,
    errors,
    summary: projectSummary(project),
    payload: serializeProject(project),
    snapshotRef: `easruntime:${projectSignature(project).slice(0, 12)}`,
  };
}

export interface SoftControllerUploadResultData extends SoftControllerUploadData {
  /** Serialized reconstructed project, ready for the existing open/replace flow. */
  payload: string;
}

export type SoftControllerUploadResult = ProjectActionResult<SoftControllerUploadResultData>;

const SOFT_CONTROLLER_UPLOAD_FILE = "esco-softcontroller-upload.easruntime";

export interface SoftControllerMonitorTagRow {
  path: string;
  name: string;
  scope: "controller" | "program";
  programName?: string;
  dataType: string;
  value: TagValue | undefined;
}

export interface SoftControllerMonitorSnapshot {
  softwareOnly: true;
  runtimeLoaded: boolean;
  running: boolean;
  mode: SoftControllerStatus["mode"];
  scanCount: number;
  lastScanMs: number;
  lastScanEvidence: SoftControllerScanEvidence | null;
  pendingEventTaskTriggers: string[];
  faultCount: number;
  tagCount: number;
  sampledTagCount: number;
  runtime: SoftControllerStatus["runtime"];
  tagRows: SoftControllerMonitorTagRow[];
  message: string;
}

/** Read-only live monitor summary for the ESCO SoftController software runtime. */
export function softControllerMonitorSnapshot(
  controller: EscoSoftController,
  tagLimit = SOFT_CONTROLLER_MONITOR_TAG_LIMIT,
): SoftControllerMonitorSnapshot {
  const status = controller.status();
  const tags = controller.listTags();
  const tagRows = tags.slice(0, Math.max(0, tagLimit)).map((tag): SoftControllerMonitorTagRow => ({
    path: tag.path,
    name: tag.name,
    scope: tag.scope,
    ...(tag.programName ? { programName: tag.programName } : {}),
    dataType: tag.dataType,
    value: controller.readTag(tag.path),
  }));
  const runtimeName = status.runtime?.projectName ?? "no runtime loaded";
  return {
    softwareOnly: true,
    runtimeLoaded: status.runtimeLoaded,
    running: status.running,
    mode: status.mode,
    scanCount: status.scanCount,
    lastScanMs: status.lastScanMs,
    lastScanEvidence: status.lastScanEvidence,
    pendingEventTaskTriggers: status.pendingEventTaskTriggers,
    faultCount: status.faults.length,
    tagCount: tags.length,
    sampledTagCount: tagRows.length,
    runtime: status.runtime,
    tagRows,
    message: status.runtimeLoaded
      ? `Monitoring ESCO SoftController runtime "${runtimeName}" in ${status.mode} mode.`
      : "No ESCO SoftController runtime is loaded.",
  };
}

/** Read the currently installed ESCO SoftController image for reconstruction upload. */
export function softControllerUploadImage(target: EscoSoftController): SoftControllerUploadImage {
  const image = target.exportImage();
  return {
    connected: true,
    identity: {
      name: image.identity.name,
      catalogNumber: image.identity.catalogNumber,
      serialNumber: image.identity.serialNumber,
      firmwareRevision: image.identity.firmwareRevision,
      vendor: image.identity.vendor,
    },
    runtimeImage: image.runtimeText ?? undefined,
    installedAt: image.runtime?.loadedAt,
  };
}

/** Run the existing SoftController upload reconstruction and attach a project payload for the web opener. */
export function uploadSoftControllerImage(
  image: SoftControllerUploadImage,
  options: SoftControllerUploadOptions = {},
): SoftControllerUploadResult {
  const result = reconstructFromSoftController(image, {
    fileName: SOFT_CONTROLLER_UPLOAD_FILE,
    ...options,
  });
  if (!result.ok || !result.data) return result as SoftControllerUploadResult;
  return {
    ...result,
    data: {
      ...result.data,
      payload: serializeProject(result.project),
    },
  };
}

function hmiSample(path: string, value: boolean | number | string | undefined, timestampMs: number): HmiTagSample {
  return {
    path,
    value: value === undefined ? null : value,
    quality: value === undefined ? "bad" : "good",
    timestampMs,
  };
}

function metadataMatches(metadata: HmiTagMetadata, path: string): boolean {
  const value = path.toLowerCase();
  const parts = metadata.path.split(".");
  const shortName = parts[parts.length - 1]?.toLowerCase();
  return metadata.path.toLowerCase() === value || shortName === value;
}

/**
 * RuntimeTagProvider bridge from the HMI runtime preview into the executable
 * ESCO SoftController. This keeps the operator preview bound to the same
 * software-runtime tag image used by SoftController upload/download, while
 * remaining explicitly software-only.
 */
export class SoftControllerRuntimeTagProvider implements RuntimeTagProvider {
  private readonly unsubscribers: Array<() => void> = [];
  private disposed = false;

  constructor(
    private readonly controller: EscoSoftController,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  read(path: string): HmiTagSample {
    const metadata = this.getMetadata(path);
    if (!metadata) return hmiSample(path, undefined, this.clock());
    return hmiSample(metadata.path, this.controller.readTag(metadata.path), this.clock());
  }

  write(request: HmiTagWriteRequest): HmiTagWriteResult {
    const metadata = this.getMetadata(request.path);
    const timestampMs = request.timestampMs ?? this.clock();
    if (!metadata) {
      return {
        ok: false,
        path: request.path,
        value: null,
        quality: "bad",
        timestampMs,
        message: `Tag "${request.path}" is not loaded in the ESCO SoftController runtime.`,
      };
    }
    if (request.value === null) {
      return {
        ok: false,
        path: metadata.path,
        value: null,
        quality: "bad",
        timestampMs,
        message: `Cannot write null to "${metadata.path}" on the ESCO SoftController.`,
      };
    }

    const result = this.controller.writeTag(metadata.path, request.value);
    const value = this.controller.readTag(metadata.path) ?? request.value;
    return {
      ok: result.ok,
      path: metadata.path,
      value,
      quality: result.ok ? "good" : "bad",
      timestampMs,
      message: result.message,
    };
  }

  subscribe(path: string, callback: (sample: HmiTagSample) => void): () => void {
    const metadata = this.getMetadata(path);
    callback(this.read(path));
    if (!metadata) return () => {};
    const unsubscribe = this.controller.subscribeTag(metadata.path, (value, changedPath) => {
      callback(hmiSample(changedPath, value, this.clock()));
    });
    this.unsubscribers.push(unsubscribe);
    return () => {
      unsubscribe();
      const index = this.unsubscribers.indexOf(unsubscribe);
      if (index >= 0) this.unsubscribers.splice(index, 1);
    };
  }

  listTags(): string[] {
    return this.metadata().map((metadata) => metadata.path);
  }

  getMetadata(path: string): HmiTagMetadata | undefined {
    return this.metadata().find((metadata) => metadataMatches(metadata, path));
  }

  metadata(): HmiTagMetadata[] {
    return this.controller.listTags().map((tag) => ({
      path: tag.path,
      dataType: tag.dataType,
      scope: tag.scope,
      writable: true,
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
  }
}

export function createSoftControllerRuntimeTagProvider(controller: EscoSoftController): RuntimeTagProvider {
  return new SoftControllerRuntimeTagProvider(controller);
}

export interface VirtualControllerApi {
  snapshot: VirtualSessionSnapshot;
  availablePaths: CommPath[];
  beginBrowsing: () => VirtualActionResult;
  selectPath: (pathId: string) => VirtualActionResult;
  goOnline: () => VirtualActionResult;
  goOffline: () => VirtualActionResult;
  monitor: () => VirtualActionResult;
  download: () => VirtualActionResult;
  upload: () => UploadResult;
  setMode: (mode: ControllerMode) => VirtualActionResult;
  clearFaults: () => VirtualActionResult;
  /**
   * Build the project's `.easruntime` and download it into the ESCO SoftController
   * (an ESCO software controller — never physical hardware). Safe, checksummed,
   * backed up, and audited; see `downloadToSoftController`.
   */
  downloadRuntimeToSoftController: () => SoftControllerDownloadResult;
  /** Read/reconstruct the current ESCO SoftController image; caller must preview before opening. */
  uploadFromSoftController: () => SoftControllerUploadResult;
  /** Restore the previous ESCO SoftController runtime image when a rollback backup exists. */
  restorePreviousSoftControllerRuntime: () => RestorePreviousRuntimeResult;
  /** Start the ESCO SoftController software scan (Run mode). */
  startSoftControllerScan: () => SoftControllerResult;
  /** Execute one deterministic ESCO SoftController scan tick. */
  scanSoftControllerOnce: () => ScanResult;
  /** Queue a software-only event task trigger for the next ESCO SoftController scan. */
  triggerSoftControllerEventTask: (task: string) => SoftControllerResult;
  /** Stop the ESCO SoftController software scan. */
  stopSoftControllerScan: () => SoftControllerResult;
  /** Create a fresh HMI runtime tag provider backed by the loaded ESCO SoftController image. */
  createSoftControllerRuntimeTagProvider: () => RuntimeTagProvider;
  /** The most recent SoftController download result, or null before the first attempt. */
  softControllerDownload: SoftControllerDownloadResult | null;
  /** Live status from the scan-capable ESCO SoftController. */
  softControllerStatus: SoftControllerStatus;
  /** Read-only live monitor snapshot from the scan-capable ESCO SoftController. */
  softControllerMonitor: SoftControllerMonitorSnapshot;
  /** Latest non-empty SoftController rollback backup, if one exists. */
  restorableSoftControllerBackup: SoftControllerBackupInfo | null;
  /** Live preflight report for ESCO Virtual Controller and SoftController software-only commands. */
  softwareGuardReport: SoftwareCommandGuardReport;
}

/**
 * React hook over a single {@link VirtualControllerSession}. The session is an
 * ESCO-owned offline/virtual controller backend (never real hardware). The hook
 * mirrors the session snapshot into render state, persists recent paths locally,
 * and derives the offline project signature / validation for Go Online + Download.
 */
export function useVirtualController(
  project: PlcProject,
  projectOpen: boolean,
  hmiProject?: HmiProject,
): VirtualControllerApi {
  const sessionRef = useRef<VirtualControllerSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = new VirtualControllerSession({ recentPaths: loadRecentPaths() });
  }
  const session = sessionRef.current;
  const [snapshot, setSnapshot] = useState<VirtualSessionSnapshot>(() => session.getSnapshot());

  // A single executable ESCO SoftController (software target) for runtime downloads.
  const softControllerRef = useRef<EscoSoftController | null>(null);
  if (softControllerRef.current === null) {
    softControllerRef.current = new EscoSoftController();
  }
  const [softControllerDownload, setSoftControllerDownload] =
    useState<SoftControllerDownloadResult | null>(null);
  const [softControllerStatus, setSoftControllerStatus] = useState<SoftControllerStatus>(() =>
    softControllerRef.current!.status(),
  );
  const [softControllerMonitor, setSoftControllerMonitor] = useState<SoftControllerMonitorSnapshot>(() =>
    softControllerMonitorSnapshot(softControllerRef.current!),
  );

  const sync = useCallback(
    <T extends VirtualActionResult>(result: T): T => {
      setSnapshot(result.snapshot);
      saveRecentPaths(result.snapshot.recentPaths);
      return result;
    },
    [],
  );

  const currentProject = projectOpen ? project : null;

  const refreshSoftController = useCallback(() => {
    const controller = softControllerRef.current!;
    setSoftControllerStatus(controller.status());
    setSoftControllerMonitor(softControllerMonitorSnapshot(controller));
  }, []);

  const beginBrowsing = useCallback(() => sync(session.beginBrowsing()), [session, sync]);
  const selectPath = useCallback((pathId: string) => sync(session.selectPath(pathId)), [session, sync]);
  const goOnline = useCallback(
    () => sync(session.goOnline(currentProject ? projectIdentity(currentProject) : null)),
    [session, sync, currentProject],
  );
  const goOffline = useCallback(() => sync(session.goOffline()), [session, sync]);
  const monitor = useCallback(() => sync(session.monitor()), [session, sync]);
  const download = useCallback(
    () => sync(session.download(currentProject ? downloadInput(currentProject) : null)),
    [session, sync, currentProject],
  );
  const upload = useCallback(() => sync(session.upload()), [session, sync]);
  const setMode = useCallback((mode: ControllerMode) => sync(session.setMode(mode)), [session, sync]);
  const clearFaults = useCallback(() => sync(session.clearFaults()), [session, sync]);

  const projectValidationErrors = useMemo(
    () =>
      currentProject
        ? validate(currentProject)
            .filter((finding) => finding.severity === "error")
            .map((finding) => `${finding.message}${finding.target ? ` (${finding.target})` : ""}`)
        : [],
    [currentProject],
  );

  const downloadRuntimeToSoftController = useCallback((): SoftControllerDownloadResult => {
    const controller = softControllerRef.current!;
    const result = downloadToSoftController(currentProject ?? project, createSoftControllerTarget(controller), {
      returnToMode: "program",
      ...(hmiProject ? { hmiProject } : {}),
    });
    setSoftControllerDownload(result);
    refreshSoftController();
    return result;
  }, [project, currentProject, hmiProject, refreshSoftController]);

  const uploadFromSoftController = useCallback(
    (): SoftControllerUploadResult => {
      const result = uploadSoftControllerImage(softControllerUploadImage(softControllerRef.current!));
      refreshSoftController();
      return result;
    },
    [refreshSoftController],
  );

  const restorePreviousSoftControllerRuntime = useCallback((): RestorePreviousRuntimeResult => {
    const result = softControllerRef.current!.restorePreviousRuntime();
    refreshSoftController();
    return result;
  }, [refreshSoftController]);
  const startSoftControllerScan = useCallback((): SoftControllerResult => {
    const result = softControllerRef.current!.startScan();
    refreshSoftController();
    return result;
  }, [refreshSoftController]);
  const scanSoftControllerOnce = useCallback((): ScanResult => {
    const result = softControllerRef.current!.scanOnce();
    refreshSoftController();
    return result;
  }, [refreshSoftController]);
  const triggerSoftControllerEventTask = useCallback((task: string): SoftControllerResult => {
    const result = softControllerRef.current!.triggerEventTask(task);
    refreshSoftController();
    return result;
  }, [refreshSoftController]);
  const stopSoftControllerScan = useCallback((): SoftControllerResult => {
    const result = softControllerRef.current!.stopScan();
    refreshSoftController();
    return result;
  }, [refreshSoftController]);
  const createSoftControllerRuntimeTagProviderForHmi = useCallback(
    () => createSoftControllerRuntimeTagProvider(softControllerRef.current!),
    [],
  );

  const availablePaths = useMemo(() => session.availablePaths(), [session, snapshot.recentPaths]);
  const restorableSoftControllerBackup = softControllerStatus.backup.available ? softControllerStatus.backup : null;
  const softwareGuardReport = useMemo(
    () =>
      softwareCommandGuardReport({
        snapshot,
        projectOpen: currentProject !== null,
        projectValid: currentProject !== null && projectValidationErrors.length === 0,
        projectErrors: projectValidationErrors,
        softControllerRuntimeLoaded: softControllerStatus.runtimeLoaded,
        softControllerBackupAvailable: softControllerStatus.backup.available,
      }),
    [
      snapshot,
      currentProject,
      projectValidationErrors,
      softControllerStatus.runtimeLoaded,
      softControllerStatus.backup.available,
    ],
  );

  return {
    snapshot,
    availablePaths,
    beginBrowsing,
    selectPath,
    goOnline,
    goOffline,
    monitor,
    download,
    upload,
    setMode,
    clearFaults,
    downloadRuntimeToSoftController,
    uploadFromSoftController,
    restorePreviousSoftControllerRuntime,
    startSoftControllerScan,
    scanSoftControllerOnce,
    triggerSoftControllerEventTask,
    stopSoftControllerScan,
    createSoftControllerRuntimeTagProvider: createSoftControllerRuntimeTagProviderForHmi,
    softControllerDownload,
    softControllerStatus,
    softControllerMonitor,
    restorableSoftControllerBackup,
    softwareGuardReport,
  };
}
