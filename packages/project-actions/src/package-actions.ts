import { createProject, type PlcProject } from "@esco/core";
import {
  createEscoPackage,
  EASPKG_EXTENSION,
  EASPROJ_EXTENSION,
  extractEscoPackageArtifacts,
  findEscoArtifactFormatByExtension,
  serializeEscoPackage,
  type EscoPackageManifestEntry,
} from "./native-format";
import { exportProjectJson, importProjectFile } from "./io-actions";
import { exportEscoRuntime } from "./runtime-actions";
import type { BuildRuntimeOptions } from "./runtime-build";
import { fail, ok } from "./helpers";
import type { ProjectActionResult } from "./types";

export interface ExportEscoPackageOptions extends BuildRuntimeOptions {
  createdAt?: string;
  packageVersion?: string;
}

export interface ExportEscoPackageData {
  fileName: string;
  text: string;
  entryCount: number;
  embeddedArtifactCount: number;
  packageChecksum: string;
  entries: EscoPackageManifestEntry[];
}

export interface ImportEscoPackageProjectData {
  packageEntryCount: number;
  embeddedArtifactCount: number;
  projectPath: string;
  runtimePath?: string;
  packageChecksumValid?: boolean;
}

function packageFileSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

/** Export a self-contained ESCO package containing the editable project and compiled runtime. */
export function exportEscoPackage(
  project: PlcProject,
  options: ExportEscoPackageOptions = {},
): ProjectActionResult<ExportEscoPackageData> {
  const { createdAt, packageVersion, ...runtimeOptions } = options;
  const projectExport = exportProjectJson(project);
  if (!projectExport.ok || !projectExport.data) {
    return fail(project, projectExport.error ?? "ESCO project export failed.");
  }

  const runtimeExport = exportEscoRuntime(project, {
    ...runtimeOptions,
    ...(createdAt && !runtimeOptions.builtAt ? { builtAt: createdAt } : {}),
  });
  if (!runtimeExport.ok || !runtimeExport.data) {
    return fail(project, runtimeExport.error ?? "ESCO Runtime build failed.");
  }

  const slug = packageFileSlug(project.name);
  const packageOptions = {
    ...(createdAt ? { createdAt } : {}),
    ...(packageVersion ? { packageVersion } : {}),
  };
  const packageFile = createEscoPackage(
    [
      { path: `project/${slug}${EASPROJ_EXTENSION}`, text: projectExport.data.text },
      { path: `runtime/${runtimeExport.data.fileName}`, text: runtimeExport.data.text },
    ],
    packageOptions,
  );

  return ok(
    project,
    {
      fileName: `${slug}${EASPKG_EXTENSION}`,
      text: serializeEscoPackage(packageFile),
      entryCount: packageFile.entries.length,
      embeddedArtifactCount: packageFile.artifacts.length,
      packageChecksum: packageFile.packageChecksum.value,
      entries: packageFile.entries,
    },
    runtimeExport.warnings,
  );
}

/** Extract and open the editable ESCO project carried by a self-contained `.easpkg`. */
export function importProjectFromEscoPackage(
  text: string,
): ProjectActionResult<ImportEscoPackageProjectData> {
  const extracted = extractEscoPackageArtifacts(text);
  if (!extracted.ok || !extracted.manifest) {
    return fail(createProject("Untitled"), extracted.error ?? "Invalid ESCO package.");
  }

  const projectArtifact = extracted.artifacts.find((artifact) => {
    const format = findEscoArtifactFormatByExtension(artifact.path);
    return format?.kind === "project";
  });
  if (!projectArtifact) {
    return fail(createProject("Untitled"), "ESCO package does not contain an editable .easproj project entry.");
  }

  const loaded = importProjectFile(projectArtifact.text);
  if (!loaded.ok) {
    return fail(
      createProject("Untitled"),
      `ESCO package project entry "${projectArtifact.path}" could not be opened: ${loaded.error ?? "invalid project file"}.`,
    );
  }

  const runtimeArtifact = extracted.artifacts.find((artifact) => {
    const format = findEscoArtifactFormatByExtension(artifact.path);
    return format?.kind === "runtime";
  });

  return ok(
    loaded.project,
    {
      packageEntryCount: extracted.manifest.entries.length,
      embeddedArtifactCount: extracted.artifacts.length,
      projectPath: projectArtifact.path,
      ...(runtimeArtifact ? { runtimePath: runtimeArtifact.path } : {}),
      ...(extracted.packageChecksum ? { packageChecksumValid: extracted.packageChecksum.valid } : {}),
    },
    loaded.warnings,
  );
}
