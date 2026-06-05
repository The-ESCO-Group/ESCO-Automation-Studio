/**
 * ESCO SoftController download orchestration.
 *
 * Drives a built `.easruntime` runtime safely into an {@link SoftControllerTarget}
 * (the ESCO SoftController — a software controller, never physical hardware). The
 * flow is a strict, ordered pipeline; every stage can block, and an audit record
 * is ALWAYS produced regardless of outcome:
 *
 *   1. Preflight  — build the `.easruntime`, fail on hard validation errors, and
 *                   surface model-only / review-only build warnings.
 *   2. Compare    — read the SoftController identity and compare it to the
 *                   project's target identity; reject an incompatible target,
 *                   warn on a (non-blocking) mismatch.
 *   3. Backup     — snapshot the controller's current image before overwriting it
 *                   (handles an empty controller).
 *   4. Transfer   — stream the runtime to the SoftController, which validates the
 *                   checksum ON THE TARGET.
 *   5. Apply      — stop scan, apply the runtime, optionally reset tag memory, and
 *                   return to Program / Run mode.
 *   6. Audit      — record the attempt, preflight result, warnings, checksum,
 *                   target identity, and backup id.
 *
 * Physical-hardware download is intentionally unsupported: there is no hardware
 * code path here, and the audit always records `physicalHardware: false`.
 */

import type { Controller, PlcProject } from "@esco/core";
import { createId, nowIso } from "@esco/shared";
import { buildRuntime, type BuildRuntimeOptions } from "./runtime-build";
import {
  EASRT_EXTENSION,
  runtimeChecksum,
  serializeRuntime,
  type EscoRuntime,
  type RuntimeBuildSummary,
} from "./runtime-format";
import type {
  SoftControllerApplyResult,
  SoftControllerBackup,
  SoftControllerTargetIdentity,
  SoftControllerReturnMode,
  SoftControllerReceiveResult,
  SoftControllerTarget,
} from "./soft-controller";

// ---------------------------------------------------------------------------
// Target identity + comparison
// ---------------------------------------------------------------------------

/** The download target identity derived from the project + compiled runtime. */
export interface ProjectTargetIdentity {
  projectId: string;
  projectName: string;
  controllerId: string;
  controllerName: string;
  processorType?: string;
  catalogNumber?: string;
  firmwareRevision?: string;
  /** Schema version of the `.easruntime` the project compiles to. */
  runtimeSchemaVersion: number;
}

export type TargetCompatibility = "compatible" | "compatible-with-warnings" | "incompatible";

export interface TargetComparison {
  status: TargetCompatibility;
  /** True when the download must be rejected (a hard incompatibility). */
  rejected: boolean;
  /** The hard reason the target is incompatible (only set when rejected). */
  rejectReason?: string;
  /** Non-blocking target mismatches (shown to the operator). */
  warnings: string[];
  project: ProjectTargetIdentity;
  controller: SoftControllerTargetIdentity;
}

/** Derive the project's download-target identity from the project + its runtime. */
export function projectTargetIdentity(project: PlcProject, runtime: EscoRuntime): ProjectTargetIdentity {
  const controller: Controller | undefined = project.controllers[0];
  return {
    projectId: project.id,
    projectName: project.name,
    controllerId: controller?.id ?? "",
    controllerName: controller?.name ?? project.name,
    ...(controller?.processorType ? { processorType: controller.processorType } : {}),
    ...(controller?.catalogNumber ? { catalogNumber: controller.catalogNumber } : {}),
    ...(controller?.firmwareRevision ? { firmwareRevision: controller.firmwareRevision } : {}),
    runtimeSchemaVersion: runtime.schemaVersion,
  };
}

/**
 * Compare the project's target identity against the SoftController's identity.
 * Hard incompatibilities (which `reject`) are: a runtime schema the controller
 * cannot load, or a processor type outside an explicitly restricted SoftController.
 * Everything else is a non-blocking warning, including the always-true fact that a
 * project authored for a hardware processor runs here in software emulation.
 */
