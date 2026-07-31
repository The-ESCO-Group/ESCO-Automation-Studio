/**
 * Adapter from the project-actions SoftControllerTarget port to the executable
 * ESCO SoftController. This keeps download orchestration in project-actions
 * while letting backend/session code target the real in-process controller.
 */

import {
  EASRT_SCHEMA_VERSION,
  parseRuntimeFile,
  planSoftControllerTransfer,
  runtimeChecksum,
  type SoftControllerApplyInput,
  type SoftControllerApplyResult,
  type SoftControllerBackup,
  type SoftControllerReceiveResult,
  type SoftControllerTarget,
  type SoftControllerTargetIdentity,
} from "@esco/project-actions";
import { createId } from "@esco/shared";
import { EscoSoftController } from "./soft-controller";

export interface EscoSoftControllerTargetAdapterOptions {
  /** Processor families accepted by this software controller. Defaults to any ESCO runtime. */
  accepts?: "any" | string[];
  /** Platform string reported to project-actions target comparison. */
  platform?: string;
  /** Id factory for project-actions backup audit records. */
  createBackupId?: () => string;
}

const DEFAULT_SOFT_CONTROLLER_PLATFORM = "esco-soft-controller";

export class EscoSoftControllerTargetAdapter implements SoftControllerTarget {
  private readonly accepts: "any" | string[];
  private readonly platform: string;
  private readonly createBackupId: () => string;
  private staged: { text: string; checksum: string } | null = null;

  constructor(
    private readonly controller: EscoSoftController,
    options: EscoSoftControllerTargetAdapterOptions = {},
  ) {
    this.accepts = options.accepts ?? "any";
    this.platform = options.platform ?? DEFAULT_SOFT_CONTROLLER_PLATFORM;
    this.createBackupId = options.createBackupId ?? (() => createId("scbak"));
  }

  identify(): SoftControllerTargetIdentity {
    const identity = this.controller.getIdentity();
    const status = this.controller.status();
    return {
      name: identity.name,
      platform: this.platform,
      firmwareRevision: identity.firmwareRevision,
      catalogNumber: identity.catalogNumber,
      vendor: "ESCO Automation",
      isPhysicalHardware: false,
      maxRuntimeSchemaVersion: EASRT_SCHEMA_VERSION,
      accepts: this.accepts === "any" ? "any" : [...this.accepts],
      loadedProjectId: status.runtime?.projectId ?? null,
    };
  }

  createBackup(at: string): SoftControllerBackup {
    const snapshot = this.controller.exportImage();
    if (!snapshot.runtime || !snapshot.runtimeText || !snapshot.runtimeChecksum) {
      return { id: this.createBackupId(), at, empty: true };
    }
    const parsed = parseRuntimeFile(snapshot.runtimeText);

    return {
      id: this.createBackupId(),
      at,
      empty: false,
      projectId: snapshot.runtime.projectId,
      projectName: snapshot.runtime.projectName,
      checksum: snapshot.runtimeChecksum,
      runtimeText: snapshot.runtimeText,
      schemaVersion: parsed.runtime?.schemaVersion ?? EASRT_SCHEMA_VERSION,
    };
  }

  receiveRuntime(runtimeText: string, declaredChecksum: string, chunkSize?: number): SoftControllerReceiveResult {
    const transferPlan = planSoftControllerTransfer(runtimeText, chunkSize);
    const transferReceipt = {
      chunkSize: transferPlan.chunkSize,
      chunkCount: transferPlan.chunkCount,
      chunks: transferPlan.chunks,
    };
    const bytes = transferPlan.totalBytes;
    const parsed = parseRuntimeFile(runtimeText);
    if (!parsed.ok || !parsed.runtime) {
      this.staged = null;
      return {
        accepted: false,
        checksum: parsed.checksum?.actual ?? "",
        checksumValid: false,
        bytes,
        ...transferReceipt,
        error:
          parsed.error ??
          "ESCO SoftController rejected the runtime: it failed integrity validation on the target.",
      };
    }

    const recomputed = runtimeChecksum(parsed.runtime);
    const checksumValid = parsed.checksum?.valid === true && recomputed === declaredChecksum;
    if (!checksumValid) {
      this.staged = null;
      return {
        accepted: false,
        checksum: recomputed,
        checksumValid: false,
        bytes,
        ...transferReceipt,
        error:
          "ESCO SoftController checksum mismatch: the runtime received on the target does not match the checksum computed at the source.",
      };
    }

    this.staged = { text: runtimeText, checksum: recomputed };
    return { accepted: true, checksum: recomputed, checksumValid: true, bytes, ...transferReceipt };
  }

  applyStaged(input: SoftControllerApplyInput = {}, _at: string): SoftControllerApplyResult {
    if (!this.staged) {
      return {
        applied: false,
        scanStopped: false,
        tagMemoryReset: false,
        mode: input.mode ?? "program",
        error: "ESCO SoftController has no staged runtime to apply. Transfer a runtime first.",
      };
    }

    const scanStopped = this.controller.isRunning();
    if (scanStopped) this.controller.stopScan();

    const loaded = this.controller.loadRuntimeText(this.staged.text);
    this.staged = null;
    if (!loaded.ok) {
      return {
        applied: false,
        scanStopped,
        tagMemoryReset: false,
        mode: input.mode ?? "program",
        error: loaded.message,
      };
    }

    const mode = input.mode ?? "program";
    if (mode === "run") {
      const run = this.controller.startScan();
      if (!run.ok) {
        return {
          applied: false,
          scanStopped,
          tagMemoryReset: true,
          mode: "program",
          error: run.message,
        };
      }
    } else {
      this.controller.setMode("program");
    }

    return {
      applied: true,
      scanStopped,
      tagMemoryReset: true,
      mode,
    };
  }
}

export function createSoftControllerTarget(
  controller: EscoSoftController,
  options: EscoSoftControllerTargetAdapterOptions = {},
): SoftControllerTarget {
  return new EscoSoftControllerTargetAdapter(controller, options);
}
