/**
 * ESCO SoftController — an in-process, ESCO-native software controller runtime.
 *
 * This is the studio's first stateful software-only "Go Online"-style target.
 * It is **software, not hardware**: it never claims to be, nor to communicate
 * with, a physical PLC. What it provides is a stateful software controller:
 *
 *   - Identity (controller id, name, ESCO-SOFT-CTRL catalog, firmware/runtime
 *     version, serial number, runtime state).
 *   - Modes: program / run / stopped / faulted.
 *   - Runtime loading: accept ESCO `.easruntime` payloads, validate schema +
 *     checksum + provenance using the existing native runtime helpers, and reject
 *     invalid/corrupt files honestly.
 *   - Tag memory: initialized from the runtime power-up image, read/write, with
 *     controller- and program-scoped paths.
 *   - Deterministic scheduled scan execution on the existing routine executor,
 *     with start / stop / reset and a fixed-step software scan tick.
 *   - A fault model: validation faults, runtime faults, clearable / non-clearable.
 *   - An exportable controller image for software upload/reconstruction flows.
 */

import type { PlcProject } from "@esco/core";
import {
  canonicalJson,
  parseRuntimeFile,
  runtimeChecksum,
  createOfflineTaskSchedulerState,
  scanScheduledProject,
  serializeNativeJson,
  serializeRuntime,
  sha256Hex,
  type EscoRuntime,
  type OfflineTaskSchedulerState,
  type TagValues,
} from "@esco/project-actions";
import { createDefaultRegistry, type InstructionRegistry } from "@esco/instructions";
import { createId, nowIso } from "@esco/shared";
import {
  powerUpImage,
  resolveValuePath,
  runtimeTagInfos,
  runtimeToExecutableProject,
  summarizeLoadedRuntime,
} from "./runtime-loader";
import {
  SOFT_CONTROLLER_CATALOG_NUMBER,
  SOFT_CONTROLLER_DEFAULT_SCAN_INTERVAL_MS,
  SOFT_CONTROLLER_FIRMWARE_REVISION,
  SOFT_CONTROLLER_IMAGE_FORMAT,
  SOFT_CONTROLLER_RUNTIME_VERSION,
  SOFT_CONTROLLER_VENDOR,
  type LoadedRuntimeInfo,
  type LoadRuntimeResult,
  type RestorePreviousRuntimeAudit,
  type RestorePreviousRuntimeReason,
  type RestorePreviousRuntimeResult,
  type ScanResult,
  type SoftControllerBackupInfo,
  type SoftControllerForceInfo,
  type SoftControllerIdentity,
  type SoftControllerImage,
  type SoftControllerMode,
  type SoftControllerOptions,
  type SoftControllerResult,
  type SoftControllerScanEvidence,
  type SoftControllerStatus,
  type SoftControllerTagInfo,
  type SoftFault,
  type SoftFaultSource,
  type SoftFaultType,
} from "./types";

export type TagValue = boolean | number | string;
type TagListener = (value: TagValue | undefined, path: string) => void;

interface RaiseFaultSpec {
  type: SoftFaultType;
  source: SoftFaultSource;
  code: string;
  message: string;
  clearable: boolean;
}

interface ImageValidationResult {
  ok: boolean;
  reason?: RestorePreviousRuntimeReason;
  error?: string;
  runtime?: EscoRuntime;
  runtimeChecksum?: string;
  imageChecksumValid: boolean;
  runtimeChecksumValid: boolean;
}

/** A settable (non-faulted) target mode. */
export type SettableMode = "program" | "run" | "stopped";

/**
 * The ESCO SoftController. Deterministic and framework-free: no timers, no real
 * I/O. `now()` is injectable so sessions are reproducible in tests.
 */
export class EscoSoftController {
  private readonly identityBase: Omit<SoftControllerIdentity, "runtimeState">;
  private readonly now: () => string;
  private readonly scanIntervalMs: number;
  private readonly registry: InstructionRegistry = createDefaultRegistry();

