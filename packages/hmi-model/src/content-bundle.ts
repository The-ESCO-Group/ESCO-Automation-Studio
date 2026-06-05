import type {
  HmiAddOnGraphicDefinition,
  HmiAsset,
  HmiContentBundleExportOptions,
  HmiContentBundleExportResult,
  HmiContentBundleFile,
  HmiContentBundleFileKind,
  HmiContentBundleFolderEntry,
  HmiContentBundleFolderExportResult,
  HmiContentBundleImportResult,
  HmiContentBundleManifest,
  HmiPopup,
  HmiProject,
  HmiScreen,
  HmiUnsupportedContent,
} from "./types";

type JsonRecord = Record<string, unknown>;

function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;

  const sorted: JsonRecord = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as JsonRecord)[key];
    if (child !== undefined) sorted[key] = stableValue(child);
  }
  return sorted;
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function safeFilePart(value: string, fallback: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || fallback;
}

function file(kind: HmiContentBundleFileKind, path: string, value: unknown): HmiContentBundleFile {
  const text = stableStringify(value);
  return {
    path,
    kind,
    text,
    checksumAlgorithm: "fnv1a32-text",
    contentChecksum: checksum(text),
  };
}

function parseJson(text: string, path: string, errors: string[]): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`Bundle file "${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byPath(files: readonly HmiContentBundleFile[]): Map<string, HmiContentBundleFile> {
  return new Map(files.map((entry) => [entry.path, entry]));
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function inferKindFromPath(path: string): HmiContentBundleFileKind {
  if (path === "manifest.json") return "manifest";
  if (path === "assets/manifest.json") return "asset-manifest";
  if (path === "unsupported/manifest.json") return "unsupported-content";
  if (path.startsWith("screens/")) return "screen";
  if (path.startsWith("popups/")) return "popup";
  if (path.startsWith("add-on-graphics/")) return "add-on-graphic";
  return "unsupported-content";
}

function verifyFile(fileEntry: HmiContentBundleFile, errors: string[]) {
  if (fileEntry.checksumAlgorithm !== "fnv1a32-text") {
    errors.push(`Bundle file "${fileEntry.path}" uses unsupported checksum algorithm.`);
    return;
  }
  const expected = checksum(fileEntry.text);
  if (fileEntry.contentChecksum !== expected) {
    errors.push(`Bundle file "${fileEntry.path}" checksum mismatch: expected ${expected}, found ${fileEntry.contentChecksum}.`);
  }
}

function parseArrayFile<T>(fileEntry: HmiContentBundleFile | undefined, label: string, errors: string[]): T[] {
  if (!fileEntry) return [];
  const parsed = parseJson(fileEntry.text, fileEntry.path, errors);
  if (!Array.isArray(parsed)) {
    errors.push(`Bundle file "${fileEntry.path}" must contain an array of ${label}.`);
    return [];
  }
  return parsed as T[];
}

function parseObjectFile<T>(fileEntry: HmiContentBundleFile | undefined, label: string, errors: string[]): T | undefined {
  if (!fileEntry) return undefined;
  const parsed = parseJson(fileEntry.text, fileEntry.path, errors);
  if (!isRecord(parsed)) {
    errors.push(`Bundle file "${fileEntry.path}" must contain a ${label} object.`);
    return undefined;
  }
  return parsed as T;
}

export function exportHmiContentBundle(
  project: HmiProject,
  options: HmiContentBundleExportOptions = {},
): HmiContentBundleExportResult {
  const files: HmiContentBundleFile[] = [
    ...project.screens.map((screen) => file("screen", `screens/${safeFilePart(screen.id, "screen")}.json`, screen)),
    ...project.popups.map((popup) => file("popup", `popups/${safeFilePart(popup.id, "popup")}.json`, popup)),
    ...project.addOnGraphics.map((graphic) =>
      file("add-on-graphic", `add-on-graphics/${safeFilePart(graphic.id, "add-on-graphic")}.json`, graphic),
    ),
    file("asset-manifest", "assets/manifest.json", project.assets),
  ];
  if (options.includeUnsupportedContent ?? true) {
    files.push(file("unsupported-content", "unsupported/manifest.json", project.unsupportedContent));
  }

  const manifest: HmiContentBundleManifest = {
    schemaVersion: 1,
    kind: "hmi-content-bundle",
    projectId: project.id,
    projectName: project.name,
    exportedAt: options.exportedAt,
    summary: {
      screenCount: project.screens.length,
      popupCount: project.popups.length,
      addOnGraphicCount: project.addOnGraphics.length,
      assetCount: project.assets.length,
      unsupportedContentCount: (options.includeUnsupportedContent ?? true) ? project.unsupportedContent.length : 0,
    },
    files: files.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      checksumAlgorithm: entry.checksumAlgorithm,
      contentChecksum: entry.contentChecksum,
    })),
  };
  const manifestFile = file("manifest", "manifest.json", manifest);
  return {
    manifest,
    files: [manifestFile, ...files],
  };
}

export function exportHmiContentBundleFolder(
  project: HmiProject,
  options: HmiContentBundleExportOptions = {},
): HmiContentBundleFolderExportResult {
  const bundle = exportHmiContentBundle(project, options);
  return {
    manifest: bundle.manifest,
    entries: bundle.files.map((entry) => ({ path: entry.path, text: entry.text })),
  };
}

export function importHmiContentBundle(files: readonly HmiContentBundleFile[]): HmiContentBundleImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const content: HmiContentBundleImportResult["content"] = {
    screens: [],
    popups: [],
    addOnGraphics: [],
    assets: [],
    unsupportedContent: [],
  };

  const paths = byPath(files);
  const manifestFile = paths.get("manifest.json");
  if (!manifestFile) {
    return { ok: false, content, errors: ['HMI content bundle is missing "manifest.json".'], warnings };
  }

  for (const entry of files) verifyFile(entry, errors);
  const manifest = parseObjectFile<HmiContentBundleManifest>(manifestFile, "bundle manifest", errors);
  if (!manifest) return { ok: false, content, errors, warnings };

  if (manifest.schemaVersion !== 1) errors.push("HMI content bundle schemaVersion must be 1.");
  if (manifest.kind !== "hmi-content-bundle") errors.push("HMI content bundle kind must be hmi-content-bundle.");

  const manifestPaths = new Set<string>();
  for (const listed of manifest.files) {
    manifestPaths.add(listed.path);
    const fileEntry = paths.get(listed.path);
    if (!fileEntry) {
      errors.push(`HMI content bundle manifest lists missing file "${listed.path}".`);
      continue;
    }
    if (fileEntry.kind !== listed.kind) {
      errors.push(`HMI content bundle file "${listed.path}" has kind "${fileEntry.kind}", expected "${listed.kind}".`);
    }
    if (fileEntry.contentChecksum !== listed.contentChecksum) {
      errors.push(`HMI content bundle manifest checksum for "${listed.path}" does not match the file entry.`);
    }
  }

  for (const entry of files) {
    if (entry.path !== "manifest.json" && !manifestPaths.has(entry.path)) {
      warnings.push(`HMI content bundle contains unlisted file "${entry.path}".`);
    }
  }

  const screenFiles = manifest.files.filter((entry) => entry.kind === "screen").map((entry) => paths.get(entry.path));
  const popupFiles = manifest.files.filter((entry) => entry.kind === "popup").map((entry) => paths.get(entry.path));
  const addOnGraphicFiles = manifest.files.filter((entry) => entry.kind === "add-on-graphic").map((entry) => paths.get(entry.path));
  content.screens = screenFiles.flatMap((entry) => {
    const parsed = parseObjectFile<HmiScreen>(entry, "screen", errors);
    return parsed ? [parsed] : [];
  });
  content.popups = popupFiles.flatMap((entry) => {
    const parsed = parseObjectFile<HmiPopup>(entry, "popup", errors);
    return parsed ? [parsed] : [];
  });
  content.addOnGraphics = addOnGraphicFiles.flatMap((entry) => {
    const parsed = parseObjectFile<HmiAddOnGraphicDefinition>(entry, "Add-On Graphic", errors);
    return parsed ? [parsed] : [];
  });
  content.assets = parseArrayFile<HmiAsset>(paths.get("assets/manifest.json"), "assets", errors);
  content.unsupportedContent = parseArrayFile<HmiUnsupportedContent>(paths.get("unsupported/manifest.json"), "unsupported content", errors);

  if (manifest.summary.screenCount !== content.screens.length) warnings.push("HMI content bundle screen count does not match imported content.");
  if (manifest.summary.popupCount !== content.popups.length) warnings.push("HMI content bundle popup count does not match imported content.");
  if (manifest.summary.addOnGraphicCount !== content.addOnGraphics.length) warnings.push("HMI content bundle Add-On Graphic count does not match imported content.");
  if (manifest.summary.assetCount !== content.assets.length) warnings.push("HMI content bundle asset count does not match imported content.");
  if (manifest.summary.unsupportedContentCount !== content.unsupportedContent.length) {
    warnings.push("HMI content bundle unsupported-content count does not match imported content.");
  }

  return {
    ok: errors.length === 0,
    manifest,
    content,
    errors,
    warnings,
  };
}

export function importHmiContentBundleFolder(entries: readonly HmiContentBundleFolderEntry[]): HmiContentBundleImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const emptyContent: HmiContentBundleImportResult["content"] = {
    screens: [],
    popups: [],
    addOnGraphics: [],
    assets: [],
    unsupportedContent: [],
  };
  const byEntryPath = new Map<string, HmiContentBundleFolderEntry>();
  for (const entry of entries) {
    const path = normalizePath(entry.path);
    if (!path) {
      warnings.push("HMI content folder contains an entry with a blank path.");
      continue;
    }
    if (byEntryPath.has(path)) {
      warnings.push(`HMI content folder repeats file "${path}"; the last entry wins.`);
    }
    byEntryPath.set(path, { path, text: entry.text });
  }

  const manifestEntry = byEntryPath.get("manifest.json");
  if (!manifestEntry) {
    return { ok: false, content: emptyContent, errors: ['HMI content folder is missing "manifest.json".'], warnings };
  }
  const parsedManifest = parseObjectFile<HmiContentBundleManifest>(
    {
      path: manifestEntry.path,
      kind: "manifest",
      text: manifestEntry.text,
      checksumAlgorithm: "fnv1a32-text",
      contentChecksum: checksum(manifestEntry.text),
    },
    "bundle manifest",
    errors,
  );
  if (!parsedManifest) return { ok: false, content: emptyContent, errors, warnings };

  const listedKinds = new Map(parsedManifest.files.map((entry) => [normalizePath(entry.path), entry.kind]));
  const files = Array.from(byEntryPath.values()).map((entry): HmiContentBundleFile => {
    const path = normalizePath(entry.path);
    return {
      path,
      kind: path === "manifest.json" ? "manifest" : listedKinds.get(path) ?? inferKindFromPath(path),
      text: entry.text,
      checksumAlgorithm: "fnv1a32-text",
      contentChecksum: checksum(entry.text),
    };
  });
  const imported = importHmiContentBundle(files);
  return { ...imported, warnings: [...warnings, ...imported.warnings] };
}
