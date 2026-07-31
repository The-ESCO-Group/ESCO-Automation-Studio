/**
 * ESCO SoftController — the software-controller download target.
 *
 * The ESCO SoftController is an ESCO-owned **software** controller: a runtime
 * target that loads and holds a compiled `.easruntime` image entirely in
 * software. It is NOT physical hardware and never claims to be — every
 * SoftController reports `isPhysicalHardware: false`, and there is deliberately
 * no method on it that reaches a real device. This is the safe destination the
 * IDE/backend can actually download a built runtime into.
 *
 * This module owns the device side of the download protocol:
 *
 *   identify()        → report the SoftController's target identity
 *   createBackup()    → snapshot the current image before it is overwritten
 *   receiveRuntime()  → accept `.easruntime` bytes as audited software chunks and
 *                       re-validate the checksum ON THE TARGET (independent
 *                       recompute from received bytes)
 *   applyStaged()     → stop scan, apply the staged image, optionally reset tag
 *                       memory, and return to Program/Run mode
 *
 * The orchestration that drives these steps (and builds the runtime) lives in
 * `soft-controller-download.ts`. Splitting them keeps this a faithful "device"
 * with no knowledge of how the runtime was produced.
 */

import { createId, nowIso } from "@esco/shared";
import {
  parseRuntimeFile,
  runtimeChecksum,
  EASRT_SCHEMA_VERSION,
  type EscoRuntime,
} from "./runtime-format";
import {
  planSoftControllerTransfer,
  type SoftControllerTransferChunk,
  type SoftControllerTransferPlan,
} from "./controller-download-lifecycle";

/** Default ESCO SoftController platform/family identifier. */
export const ESCO_SOFT_CONTROLLER_PLATFORM = "esco-soft-controller";

/** Default software catalog/SKU for the ESCO SoftController (software, not hardware). */
export const ESCO_SOFT_CONTROLLER_CATALOG = "ESCO-SOFT-1";

/** Default SoftController runtime/firmware revision. */
export const ESCO_SOFT_CONTROLLER_FIRMWARE = "1.0.0";

/**
 * Identity reported by an ESCO SoftController. The `isPhysicalHardware: false`
 * literal is a load-bearing invariant: it is part of the type, so a SoftController
 * can never type-check while claiming to be hardware.
 */
export interface SoftControllerTargetIdentity {
  /** Instance name of the running ESCO SoftController. */
  name: string;
  /** ESCO software-controller platform family (never a physical hardware family). */
  platform: string;
  /** SoftController runtime/firmware revision. */
  firmwareRevision: string;
  /** SoftController catalog/SKU (a software SKU, not a hardware catalog number). */
  catalogNumber: string;
  vendor: "ESCO Automation";
  /** INVARIANT: an ESCO SoftController is software — never physical hardware. */
  isPhysicalHardware: false;
  /** Highest `.easruntime` schema version this SoftController can load. */
  maxRuntimeSchemaVersion: number;
  /**
   * Processor types this SoftController accepts, or `"any"` for any ESCO-native
   * runtime. Used to reject runtimes built for an incompatible target platform.
   */
  accepts: "any" | string[];
  /** Id of the project image currently loaded, or null when the SoftController is empty. */
  loadedProjectId: string | null;
}

/** A backup of the SoftController's image, taken before an overwrite. */
export interface SoftControllerBackup {
  id: string;
  at: string;
  /** True when the SoftController had no prior image (nothing to restore). */
  empty: boolean;
  projectId?: string;
  projectName?: string;
  /** Content checksum of the prior loaded image. */
  checksum?: string;
  /** The prior image bytes, retained so the backup can be restored. */
  runtimeText?: string;
  schemaVersion?: number;
}

/** Result of streaming `.easruntime` bytes into the SoftController (the transfer step). */
export interface SoftControllerReceiveResult {
  /** True when the bytes were accepted and staged for apply. */
  accepted: boolean;
  /** Checksum the SoftController recomputed from the bytes it actually received. */
  checksum: string;
  /**
   * True only when the recomputed checksum matches the declared checksum AND the
   * received runtime parses and self-verifies. This is validated on the target.
   */
  checksumValid: boolean;
  /** Number of bytes received. */
  bytes: number;
  /** Chunk size requested by the sender for the software transfer. */
  chunkSize?: number;
  /** Number of chunks in the transfer ledger. */
  chunkCount?: number;
  /** Per-chunk audit/debug ledger. */
  chunks?: SoftControllerTransferChunk[];
  error?: string;
}

export type SoftControllerReturnMode = "program" | "run";

/** Options for the apply/restart step. */
export interface SoftControllerApplyInput {
  /** Reset (clear/re-initialize) tag memory to power-up values during apply. */
  resetTagMemory?: boolean;
  /** Mode to return to after the runtime is applied. Defaults to "program". */
  mode?: SoftControllerReturnMode;
}

/** Result of applying the staged image (apply/restart step). */
export interface SoftControllerApplyResult {
  applied: boolean;
  /** True when an active scan had to be stopped before applying. */
  scanStopped: boolean;
  /** True when tag memory was reset as part of the apply. */
  tagMemoryReset: boolean;
  /** The mode the SoftController is in after apply. */
  mode: SoftControllerReturnMode;
  error?: string;
}

