import { createDefaultHmiProject } from "./factory";
import type { HmiProject } from "./types";

export interface HmiProjectHost {
  hmi?: HmiProject;
}

export function getHmiProject(project: object): HmiProject | undefined {
  const host = project as HmiProjectHost;
  return isHmiProject(host.hmi) ? host.hmi : undefined;
}

export function ensureHmiProject(project: object, name = "HMI Project"): HmiProject {
  return getHmiProject(project) ?? createDefaultHmiProject(name);
}

export function withHmiProject<T extends object>(project: T, hmi: HmiProject): T & HmiProjectHost {
  return { ...project, hmi };
}

export function isHmiProject(value: unknown): value is HmiProject {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<HmiProject>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.screens) &&
    Array.isArray(candidate.popups) &&
    typeof candidate.systemBanner === "object" &&
    candidate.systemBanner !== null
  );
}