export function compareTarget(
  project: ProjectTargetIdentity,
  controller: SoftControllerTargetIdentity,
): TargetComparison {
  const warnings: string[] = [];
  let rejectReason: string | undefined;

  // Hard gate 1: the SoftController must be able to load this runtime schema.
  if (project.runtimeSchemaVersion > controller.maxRuntimeSchemaVersion) {
    rejectReason = `Incompatible target: the runtime uses schema version ${project.runtimeSchemaVersion}, but "${controller.name}" only loads up to version ${controller.maxRuntimeSchemaVersion}. Update the ESCO SoftController.`;
  }

  // Hard gate 2: a SoftController with a restricted processor list rejects a
  // declared processor type it does not accept.
  if (!rejectReason && controller.accepts !== "any" && project.processorType) {
    if (!controller.accepts.includes(project.processorType)) {
      rejectReason = `Incompatible target: the project targets processor "${project.processorType}", which "${controller.name}" does not accept (accepted: ${controller.accepts.join(", ") || "none"}).`;
    }
  }

  if (rejectReason) {
    return { status: "incompatible", rejected: true, rejectReason, warnings, project, controller };
  }

  // Non-blocking mismatches.
  if (project.processorType) {
    warnings.push(
      `Project targets processor type "${project.processorType}"; the ESCO SoftController runs it in software (not physical hardware).`,
    );
  } else {
    warnings.push(
      "Project controller has no processor type set; target compatibility cannot be fully confirmed.",
    );
  }
  if (controller.loadedProjectId && controller.loadedProjectId !== project.projectId) {
    warnings.push(
      "The ESCO SoftController currently holds a different project image; it will be backed up and overwritten.",
    );
  }

  return {
    status: warnings.length > 0 ? "compatible-with-warnings" : "compatible",
    rejected: false,
    warnings,
    project,
    controller,
  };
}

// ---------------------------------------------------------------------------
// Download orchestration
// ---------------------------------------------------------------------------

export type DownloadStage = "preflight" | "compare" | "backup" | "transfer" | "apply" | "complete";

export type DownloadOutcome = "success" | "blocked" | "failed";

export interface DownloadPreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary?: RuntimeBuildSummary;
  fileName?: string;
  checksum?: string;
}

/** The audit record produced for every SoftController download attempt. */
export interface SoftControllerDownloadAudit {
  id: string;
  at: string;
  outcome: DownloadOutcome;
  /** The stage the attempt reached (where it stopped, or "complete"). */
  stage: DownloadStage;
  attempt: {
    projectId: string;
    projectName: string;
    controllerName?: string;
    target?: string;
  };
  preflight: { ok: boolean; errorCount: number; warningCount: number; warnings: string[] };
  /** All non-blocking warnings surfaced across the flow. */
  warnings: string[];
  /** Checksum of the transferred runtime, when one was built. */
  checksum?: string;
  /** Whether the checksum validated on the target, when a transfer was attempted. */
  checksumValid?: boolean;
  /** The compared target identities, when comparison ran. */
  targetIdentity?: { project: ProjectTargetIdentity; controller: SoftControllerTargetIdentity };
  /** The backup id created before overwrite, when backup ran. */
  backupId?: string;
  /** INVARIANT: this flow never touches physical hardware. */
  physicalHardware: false;
}

export interface SoftControllerDownloadResult {
  ok: boolean;
  stage: DownloadStage;
  outcome: DownloadOutcome;
  message: string;
  error?: string;
  warnings: string[];
  preflight: DownloadPreflightResult;
  comparison?: TargetComparison;
  backup?: SoftControllerBackup;
  transfer?: SoftControllerReceiveResult;
  apply?: SoftControllerApplyResult;
  /** Always produced — the tamper-evident record of what was attempted. */
  audit: SoftControllerDownloadAudit;
}

export interface DownloadToSoftControllerOptions extends Pick<BuildRuntimeOptions, "appVersion" | "builtAt" | "hmi" | "hmiProject"> {
  /** Clock for audit / backup timestamps; injectable for determinism. */
  now?: () => string;
  /** Id factory for the audit record; injectable for determinism. */
  createId?: () => string;
  /** Reset tag memory to power-up values when applying the runtime. */
  resetTagMemory?: boolean;
  /** Mode to return to after the runtime is applied. Defaults to "program". */
  returnToMode?: SoftControllerReturnMode;
}

function runtimeFileSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "esco-runtime";
}

/**
 * Build a project's runtime and download it into an ESCO SoftController, safely
 * and with a full audit trail. Never throws for expected failures and never
 * touches physical hardware. See the module header for the ordered flow.
 */
