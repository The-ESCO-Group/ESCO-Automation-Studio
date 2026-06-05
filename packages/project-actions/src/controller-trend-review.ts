import type { ControllerTrend, PlcProject } from "@esco/core";

export type ControllerTrendReviewStatus =
  | "reviewable"
  | "needs-attention";

export type ControllerTrendReviewIssue =
  | "no-pens"
  | "too-many-pens"
  | "invalid-sample-period"
  | "invalid-number-of-captures";

export type ControllerTrendReviewBoundary =
  | "no-controller-communication"
  | "no-online-trend-run"
  | "no-controller-sampling"
  | "no-trend-log-capture"
  | "no-sampled-data-export";

export interface ControllerTrendPenReviewRow {
  penId: string;
  penName: string;
  tagSpecifier: string;
  color?: string;
  visible?: string;
  width?: string;
  type?: string;
  style?: string;
  marker?: string;
  min?: string;
  max?: string;
  engineeringUnits?: string;
  description?: string;
}

export interface ControllerTrendReviewRow {
  controllerId: string;
  controllerName: string;
  trendId: string;
  trendName: string;
  description?: string;
  samplePeriod?: string;
  samplePeriodMs?: number;
  numberOfCaptures?: string;
  numberOfCapturesValue?: number;
  captureSizeType?: string;
  captureSize?: string;
  startTriggerType?: string;
  stopTriggerType?: string;
  trendxVersion?: string;
  templatePresent: boolean;
  penCount: number;
  pens: ControllerTrendPenReviewRow[];
  status: ControllerTrendReviewStatus;
  issues: ControllerTrendReviewIssue[];
  controllerCommunicationModelled: false;
  onlineTrendRunModelled: false;
  controllerSamplingModelled: false;
  trendLogCaptureModelled: false;
  sampledDataExported: false;
  boundaries: ControllerTrendReviewBoundary[];
  message: string;
}

export interface ControllerTrendReviewReport {
  rows: ControllerTrendReviewRow[];
  controllerCount: number;
  trendCount: number;
  penCount: number;
  reviewableCount: number;
  issueCount: number;
  noPenCount: number;
  tooManyPensCount: number;
  invalidSamplePeriodCount: number;
  invalidNumberOfCapturesCount: number;
  warnings: string[];
}

const MAX_TRENDS_PENS = 8;
const MIN_SAMPLE_PERIOD_MS = 1;
const MAX_SAMPLE_PERIOD_MS = 30 * 60 * 1000;
const MIN_CAPTURES = 1;
const MAX_CAPTURES = 100;

const BOUNDARIES: ControllerTrendReviewBoundary[] = [
  "no-controller-communication",
  "no-online-trend-run",
  "no-controller-sampling",
  "no-trend-log-capture",
  "no-sampled-data-export",
];

function attr(trend: ControllerTrend, name: string): string | undefined {
  const value = trend.attributes?.[name];
  return value == null || value.trim() === "" ? undefined : value.trim();
}

