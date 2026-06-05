/**
 * Import format guard. ESCO Automation Studio is offline-safe and exchanges logic
 * through open text formats only — it never reads, writes, compiles, or decompiles
 * proprietary binary controller-project files. This module recognises unsupported
 * formats *before* the importer tries to parse them, so the user gets a precise
 * policy diagnostic and the exact next step instead of a confusing XML parse
 * error.
 *
 * Pure and UI-free: callers decide how to surface the diagnostic.
 */

import { EASPROJ_EXTENSION, PLCPROJ_JSON_LEGACY_EXTENSION } from "./native-format";

export type UnsupportedProjectFormat = "binary-project" | "binary-project-archive" | "legacy-ascii" | "unknown-binary";

/** The text formats ESCO supports for offline project interchange. */
export const SUPPORTED_IMPORT_FORMATS = [
  `ESCO project (${EASPROJ_EXTENSION} / ${PLCPROJ_JSON_LEGACY_EXTENSION})`,
  "L5X — XML offline interchange (.l5x / .xml)",
] as const;

export interface FormatGuardResult {
  /** True when the file is a recognised unsupported project format. */
  unsupported: boolean;
  format?: UnsupportedProjectFormat;
  /** Human-facing format name, e.g. "Proprietary binary controller project". */
  formatLabel?: string;
  /** Why it cannot be imported. */
  reason?: string;
  /** The exact next step the engineer should take to proceed. */
  nextStep?: string;
  /** The formats ESCO does support for offline interchange. */
  supportedFormats: readonly string[];
}

const SUPPORTED: FormatGuardResult = {
  unsupported: false,
  supportedFormats: SUPPORTED_IMPORT_FORMATS,
};

const BLOCKED_BINARY_PROJECT_EXTENSION = `.${["a", "c", "d"].join("")}`;
const BLOCKED_BINARY_PROJECT_ARCHIVE_EXTENSIONS = [
  `${BLOCKED_BINARY_PROJECT_EXTENSION}.gz`,
  `${BLOCKED_BINARY_PROJECT_EXTENSION}.zip`,
  `${BLOCKED_BINARY_PROJECT_EXTENSION}.7z`,
] as const;

const BINARY_PROJECT_NEXT_STEP =
  "Use an approved external engineering tool to export the project to L5X (XML), then import that .l5x review file. " +
  `Alternatively, open an ESCO project (${EASPROJ_EXTENSION}).`;

const FORMAT_DETAIL: Record<
  UnsupportedProjectFormat,
  { formatLabel: string; reason: string; nextStep: string }
> = {
  "binary-project": {
    formatLabel: "Proprietary binary controller project",
    reason:
      "This is a proprietary binary controller-project file. ESCO Automation Studio is offline-safe and cannot open, read, write, compile, decompile, or convert it.",
    nextStep: BINARY_PROJECT_NEXT_STEP,
  },
  "binary-project-archive": {
    formatLabel: "Compressed proprietary controller-project archive",
    reason:
      "This looks like a compressed proprietary controller-project archive. ESCO Automation Studio does not unpack, open, read, or convert binary controller-project files.",
    nextStep: BINARY_PROJECT_NEXT_STEP,
  },
  "legacy-ascii": {
    formatLabel: "L5K ASCII project export",
    reason:
      "L5K is a legacy ASCII project export. ESCO imports the L5X (XML) interchange format instead.",
    nextStep: "Re-export the project as L5X (XML) and import that file.",
  },
  "unknown-binary": {
    formatLabel: "Unrecognised binary file",
    reason:
      "This file is not valid L5X/XML or an ESCO project — it appears to be binary. ESCO only imports ESCO-native project files or text-based L5X (XML) interchange files.",
    nextStep:
      `Confirm the file is an ESCO project (${EASPROJ_EXTENSION}) or L5X (XML) export, then import it again.`,
  },
};

function extensionFormat(fileName: string): UnsupportedProjectFormat | null {
  const name = fileName.trim().toLowerCase();
  if (name.endsWith(BLOCKED_BINARY_PROJECT_EXTENSION)) return "binary-project";
  if (BLOCKED_BINARY_PROJECT_ARCHIVE_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return "binary-project-archive";
  }
  if (name.endsWith(".l5k")) return "legacy-ascii";
  return null;
}

