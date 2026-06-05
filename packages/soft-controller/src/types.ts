/**
 * ESCO SoftController — type model.
 *
 * The SoftController is an ESCO-native, **in-process software controller**. It is
 * the first real "Go Online" target for the studio: it loads a compiled ESCO
 * `.easruntime` artifact, scans it deterministically, and exposes identity,
 * status, tag memory, faults, and an exportable controller image.
 *
 * It is software, not hardware. Nothing in this package claims to be, or to talk
 * to, a physical PLC. Every identity is branded "ESCO SoftController" with
 * `kind: "software"`.
 */

import type { TagValues } from "@esco/project-actions";

/** Catalog number reported by every ESCO SoftController. */
export const SOFT_CONTROLLER_CATALOG_NUMBER = "ESCO-SOFT-CTRL";
/** Vendor reported by every ESCO SoftController. */
export const SOFT_CONTROLLER_VENDOR = "ESCO Automation";
/** Version of the SoftController scan/runtime engine in this build. */
export const SOFT_CONTROLLER_RUNTIME_VERSION = "1.0.0";
/** Default firmware revision reported by a SoftController instance. */
export const SOFT_CONTROLLER_FIRMWARE_REVISION = "1.0.0";
/** Default modeled scan period (ms) for a deterministic scan tick. */
export const SOFT_CONTROLLER_DEFAULT_SCAN_INTERVAL_MS = 10;
/** Format marker for an exported controller image (used by the upload system). */
export const SOFT_CONTROLLER_IMAGE_FORMAT = "ESCO SoftController Image";

/**
 * Controller execution mode / runtime state.
 *
 * - `program`  — a runtime is loaded; not scanning; ready to enter Run.
 * - `run`      — scanning logic on each tick.
 * - `stopped`  — powered, not scanning; the power-up state and the post-stop state.
 * - `faulted`  — a fault has halted the controller; scanning is blocked until cleared.
 */
export type SoftControllerMode = "program" | "run" | "stopped" | "faulted";

/** What raised a fault: a runtime-load/validation problem, a scan problem, or an operator/test injection. */
export type SoftFaultType = "validation" | "runtime";
export type SoftFaultSource = "runtime-load" | "scan" | "operator";

export interface SoftFault {
  id: string;
  /** ISO timestamp the fault was raised. */
  at: string;
  type: SoftFaultType;
  source: SoftFaultSource;
  /** Stable fault code, e.g. "SC-RUNTIME-INVALID". */
  code: string;
  message: string;
  /** Whether {@link SoftController.clearFaults} can dismiss it. */
  clearable: boolean;
}

/** Identity reported by the SoftController. */
export interface SoftControllerIdentity {
  controllerId: string;
  name: string;
  /** Always "ESCO-SOFT-CTRL" — this is a software controller catalog entry. */
  catalogNumber: string;
  /** Firmware/runtime version of the controller. */
  firmwareRevision: string;
  /** Version of the SoftController scan engine. */
  runtimeVersion: string;
  serialNumber: string;
  vendor: string;
  /** Honest marker: an in-process software controller, never physical hardware. */
  kind: "software";
  /** Current runtime state (mirrors {@link SoftControllerMode}). */
  runtimeState: SoftControllerMode;
}

/** Summary of the runtime artifact currently loaded into the controller. */
export interface LoadedRuntimeInfo {
  projectId: string;
  projectName: string;
  description?: string;
  /** Runtime-compiler version stamped in the `.easruntime` payload. */
  runtimeVersion: string;
  /** Studio version that built the runtime. */
  appVersion: string;
  /** ISO timestamp the runtime was built. */
  builtAt: string;
  /** Integrity checksum (sha256) of the loaded `.easruntime` file. */
  checksum: string;
  controllerCount: number;
  programCount: number;
  routineCount: number;
  tagCount: number;
  /** Number of routines in the deterministic offline scan set. */
  scheduledRoutineCount: number;
  /** ISO timestamp the runtime was loaded into the controller. */
  loadedAt: string;
}

/** Metadata about the rollback image currently retained by the SoftController. */
export interface SoftControllerBackupInfo {
  /** True when a non-empty previous runtime image is available for restore. */
  available: boolean;
  capturedAt?: string;
  projectId?: string;
  projectName?: string;
  runtimeChecksum?: string;
  imageChecksum?: string;
}

export type SoftTagScope = "controller" | "program";

/** Metadata describing one addressable tag path in the loaded runtime. */
export interface SoftControllerTagInfo {
  /** Canonical value path (the key used by read/write and the tag image). */
  path: string;
  name: string;
  scope: SoftTagScope;
  programName?: string;
  dataType: string;
  dimensions?: number[];
}

/** One active software-only force in the SoftController force table. */
export interface SoftControllerForceInfo {
  /** Canonical value path being forced. */
  path: string;
  /** Forced value applied before and after each deterministic software scan. */
  value: boolean | number | string;
}

