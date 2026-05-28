import { nowIso } from "@esco/shared";
import type { PlcProject } from "@esco/core";

/** On-disk shape of a `.plcproj.json` file. */
export interface PlcProjectFile {
  formatVersion: 1;
  savedAt: string;
  project: PlcProject;
}

export function serializeProject(project: PlcProject): string {
  const file: PlcProjectFile = {
    formatVersion: 1,
    savedAt: nowIso(),
    project,
  };
  return JSON.stringify(file, null, 2);
}

export function deserializeProject(json: string): PlcProject {
  const file = JSON.parse(json) as PlcProjectFile;
  if (file.formatVersion !== 1) {
    throw new Error(`Unsupported project format version: ${file.formatVersion}`);
  }
  return file.project;
}
