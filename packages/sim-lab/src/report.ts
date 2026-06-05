/**
 * ESCO-native test report generator. Produces an offline report object plus
 * JSON and CSV serializers. The report embeds the offline-only boundary and the
 * generated-offline notice for provenance.
 */

import { SIM_LAB_GENERATED_NOTICE, SIM_LAB_OFFLINE_BOUNDARY, SIM_OFFLINE_EVIDENCE } from "./boundary";
import { collectAllTags } from "./tags";
import { nextSimId } from "./ids";
import { hmiWidgetCoverage, ioChannelCoverage, trendsCaptured, type HmiWidgetCoverage } from "./view-models";
import type {
  SimEvidenceEntry,
  SimExpectationCheck,
  SimProject,
  SimReportRef,
  SimScenarioResult,
  SimScenarioStatus,
} from "./types";

export interface SimReport {
  notice: string;
  boundary: string;
  offline: typeof SIM_OFFLINE_EVIDENCE;
  project: { id: string; name: string; processType: string; controller: string; scanRateMs: number };
  devicesTested: { tag: string; name: string; kind: string; tagCount: number }[];
  logicPathsCovered: { name: string; templateKind: string; rungs: number }[];
  alarmsProven: { alarm: string; proven: boolean }[];
  hmiActionsTested: string[];
  hmiWidgetCoverage: HmiWidgetCoverage;
  ioChannelsTested: { total: number; exercised: number };
  trendsCaptured: { tag: string; samples: number }[];
  failedExpectations: (SimExpectationCheck & { scenario: string })[];
  timelineEvidence: (SimEvidenceEntry & { scenario: string })[];
  scenarios: { name: string; status: SimScenarioStatus; total: number; passed: number; failed: number }[];
  summary: {
    devices: number;
    tags: number;
    logicBlocks: number;
    scenarios: number;
    scenariosPassed: number;
    checks: number;
    checksPassed: number;
  };
  status: SimScenarioStatus;
  offlineOnly: true;
  createdAtLabel: string;
}

export interface GenerateReportOptions {
  now?: () => string;
  /** Cap the embedded evidence rows (default 2000). */
  maxEvidenceRows?: number;
}

