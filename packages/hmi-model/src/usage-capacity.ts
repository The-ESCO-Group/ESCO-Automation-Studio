import type {
  HmiAsset,
  HmiCapacityMetricStatus,
  HmiDataLog,
  HmiGraphicElement,
  HmiProject,
  HmiSurfaceBase,
  HmiSurfaceScalingStatus,
  HmiSurfaceUsage,
  HmiUsageCapacityMetric,
  HmiUsageCapacityReport,
} from "./types";

function surfaces(project: HmiProject): HmiSurfaceBase[] {
  return [...project.screens, ...project.popups, project.systemBanner];
}

function positiveBytes(bytes: number | undefined): number {
  return bytes && Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

function assetBytes(assets: HmiAsset[]): number {
  return assets.reduce((sum, asset) => sum + positiveBytes(asset.bytes), 0);
}

function estimatedLanguageBytes(project: HmiProject): number {
  let total = 0;
  for (const pack of project.languagePacks) {
    total += pack.languageId.length + pack.displayName.length;
    for (const [id, value] of Object.entries(pack.strings)) total += id.length + value.length;
    for (const id of pack.missingStringIds) total += id.length;
  }
  return total;
}

function estimatedDataLogBytesFor(log: HmiDataLog): number {
  if (log.sampleRateMs <= 0 || log.retentionHours <= 0 || log.tagPaths.length === 0) return 0;
  const retainedRows = Math.ceil((log.retentionHours * 60 * 60 * 1000) / log.sampleRateMs);
  const valueColumns = log.tagPaths.length + (log.statusTagPath ? 1 : 0);
  return retainedRows * (24 + valueColumns * 40);
}

function estimatedDataLogBytes(logs: HmiDataLog[]): number {
  return logs.reduce((sum, log) => sum + estimatedDataLogBytesFor(log), 0);
}

function metric(
  key: HmiUsageCapacityMetric["key"],
  label: string,
  used: number,
  limit: number,
  unit: string,
): HmiUsageCapacityMetric {
  const validLimit = Number.isFinite(limit) && limit > 0;
  const percent = validLimit ? (used / limit) * 100 : undefined;
  const status: HmiCapacityMetricStatus = !validLimit
    ? "unknown"
    : used > limit
      ? "exceeded"
      : (percent ?? 0) >= 80
        ? "warning"
        : "ok";
  return {
    key,
    label,
    used,
    limit,
    unit,
    status,
    percent,
    message: validLimit
      ? `${used} of ${limit} ${unit}`
      : `Target device has no valid ${label.toLowerCase()} limit.`,
  };
}

function surfaceScalingStatus(surface: HmiSurfaceBase, project: HmiProject): HmiSurfaceScalingStatus {
  if (surface.width === project.targetDevice.width && surface.height === project.targetDevice.height) return "native";
  if (surface.width > project.targetDevice.width || surface.height > project.targetDevice.height) return "oversized";
  return "scaled";
}

function hasRasterReference(element: HmiGraphicElement, project: HmiProject): boolean {
  const assetId = element.properties.assetId;
  if (typeof assetId === "string") {
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    if (asset?.kind === "image") return true;
  }
  return element.typeId === "media.image-placeholder";
}

function surfaceUsage(surface: HmiSurfaceBase, project: HmiProject): HmiSurfaceUsage {
  const status = surfaceScalingStatus(surface, project);
  const displayScaleX = surface.width > 0 ? project.targetDevice.width / surface.width : 0;
  const displayScaleY = surface.height > 0 ? project.targetDevice.height / surface.height : 0;
  const rasterScalingRiskCount = status === "native" ? 0 : surface.elements.filter((element) => hasRasterReference(element, project)).length;
  const elementStatus = metric(
    "largest-surface-elements",
    "Largest surface elements",
    surface.elements.length,
    project.targetDevice.capacity.maxElementsPerScreen,
    "elements",
  ).status;

  return {
    id: surface.id,
    kind: surface.kind,
    name: surface.name,
    width: surface.width,
    height: surface.height,
    elementCount: surface.elements.length,
    elementStatus,
    displayScaleX,
    displayScaleY,
    scalingStatus: status,
    rasterScalingRiskCount,
  };
}

export function hmiUsageCapacityReport(project: HmiProject): HmiUsageCapacityReport {
  const surfaceRows = surfaces(project).map((surface) => surfaceUsage(surface, project));
  const recipes = project.recipes ?? [];
  const largestSurfaceElements = surfaceRows.reduce((max, surface) => Math.max(max, surface.elementCount), 0);
  const knownAssetBytes = assetBytes(project.assets);
  const languageBytes = estimatedLanguageBytes(project);
  const dataLogBytes = estimatedDataLogBytes(project.dataLogs);
  const storageBytes = knownAssetBytes + languageBytes + dataLogBytes;
  const storageLimitBytes = project.targetDevice.capacity.storageMb * 1024 * 1024;
  const metrics = [
    metric("screens", "Screens", project.screens.length, project.targetDevice.capacity.maxScreens, "screens"),
    metric("largest-surface-elements", "Largest surface elements", largestSurfaceElements, project.targetDevice.capacity.maxElementsPerScreen, "elements"),
    metric("trends", "Trends", project.trends.length, project.targetDevice.capacity.maxTrends, "trends"),
    metric("data-logs", "Data logs", project.dataLogs.length, project.targetDevice.capacity.maxDataLogs, "logs"),
    metric("recipes", "Recipes", recipes.length, project.targetDevice.capacity.maxRecipes, "recipes"),
    metric("storage", "Estimated storage", storageBytes, storageLimitBytes, "bytes"),
  ];

  return {
    targetDevice: {
      id: project.targetDevice.id,
      name: project.targetDevice.name,
      width: project.targetDevice.width,
      height: project.targetDevice.height,
      storageBytes: storageLimitBytes,
    },
    metrics,
    surfaces: surfaceRows,
    knownAssetBytes,
    estimatedLanguageBytes: languageBytes,
    estimatedDataLogBytes: dataLogBytes,
    estimatedStorageBytes: storageBytes,
    warningCount: metrics.filter((item) => item.status === "warning").length,
    exceededCount: metrics.filter((item) => item.status === "exceeded").length,
    scalingRiskCount: surfaceRows.reduce((sum, surface) => sum + surface.rasterScalingRiskCount, 0),
  };
}
