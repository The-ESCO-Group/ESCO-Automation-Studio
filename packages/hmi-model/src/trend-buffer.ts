import type {
  HmiTrend,
  HmiTrendBufferedPoint,
  HmiTrendBuffer,
  HmiTrendExportResult,
  HmiTrendSampleInput,
  HmiTrendSampleQuality,
  HmiTrendSampleResult,
} from "./types";

function csvValue(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(values: string[]): string {
  return values.map(csvValue).join(",");
}

function safeFilePart(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "trend";
}

function pointValueText(point: HmiTrendBufferedPoint | undefined): string {
  if (!point || point.value === null) return "";
  return String(point.value);
}

function pointQualityText(point: HmiTrendBufferedPoint | undefined): string {
  return point?.quality ?? "missing";
}

function cloneBuffer(buffer: HmiTrendBuffer): HmiTrendBuffer {
  return {
    ...buffer,
    traces: buffer.traces.map((trace) => ({
      ...trace,
      points: trace.points.map((point) => ({ ...point })),
    })),
  };
}

function normalizeSampleValue(value: number | boolean | null | undefined): { value: number | null; quality: HmiTrendSampleQuality } {
  if (value === undefined) return { value: null, quality: "missing" };
  if (value === null) return { value: null, quality: "bad" };
  if (typeof value === "boolean") return { value: value ? 1 : 0, quality: "good" };
  if (!Number.isFinite(value)) return { value: null, quality: "bad" };
  return { value, quality: "good" };
}

function trimTraceWindow(points: HmiTrendBufferedPoint[], timestampMs: number, timeRangeSeconds: number): HmiTrendBufferedPoint[] {
  const cutoff = timestampMs - timeRangeSeconds * 1000;
  return points.filter((point) => point.timestampMs >= cutoff);
}

function sampleTraceValue(
  input: HmiTrendSampleInput,
  trace: HmiTrendBuffer["traces"][number],
): HmiTrendBufferedPoint {
  const rawValue = Object.prototype.hasOwnProperty.call(input.values, trace.sourcePath)
    ? input.values[trace.sourcePath]
    : input.values[trace.id];
  return {
    timestampMs: input.timestampMs,
    ...normalizeSampleValue(rawValue),
  };
}

export function createHmiTrendBuffer(trend: HmiTrend): HmiTrendBuffer {
  return {
    trendId: trend.id,
    trendName: trend.name,
    sampleRateMs: trend.sampleRateMs,
    timeRangeSeconds: trend.timeRangeSeconds,
    traces: trend.traces.map((trace) => ({
      id: trace.id,
      label: trace.label,
      sourcePath: trace.source.path,
      color: trace.color,
      points: [],
    })),
  };
}

export function recordHmiTrendSample(
  buffer: HmiTrendBuffer,
  input: HmiTrendSampleInput,
): HmiTrendSampleResult {
  if (!Number.isFinite(input.timestampMs)) {
    return { accepted: false, buffer: cloneBuffer(buffer), skippedReason: "Trend sample timestamp must be finite." };
  }
  if (
    !input.force &&
    buffer.lastSampleTimestampMs !== undefined &&
    input.timestampMs - buffer.lastSampleTimestampMs < buffer.sampleRateMs
  ) {
    return { accepted: false, buffer: cloneBuffer(buffer), skippedReason: "Trend sample arrived before the configured sample rate elapsed." };
  }

  const next = cloneBuffer(buffer);
  next.lastSampleTimestampMs = input.timestampMs;
  next.traces = next.traces.map((trace) => {
    const point = sampleTraceValue(input, trace);
    return {
      ...trace,
      points: trimTraceWindow([...trace.points, point], input.timestampMs, next.timeRangeSeconds),
    };
  });
  return { accepted: true, buffer: next };
}

export function latestHmiTrendValues(buffer: HmiTrendBuffer): Record<string, HmiTrendBufferedPoint | undefined> {
  return Object.fromEntries(buffer.traces.map((trace) => [trace.id, trace.points.at(-1)]));
}

export function exportHmiTrendBufferCsv(
  buffer: HmiTrendBuffer,
  fileName = `${safeFilePart(buffer.trendName || buffer.trendId)}.hmi-trend.csv`,
): HmiTrendExportResult {
  // Traces are sampled together by recordHmiTrendSample, but export defensively
  // by pivoting the union of every trace's timestamps so misaligned buffers still
  // round-trip rather than silently dropping rows.
  const pointsByTimestamp = buffer.traces.map((trace) => {
    const byTimestamp = new Map<number, HmiTrendBufferedPoint>();
    for (const point of trace.points) byTimestamp.set(point.timestampMs, point);
    return byTimestamp;
  });
  const timestamps = [...new Set(buffer.traces.flatMap((trace) => trace.points.map((point) => point.timestampMs)))].sort(
    (a, b) => a - b,
  );

  const headers = [
    "timestampMs",
    "timestampIso",
    ...buffer.traces.flatMap((trace) => [trace.sourcePath, `${trace.sourcePath}__quality`]),
  ];
  const rows = timestamps.map((timestampMs) =>
    csvRow([
      String(timestampMs),
      new Date(timestampMs).toISOString(),
      ...buffer.traces.flatMap((_trace, index) => {
        const point = pointsByTimestamp[index].get(timestampMs);
        return [pointValueText(point), pointQualityText(point)];
      }),
    ]),
  );
  return {
    fileName,
    text: `${[csvRow(headers), ...rows].join("\n")}\n`,
    rowCount: timestamps.length,
  };
}