  private mode: SoftControllerMode = "stopped";
  private runtime: EscoRuntime | null = null;
  private runtimeText: string | null = null;
  private runtimeChecksumValue: string | null = null;
  private project: PlcProject | null = null;
  private loadedInfo: LoadedRuntimeInfo | null = null;
  private tagInfos: SoftControllerTagInfo[] = [];

  private image: TagValues = {};
  private forces: TagValues = {};
  private schedulerState: OfflineTaskSchedulerState = createOfflineTaskSchedulerState();
  private queuedEventTaskTriggers: string[] = [];
  private lastScanEvidence: SoftControllerScanEvidence | null = null;
  private scanCount = 0;
  private lastScanMs = 0;

  private faults: SoftFault[] = [];
  private readonly listeners = new Map<string, Set<TagListener>>();
  private rollbackBackup: SoftControllerImage | null = null;

  constructor(options: SoftControllerOptions = {}) {
    this.now = options.now ?? nowIso;
    this.scanIntervalMs = options.scanIntervalMs ?? SOFT_CONTROLLER_DEFAULT_SCAN_INTERVAL_MS;
    this.identityBase = {
      controllerId: options.controllerId ?? createId("softctrl"),
      name: options.name ?? "ESCO SoftController",
      catalogNumber: SOFT_CONTROLLER_CATALOG_NUMBER,
      firmwareRevision: options.firmwareRevision ?? SOFT_CONTROLLER_FIRMWARE_REVISION,
      runtimeVersion: SOFT_CONTROLLER_RUNTIME_VERSION,
      serialNumber: options.serialNumber ?? `ESCO-SC-${createId("sn").slice(-8).toUpperCase()}`,
      vendor: SOFT_CONTROLLER_VENDOR,
      kind: "software",
    };
  }

  // --- identity / status ---------------------------------------------------

  /** Current identity, including the live runtime state. */
  getIdentity(): SoftControllerIdentity {
    return { ...this.identityBase, runtimeState: this.mode };
  }

  getMode(): SoftControllerMode {
    return this.mode;
  }

  isRunning(): boolean {
    return this.mode === "run";
  }

  isRuntimeLoaded(): boolean {
    return this.runtime !== null;
  }

  /** Full live status. */
  status(): SoftControllerStatus {
    return {
      identity: this.getIdentity(),
      mode: this.mode,
      running: this.mode === "run",
      runtimeLoaded: this.runtime !== null,
      runtime: this.loadedInfo,
      scanCount: this.scanCount,
      lastScanMs: this.lastScanMs,
      lastScanEvidence: this.lastScanEvidence ? { ...this.lastScanEvidence } : null,
      pendingEventTaskTriggers: [...this.queuedEventTaskTriggers],
      forceCount: Object.keys(this.forces).length,
      faults: this.faults.map((fault) => ({ ...fault })),
      faulted: this.mode === "faulted",
      backupAvailable: this.rollbackBackup !== null,
      backup: this.rollbackBackupInfo(),
    };
  }

  getFaults(): SoftFault[] {
    return this.faults.map((fault) => ({ ...fault }));
  }

  /** Metadata for every addressable tag path in the loaded runtime. */
  listTags(): SoftControllerTagInfo[] {
    return this.tagInfos.map((info) => ({ ...info }));
  }

