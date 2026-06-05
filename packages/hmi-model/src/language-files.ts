import { createId } from "@esco/shared";
import type {
  HmiLanguageFileExportOptions,
  HmiLanguageFileExportResult,
  HmiLanguageFileImportOptions,
  HmiLanguageFileImportResult,
  HmiLanguagePack,
} from "./types";

const LANGUAGE_CSV_HEADERS = ["languageId", "displayName", "stringId", "text", "missing"] as const;

function csvValue(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(values: string[]): string {
  return values.map(csvValue).join(",");
}

function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function safeFilePart(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "language";
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    const next = input[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error("unterminated quoted field");
  }
  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function missingFlag(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export function exportHmiLanguagePackCsv(
  languagePack: HmiLanguagePack,
  options: HmiLanguageFileExportOptions = {},
): HmiLanguageFileExportResult {
  const missingIds = new Set(languagePack.missingStringIds);
  const stringIds = Array.from(new Set([...Object.keys(languagePack.strings), ...languagePack.missingStringIds])).sort((left, right) =>
    left.localeCompare(right),
  );
  const rows = [
    csvRow([...LANGUAGE_CSV_HEADERS]),
    ...stringIds.map((stringId) =>
      csvRow([
        languagePack.languageId,
        languagePack.displayName,
        stringId,
        languagePack.strings[stringId] ?? "",
        missingIds.has(stringId) ? "true" : "false",
      ]),
    ),
  ];
  const text = `${rows.join("\n")}\n`;
  const contentChecksum = checksum(text);
  return {
    fileName: options.fileName ?? `${safeFilePart(languagePack.languageId || languagePack.id)}.hmi-language.csv`,
    text,
    metadata: {
      format: "esco-language-csv",
      languageId: languagePack.languageId,
      displayName: languagePack.displayName,
      stringCount: stringIds.length,
      missingStringCount: languagePack.missingStringIds.length,
      checksumAlgorithm: "fnv1a32-csv",
      contentChecksum,
      exportedAt: options.exportedAt,
    },
  };
}

export function importHmiLanguagePackCsv(
  text: string,
  options: HmiLanguageFileImportOptions = {},
): HmiLanguageFileImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let rows: string[][];
  try {
    rows = parseCsvRows(text);
  } catch (error) {
    return {
      ok: false,
      errors: [`Language file CSV is malformed: ${error instanceof Error ? error.message : String(error)}`],
      warnings,
    };
  }

  if (rows.length === 0) {
    return { ok: false, errors: ["Language file CSV has no header row."], warnings };
  }

  const header = rows[0]!.map((value) => value.trim());
  const column = new Map(header.map((value, index) => [value, index]));
  for (const required of LANGUAGE_CSV_HEADERS) {
    if (!column.has(required)) errors.push(`Language file CSV is missing required column "${required}".`);
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  const strings: Record<string, string> = {};
  const missingStringIds = new Set<string>();
  const seenStringIds = new Set<string>();
  let languageId = "";
  let displayName = "";

  rows.slice(1).forEach((row, rowIndex) => {
    const value = (name: (typeof LANGUAGE_CSV_HEADERS)[number]) => row[column.get(name)!] ?? "";
    const rowTarget = `row ${rowIndex + 2}`;
    const stringId = value("stringId").trim();
    if (!stringId) {
      warnings.push(`Language file ${rowTarget} has a blank stringId and was skipped.`);
      return;
    }
    const rowLanguageId = value("languageId").trim();
    const rowDisplayName = value("displayName").trim();
    if (!languageId && rowLanguageId) languageId = rowLanguageId;
    if (!displayName && rowDisplayName) displayName = rowDisplayName;
    if (languageId && rowLanguageId && rowLanguageId !== languageId) {
      warnings.push(`Language file ${rowTarget} uses languageId "${rowLanguageId}" instead of "${languageId}".`);
    }
    if (seenStringIds.has(stringId)) {
      warnings.push(`Language file repeats stringId "${stringId}"; the last value wins.`);
    }
    seenStringIds.add(stringId);

    const textValue = value("text");
    if (textValue || !missingFlag(value("missing"))) {
      strings[stringId] = textValue;
    } else {
      delete strings[stringId];
    }
    if (missingFlag(value("missing"))) missingStringIds.add(stringId);
    else missingStringIds.delete(stringId);
  });

  if (!languageId) errors.push("Language file CSV does not define a languageId.");
  if (!displayName) displayName = languageId;
  if (seenStringIds.size === 0) errors.push("Language file CSV does not contain any string rows.");
  if (errors.length > 0) return { ok: false, errors, warnings };

  const contentChecksum = checksum(text);
  return {
    ok: true,
    errors,
    warnings,
    languagePack: {
      id: options.id ?? createId("lang"),
      languageId,
      displayName,
      strings,
      missingStringIds: Array.from(missingStringIds).sort((left, right) => left.localeCompare(right)),
      importExport: {
        format: "esco-language-csv",
        sourceFileName: options.sourceFileName,
        importedAt: options.importedAt,
        checksumAlgorithm: "fnv1a32-csv",
        contentChecksum,
      },
    },
  };
}
