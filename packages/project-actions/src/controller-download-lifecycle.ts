/**
 * Studio 5000-style download lifecycle, expressed as ESCO capabilities.
 *
 * This module is descriptive and safety-gated. It names the four phases a
 * Rockwell download performs, then maps them to what ESCO can actually execute
 * today:
 *
 * - ESCO SoftController: implemented as a software-only `.easruntime` flow.
 * - Allen-Bradley Logix physical controller: blocked unless official Rockwell
 *   tooling/SDK and a validated target adapter are present.
 */

export type ControllerDownloadTargetKind = "esco-soft-controller" | "allen-bradley-logix";

export type ControllerDownloadPhaseId =
  | "compile"
  | "take-control-clear"
  | "transfer"
  | "verify-finalize";

export type ControllerDownloadPhaseStatus = "implemented" | "blocked";

export interface ControllerDownloadPhaseSupport {
  status: ControllerDownloadPhaseStatus;
  summary: string;
  evidence: string[];
  blockedReason?: string;
}

export interface ControllerDownloadPhase {
  id: ControllerDownloadPhaseId;
  label: string;
  studio5000Behavior: string;
  softController: ControllerDownloadPhaseSupport;
  allenBradleyLogix: ControllerDownloadPhaseSupport;
}

export interface ControllerUploadCapability {
  status: ControllerDownloadPhaseStatus;
  summary: string;
  evidence: string[];
  blockedReason?: string;
}

export interface ControllerDownloadCapabilityReport {
  targetKind: ControllerDownloadTargetKind;
  physicalHardware: boolean;
  canExecuteDownload: boolean;
  canExecuteUpload: boolean;
  requiresRockwellSdk: boolean;
  usesUnpublishedRockwellCipServices: boolean;
  summary: string;
  phases: ControllerDownloadPhaseSupport[];
  allowedOperations: string[];
  blockedOperations: string[];
  upload: ControllerUploadCapability;
}

export interface SoftControllerTransferChunk {
  index: number;
  offset: number;
  bytes: number;
  /** Non-cryptographic per-chunk fingerprint for transfer audit/debug. */
  fingerprint: string;
  final: boolean;
}

export interface SoftControllerTransferPlan {
  protocol: "esco-softcontroller-runtime-chunks-v1";
  softwareOnly: true;
  chunkSize: number;
  totalBytes: number;
  chunkCount: number;
  chunks: SoftControllerTransferChunk[];
}

export const DEFAULT_SOFT_CONTROLLER_TRANSFER_CHUNK_SIZE = 16 * 1024;

export const STUDIO5000_DOWNLOAD_PHASES: readonly ControllerDownloadPhase[] = [
  {
    id: "compile",
    label: "Compile",
    studio5000Behavior:
      "Translate editable logic, tag database, and I/O map into a firmware-specific controller image.",
    softController: {
      status: "implemented",
      summary:
        "Build the ESCO project into a checksummed `.easruntime` software-controller image.",
      evidence: [
        "buildRuntime(project)",
        "serializeRuntime(runtime)",
        "runtimeChecksum(runtime)",
      ],
    },
    allenBradleyLogix: {
      status: "blocked",
      summary:
        "Rockwell firmware-specific binary compilation is not implemented in ESCO.",
      evidence: ["No `.ACD` compiler/decompiler", "No Rockwell runtime image writer"],
      blockedReason:
        "Requires official Rockwell tooling/SDK or licensed compiler behavior; ESCO will not fake a firmware-specific Logix image.",
    },
  },
  {
    id: "take-control-clear",
    label: "Take Control And Clear",
    studio5000Behavior:
      "Require Program mode, stop the running controller image, clear/replace the existing image, and break normal communications while transfer owns the controller.",
    softController: {
      status: "implemented",
      summary:
        "Back up the current software image, stop the software scan if needed, then stage the replacement runtime.",
      evidence: ["createBackup(at)", "applyStaged({ mode, resetTagMemory })"],
    },
    allenBradleyLogix: {
      status: "blocked",
      summary:
        "Taking control of a physical controller and clearing the running image is intentionally unavailable.",
      evidence: ["No physical mode-change route", "No controller-clear command route"],
      blockedReason:
        "Would require a verified physical target adapter, operator authority, backup/restore plan, and official controller-transfer API.",
    },
  },
  {
    id: "transfer",
    label: "Transfer",
    studio5000Behavior:
      "Ship the compiled controller image in chunks over EtherNet/IP/CIP using Rockwell vendor-specific services.",
    softController: {
      status: "implemented",
      summary:
        "Split the `.easruntime` image into audited ESCO software chunks and validate the received bytes on the target.",
      evidence: [
        "planSoftControllerTransfer(runtimeText)",
        "receiveRuntime(runtimeText, declaredChecksum)",
      ],
    },
    allenBradleyLogix: {
      status: "blocked",
      summary:
        "Rockwell download object classes and services are not published or implemented.",
      evidence: ["Read-only CIP stack only", "No write/download service builders"],
      blockedReason:
        "Requires vendor-specific Rockwell CIP services/object classes; ESCO will not reverse-engineer or guess them.",
    },
  },
  {
    id: "verify-finalize",
    label: "Verify And Finalize",
    studio5000Behavior:
      "Validate checksums/signatures, finalize the stored controller image, and return the controller to the selected mode; safety controllers require extra safety-signature flow.",
    softController: {
      status: "implemented",
      summary:
        "Recompute checksum on the software target, apply only verified bytes, reset tag memory when requested, and return to Program or Run.",
      evidence: ["parseRuntimeFile(runtimeText)", "runtimeChecksum(runtime)", "applyStaged(...)"],
    },
    allenBradleyLogix: {
      status: "blocked",
      summary:
        "Physical controller finalization and GuardLogix safety-signature handling are not implemented.",
      evidence: ["No safety-signature API", "No physical finalize route"],
      blockedReason:
        "Requires official Rockwell safety/download APIs, validated hardware procedures, and safety lifecycle controls.",
    },
  },
];