  /** Active software-only forces, keyed by canonical tag path. */
  listForces(): SoftControllerForceInfo[] {
    return Object.entries(this.forces)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, value]) => ({ path, value }));
  }

  // --- runtime loading -----------------------------------------------------

  /**
   * Load a `.easruntime` file (its text). Validates extension, schema, checksum,
   * and ESCO-native provenance via the existing native runtime helpers. On an
   * invalid/corrupt file the controller raises a clearable validation fault,
   * faults, and rejects the load — it never pretends a bad image is good.
   */
  loadRuntimeText(text: string, fileName = "download.easruntime"): LoadRuntimeResult {
    if (this.mode === "run") {
      return {
        ...this.result(false, "Stop the controller (exit Run mode) before loading a new runtime."),
        runtime: this.loadedInfo,
        backup: null,
      };
    }

    const parsed = parseRuntimeFile(text, fileName);
    if (!parsed.ok || !parsed.runtime) {
      const message = parsed.error ?? "Invalid ESCO runtime file.";
      this.raiseFault({
        type: "validation",
        source: "runtime-load",
        code: "SC-RUNTIME-INVALID",
        message,
        clearable: true,
      });
      return { ...this.result(false, message), runtime: null, backup: null };
    }

    const checksum = parsed.checksum?.expected ?? runtimeChecksum(parsed.runtime);
    return this.applyRuntime(parsed.runtime, text, checksum);
  }

  /**
   * Load an already-parsed runtime payload (for hosts that hold the object). The
   * caller vouches for the payload; checksum is computed for the image.
   */
  loadRuntime(runtime: EscoRuntime, runtimeText?: string): LoadRuntimeResult {
    if (this.mode === "run") {
      return {
        ...this.result(false, "Stop the controller (exit Run mode) before loading a new runtime."),
        runtime: this.loadedInfo,
        backup: null,
      };
    }
    const text = runtimeText ?? serializeRuntime(runtime);
    return this.applyRuntime(runtime, text, runtimeChecksum(runtime));
  }

  private applyRuntime(runtime: EscoRuntime, text: string, checksum: string): LoadRuntimeResult {
    const backup = this.runtime ? this.exportImage() : null;
    if (backup) this.rollbackBackup = cloneImage(backup);
    const project = runtimeToExecutableProject(runtime, this.registry);
    const loadedAt = this.now();

    this.runtime = runtime;
    this.runtimeText = text;
    this.runtimeChecksumValue = checksum;
    this.project = project;
    this.image = powerUpImage(project, runtime);
    this.forces = {};
    this.schedulerState = createOfflineTaskSchedulerState();
    this.queuedEventTaskTriggers = [];
    this.lastScanEvidence = null;
    this.tagInfos = runtimeTagInfos(runtime);
    this.scanCount = 0;
    this.lastScanMs = 0;
    this.loadedInfo = summarizeLoadedRuntime(runtime, project, checksum, loadedAt);

    // A clean download clears prior clearable runtime-load (validation) faults.
    this.faults = this.faults.filter((fault) => !(fault.source === "runtime-load" && fault.clearable));
    this.mode = this.faults.length > 0 ? "faulted" : "program";

    this.notifyAllTags();
    return {
      ...this.result(true, `Loaded ESCO runtime "${runtime.identity.projectName}" — controller in Program mode.`),
      runtime: this.loadedInfo,
      backup,
    };
  }

  // --- mode / scan control -------------------------------------------------

  /** Transition to a settable mode. Run/Program require a loaded runtime and no active faults. */
  setMode(mode: SettableMode): SoftControllerResult {
    if (mode === "stopped") {
      this.mode = "stopped";
      return this.result(true, "Controller stopped — scanning halted.");
    }

    if (this.faults.length > 0) {
      return this.result(false, "Clear active faults before changing mode.");
    }
    if (!this.runtime) {
      return this.result(false, `${mode === "run" ? "Run" : "Program"} mode requires a loaded ESCO runtime.`);
    }

    if (mode === "run") {
      this.mode = "run";
      return this.result(true, "Run mode — deterministic scanning enabled.");
    }
    this.mode = "program";
    return this.result(true, "Program mode — scanning halted, ready to run.");
  }

  /** Start the scan (enter Run mode). */
  startScan(): SoftControllerResult {
    return this.setMode("run");
  }

  /** Stop the scan (enter Stopped mode). */
  stopScan(): SoftControllerResult {
    return this.setMode("stopped");
  }

  /**
   * Reset the controller: restore the tag image to power-up values and zero the
   * scan counter. Recovers to Program mode when a runtime is loaded and no faults
   * remain; otherwise stays Faulted / Stopped. Does not clear faults.
   */
  resetScan(): SoftControllerResult {
    if (this.project && this.runtime) {
      this.image = powerUpImage(this.project, this.runtime);
      this.applyForcesToImage();
    }
    this.schedulerState = createOfflineTaskSchedulerState();
    this.queuedEventTaskTriggers = [];
    this.lastScanEvidence = null;
    this.scanCount = 0;
    this.lastScanMs = 0;
    if (this.faults.length > 0) this.mode = "faulted";
    else this.mode = this.runtime ? "program" : "stopped";
    this.notifyAllTags();
    return this.result(true, "Controller reset to power-up state.");
  }

  /** Alias of {@link resetScan}. */
  reset(): SoftControllerResult {
    return this.resetScan();
  }

  /** Execute exactly one deterministic scan tick (must be in Run mode). */
  scanOnce(deltaMs: number = this.scanIntervalMs): ScanResult {
    if (this.mode !== "run") {
      return {
        ...this.result(false, "Controller is not in Run mode; start the scan first."),
        scansExecuted: 0,
        scanCount: this.scanCount,
        lastScanEvidence: this.lastScanEvidence,
      };
    }
    return this.executeScans(1, deltaMs);
  }

  /** Execute `count` deterministic scan ticks, stopping early on a scan fault. */
  runScans(count: number, deltaMs: number = this.scanIntervalMs): ScanResult {
    if (this.mode !== "run") {
      return {
        ...this.result(false, "Controller is not in Run mode; start the scan first."),
        scansExecuted: 0,
        scanCount: this.scanCount,
        lastScanEvidence: this.lastScanEvidence,
      };
    }
    return this.executeScans(Math.max(0, Math.trunc(count)), deltaMs);
  }

  /**
   * Queue a software-only event task trigger for the next scan. The label may be
   * a task scan key, task id, task name, or "Controller/Task".
   */
  triggerEventTask(label: string): SoftControllerResult {
    if (!this.runtime) return this.result(false, "Cannot trigger event task: no ESCO runtime is loaded.");
    const trimmed = label.trim();
    if (!trimmed) return this.result(false, "Cannot trigger event task: supply a task key, id, or name.");
    this.queuedEventTaskTriggers.push(trimmed);
    return this.result(true, `Queued software-only event task trigger "${trimmed}" for the next scan.`);
  }

  private executeScans(count: number, deltaMs: number): ScanResult {
    let executed = 0;
    for (let i = 0; i < count; i += 1) {
      if (this.mode !== "run" || !this.project) break;
      const before = this.image;
      const simulatedEventTaskTriggers = this.queuedEventTaskTriggers;
      this.queuedEventTaskTriggers = [];
      try {
        const result = scanScheduledProject(this.project, this.image, {
          deltaMs,
          forces: this.forces,
          schedulerState: this.schedulerState,
          ...(simulatedEventTaskTriggers.length ? { simulatedEventTaskTriggers } : {}),
        });
        this.image = result.data?.values ?? this.image;
        this.schedulerState = result.data?.schedulerState ?? this.schedulerState;
        this.lastScanEvidence = {
          softwareOnly: true,
          scannedTaskKeys: result.data?.scannedTaskKeys ?? [],
          heldEventTaskKeys: result.data?.heldEventTaskKeys ?? [],
          triggeredEventTaskKeys: result.data?.triggeredEventTaskKeys ?? [],
        };
        this.scanCount += 1;
        this.lastScanMs = deltaMs;
        executed += 1;
        this.notifyChangedTags(before, this.image);
      } catch (error) {
        this.raiseFault({
          type: "runtime",
          source: "scan",
          code: "SC-SCAN-FAULT",
          message: `SoftController scan faulted: ${error instanceof Error ? error.message : String(error)}`,
          clearable: false,
        });
        break;
      }
    }
    const ok = executed === count;
    const message = ok
      ? `Executed ${executed} scan tick(s); total ${this.scanCount}.`
      : `Scan halted after ${executed}/${count} tick(s) — controller faulted.`;
    return { ...this.result(ok, message), scansExecuted: executed, scanCount: this.scanCount, lastScanEvidence: this.lastScanEvidence };
  }

  // --- tag memory ----------------------------------------------------------

  /** Read a tag by canonical path, controller name, or `Program::Tag` form. */
  readTag(path: string): TagValue | undefined {
    if (!this.runtime) return undefined;
    return this.image[resolveValuePath(path)];
  }

  /** Write a tag value. Outputs driven by logic are overwritten on the next scan. */
  writeTag(path: string, value: TagValue): SoftControllerResult {
    if (!this.runtime) return this.result(false, "Cannot write tag: no ESCO runtime is loaded.");
    const key = resolveValuePath(path);
    if (!(key in this.image)) {
      return this.result(false, `Unknown tag path "${path}".`);
    }
    this.image[key] = value;
    this.notifyTag(key, value);
    return this.result(true, `Wrote ${key} = ${String(value)}.`);
  }

  /** Apply a local software-only force to a tag path. No physical controller force table is touched. */
  forceTag(path: string, value: TagValue): SoftControllerResult {
    if (!this.runtime) return this.result(false, "Cannot force tag: no ESCO runtime is loaded.");
    const key = resolveValuePath(path);
    if (!(key in this.image)) return this.result(false, `Unknown tag path "${path}".`);
    this.forces[key] = value;
    this.image[key] = value;
    this.notifyTag(key, value);
    return this.result(true, `Forced ${key} = ${String(value)} in the software force table.`);
  }

  /** Clear one local software-only force by path. */
  clearForce(path: string): SoftControllerResult {
    if (!this.runtime) return this.result(false, "Cannot clear force: no ESCO runtime is loaded.");
    const key = resolveValuePath(path);
    if (!Object.prototype.hasOwnProperty.call(this.forces, key)) {
      return this.result(false, `No active force exists for "${path}".`);
    }
    delete this.forces[key];
    return this.result(true, `Cleared software force for ${key}.`);
  }

  /** Clear all local software-only forces. */
  clearForces(): SoftControllerResult {
    const count = Object.keys(this.forces).length;
    this.forces = {};
    return this.result(true, `Cleared ${count} software force${count === 1 ? "" : "s"}.`);
  }

  /** A copy of the full live tag image keyed by canonical value path. */
  tagImage(): TagValues {
    return { ...this.image };
  }

  /** Subscribe to changes of a tag (by canonical path, name, or `Program::Tag`). Returns an unsubscribe fn. */
  subscribeTag(path: string, listener: TagListener): () => void {
    const key = resolveValuePath(path);
    const listeners = this.listeners.get(key) ?? new Set<TagListener>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
    };
  }

  // --- faults --------------------------------------------------------------

  /**
   * Inject a fault (e.g. a simulated runtime fault). Faults the controller and
   * halts scanning. `clearable` controls whether {@link clearFaults} can dismiss it.
   */
  injectFault(spec: {
    message: string;
    type?: SoftFaultType;
    source?: SoftFaultSource;
    code?: string;
    clearable?: boolean;
  }): SoftControllerResult {
    this.raiseFault({
      type: spec.type ?? "runtime",
      source: spec.source ?? "operator",
      code: spec.code ?? "SC-FAULT",
      message: spec.message,
      clearable: spec.clearable ?? true,
    });
    return this.result(true, `Fault raised: ${spec.message}`);
  }

  /**
   * Clear clearable faults. Non-clearable faults remain and keep the controller
   * faulted. When all faults are cleared, the controller recovers to Program mode
   * (or Stopped when no runtime is loaded).
   */
  clearFaults(): SoftControllerResult {
    const before = this.faults.length;
    const remaining = this.faults.filter((fault) => !fault.clearable);
    const cleared = before - remaining.length;
    this.faults = remaining;

    if (remaining.length > 0) {
      this.mode = "faulted";
      return this.result(
        false,
        `Cleared ${cleared} fault(s); ${remaining.length} non-clearable fault(s) remain.`,
      );
    }

    if (this.mode === "faulted") this.mode = this.runtime ? "program" : "stopped";
    return this.result(true, before === 0 ? "No faults to clear." : `Cleared ${cleared} fault(s).`);
  }

  private raiseFault(spec: RaiseFaultSpec): void {
    this.faults.push({ id: createId("scflt"), at: this.now(), ...spec });
    this.mode = "faulted";
  }

  // --- controller image (for upload) --------------------------------------

  /**
   * Export a serializable image of the controller for the upload system: identity,
   * mode, loaded-runtime summary, the verbatim runtime text, the full tag image,
   * faults, and an integrity checksum over everything else.
   */
  exportImage(): SoftControllerImage {
    const base = {
      formatName: SOFT_CONTROLLER_IMAGE_FORMAT,
      schemaVersion: 1 as const,
      capturedAt: this.now(),
      identity: this.getIdentity(),
      mode: this.mode,
      runtime: this.loadedInfo,
      runtimeText: this.runtimeText,
      runtimeChecksum: this.runtimeChecksumValue,
      scan: { count: this.scanCount, lastScanMs: this.lastScanMs },
      tags: { ...this.image },
      faults: this.faults.map((fault) => ({ ...fault })),
    };
    const checksum = sha256Hex(canonicalJson(base));
    return { ...base, checksum };
  }

  /** Deterministic JSON text of the exported controller image. */
  serializeImage(): string {
    return serializeNativeJson(this.exportImage());
  }

  // --- restore / rollback --------------------------------------------------

  /** Summary of the retained previous-runtime image, if one exists. */
  getRollbackBackupInfo(): SoftControllerBackupInfo {
    return this.rollbackBackupInfo();
  }

  /** A copy of the retained previous-runtime image. Intended for audit/export tooling. */
  getRollbackBackupImage(): SoftControllerImage | null {
    return this.rollbackBackup ? cloneImage(this.rollbackBackup) : null;
  }

  /**
   * Restore the previous runtime image captured before the last overwrite.
   * Both the controller-image checksum and embedded runtime checksum are verified
   * before live state changes. On success, the replaced current image becomes the
   * next rollback candidate.
   */
  restorePreviousRuntime(): RestorePreviousRuntimeResult {
    if (!this.rollbackBackup) {
      return this.restoreResult({
        restored: false,
        outcome: "blocked",
        reason: "no-backup",
        message: "Restore blocked: no previous ESCO SoftController runtime backup is available.",
        error: "No previous runtime backup is available.",
        backupBefore: null,
        backupAfter: null,
        stoppedRunningScan: false,
      });
    }
    return this.restoreControllerImage(this.rollbackBackup);
  }

  /**
   * Restore a supplied controller image. This is used by restore tooling and by
   * tests that need to prove corrupt backups are rejected without mutating state.
   */
  restoreControllerImage(image: SoftControllerImage): RestorePreviousRuntimeResult {
    const backupBefore = cloneImage(image);
    const validation = validateSoftControllerImage(backupBefore);
    if (!validation.ok || !validation.runtime || !validation.runtimeChecksum) {
      return this.restoreResult({
        restored: false,
        outcome: "failed",
        reason: validation.reason ?? "corrupt-backup",
        message: "Restore failed: the ESCO SoftController rollback backup did not pass checksum validation.",
        error: validation.error ?? "Rollback backup failed checksum validation.",
        backupBefore,
        backupAfter: this.rollbackBackup,
        stoppedRunningScan: false,
        imageChecksumValid: validation.imageChecksumValid,
        runtimeChecksumValid: validation.runtimeChecksumValid,
      });
    }

    let project: PlcProject;
    try {
      project = runtimeToExecutableProject(validation.runtime, this.registry);
    } catch (error) {
      return this.restoreResult({
        restored: false,
        outcome: "failed",
        reason: "restore-failed",
        message: "Restore failed: the rollback runtime could not be rebuilt for execution.",
        error: error instanceof Error ? error.message : String(error),
        backupBefore,
        backupAfter: this.rollbackBackup,
        stoppedRunningScan: false,
        imageChecksumValid: validation.imageChecksumValid,
        runtimeChecksumValid: validation.runtimeChecksumValid,
      });
    }

    const stoppedRunningScan = this.mode === "run";
    const replaced = this.runtime ? this.exportImage() : null;
    const loadedAt = this.now();

    this.runtime = validation.runtime;
    this.runtimeText = backupBefore.runtimeText;
    this.runtimeChecksumValue = validation.runtimeChecksum;
    this.project = project;
    this.image = { ...backupBefore.tags };
    this.schedulerState = createOfflineTaskSchedulerState();
    this.queuedEventTaskTriggers = [];
    this.lastScanEvidence = null;
    this.tagInfos = runtimeTagInfos(validation.runtime);
    this.scanCount = backupBefore.scan.count;
    this.lastScanMs = backupBefore.scan.lastScanMs;
    this.loadedInfo = summarizeLoadedRuntime(validation.runtime, project, validation.runtimeChecksum, loadedAt);
    this.faults = backupBefore.faults.map((fault) => ({ ...fault }));
    this.mode = restoredMode(backupBefore.mode, this.faults);
    this.rollbackBackup = replaced ? cloneImage(replaced) : null;

    this.notifyAllTags();
    const modeLabel = this.mode === "run" ? "Run" : this.mode === "program" ? "Program" : this.mode;
    return this.restoreResult({
      restored: true,
      outcome: "success",
      message: `Restored previous ESCO runtime "${validation.runtime.identity.projectName}" from rollback backup. Checksum verified; controller in ${modeLabel} mode.`,
      backupBefore,
      backupAfter: this.rollbackBackup,
      stoppedRunningScan,
      imageChecksumValid: validation.imageChecksumValid,
      runtimeChecksumValid: validation.runtimeChecksumValid,
      restoredProjectId: validation.runtime.identity.projectId,
      restoredProjectName: validation.runtime.identity.projectName,
      restoredRuntimeChecksum: validation.runtimeChecksum,
      ...(replaced?.runtimeChecksum ? { replacedRuntimeChecksum: replaced.runtimeChecksum } : {}),
    });
  }

  // --- helpers -------------------------------------------------------------

  private result(ok: boolean, message: string): SoftControllerResult {
    return { ok, message, status: this.status() };
  }

  private applyForcesToImage(): void {
    for (const [path, value] of Object.entries(this.forces)) {
      if (path in this.image) this.image[path] = value;
    }
  }

  private rollbackBackupInfo(image: SoftControllerImage | null = this.rollbackBackup): SoftControllerBackupInfo {
    if (!image?.runtime || !image.runtimeText || !image.runtimeChecksum) return { available: false };
    return {
      available: true,
      capturedAt: image.capturedAt,
      projectId: image.runtime.projectId,
      projectName: image.runtime.projectName,
      runtimeChecksum: image.runtimeChecksum,
      imageChecksum: image.checksum,
    };
  }

  private restoreResult(input: {
    restored: boolean;
    outcome: RestorePreviousRuntimeResult["outcome"];
    message: string;
    reason?: RestorePreviousRuntimeReason;
    error?: string;
    backupBefore: SoftControllerImage | null;
    backupAfter: SoftControllerImage | null;
    stoppedRunningScan: boolean;
    imageChecksumValid?: boolean;
    runtimeChecksumValid?: boolean;
    restoredProjectId?: string;
    restoredProjectName?: string;
    restoredRuntimeChecksum?: string;
    replacedRuntimeChecksum?: string;
  }): RestorePreviousRuntimeResult {
    const backup = this.rollbackBackupInfo(input.backupAfter);
    const audit: RestorePreviousRuntimeAudit = {
      id: createId("screstore"),
      at: this.now(),
      outcome: input.outcome,
      ...(input.reason ? { reason: input.reason } : {}),
      physicalHardware: false,
      backupAvailable: input.backupBefore !== null,
      backup: this.rollbackBackupInfo(input.backupBefore),
      ...(input.imageChecksumValid !== undefined ? { imageChecksumValid: input.imageChecksumValid } : {}),
      ...(input.runtimeChecksumValid !== undefined ? { runtimeChecksumValid: input.runtimeChecksumValid } : {}),
      stoppedRunningScan: input.stoppedRunningScan,
      ...(input.restoredProjectId ? { restoredProjectId: input.restoredProjectId } : {}),
      ...(input.restoredProjectName ? { restoredProjectName: input.restoredProjectName } : {}),
      ...(input.restoredRuntimeChecksum ? { restoredRuntimeChecksum: input.restoredRuntimeChecksum } : {}),
      ...(input.replacedRuntimeChecksum ? { replacedRuntimeChecksum: input.replacedRuntimeChecksum } : {}),
    };
    return {
      ...this.result(input.restored, input.message),
      restored: input.restored,
      outcome: input.outcome,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.error ? { error: input.error } : {}),
      backupAvailable: backup.available,
      backup,
      audit,
    };
  }

  private notifyTag(key: string, value: TagValue | undefined): void {
    for (const listener of this.listeners.get(key) ?? []) listener(value, key);
  }

  private notifyAllTags(): void {
    for (const [key, listeners] of this.listeners) {
      if (listeners.size === 0) continue;
      const value = this.image[key];
      for (const listener of listeners) listener(value, key);
    }
  }

  private notifyChangedTags(before: TagValues, after: TagValues): void {
    if (this.listeners.size === 0) return;
    for (const [key, listeners] of this.listeners) {
      if (listeners.size === 0) continue;
      if (before[key] !== after[key]) {
        for (const listener of listeners) listener(after[key], key);
      }
    }
  }
}

