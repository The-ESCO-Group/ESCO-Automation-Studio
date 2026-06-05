import type {
  HmiDataLog,
  HmiDataLogBuffer,
  HmiDataLogBufferedRow,
  HmiDataLogBufferedValue,
  HmiDataLogExportResult,
  HmiDataLogMediaSaveOptions,
  HmiDataLogMediaSaveResult,
  HmiDataLogSampleInput,
  HmiDataLogSampleQuality,
  HmiDataLogSampleResult,
} from "./types";

function cloneBuffer(buffer: HmiDataLogBuffer): HmiDataLogBuffer {
  return {
    ...buffer,
    tagPaths: [...buffer.tagPaths],
    rows: buffer.rows.map((row) => ({
      timestampMs: row.timestampMs,
      values: Object.fromEntries(Object.entries(row.values).map(([tagPath, value]) => [tagPath, { ...value }])),
    })),
  };
}

function normalizeValue(value: string | number | boolean | null | undefined): { value: string | number | boolean | null; quality: HmiDataLogSampleQuality } {
  if (value === undefined) return { value: null, quality: "missing" };
  if (value === null) return { value: null, quality: "bad" };
  if (typeof value === "number" && !Number.isFinite(value)) return { value: null, quality: "bad" };
  return { value, quality: "good" };
}

function csvValue(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(values: string[]): string {
  return values.map(csvValue).join(",");
}

function safeFilePart(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "data-log";
}

function safeDirectoryPath(value: string | undefined): string {
  const segments = (value ?? "DataLogs")
    .split(/[\\/]+/)
    .map((segment) => safeFilePart(segment))
    .filter(Boolean);
  return segments.length > 0 ? segments.join("/") : "DataLogs";
}

function normalizeRootPath(value: string): string {
  return value.trim().replace(/[\\/]+$/g, "") || "media";
}

function mediaPath(rootPath: string, directory: string, fileName: string): string {
  return `${normalizeRootPath(rootPath)}/${directory}/${safeFilePart(fileName)}`;
}

function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function rowValueText(value: HmiDataLogBufferedValue | undefined): string {
  if (!value || value.value === null) return "";
  return String(value.value);
}

function rowQualityText(value: HmiDataLogBufferedValue | undefined): string {
  return value?.quality ?? "missing";
}

function trimRows(rows: HmiDataLogBufferedRow[], timestampMs: number, retentionHours: number): HmiDataLogBufferedRow[] {
  const cutoff = timestampMs - retentionHours * 60 * 60 * 1000;
  return rows.filter((row) => row.timestampMs >= cutoff);
}

function sampleRow(buffer: HmiDataLogBuffer, input: HmiDataLogSampleInput): HmiDataLogBufferedRow {
  return {
    timestampMs: input.timestampMs,
    values: Object.fromEntries(
      buffer.tagPaths.map((tagPath) => [tagPath, normalizeValue(input.values[tagPath])]),
    ),
  };
}

export function createHmiDataLogBuffer(log: HmiDataLog): HmiDataLogBuffer {
  return {
    dataLogId: log.id,
    dataLogName: log.name,
    sampleRateMs: log.sampleRateMs,
    retentionHours: log.retentionHours,
    tagPaths: [...log.tagPaths],
    rows: [],
    status: "idle",
    statusMessage: `Data log "${log.name}" is idle.`,
  };
}

export function recordHmiDataLogSample(
  buffer: HmiDataLogBuffer,
  input: HmiDataLogSampleInput,
): HmiDataLogSampleResult {
  if (!Number.isFinite(input.timestampMs)) {
    return { accepted: false, buffer: cloneBuffer(buffer), skippedReason: "Data log sample timestamp must be finite." };
  }
  if (
    !input.force &&
    buffer.lastSampleTimestampMs !== undefined &&
    input.timestampMs - buffer.lastSampleTimestampMs < buffer.sampleRateMs
  ) {
    return {
      accepted: false,
      buffer: {
        ...cloneBuffer(buffer),
        status: "skipped",
        statusMessage: `Data log "${buffer.dataLogName}" sample skipped before the configured sample rate elapsed.`,
      },
      skippedReason: "Data log sample arrived before the configured sample rate elapsed.",
    };
  }

  const row = sampleRow(buffer, input);
  const rows = trimRows([...buffer.rows, row], input.timestampMs, buffer.retentionHours);
  return {
    accepted: true,
    buffer: {
      ...cloneBuffer(buffer),
      rows,
      lastSampleTimestampMs: input.timestampMs,
      status: "recording",
      statusMessage: `Data log "${buffer.dataLogName}" recorded ${rows.length} row(s).`,
    },
  };
}

export function clearHmiDataLogBuffer(buffer: HmiDataLogBuffer): HmiDataLogBuffer {
  return {
    ...cloneBuffer(buffer),
    rows: [],
    lastSampleTimestampMs: undefined,
    status: "cleared",
    statusMessage: `Data log "${buffer.dataLogName}" was cleared.`,
  };
}

export function exportHmiDataLogBufferCsv(
  buffer: HmiDataLogBuffer,
  fileName = `${safeFilePart(buffer.dataLogName || buffer.dataLogId)}.hmi-data-log.csv`,
): HmiDataLogExportResult {
  const headers = [
    "timestampMs",
    "timestampIso",
    ...buffer.tagPaths.flatMap((tagPath) => [tagPath, `${tagPath}__quality`]),
  ];
  const rows = buffer.rows.map((row) =>
    csvRow([
      String(row.timestampMs),
      new Date(row.timestampMs).toISOString(),
      ...buffer.tagPaths.flatMap((tagPath) => [rowValueText(row.values[tagPath]), rowQualityText(row.values[tagPath])]),
    ]),
  );
  return {
    fileName,
    text: `${[csvRow(headers), ...rows].join("\n")}\n`,
    rowCount: buffer.rows.length,
  };
}

export function buildHmiDataLogMediaSave(
  exportResult: HmiDataLogExportResult,
  options: HmiDataLogMediaSaveOptions,
): HmiDataLogMediaSaveResult {
  const byteLength = utf8ByteLength(exportResult.text);
  if (!options.target.mounted) {
    return {
      ok: false,
      status: "blocked",
      message: `Media target "${options.target.label}" is not mounted.`,
    };
  }
  if (options.target.availableBytes !== undefined && byteLength > options.target.availableBytes) {
    return {
      ok: false,
      status: "blocked",
      message: `Media target "${options.target.label}" does not have enough free space for ${exportResult.fileName}.`,
    };
  }

  const directory = safeDirectoryPath(options.directory);
  const fileName = safeFilePart(exportResult.fileName);
  const savedAt = options.savedAt ?? new Date(0).toISOString();
  const file = {
    fileName,
    path: mediaPath(options.target.rootPath, directory, fileName),
    rowCount: exportResult.rowCount,
    byteLength,
    savedAt,
    mediaKind: options.target.kind,
    mediaLabel: options.target.label,
    checksumAlgorithm: "fnv1a32-text" as const,
    contentChecksum: checksum(exportResult.text),
  };

  return {
    ok: true,
    status: "saved",
    message: `Saved ${exportResult.rowCount} data-log row(s) to ${file.path} in offline preview.`,
    file,
  };
}
