import type {
  HmiControllerReference,
  HmiControllerReferenceSyncStatus,
  HmiProject,
} from "./types";

export type HmiControllerReferenceBrowserKind = "tag" | "data-type" | "alarm";

export interface HmiControllerReferenceBrowserRow {
  kind: HmiControllerReferenceBrowserKind;
  referenceId: string;
  referenceName: string;
  controllerName: string;
  syncStatus: HmiControllerReferenceSyncStatus;
  name: string;
  path: string;
  dataType?: string;
  scope?: "controller" | "program";
  programName?: string;
  detail?: string;
}

export interface HmiControllerReferenceSyncSummary {
  total: number;
  synchronized: number;
  notImported: number;
  synchronizing: number;
  stale: number;
  conflict: number;
  error: number;
  unsupportedSource: number;
  secured: number;
  tagCount: number;
  dataTypeCount: number;
  alarmCount: number;
  actionableCount: number;
}

function references(project: HmiProject): HmiControllerReference[] {
  return Array.isArray(project.controllerReferences) ? project.controllerReferences : [];
}

function statusBucket(status: HmiControllerReferenceSyncStatus): Exclude<keyof HmiControllerReferenceSyncSummary, "total" | "tagCount" | "dataTypeCount" | "alarmCount" | "actionableCount"> {
  switch (status) {
    case "not-imported":
      return "notImported";
    case "unsupported-source":
      return "unsupportedSource";
    case "synchronizing":
      return "synchronizing";
    case "synchronized":
      return "synchronized";
    case "stale":
      return "stale";
    case "conflict":
      return "conflict";
    case "error":
      return "error";
    case "secured":
      return "secured";
  }
}

export function hmiControllerReferenceSyncSummary(project: HmiProject): HmiControllerReferenceSyncSummary {
  const summary: HmiControllerReferenceSyncSummary = {
    total: 0,
    synchronized: 0,
    notImported: 0,
    synchronizing: 0,
    stale: 0,
    conflict: 0,
    error: 0,
    unsupportedSource: 0,
    secured: 0,
    tagCount: 0,
    dataTypeCount: 0,
    alarmCount: 0,
    actionableCount: 0,
  };

  for (const reference of references(project)) {
    summary.total += 1;
    summary[statusBucket(reference.syncStatus)] += 1;
    summary.tagCount += reference.tags.length;
    summary.dataTypeCount += reference.dataTypes.length;
    summary.alarmCount += reference.alarms.length;
    if (reference.syncStatus !== "synchronized" && reference.syncStatus !== "synchronizing") {
      summary.actionableCount += 1;
    }
  }

  return summary;
}

export function hmiControllerReferenceTagPaths(project: HmiProject): string[] {
  return references(project).flatMap((reference) => reference.tags.map((tag) => tag.path));
}

export function hmiControllerReferenceBrowserRows(project: HmiProject): HmiControllerReferenceBrowserRow[] {
  const rows: HmiControllerReferenceBrowserRow[] = [];
  for (const reference of references(project)) {
    for (const tag of reference.tags) {
      rows.push({
        kind: "tag",
        referenceId: reference.id,
        referenceName: reference.name,
        controllerName: reference.controllerName,
        syncStatus: reference.syncStatus,
        name: tag.name,
        path: tag.path,
        dataType: tag.dataType,
        scope: tag.scope,
        programName: tag.programName,
        detail: tag.externalAccess,
      });
    }
    for (const dataType of reference.dataTypes) {
      rows.push({
        kind: "data-type",
        referenceId: reference.id,
        referenceName: reference.name,
        controllerName: reference.controllerName,
        syncStatus: reference.syncStatus,
        name: dataType.name,
        path: dataType.name,
        detail: dataType.family,
      });
    }
    for (const alarm of reference.alarms) {
      rows.push({
        kind: "alarm",
        referenceId: reference.id,
        referenceName: reference.name,
        controllerName: reference.controllerName,
        syncStatus: reference.syncStatus,
        name: alarm.name,
        path: alarm.tagPath,
        dataType: alarm.dataType,
        scope: alarm.scope,
        programName: alarm.programName,
        detail: alarm.kind,
      });
    }
  }

  return rows.sort((a, b) => {
    const byKind = a.kind.localeCompare(b.kind);
    if (byKind !== 0) return byKind;
    const byReference = a.referenceName.localeCompare(b.referenceName);
    if (byReference !== 0) return byReference;
    return a.path.localeCompare(b.path);
  });
}