/** Compute the checksum for a controller image with its checksum field excluded. */
export function softControllerImageChecksum(image: SoftControllerImage): string {
  const { checksum: _checksum, ...base } = image;
  return sha256Hex(canonicalJson(base));
}

/** Validate a controller image and its embedded `.easruntime` payload. */
export function validateSoftControllerImage(image: SoftControllerImage): ImageValidationResult {
  if (image.formatName !== SOFT_CONTROLLER_IMAGE_FORMAT || image.schemaVersion !== 1) {
    return {
      ok: false,
      reason: "corrupt-backup",
      error: "Rollback backup is not an ESCO SoftController image.",
      imageChecksumValid: false,
      runtimeChecksumValid: false,
    };
  }

  const imageChecksumValid = softControllerImageChecksum(image) === image.checksum;
  if (!imageChecksumValid) {
    return {
      ok: false,
      reason: "corrupt-backup",
      error: "Rollback backup image checksum does not match its contents.",
      imageChecksumValid,
      runtimeChecksumValid: false,
    };
  }

  if (!image.runtimeText || !image.runtime || !image.runtimeChecksum) {
    return {
      ok: false,
      reason: "corrupt-runtime",
      error: "Rollback backup does not contain a restorable runtime image.",
      imageChecksumValid,
      runtimeChecksumValid: false,
    };
  }

  const parsed = parseRuntimeFile(image.runtimeText);
  if (!parsed.ok || !parsed.runtime) {
    return {
      ok: false,
      reason: "corrupt-runtime",
      error: parsed.error ?? "Rollback runtime could not be parsed.",
      imageChecksumValid,
      runtimeChecksumValid: false,
    };
  }

  const computedRuntimeChecksum = runtimeChecksum(parsed.runtime);
  const runtimeChecksumValid =
    parsed.checksum?.valid === true &&
    computedRuntimeChecksum === image.runtimeChecksum &&
    image.runtime.checksum === computedRuntimeChecksum &&
    image.runtime.projectId === parsed.runtime.identity.projectId &&
    image.runtime.projectName === parsed.runtime.identity.projectName;
  if (!runtimeChecksumValid) {
    return {
      ok: false,
      reason: "corrupt-runtime",
      error: "Rollback runtime checksum does not match the backup metadata.",
      imageChecksumValid,
      runtimeChecksumValid,
    };
  }

  return {
    ok: true,
    runtime: parsed.runtime,
    runtimeChecksum: computedRuntimeChecksum,
    imageChecksumValid,
    runtimeChecksumValid,
  };
}

function restoredMode(imageMode: SoftControllerMode, faults: SoftFault[]): SoftControllerMode {
  if (faults.length > 0 || imageMode === "faulted") return "faulted";
  return imageMode === "run" ? "program" : imageMode;
}

function cloneImage(image: SoftControllerImage): SoftControllerImage {
  return JSON.parse(JSON.stringify(image)) as SoftControllerImage;
}