/** Software-only task scheduler evidence from the latest SoftController scan. */
export interface SoftControllerScanEvidence {
  /** INVARIANT: this is local ESCO software evidence, never physical-controller state. */
  softwareOnly: true;
  scannedTaskKeys: string[];
  heldEventTaskKeys: string[];
  triggeredEventTaskKeys: string[];
}

/** Live status of the controller. */
export interface SoftControllerStatus {
  identity: SoftControllerIdentity;
  mode: SoftControllerMode;
  running: boolean;
  runtimeLoaded: boolean;
  runtime: LoadedRuntimeInfo | null;
  scanCount: number;
  /** Modeled time step (ms) of the most recent scan. */
  lastScanMs: number;
  /** Latest local task-scheduler evidence, or null before the first scan/reset. */
  lastScanEvidence: SoftControllerScanEvidence | null;
  /** Queued software-only event task trigger labels that will be consumed on the next scan. */
  pendingEventTaskTriggers: string[];
  /** Number of active software-only forces. */
  forceCount: number;
  faults: SoftFault[];
  faulted: boolean;
  /** Whether Restore Previous Runtime can currently run. */
  backupAvailable: boolean;
  /** Summary of the retained rollback image, when present. */
  backup: SoftControllerBackupInfo;
}

/** Generic action result. */
export interface SoftControllerResult {
  ok: boolean;
  message: string;
  status: SoftControllerStatus;
}

/** Result of loading an `.easruntime`. */
export interface LoadRuntimeResult extends SoftControllerResult {
  runtime: LoadedRuntimeInfo | null;
  /** A controller image captured before this load, so a host can roll back. */
  backup: SoftControllerImage | null;
}

/** Result of running one or more scan ticks. */
export interface ScanResult extends SoftControllerResult {
  scansExecuted: number;
  scanCount: number;
  lastScanEvidence: SoftControllerScanEvidence | null;
}

/**
 * A serializable image of the controller, for the (future) upload system. It
 * carries identity, mode, the loaded runtime summary, the original runtime text
 * (so the project can be reconstructed), the full tag image, faults, and an
 * integrity checksum over everything else.
 */
export interface SoftControllerImage {
  formatName: string;
  schemaVersion: 1;
  /** ISO timestamp the image was captured. */
  capturedAt: string;
  identity: SoftControllerIdentity;
  mode: SoftControllerMode;
  runtime: LoadedRuntimeInfo | null;
  /** Verbatim `.easruntime` text of the loaded runtime, for upload reconstruction. */
  runtimeText: string | null;
  /** Integrity checksum (sha256) of the loaded `.easruntime` file. */
  runtimeChecksum: string | null;
  scan: { count: number; lastScanMs: number };
  /** Full live tag image keyed by canonical value path. */
  tags: TagValues;
  faults: SoftFault[];
  /** sha256 over the image with this field excluded. */
  checksum: string;
}

export type RestorePreviousRuntimeOutcome = "success" | "blocked" | "failed";

export type RestorePreviousRuntimeReason =
  | "no-backup"
  | "corrupt-backup"
  | "corrupt-runtime"
  | "restore-failed";

export interface RestorePreviousRuntimeAudit {
  id: string;
  at: string;
  outcome: RestorePreviousRuntimeOutcome;
  reason?: RestorePreviousRuntimeReason;
  /** INVARIANT: rollback is local software state only, never physical hardware. */
  physicalHardware: false;
  backupAvailable: boolean;
  /** The rollback image selected for restore, when one was available. */
  backup: SoftControllerBackupInfo;
  imageChecksumValid?: boolean;
  runtimeChecksumValid?: boolean;
  /** True when Restore stopped a running software scan before applying the image. */
  stoppedRunningScan: boolean;
  restoredProjectId?: string;
  restoredProjectName?: string;
  restoredRuntimeChecksum?: string;
  replacedRuntimeChecksum?: string;
}

/** Result of Restore Previous Runtime / rollback. */
export interface RestorePreviousRuntimeResult extends SoftControllerResult {
  restored: boolean;
  outcome: RestorePreviousRuntimeOutcome;
  reason?: RestorePreviousRuntimeReason;
  error?: string;
  backupAvailable: boolean;
  /** Backup availability after the command completes. */
  backup: SoftControllerBackupInfo;
  audit: RestorePreviousRuntimeAudit;
}

/** Construction / configuration options. */
export interface SoftControllerOptions {
  controllerId?: string;
  name?: string;
  firmwareRevision?: string;
  serialNumber?: string;
  /** Modeled scan period (ms) used when a scan tick is requested without an explicit step. */
  scanIntervalMs?: number;
  /** Injectable clock (ISO string) for deterministic tests. */
  now?: () => string;
}
