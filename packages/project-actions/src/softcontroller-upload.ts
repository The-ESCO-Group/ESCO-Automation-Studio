/**
 * ESCO SoftController upload — reconstruct an ESCO project model from a
 * SoftController runtime image.
 *
 * "Upload" here is the ESCO SoftController sense: read the runtime image that was
 * previously downloaded to the ESCO SoftController and reconstruct an inspectable
 * ESCO project model from it. The ESCO SoftController is an ESCO-owned *software*
 * controller, never a proprietary binary/interchange source and never a physical
 * controller. This flow makes no hardware claims: physical-controller upload stays
 * unsupported and is gated elsewhere (see `@esco/controller-comm`).
 *
 * The reconstruction is strictly read-only. It parses and integrity-checks the
 * runtime image, rebuilds controllers / tasks / programs / routines / tags and
 * I/O config as offline metadata, preserves the controller identity and any HMI
 * references, stamps honest provenance (source type, uploaded-at, serial/version,
 * runtime checksum), and reports warnings for runtime-only data that cannot be
 * fully reconstructed. Disconnected and empty controllers fail cleanly.
 *
 * Pure: never mutates the caller's project and never talks to hardware. The
 * returned project is a candidate; callers preview it (counts + warnings) before
 * deciding to replace the active project.
 */

import { createProject, type Controller, type PlcProject } from "@esco/core";
import { getHmiProject, isHmiProject } from "@esco/hmi-model";
import { nowIso } from "@esco/shared";
import { fail, getAllTags, ok } from "./helpers";
import { recordImportProvenance } from "./provenance";
import { runtimeToInspectionProject } from "./runtime-actions";
import { parseRuntimeFile, type EscoRuntime } from "./runtime-format";
import type { ProjectActionResult } from "./types";

/**
 * Controller identity as read from an ESCO SoftController. Mirrors what the
 * SoftController session reports; every field is optional so partial reads still
 * upload cleanly. (Structurally compatible with the controller-comm
 * `VirtualControllerIdentity` so a session image can be passed straight through.)
 */
export interface SoftControllerIdentity {
  name?: string;
  catalogNumber?: string;
  serialNumber?: string;
  firmwareRevision?: string;
  vendor?: string;
}

/**
 * The image read from an ESCO SoftController for upload: the four reads the flow
 * needs — connection state, controller identity, installed-runtime metadata, and
 * the serialized runtime image (the tag database is embedded in that image).
 */
export interface SoftControllerImage {
  /** Whether the SoftController session is connected. `false` → upload fails cleanly. */
  connected: boolean;
  /** Controller identity read from the SoftController (serial / version / catalog). */
  identity?: SoftControllerIdentity;
  /** Installed runtime image: the serialized `.easruntime` text stored on the controller. */
  runtimeImage?: string;
  /** When the runtime image was downloaded/installed onto the SoftController (ISO), if known. */
  installedAt?: string;
}

export interface SoftControllerUploadOptions {
  /** ISO timestamp the upload occurred. Injectable to keep callers deterministic in tests. */
  uploadedAt?: string;
  /** A source label recorded in provenance (e.g. the SoftController path / image name). */
  fileName?: string;
}

/** Reconstruction counts surfaced in the upload preview. */
export interface SoftControllerUploadCounts {
  controllers: number;
  tasks: number;
  programs: number;
  routines: number;
  tags: number;
  ioModules: number;
  hmiReferences: number;
  warnings: number;
}

/**
 * A preview of what an upload would reconstruct, shown to the user *before* the
 * active project is replaced. Carries the controller identity/checksum it came
 * from, the reconstruction counts, and the warnings.
 */
export interface SoftControllerUploadPreview {
  projectName: string;
  controllerName?: string;
  serialNumber?: string;
  firmwareRevision?: string;
  /** ESCO runtime compiler version that produced the uploaded image. */
  runtimeVersion?: string;
  /** SHA-256 integrity checksum of the uploaded runtime image. */
  runtimeChecksum: string;
  /** Whether the runtime image integrity checksum verified. */
  checksumValid: boolean;
  /** ISO timestamp the reconstruction (upload) happened. */
  uploadedAt: string;
  /** When the image was downloaded onto the SoftController, when reported. */
  installedAt?: string;
  counts: SoftControllerUploadCounts;
  warnings: string[];
  /** True when the runtime carried a validated HMI project snapshot and upload restored it. */
  hmiProjectReconstructed: boolean;
}