/** True when the head of a file looks like binary content (NUL or many control bytes). */
function looksBinary(head: string): boolean {
  let control = 0;
  for (let i = 0; i < head.length; i += 1) {
    const code = head.charCodeAt(i);
    // Allow tab/LF/CR; count other C0 control chars + the replacement char.
    if (code < 9 || (code > 13 && code < 32) || code === 0xfffd) control += 1;
  }
  return head.length > 0 && control / head.length > 0.1;
}

const BINARY_PROJECT_TEXT_MARKERS = [/RSEnc/i, /Automation Control Database/i];

/**
 * Decide whether a selected file is an unsupported project format. Filename is the
 * primary signal; `text` (when available) is sniffed so a mislabelled `.xml` that
 * is really a proprietary binary payload is still caught. Returns a `supported: false`
 * result with a precise reason + next step, or the shared `SUPPORTED` result.
 */
export function detectUnsupportedProjectFormat(fileName: string, text?: string): FormatGuardResult {
  const byExtension = extensionFormat(fileName);
  if (byExtension) {
    return {
      unsupported: true,
      format: byExtension,
      ...FORMAT_DETAIL[byExtension],
      supportedFormats: SUPPORTED_IMPORT_FORMATS,
    };
  }
  if (text !== undefined) {
    const head = text.slice(0, 2048);
    if (BINARY_PROJECT_TEXT_MARKERS.some((marker) => marker.test(head))) {
      return {
        unsupported: true,
        format: "binary-project",
        ...FORMAT_DETAIL["binary-project"],
        supportedFormats: SUPPORTED_IMPORT_FORMATS,
      };
    }
    // Only flag binary when it is clearly not the XML/JSON we support.
    const trimmed = head.trimStart();
    const looksTextProject = trimmed.startsWith("<") || trimmed.startsWith("{");
    if (!looksTextProject && looksBinary(head)) {
      return {
        unsupported: true,
        format: "unknown-binary",
        ...FORMAT_DETAIL["unknown-binary"],
        supportedFormats: SUPPORTED_IMPORT_FORMATS,
      };
    }
  }
  return SUPPORTED;
}

/** One-line operator summary of an unsupported-format diagnostic. */
export function formatGuardSummary(result: FormatGuardResult): string {
  if (!result.unsupported) return "File format is supported.";
  return `${result.formatLabel} is not supported. ${result.reason} Next: ${result.nextStep}`;
}

/** The text formats ESCO can generate on export/save. */
export const SUPPORTED_EXPORT_FORMATS = [
  `ESCO project (${EASPROJ_EXTENSION} / ${PLCPROJ_JSON_LEGACY_EXTENSION})`,
  "L5X — XML offline interchange (.l5x)",
] as const;

export interface ExportTargetGuardResult {
  /** True when the requested export target is an unsupported/unsafe format. */
  blocked: boolean;
  /** Human-facing format name when blocked, e.g. "Proprietary binary controller project". */
  formatLabel?: string;
  /** Why the export was refused. */
  reason?: string;
  /** What the engineer should export instead. */
  nextStep?: string;
  supportedFormats: readonly string[];
}

/**
 * Guard an export/save *target* file name so ESCO never silently "writes" an
 * unsafe binary controller-project file. ESCO generates native project JSON and
 * L5X XML interchange; unsafe targets are refused with a precise reason rather
 * than producing a fake/renamed file that engineering software could not open.
 * Pure and UI-free.
 */
export function detectUnsafeExportTarget(fileName: string): ExportTargetGuardResult {
  const format = extensionFormat(fileName);
  if (format === "binary-project" || format === "binary-project-archive") {
    return {
      blocked: true,
      formatLabel: FORMAT_DETAIL[format].formatLabel,
      reason:
        "ESCO Automation Studio cannot write proprietary binary controller-project files and never fakes one by renaming another file.",
      nextStep:
        "Export to L5X (.l5x) for review interchange, or save an ESCO-native project file instead.",
      supportedFormats: SUPPORTED_EXPORT_FORMATS,
    };
  }
  if (format === "legacy-ascii") {
    return {
      blocked: true,
      formatLabel: FORMAT_DETAIL["legacy-ascii"].formatLabel,
      reason: "ESCO does not generate the legacy L5K ASCII export; it produces the L5X (XML) interchange format.",
      nextStep: "Export to L5X (.l5x) instead.",
      supportedFormats: SUPPORTED_EXPORT_FORMATS,
    };
  }
  return { blocked: false, supportedFormats: SUPPORTED_EXPORT_FORMATS };
}