/**
 * The device-side contract the download orchestration drives. The concrete
 * {@link InMemorySoftController} implements it; tests can supply a fake. Nothing on
 * this interface can reach physical hardware.
 */
export interface SoftControllerTarget {
  identify(): SoftControllerTargetIdentity;
  createBackup(at: string): SoftControllerBackup;
  receiveRuntime(runtimeText: string, declaredChecksum: string, chunkSize?: number): SoftControllerReceiveResult;
  applyStaged(input: SoftControllerApplyInput, at: string): SoftControllerApplyResult;
}

/** The image currently loaded on (or staged for) the SoftController. */
export interface SoftControllerRuntimeImage {
  projectId: string;
  projectName: string;
  checksum: string;
  schemaVersion: number;
  runtimeText: string;
  appliedAt?: string;
}

export interface InMemorySoftControllerOptions {
  name?: string;
  firmwareRevision?: string;
  catalogNumber?: string;
  platform?: string;
  maxRuntimeSchemaVersion?: number;
  /** Processor types this SoftController accepts. Defaults to `"any"`. */
  accepts?: "any" | string[];
  /** Initial controller mode. Defaults to "program". */
  initialMode?: SoftControllerReturnMode;
  /** Whether the SoftController starts out scanning. Defaults to (initialMode === "run"). */
  scanning?: boolean;
  /** Seed an already-loaded image so backup-before-overwrite can be exercised. */
  initialImage?: { runtimeText: string };
  /**
   * Simulate a corrupted transfer: mutate the received bytes before validating,
   * so the on-target checksum recompute fails. For tests / fault injection only.
   */
  corruptOnReceive?: boolean;
  now?: () => string;
  createId?: () => string;
}

/**
 * Mutate `.easruntime` text so its content no longer matches its embedded
 * checksum — models a corrupted transfer. Returns the input unchanged if it
 * cannot be parsed (the parse step will then reject it anyway).
 */
function corruptRuntimeText(text: string): string {
  try {
    const file = JSON.parse(text) as { runtime?: { identity?: { projectName?: unknown } } };
    if (file.runtime?.identity && typeof file.runtime.identity.projectName === "string") {
      file.runtime.identity.projectName += " (corrupted-in-transit)";
      return JSON.stringify(file);
    }
  } catch {
    /* fall through */
  }
  return text + " ";
}

/**
 * An in-memory, software-only ESCO SoftController download target — the reference
 * implementation of {@link SoftControllerTarget}. It loads compiled `.easruntime`
 * images, backs up before overwrite, validates checksums on receipt, and applies
 * with mode/tag-memory control, all in memory. Deterministic and framework-free:
 * `now()` and `createId()` are injectable so downloads are reproducible in tests.
 * There is no code path here that contacts a physical device.
 *
 * The executable SoftController (which actually scans logic via the simulator)
 * lives in the `@esco/soft-controller` package; it can be adapted to this same
 * {@link SoftControllerTarget} port so the download orchestration drives either.
 */
export class InMemorySoftController implements SoftControllerTarget {
  /** Compile-time-honest invariant: a SoftController is never physical hardware. */
  static readonly isPhysicalHardware = false;

  private readonly name: string;
  private readonly firmwareRevision: string;
  private readonly catalogNumber: string;
  private readonly platform: string;
  private readonly maxRuntimeSchemaVersion: number;
  private readonly accepts: "any" | string[];
  private readonly corruptOnReceive: boolean;
  private readonly now: () => string;
  private readonly newId: () => string;

  private image: SoftControllerRuntimeImage | null = null;
  private staged: SoftControllerRuntimeImage | null = null;
  private mode: SoftControllerReturnMode;
  private scanning: boolean;
  private backups: SoftControllerBackup[] = [];
  private tagMemoryGeneration = 0;

  constructor(options: InMemorySoftControllerOptions = {}) {
    this.name = options.name ?? "ESCO SoftController";
    this.firmwareRevision = options.firmwareRevision ?? ESCO_SOFT_CONTROLLER_FIRMWARE;
    this.catalogNumber = options.catalogNumber ?? ESCO_SOFT_CONTROLLER_CATALOG;
    this.platform = options.platform ?? ESCO_SOFT_CONTROLLER_PLATFORM;
    this.maxRuntimeSchemaVersion = options.maxRuntimeSchemaVersion ?? EASRT_SCHEMA_VERSION;
    this.accepts = options.accepts ?? "any";
    this.corruptOnReceive = options.corruptOnReceive ?? false;
    this.now = options.now ?? nowIso;
    this.newId = options.createId ?? (() => createId("scbak"));
    this.mode = options.initialMode ?? "program";
    this.scanning = options.scanning ?? this.mode === "run";

    if (options.initialImage) {
      const loaded = parseRuntimeFile(options.initialImage.runtimeText);
      if (loaded.ok && loaded.runtime) {
        this.image = imageFromRuntime(loaded.runtime, options.initialImage.runtimeText);
      }
    }
  }