export function downloadToSoftController(
  project: PlcProject,
  target: SoftControllerTarget,
  options: DownloadToSoftControllerOptions = {},
): SoftControllerDownloadResult {
  const now = options.now ?? nowIso;
  const auditId = options.createId ?? (() => createId("scdl"));
  const at = now();
  const warnings: string[] = [];

  // Mutable scratch the audit builder reads from as the flow progresses.
  let preflight: DownloadPreflightResult = { ok: false, errors: [], warnings: [] };
  let comparison: TargetComparison | undefined;
  let backup: SoftControllerBackup | undefined;
  let transfer: SoftControllerReceiveResult | undefined;
  let apply: SoftControllerApplyResult | undefined;

  const buildAudit = (outcome: DownloadOutcome, stage: DownloadStage): SoftControllerDownloadAudit => ({
    id: auditId(),
    at,
    outcome,
    stage,
    attempt: {
      projectId: project.id,
      projectName: project.name,
      ...(comparison ? { controllerName: comparison.project.controllerName } : {}),
      ...(comparison ? { target: comparison.controller.name } : {}),
    },
    preflight: {
      ok: preflight.ok,
      errorCount: preflight.errors.length,
      warningCount: preflight.warnings.length,
      warnings: [...preflight.warnings],
    },
    warnings: [...warnings],
    ...(preflight.checksum ? { checksum: preflight.checksum } : {}),
    ...(transfer ? { checksumValid: transfer.checksumValid } : {}),
    ...(comparison
      ? { targetIdentity: { project: comparison.project, controller: comparison.controller } }
      : {}),
    ...(backup ? { backupId: backup.id } : {}),
    physicalHardware: false,
  });

  const finish = (
    ok: boolean,
    outcome: DownloadOutcome,
    stage: DownloadStage,
    message: string,
    error?: string,
  ): SoftControllerDownloadResult => ({
    ok,
    stage,
    outcome,
    message,
    ...(error ? { error } : {}),
    warnings: [...warnings],
    preflight,
    ...(comparison ? { comparison } : {}),
    ...(backup ? { backup } : {}),
    ...(transfer ? { transfer } : {}),
    ...(apply ? { apply } : {}),
    audit: buildAudit(outcome, stage),
  });

  // --- 1. Preflight: build the .easruntime ---------------------------------
  const built = buildRuntime(project, {
    ...(options.appVersion ? { appVersion: options.appVersion } : {}),
    ...(options.builtAt ? { builtAt: options.builtAt } : {}),
    ...(options.hmi ? { hmi: options.hmi } : {}),
    ...(options.hmiProject ? { hmiProject: options.hmiProject } : {}),
  });
  preflight = {
    ok: built.ok,
    errors: [...built.errors],
    warnings: [...built.warnings],
    ...(built.summary ? { summary: built.summary } : {}),
  };
  // Surface model-only / review-only build warnings on the flow.
  warnings.push(...built.warnings);

  if (!built.ok || !built.runtime || !built.summary) {
    return finish(
      false,
      "blocked",
      "preflight",
      "Download blocked: the project failed runtime preflight validation.",
      built.errors[0] ?? "ESCO Runtime build failed.",
    );
  }

  const runtime = built.runtime;
  const runtimeText = serializeRuntime(runtime);
  const checksum = runtimeChecksum(runtime);
  preflight = {
    ...preflight,
    fileName: `${runtimeFileSlug(project.name)}${EASRT_EXTENSION}`,
    checksum,
  };

  // --- 2. Compare target identity ------------------------------------------
  const controllerIdentity = target.identify();
  const projectIdentity = projectTargetIdentity(project, runtime);
  comparison = compareTarget(projectIdentity, controllerIdentity);
  warnings.push(...comparison.warnings);

  if (comparison.rejected) {
    return finish(
      false,
      "blocked",
      "compare",
      "Download blocked: the project is incompatible with the selected ESCO SoftController.",
      comparison.rejectReason ?? "Incompatible target.",
    );
  }

  // --- 3. Backup before overwrite ------------------------------------------
  backup = target.createBackup(at);

  // --- 4. Transfer: stream the runtime, checksum-validate on target --------
  transfer = target.receiveRuntime(runtimeText, checksum);
  if (!transfer.accepted || !transfer.checksumValid) {
    return finish(
      false,
      "failed",
      "transfer",
      "Download failed: the ESCO SoftController rejected the runtime during transfer.",
      transfer.error ?? "Checksum validation failed on the target.",
    );
  }

  // --- 5. Apply / restart --------------------------------------------------
  apply = target.applyStaged(
    {
      ...(options.resetTagMemory !== undefined ? { resetTagMemory: options.resetTagMemory } : {}),
      mode: options.returnToMode ?? "program",
    },
    at,
  );
  if (!apply.applied) {
    return finish(
      false,
      "failed",
      "apply",
      "Download failed: the ESCO SoftController could not apply the runtime.",
      apply.error ?? "Apply failed on the target.",
    );
  }

  // --- 6. Success ----------------------------------------------------------
  const modeLabel = apply.mode === "run" ? "Run" : "Program";
  return finish(
    true,
    "success",
    "complete",
    `Downloaded "${project.name}" to ${controllerIdentity.name} (software). Checksum verified on target; now in ${modeLabel} mode.`,
  );
}