export function generateSimReport(
  project: SimProject,
  results: SimScenarioResult[],
  options: GenerateReportOptions = {},
): SimReport {
  const now = options.now ?? (() => new Date().toISOString());
  const maxEvidence = options.maxEvidenceRows ?? 2000;

  const provenAlarms = new Set<string>();
  for (const result of results) {
    for (const frame of result.timeline) {
      for (const a of frame.alarms) {
        if (a.state.startsWith("active")) provenAlarms.add(a.alarm);
      }
    }
  }
  const allAlarmNames = project.devices.flatMap((d) => d.alarms.map((a) => a.name));

  const hmiActions = new Set<string>();
  for (const result of results) {
    for (const frame of result.timeline) for (const e of frame.hmiEvents) hmiActions.add(e);
  }

  const failedExpectations = results.flatMap((r) =>
    r.checks.filter((c) => !c.passed).map((c) => ({ ...c, scenario: r.scenarioName })),
  );

  const timelineEvidence = results
    .flatMap((r) => r.evidence.map((e) => ({ ...e, scenario: r.scenarioName })))
    .slice(0, maxEvidence);

  const checks = results.reduce((sum, r) => sum + r.summary.total, 0);
  const checksPassed = results.reduce((sum, r) => sum + r.summary.passed, 0);
  const scenariosPassed = results.filter((r) => r.status === "pass").length;
  const status: SimScenarioStatus = results.length === 0
    ? "fail"
    : results.every((r) => r.status === "pass")
      ? "pass"
      : results.some((r) => r.status === "error")
        ? "error"
        : "fail";

  return {
    notice: SIM_LAB_GENERATED_NOTICE,
    boundary: SIM_LAB_OFFLINE_BOUNDARY,
    offline: SIM_OFFLINE_EVIDENCE,
    project: {
      id: project.id,
      name: project.name,
      processType: project.processType,
      controller: `${project.controller.name} (${project.controller.catalog})`,
      scanRateMs: project.controller.scanRateMs,
    },
    devicesTested: project.devices.map((d) => ({ tag: d.tag, name: d.name, kind: d.kind, tagCount: d.tags.length })),
    logicPathsCovered: project.logicBlocks.map((b) => ({ name: b.name, templateKind: b.templateKind, rungs: b.routine.rungs.length })),
    alarmsProven: allAlarmNames.map((alarm) => ({ alarm, proven: provenAlarms.has(alarm) })),
    hmiActionsTested: [...hmiActions],
    hmiWidgetCoverage: hmiWidgetCoverage(project, results.map((r) => r.timeline)),
    ioChannelsTested: (() => {
      const c = ioChannelCoverage(project, results.map((r) => r.timeline));
      return { total: c.channelsTotal, exercised: c.channelsExercised };
    })(),
    trendsCaptured: trendsCaptured(project, results.map((r) => r.timeline)).slice(0, 24),
    failedExpectations,
    timelineEvidence,
    scenarios: results.map((r) => ({ name: r.scenarioName, status: r.status, total: r.summary.total, passed: r.summary.passed, failed: r.summary.failed })),
    summary: {
      devices: project.devices.length,
      tags: collectAllTags(project).length,
      logicBlocks: project.logicBlocks.length,
      scenarios: results.length,
      scenariosPassed,
      checks,
      checksPassed,
    },
    status,
    offlineOnly: true,
    createdAtLabel: now(),
  };
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

export function reportToJson(report: SimReport): string {
  return JSON.stringify(report, null, 2);
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(report: SimReport): string {
  const rows: string[][] = [];
  rows.push(["ESCO Simulation Lab Test Report"]);
  rows.push(["Project", report.project.name]);
  rows.push(["Controller", report.project.controller]);
  rows.push(["Status", report.status]);
  rows.push([
    "HMI widgets bound",
    `${report.hmiWidgetCoverage.liveBoundWidgets}/${report.hmiWidgetCoverage.boundWidgets}`,
  ]);
  rows.push(["HMI widgets scenario-covered", String(report.hmiWidgetCoverage.scenarioCoveredWidgets)]);
  rows.push(["I/O channels exercised", `${report.ioChannelsTested.exercised}/${report.ioChannelsTested.total}`]);
  rows.push(["Trends captured", String(report.trendsCaptured.length)]);
  rows.push(["Boundary", report.boundary]);
  rows.push([]);
  rows.push(["Scenario", "Status", "Checks", "Passed", "Failed"]);
  for (const s of report.scenarios) rows.push([s.name, s.status, String(s.total), String(s.passed), String(s.failed)]);
  rows.push([]);
  rows.push(["Device", "Name", "Kind", "Tags"]);
  for (const d of report.devicesTested) rows.push([d.tag, d.name, d.kind, String(d.tagCount)]);
  rows.push([]);
  rows.push(["Alarm", "Proven"]);
  for (const a of report.alarmsProven) rows.push([a.alarm, a.proven ? "yes" : "no"]);
  rows.push([]);
  rows.push(["Failed Expectation (Scenario)", "Expected", "Actual"]);
  for (const f of report.failedExpectations) rows.push([`${f.description} (${f.scenario})`, f.expected, f.actual]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** Append a saved-report pointer to the project (for the Reports tree). */
export function saveReportRef(
  project: SimProject,
  report: SimReport,
  name?: string,
  now: () => string = () => new Date().toISOString(),
): { project: SimProject; ref: SimReportRef } {
  const draft = structuredClone(project);
  const ref: SimReportRef = {
    id: nextSimId(draft, "report"),
    name: name?.trim() || `${report.project.name} Test Report`,
    createdAtLabel: report.createdAtLabel,
    status: report.status,
    scenariosPassed: report.summary.scenariosPassed,
    scenariosTotal: report.summary.scenarios,
  };
  draft.reports.push(ref);
  draft.updatedAtLabel = now();
  return { project: draft, ref };
}