  identify(): SoftControllerTargetIdentity {
    return {
      name: this.name,
      platform: this.platform,
      firmwareRevision: this.firmwareRevision,
      catalogNumber: this.catalogNumber,
      vendor: "ESCO Automation",
      isPhysicalHardware: false,
      maxRuntimeSchemaVersion: this.maxRuntimeSchemaVersion,
      accepts: this.accepts === "any" ? "any" : [...this.accepts],
      loadedProjectId: this.image?.projectId ?? null,
    };
  }

  /** Snapshot the current image before an overwrite. Handles the empty controller. */
  createBackup(at: string = this.now()): SoftControllerBackup {
    if (!this.image) {
      const backup: SoftControllerBackup = { id: this.newId(), at, empty: true };
      this.backups.push(backup);
      return backup;
    }
    const backup: SoftControllerBackup = {
      id: this.newId(),
      at,
      empty: false,
      projectId: this.image.projectId,
      projectName: this.image.projectName,
      checksum: this.image.checksum,
      runtimeText: this.image.runtimeText,
      schemaVersion: this.image.schemaVersion,
    };
    this.backups.push(backup);
    return backup;
  }

  /**
   * Receive `.easruntime` bytes and validate the checksum on the target by
   * recomputing it from the bytes actually received. Only a clean, self-verifying
   * runtime whose recomputed checksum matches the declared checksum is staged.
   */
  receiveRuntime(runtimeText: string, declaredChecksum: string, chunkSize?: number): SoftControllerReceiveResult {
    const received = this.corruptOnReceive ? corruptRuntimeText(runtimeText) : runtimeText;
    const transferPlan = planSoftControllerTransfer(received, chunkSize);
    const bytes = transferPlan.totalBytes;
    const parsed = parseRuntimeFile(received);

    if (!parsed.ok || !parsed.runtime) {
      return {
        accepted: false,
        checksum: parsed.checksum?.actual ?? "",
        checksumValid: false,
        bytes,
        ...transferReceipt(transferPlan),
        error:
          parsed.error ??
          "ESCO SoftController rejected the runtime: it failed integrity validation on the target.",
      };
    }

    const recomputed = runtimeChecksum(parsed.runtime);
    const checksumValid = parsed.checksum?.valid === true && recomputed === declaredChecksum;
    if (!checksumValid) {
      return {
        accepted: false,
        checksum: recomputed,
        checksumValid: false,
        bytes,
        ...transferReceipt(transferPlan),
        error:
          "ESCO SoftController checksum mismatch: the runtime received on the target does not match the checksum computed at the source (corrupt or modified in transfer).",
      };
    }

    this.staged = imageFromRuntime(parsed.runtime, received);
    return { accepted: true, checksum: recomputed, checksumValid: true, bytes, ...transferReceipt(transferPlan) };
  }

  /**
   * Apply the staged image: stop the scan if running, swap in the new image,
   * optionally reset tag memory, then return to the requested mode.
   */
  applyStaged(input: SoftControllerApplyInput = {}, at: string = this.now()): SoftControllerApplyResult {
    if (!this.staged) {
      return {
        applied: false,
        scanStopped: false,
        tagMemoryReset: false,
        mode: this.mode,
        error: "ESCO SoftController has no staged runtime to apply. Transfer a runtime first.",
      };
    }

    const scanStopped = this.scanning;
    this.scanning = false;

    this.image = { ...this.staged, appliedAt: at };
    this.staged = null;

    const tagMemoryReset = input.resetTagMemory === true;
    if (tagMemoryReset) this.tagMemoryGeneration += 1;

    const mode = input.mode ?? "program";
    this.mode = mode;
    this.scanning = mode === "run";

    return { applied: true, scanStopped, tagMemoryReset, mode };
  }

  // --- read-only inspection (for the host UI / tests) ----------------------

  getMode(): SoftControllerReturnMode {
    return this.mode;
  }

  isScanning(): boolean {
    return this.scanning;
  }

  getImage(): SoftControllerRuntimeImage | null {
    return this.image ? { ...this.image } : null;
  }

  getStaged(): SoftControllerRuntimeImage | null {
    return this.staged ? { ...this.staged } : null;
  }

  getBackups(): SoftControllerBackup[] {
    return [...this.backups];
  }

  getTagMemoryGeneration(): number {
    return this.tagMemoryGeneration;
  }
}

function imageFromRuntime(runtime: EscoRuntime, runtimeText: string): SoftControllerRuntimeImage {
  return {
    projectId: runtime.identity.projectId,
    projectName: runtime.identity.projectName,
    checksum: runtimeChecksum(runtime),
    schemaVersion: runtime.schemaVersion,
    runtimeText,
  };
}

function transferReceipt(
  plan: SoftControllerTransferPlan,
): Pick<SoftControllerReceiveResult, "chunkSize" | "chunkCount" | "chunks"> {
  return { chunkSize: plan.chunkSize, chunkCount: plan.chunkCount, chunks: plan.chunks };
}
