import type {
  HmiTrendBuffer,
  HmiTrendChartAxisTick,
  HmiTrendChartPlotArea,
  HmiTrendChartPoint,
  HmiTrendChartPreview,
  HmiTrendChartRenderOptions,
  HmiTrendChartRenderPadding,
  HmiTrendChartSeries,
} from "./types";

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 320;
const DEFAULT_PADDING: HmiTrendChartRenderPadding = { top: 16, right: 16, bottom: 32, left: 48 };

function boundedDimension(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function boundedPadding(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function normalizePadding(padding: HmiTrendChartRenderOptions["padding"]): HmiTrendChartRenderPadding {
  return {
    top: boundedPadding(padding?.top, DEFAULT_PADDING.top),
    right: boundedPadding(padding?.right, DEFAULT_PADDING.right),
    bottom: boundedPadding(padding?.bottom, DEFAULT_PADDING.bottom),
    left: boundedPadding(padding?.left, DEFAULT_PADDING.left),
  };
}

function createPlotArea(width: number, height: number, padding: HmiTrendChartRenderPadding): HmiTrendChartPlotArea {
  return {
    x: padding.left,
    y: padding.top,
    width: Math.max(1, width - padding.left - padding.right),
    height: Math.max(1, height - padding.top - padding.bottom),
  };
}

function latestTimestampMs(buffer: HmiTrendBuffer): number {
  if (Number.isFinite(buffer.lastSampleTimestampMs)) return buffer.lastSampleTimestampMs!;
  const timestamps = buffer.traces.flatMap((trace) => trace.points.map((point) => point.timestampMs)).filter(Number.isFinite);
  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
}

function normalizeTimeWindow(buffer: HmiTrendBuffer, nowTimestampMs: number | undefined): { start: number; end: number } {
  const end = Number.isFinite(nowTimestampMs) ? nowTimestampMs! : latestTimestampMs(buffer);
  const spanMs = Math.max(1, buffer.timeRangeSeconds * 1000);
  return { start: end - spanMs, end };
}

function goodValues(buffer: HmiTrendBuffer): number[] {
  return buffer.traces.flatMap((trace) =>
    trace.points
      .filter((point) => point.quality === "good" && point.value !== null && Number.isFinite(point.value))
      .map((point) => point.value!),
  );
}

function normalizeValueRange(buffer: HmiTrendBuffer, options: HmiTrendChartRenderOptions): { min: number; max: number; emptyMessage?: string } {
  const values = goodValues(buffer);
  const hasValues = values.length > 0;
  let min = Number.isFinite(options.valueMin) ? options.valueMin! : hasValues ? Math.min(...values) : 0;
  let max = Number.isFinite(options.valueMax) ? options.valueMax! : hasValues ? Math.max(...values) : 1;

  if (min > max) [min, max] = [max, min];
  if (min === max) {
    min -= 1;
    max += 1;
  }

  return hasValues ? { min, max } : { min, max, emptyMessage: "Trend has no good samples." };
}

function mapTime(timestampMs: number, start: number, end: number, plotArea: HmiTrendChartPlotArea): number {
  const ratio = (timestampMs - start) / Math.max(1, end - start);
  return plotArea.x + Math.max(0, Math.min(1, ratio)) * plotArea.width;
}

function mapValue(value: number, min: number, max: number, plotArea: HmiTrendChartPlotArea): number {
  const ratio = (value - min) / Math.max(1, max - min);
  return plotArea.y + plotArea.height - Math.max(0, Math.min(1, ratio)) * plotArea.height;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function labelNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(roundCoordinate(value));
}

function createTicks(start: number, end: number, count: number, toPosition: (value: number) => number): HmiTrendChartAxisTick[] {
  const safeCount = Math.max(2, count);
  const span = end - start;
  return Array.from({ length: safeCount }, (_, index) => {
    const value = start + (span * index) / (safeCount - 1);
    return {
      value: roundCoordinate(value),
      position: roundCoordinate(toPosition(value)),
      label: labelNumber(value),
    };
  });
}

function createPath(points: HmiTrendChartPoint[]): string {
  const commands: string[] = [];
  let drawing = false;

  for (const point of points) {
    if (point.y === null) {
      drawing = false;
      continue;
    }
    commands.push(`${drawing ? "L" : "M"} ${point.x} ${point.y}`);
    drawing = true;
  }

  return commands.join(" ");
}

function createSeries(
  buffer: HmiTrendBuffer,
  timeWindow: { start: number; end: number },
  valueRange: { min: number; max: number },
  plotArea: HmiTrendChartPlotArea,
): HmiTrendChartSeries[] {
  return buffer.traces.map((trace) => {
    const points = trace.points.map((point) => {
      const x = roundCoordinate(mapTime(point.timestampMs, timeWindow.start, timeWindow.end, plotArea));
      const y =
        point.quality === "good" && point.value !== null && Number.isFinite(point.value)
          ? roundCoordinate(mapValue(point.value, valueRange.min, valueRange.max, plotArea))
          : null;
      return { timestampMs: point.timestampMs, value: point.value, quality: point.quality, x, y };
    });

    return {
      traceId: trace.id,
      label: trace.label,
      sourcePath: trace.sourcePath,
      color: trace.color,
      points,
      path: createPath(points),
    };
  });
}

export function renderHmiTrendChartPreview(
  buffer: HmiTrendBuffer,
  options: HmiTrendChartRenderOptions = {},
): HmiTrendChartPreview {
  const width = boundedDimension(options.width, DEFAULT_WIDTH);
  const height = boundedDimension(options.height, DEFAULT_HEIGHT);
  const padding = normalizePadding(options.padding);
  const plotArea = createPlotArea(width, height, padding);
  const timeWindow = normalizeTimeWindow(buffer, options.nowTimestampMs);
  const valueRange = normalizeValueRange(buffer, options);
  const timeAxis = {
    startTimestampMs: timeWindow.start,
    endTimestampMs: timeWindow.end,
    ticks: createTicks(timeWindow.start, timeWindow.end, 3, (value) => mapTime(value, timeWindow.start, timeWindow.end, plotArea)),
  };
  const valueAxis = {
    min: valueRange.min,
    max: valueRange.max,
    ticks: createTicks(valueRange.min, valueRange.max, 5, (value) => mapValue(value, valueRange.min, valueRange.max, plotArea)),
  };
  const preview = {
    trendId: buffer.trendId,
    trendName: buffer.trendName,
    width,
    height,
    padding,
    plotArea,
    timeAxis,
    valueAxis,
    series: createSeries(buffer, timeWindow, valueRange, plotArea),
  };
  return valueRange.emptyMessage ? { ...preview, emptyMessage: valueRange.emptyMessage } : preview;
}
