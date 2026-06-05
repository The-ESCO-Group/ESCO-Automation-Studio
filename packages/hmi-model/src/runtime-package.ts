import { nowIso } from "@esco/shared";
import { getHmiElementDefinition } from "./registry";
import { validateHmiProject } from "./validation";
import type {
  HmiGraphicElement,
  HmiProject,
  HmiRuntimePackageArtifact,
  HmiRuntimePackageBuildOptions,
  HmiRuntimePackageBuildResult,
  HmiRuntimePackageIntegrityResult,
  HmiRuntimePackageSummary,
  HmiRuntimePackageTargetDevice,
  HmiRuntimePackageVerificationSummary,
  HmiSurfaceBase,
  HmiValidationFinding,
} from "./types";

function surfaces(project: HmiProject): HmiSurfaceBase[] {
  return [...project.screens, ...project.popups, project.systemBanner];
}

function knownAssetBytes(project: HmiProject): number {
  return project.assets.reduce((sum, asset) => sum + (asset.bytes && Number.isFinite(asset.bytes) && asset.bytes > 0 ? asset.bytes : 0), 0);
}

function countModelOnlyElements(elements: HmiGraphicElement[]): number {
  return elements.filter((element) => getHmiElementDefinition(element.typeId)?.runtimeSupport === "model-only").length;
}

function summarizeProject(project: HmiProject): HmiRuntimePackageSummary {
  const surfaceElements = surfaces(project).flatMap((surface) => surface.elements);
  const addOnGraphicElements = project.addOnGraphics.flatMap((graphic) => graphic.elements);
  const alarms = project.alarms ?? [];
  const recipes = project.recipes ?? [];
  return {
    controllerReferenceCount: project.controllerReferences?.length ?? 0,
    screenCount: project.screens.length,
    popupCount: project.popups.length,
    systemBannerElementCount: project.systemBanner.elements.length,
    addOnGraphicCount: project.addOnGraphics.length,
    elementCount: surfaceElements.length + addOnGraphicElements.length,
    assetCount: project.assets.length,
    knownAssetBytes: knownAssetBytes(project),
    alarmCount: alarms.length,
    trendCount: project.trends.length,
    dataLogCount: project.dataLogs.length,
    recipeCount: recipes.length,
    languagePackCount: project.languagePacks.length,
    securityRoleCount: project.security.roles.length,
    unsupportedContentCount: project.unsupportedContent.length + project.assets.filter((asset) => asset.unsupported).length,
    modelOnlyElementCount: countModelOnlyElements(surfaceElements) + countModelOnlyElements(addOnGraphicElements),
  };
}

function summarizeVerification(findings: HmiValidationFinding[]): HmiRuntimePackageVerificationSummary {
  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const infoCount = findings.filter((finding) => finding.severity === "info").length;
  return {
    status: errorCount > 0 ? "blocked" : "ready",
    errorCount,
    warningCount,
    infoCount,
    findings,
  };
}

function targetDeviceSnapshot(project: HmiProject): HmiRuntimePackageTargetDevice {
  return {
    id: project.targetDevice.id,
    family: project.targetDevice.family,
    name: project.targetDevice.name,
    firmwareRevision: project.targetDevice.firmwareRevision,
    width: project.targetDevice.width,
    height: project.targetDevice.height,
    dpi: project.targetDevice.dpi,
    colorDepth: project.targetDevice.colorDepth,
    supportsTouch: project.targetDevice.supportsTouch,
    supportedFeatures: [...project.targetDevice.supportedFeatures],
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) sorted[key] = stableValue(child);
  }
  return sorted;
}

function stableStringify(value: unknown, space?: number): string {
  return JSON.stringify(stableValue(value), null, space);
}

function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function runtimePackageFileName(project: HmiProject): string {
  const projectName = project.name.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "hmi-project";
  const deviceId = project.targetDevice.id.trim().replace(/[^a-z0-9._-]+/gi, "-") || "target-device";
  return `${projectName}-${deviceId}.hmiruntime.json`;
}

function runtimePackageChecksumPayload(artifact: Omit<HmiRuntimePackageArtifact, "contentChecksum" | "packageId" | "fileName" | "builtAt">) {
  return {
    schemaVersion: artifact.schemaVersion,
    kind: artifact.kind,
    projectId: artifact.projectId,
    projectName: artifact.projectName,
    hmiSchemaVersion: artifact.hmiSchemaVersion,
    runtimeProfile: artifact.runtimeProfile,
    targetDevice: artifact.targetDevice,
    summary: artifact.summary,
    verification: artifact.verification,
    checksumAlgorithm: artifact.checksumAlgorithm,
    hardwareTransfer: artifact.hardwareTransfer,
  };
}