function parseNumber(value: string | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseInteger(value: string | undefined): number | undefined {
  const parsed = parseNumber(value);
  return parsed != null && Number.isInteger(parsed) ? parsed : undefined;
}

function issuesFor(trend: ControllerTrend): ControllerTrendReviewIssue[] {
  const issues: ControllerTrendReviewIssue[] = [];
  if (trend.pens.length === 0) issues.push("no-pens");
  if (trend.pens.length > MAX_TRENDS_PENS) issues.push("too-many-pens");

  const samplePeriod = parseNumber(attr(trend, "SamplePeriod"));
  if (
    attr(trend, "SamplePeriod") != null &&
    (samplePeriod == null || samplePeriod < MIN_SAMPLE_PERIOD_MS || samplePeriod > MAX_SAMPLE_PERIOD_MS)
  ) {
    issues.push("invalid-sample-period");
  }

  const captures = parseInteger(attr(trend, "NumberOfCaptures"));
  if (
    attr(trend, "NumberOfCaptures") != null &&
    (captures == null || captures < MIN_CAPTURES || captures > MAX_CAPTURES)
  ) {
    issues.push("invalid-number-of-captures");
  }

  return issues;
}

function issueLabel(issue: ControllerTrendReviewIssue): string {
  switch (issue) {
    case "no-pens":
      return "no pens are configured";
    case "too-many-pens":
      return `more than ${MAX_TRENDS_PENS} pens are configured`;
    case "invalid-sample-period":
      return `SamplePeriod must be ${MIN_SAMPLE_PERIOD_MS}-${MAX_SAMPLE_PERIOD_MS} ms`;
    case "invalid-number-of-captures":
      return `NumberOfCaptures must be ${MIN_CAPTURES}-${MAX_CAPTURES}`;
  }
}

function penRow(pen: ControllerTrend["pens"][number]): ControllerTrendPenReviewRow {
  const attributes = pen.attributes ?? {};
  return {
    penId: pen.id,
    penName: pen.name,
    tagSpecifier: pen.name,
    color: attributes.Color,
    visible: attributes.Visible,
    width: attributes.Width,
    type: attributes.Type,
    style: attributes.Style,
    marker: attributes.Marker,
    min: attributes.Min,
    max: attributes.Max,
    engineeringUnits: attributes.EngUnits,
    description: pen.description,
  };
}

function messageFor(row: Omit<ControllerTrendReviewRow, "message">): string {
  if (row.issues.length) {
    return `Trend "${row.trendName}" needs attention: ${row.issues.map(issueLabel).join("; ")}.`;
  }
  return `Trend "${row.trendName}" is reviewable offline with ${row.penCount} pen(s); online sampling, trend logs, and sampled data export are not modelled.`;
}

export function controllerTrendReviewReport(project: PlcProject): ControllerTrendReviewReport {
  const rows: ControllerTrendReviewRow[] = [];
  for (const controller of project.controllers) {
    for (const trend of controller.trends ?? []) {
      const issues = issuesFor(trend);
      const samplePeriod = attr(trend, "SamplePeriod");
      const captures = attr(trend, "NumberOfCaptures");
      const rowBase = {
        controllerId: controller.id,
        controllerName: controller.name,
        trendId: trend.id,
        trendName: trend.name,
        description: trend.description,
        samplePeriod,
        samplePeriodMs: parseNumber(samplePeriod),
        numberOfCaptures: captures,
        numberOfCapturesValue: parseInteger(captures),
        captureSizeType: attr(trend, "CaptureSizeType"),
        captureSize: attr(trend, "CaptureSize"),
        startTriggerType: attr(trend, "StartTriggerType"),
        stopTriggerType: attr(trend, "StopTriggerType"),
        trendxVersion: attr(trend, "TrendxVersion"),
        templatePresent: trend.template != null && trend.template.trim() !== "",
        penCount: trend.pens.length,
        pens: trend.pens.map(penRow),
        status: issues.length ? "needs-attention" as const : "reviewable" as const,
        issues,
        controllerCommunicationModelled: false as const,
        onlineTrendRunModelled: false as const,
        controllerSamplingModelled: false as const,
        trendLogCaptureModelled: false as const,
        sampledDataExported: false as const,
        boundaries: [...BOUNDARIES],
      };
      rows.push({ ...rowBase, message: messageFor(rowBase) });
    }
  }

  const hasIssue = (issue: ControllerTrendReviewIssue) =>
    rows.filter((row) => row.issues.includes(issue)).length;

  return {
    rows,
    controllerCount: project.controllers.length,
    trendCount: rows.length,
    penCount: rows.reduce((sum, row) => sum + row.penCount, 0),
    reviewableCount: rows.filter((row) => row.status === "reviewable").length,
    issueCount: rows.filter((row) => row.issues.length > 0).length,
    noPenCount: hasIssue("no-pens"),
    tooManyPensCount: hasIssue("too-many-pens"),
    invalidSamplePeriodCount: hasIssue("invalid-sample-period"),
    invalidNumberOfCapturesCount: hasIssue("invalid-number-of-captures"),
    warnings: rows.filter((row) => row.issues.length > 0).map((row) => row.message),
  };
}