export interface SoftControllerUploadData {
  preview: SoftControllerUploadPreview;
  /** True — this is a reconstructed, read-only upload, not a live editable hardware project. */
  reconstructed: true;
  /** Whether the runtime image integrity checksum verified on read. */
  checksumValid: boolean;
  /** HMI screen references preserved from the runtime image (names), when present. */
  hmiReferences: string[];
  /** True when a full HMI project snapshot was restored into the reconstructed project. */
  hmiProjectReconstructed: boolean;
}

function trimmedImage(runtimeImage: string | undefined): string | undefined {
  const text = runtimeImage?.trim();
  return text ? text : undefined;
}

/**
 * Build the human-facing warnings for runtime-only data that an upload cannot
 * fully reconstruct. Deduplicated; ordered most-structural first.
 */
function reconstructionWarnings(
  runtime: EscoRuntime,
  project: PlcProject,
  restoreWarnings: string[] = [],
): string[] {
  const warnings: string[] = [];

  warnings.push(
    "Reconstructed from an ESCO SoftController runtime image (read-only). Structure, tags, and I/O " +
      "are inspectable; routine logic is restored as read-only source and is not fully editable.",
  );
  warnings.push(...restoreWarnings);

  // Routine bodies the offline runtime preserved but cannot execute (FBD / SFC).
  for (const note of runtime.build.warnings) warnings.push(note);

  // I/O: the runtime image carries module identity, not the live connection table.
  const ioModules = project.controllers.reduce(
    (sum, controller) => sum + controller.ioConfiguration.modules.length,
    0,
  );
  if (ioModules > 0) {
    warnings.push(
      `Reconstructed ${ioModules} I/O module(s) as offline catalog/configuration metadata. Authored ports, ` +
        "connections, keying, and profile channels are preserved when present; live module state is not reconstructed.",
    );
  }

  // Tag values are the compiled power-up state, not live online values.
  if (Object.keys(runtime.initialValues).length > 0) {
    warnings.push(
      "Uploaded tag values are the compiled power-up state from the runtime image, not live controller values.",
    );
  }

  const hmiSnapshotValid = isHmiProject(runtime.hmi?.projectSnapshot);
  const hmiProject = getHmiProject(project);

  // New runtimes carry a validated HMI project snapshot; legacy runtimes may
  // carry only screen-reference metadata.
  if (runtime.hmi && runtime.hmi.screenCount > 0) {
    if (hmiSnapshotValid && hmiProject) {
      warnings.push(
        `Reconstructed HMI project snapshot "${hmiProject.name}" with ${hmiProject.screens.length} screen(s) ` +
          `and ${hmiProject.popups.length} popup(s) from the ESCO runtime image.`,
      );
    } else {
      warnings.push(
        `Preserved ${runtime.hmi.screenCount} HMI screen reference(s) from the runtime image as metadata; ` +
          "the HMI project itself is not reconstructed by upload.",
      );
    }
  }

  // Dedupe while preserving order.
  return [...new Set(warnings)];
}

/** Preserve the SoftController's controller identity onto the reconstructed controller. */
function preserveIdentity(controller: Controller, identity: SoftControllerIdentity | undefined): void {
  if (!identity) return;
  if (!controller.firmwareRevision && identity.firmwareRevision) {
    controller.firmwareRevision = identity.firmwareRevision;
  }
  if (!controller.catalogNumber && identity.catalogNumber) {
    controller.catalogNumber = identity.catalogNumber;
  }
}

/**
 * Reconstruct an ESCO project model from an ESCO SoftController runtime image.
 *
 * Fails cleanly (never throws) when the controller is disconnected, empty (no
 * downloaded project), or carries a corrupt/tampered runtime image. On success
 * the returned `project` is reconstructed and stamped with
 * `provenance.sourceType = "esco-softcontroller-upload"`, and `data.preview`
 * holds the counts + warnings to show before replacing the active project.
 */