function runtimePackageChecksum(artifact: Omit<HmiRuntimePackageArtifact, "contentChecksum" | "packageId" | "fileName" | "builtAt">): string {
  return checksum(stableStringify(runtimePackageChecksumPayload(artifact)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildHmiRuntimePackage(
  project: HmiProject,
  options: HmiRuntimePackageBuildOptions = {},
): HmiRuntimePackageBuildResult {
  const findings = validateHmiProject(project, options.validationContext);
  const verification = summarizeVerification(findings);
  if (verification.status === "blocked") {
    return {
      ok: false,
      verification,
      blockedReason: `${verification.errorCount} HMI verification error(s) must be resolved before building a runtime package.`,
    };
  }

  const builtAt = options.builtAt ?? nowIso();
  const targetDevice = targetDeviceSnapshot(project);
  const summary = summarizeProject(project);
  const artifactBase = {
    schemaVersion: 1,
    kind: "hmi-runtime-package",
    projectId: project.id,
    projectName: project.name,
    hmiSchemaVersion: project.schemaVersion,
    runtimeProfile: "offline-preview",
    targetDevice,
    summary,
    verification,
    checksumAlgorithm: "fnv1a32-stable-json",
    hardwareTransfer: {
      download: "disabled-model-only",
      upload: "disabled-model-only",
      reason: "Runtime package artifacts are offline review/save-to-media metadata only; ESCO does not upload, download, or transfer to an HMI device.",
    },
  } satisfies Omit<HmiRuntimePackageArtifact, "contentChecksum" | "packageId" | "fileName" | "builtAt">;
  const contentChecksum = runtimePackageChecksum(artifactBase);
  const artifact: HmiRuntimePackageArtifact = {
    ...artifactBase,
    packageId: `hmirt_${contentChecksum}`,
    fileName: runtimePackageFileName(project),
    builtAt,
    contentChecksum,
  };

  return { ok: true, artifact, verification };
}

export function serializeHmiRuntimePackageArtifact(artifact: HmiRuntimePackageArtifact): string {
  return `${stableStringify(artifact, 2)}\n`;
}

export function verifyHmiRuntimePackageArtifact(artifact: unknown): HmiRuntimePackageIntegrityResult {
  const errors: string[] = [];
  if (!isRecord(artifact)) {
    return { ok: false, errors: ["Runtime package artifact must be a JSON object."] };
  }

  const candidate = artifact as unknown as HmiRuntimePackageArtifact;
  if (candidate.schemaVersion !== 1) errors.push("Runtime package schemaVersion must be 1.");
  if (candidate.kind !== "hmi-runtime-package") errors.push("Runtime package kind must be hmi-runtime-package.");
  if (candidate.runtimeProfile !== "offline-preview") errors.push("Runtime package runtimeProfile must be offline-preview.");
  if (candidate.checksumAlgorithm !== "fnv1a32-stable-json") errors.push("Runtime package checksum algorithm is unsupported.");
  if (typeof candidate.contentChecksum !== "string" || !/^[0-9a-f]{8}$/.test(candidate.contentChecksum)) {
    errors.push("Runtime package contentChecksum must be an 8-character lowercase hex value.");
  }
  if (typeof candidate.packageId !== "string" || candidate.packageId !== `hmirt_${candidate.contentChecksum}`) {
    errors.push("Runtime package packageId must match the content checksum.");
  }
  if (!isRecord(candidate.targetDevice) || typeof candidate.targetDevice.id !== "string" || typeof candidate.targetDevice.name !== "string") {
    errors.push("Runtime package targetDevice snapshot is incomplete.");
  }
  if (!isRecord(candidate.summary) || typeof candidate.summary.screenCount !== "number" || typeof candidate.summary.elementCount !== "number") {
    errors.push("Runtime package summary is incomplete.");
  }
  if (
    !isRecord(candidate.verification) ||
    (candidate.verification.status !== "ready" && candidate.verification.status !== "blocked") ||
    typeof candidate.verification.errorCount !== "number" ||
    typeof candidate.verification.warningCount !== "number" ||
    typeof candidate.verification.infoCount !== "number" ||
    !Array.isArray(candidate.verification.findings)
  ) {
    errors.push("Runtime package verification summary is incomplete.");
  } else if (
    candidate.verification.status === "ready" &&
    candidate.verification.errorCount !== 0
  ) {
    errors.push("Runtime package cannot be ready while verification errors are present.");
  }
  if (
    !isRecord(candidate.hardwareTransfer) ||
    candidate.hardwareTransfer.download !== "disabled-model-only" ||
    candidate.hardwareTransfer.upload !== "disabled-model-only"
  ) {
    errors.push("Runtime package hardware upload/download transfer must remain disabled-model-only.");
  }

  let expectedChecksum: string | undefined;
  if (errors.length === 0) {
    expectedChecksum = runtimePackageChecksum(candidate);
    if (candidate.contentChecksum !== expectedChecksum) {
      errors.push(`Runtime package checksum mismatch: expected ${expectedChecksum}, found ${candidate.contentChecksum}.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    expectedChecksum,
    artifact: errors.length === 0 ? candidate : undefined,
  };
}

export function deserializeHmiRuntimePackageArtifact(text: string): HmiRuntimePackageIntegrityResult {
  try {
    return verifyHmiRuntimePackageArtifact(JSON.parse(text));
  } catch (error) {
    return {
      ok: false,
      errors: [`Runtime package artifact is not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