const SOFT_ALLOWED = [
  "Compile ESCO project to `.easruntime`.",
  "Back up and replace ESCO SoftController software image.",
  "Transfer runtime as audited software chunks.",
  "Verify checksum on the software target.",
  "Finalize in Program or Run mode for software-only execution.",
  "Upload/reconstruct an ESCO project from a SoftController runtime image.",
];

const ROCKWELL_BLOCKED = [
  "Compile to Rockwell firmware-specific controller image.",
  "Download to physical Allen-Bradley controller.",
  "Upload/reconstruct `.ACD` project from physical controller image.",
  "Use unpublished Rockwell CIP download/upload services.",
  "Change physical controller mode or clear a physical controller.",
  "Execute GuardLogix safety-signature operations.",
  "Apply online edits, forces, fault commands, or safety operations.",
];

export function describeControllerDownloadCapabilities(
  targetKind: ControllerDownloadTargetKind = "esco-soft-controller",
): ControllerDownloadCapabilityReport {
  if (targetKind === "esco-soft-controller") {
    return {
      targetKind,
      physicalHardware: false,
      canExecuteDownload: true,
      canExecuteUpload: true,
      requiresRockwellSdk: false,
      usesUnpublishedRockwellCipServices: false,
      summary:
        "Executable today for ESCO-owned software runtime only; no physical PLC or Rockwell proprietary transfer is contacted.",
      phases: STUDIO5000_DOWNLOAD_PHASES.map((phase) => phase.softController),
      allowedOperations: [...SOFT_ALLOWED],
      blockedOperations: [...ROCKWELL_BLOCKED],
      upload: {
        status: "implemented",
        summary:
          "Read a SoftController `.easruntime` image, verify checksum, and reconstruct an editable ESCO project model where possible.",
        evidence: ["uploadFromSoftController(image)", "previewSoftControllerUpload(image)"],
      },
    };
  }

  return {
    targetKind,
    physicalHardware: true,
    canExecuteDownload: false,
    canExecuteUpload: false,
    requiresRockwellSdk: true,
    usesUnpublishedRockwellCipServices: true,
    summary:
      "Physical Allen-Bradley Logix transfer remains blocked. ESCO can describe the lifecycle and run read-only monitoring, but it cannot build or send Rockwell controller images.",
    phases: STUDIO5000_DOWNLOAD_PHASES.map((phase) => phase.allenBradleyLogix),
    allowedOperations: [
      "Read-only EtherNet/IP identity/tag monitoring through the backend gateway.",
      "Offline L5X import/export review.",
      "Offline Logix Designer SDK handoff planning for sandbox workstations.",
    ],
    blockedOperations: [...ROCKWELL_BLOCKED],
    upload: {
      status: "blocked",
      summary:
        "Physical controller upload/reconstruction into `.ACD` or editable Logix project is not implemented.",
      evidence: ["No `.ACD` writer", "No Rockwell controller-image reader"],
      blockedReason:
        "Requires official Rockwell upload APIs/project reconstruction behavior and validated safety controls.",
    },
  };
}

export function planSoftControllerTransfer(
  runtimeText: string,
  chunkSize = DEFAULT_SOFT_CONTROLLER_TRANSFER_CHUNK_SIZE,
): SoftControllerTransferPlan {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
  }

  const bytes = new TextEncoder().encode(runtimeText);
  const chunks: SoftControllerTransferChunk[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const part = bytes.slice(offset, Math.min(offset + chunkSize, bytes.length));
    chunks.push({
      index: chunks.length,
      offset,
      bytes: part.length,
      fingerprint: fnv1a32Hex(part),
      final: offset + part.length >= bytes.length,
    });
  }

  if (chunks.length === 0) {
    chunks.push({ index: 0, offset: 0, bytes: 0, fingerprint: fnv1a32Hex(bytes), final: true });
  }

  return {
    protocol: "esco-softcontroller-runtime-chunks-v1",
    softwareOnly: true,
    chunkSize,
    totalBytes: bytes.length,
    chunkCount: chunks.length,
    chunks,
  };
}

function fnv1a32Hex(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