export function uploadFromSoftController(
  image: SoftControllerImage,
  options: SoftControllerUploadOptions = {},
): ProjectActionResult<SoftControllerUploadData> {
  const uploadedAt = options.uploadedAt ?? nowIso();

  // 1 — Read controller identity / connection state.
  if (!image.connected) {
    return fail(
      createProject("Untitled"),
      "The ESCO SoftController is disconnected. Connect to the SoftController before uploading.",
    );
  }

  // 2 — Read the installed runtime image (the tag database is embedded in it).
  const runtimeImage = trimmedImage(image.runtimeImage);
  if (!runtimeImage) {
    return fail(
      createProject("Untitled"),
      "The ESCO SoftController is empty — no project has been downloaded to it. Download a project before uploading.",
    );
  }

  // 3 — Parse + integrity-check the runtime image.
  const loaded = parseRuntimeFile(runtimeImage);
  if (!loaded.ok || !loaded.runtime) {
    return fail(
      createProject("Untitled"),
      `Corrupt ESCO SoftController runtime image: ${loaded.error ?? "the image could not be read."}`,
    );
  }

  const runtime = loaded.runtime;
  const runtimeChecksum = loaded.checksum?.actual ?? "";
  const checksumValid = loaded.checksum?.valid ?? false;

  // 4 — Reconstruct the ESCO project model and preserve controller identity.
  const restoreWarnings: string[] = [];
  const reconstructed = runtimeToInspectionProject(runtime, restoreWarnings);
  const firstController = reconstructed.controllers[0];
  if (firstController) preserveIdentity(firstController, image.identity);

  const warnings = reconstructionWarnings(runtime, reconstructed, restoreWarnings);
  const hmiReferences = runtime.hmi?.screenNames ? [...runtime.hmi.screenNames] : [];
  const hmiProjectReconstructed = Boolean(getHmiProject(reconstructed));

  // 5 — Stamp honest, read-only provenance for the upload.
  const stamped = recordImportProvenance(reconstructed, {
    sourceType: "esco-softcontroller-upload",
    importedAt: uploadedAt,
    ...(options.fileName ? { fileName: options.fileName } : {}),
    softController: {
      ...(image.identity?.serialNumber ? { serialNumber: image.identity.serialNumber } : {}),
      ...(firstController?.firmwareRevision ? { firmwareRevision: firstController.firmwareRevision } : {}),
      ...(firstController?.catalogNumber ? { catalogNumber: firstController.catalogNumber } : {}),
      ...(runtime.runtimeVersion ? { runtimeVersion: runtime.runtimeVersion } : {}),
      ...(runtimeChecksum ? { runtimeChecksum } : {}),
      uploadedAt,
    },
  });

  const counts: SoftControllerUploadCounts = {
    controllers: stamped.controllers.length,
    tasks: stamped.controllers.reduce((sum, controller) => sum + controller.tasks.length, 0),
    programs: stamped.controllers.reduce((sum, controller) => sum + controller.programs.length, 0),
    routines: stamped.controllers.reduce(
      (sum, controller) => sum + controller.programs.reduce((s, program) => s + program.routines.length, 0),
      0,
    ),
    tags: getAllTags(stamped).length,
    ioModules: stamped.controllers.reduce(
      (sum, controller) => sum + controller.ioConfiguration.modules.length,
      0,
    ),
    hmiReferences: runtime.hmi?.screenCount ?? 0,
    warnings: warnings.length,
  };

  const preview: SoftControllerUploadPreview = {
    projectName: stamped.name,
    ...(firstController?.name ? { controllerName: firstController.name } : {}),
    ...(image.identity?.serialNumber ? { serialNumber: image.identity.serialNumber } : {}),
    ...(firstController?.firmwareRevision ? { firmwareRevision: firstController.firmwareRevision } : {}),
    ...(runtime.runtimeVersion ? { runtimeVersion: runtime.runtimeVersion } : {}),
    runtimeChecksum,
    checksumValid,
    uploadedAt,
    ...(image.installedAt ? { installedAt: image.installedAt } : {}),
    counts,
    warnings,
    hmiProjectReconstructed,
  };

  return ok(stamped, { preview, reconstructed: true, checksumValid, hmiReferences, hmiProjectReconstructed }, warnings);
}

/**
 * Read-only preview of a SoftController upload: the counts + warnings the user
 * sees *before* the active project is replaced. Returns the preview on success,
 * or an `error` (with the same clean disconnected/empty/corrupt messages as
 * {@link uploadFromSoftController}) when the image cannot be reconstructed.
 */
export function previewSoftControllerUpload(
  image: SoftControllerImage,
  options: SoftControllerUploadOptions = {},
): { ok: true; preview: SoftControllerUploadPreview } | { ok: false; error: string } {
  const result = uploadFromSoftController(image, options);
  if (!result.ok || !result.data) {
    return { ok: false, error: result.error ?? "ESCO SoftController upload failed." };
  }
  return { ok: true, preview: result.data.preview };
}
