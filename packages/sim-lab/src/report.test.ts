import { describe, expect, it } from "vitest";
import { addHmiScreen, addHmiWidget, createSimProject } from "./project";
import { addScenarioFromTemplate, runScenario } from "./scenarios";
import { generateSimReport, reportToCsv, reportToJson, saveReportRef } from "./report";

const NOW = () => "2026-01-01T00:00:00.000Z";

function runAll() {
  let project = createSimProject({ name: "Report Test", processType: "skid", now: NOW });
  const results = [];
  for (const kind of ["start-motor", "trip-overload", "low-flow"] as const) {
    const added = addScenarioFromTemplate(project, kind, NOW);
    if (added.ok) {
      project = added.project;
      results.push(runScenario(project, added.data!));
    }
  }
  return { project, results };
}

describe("Simulation report", () => {
  it("summarizes devices, logic, alarms, HMI actions and check totals", () => {
    const { project, results } = runAll();
    const report = generateSimReport(project, results, { now: NOW });
    expect(report.offlineOnly).toBe(true);
    expect(report.boundary).toMatch(/offline/i);
    expect(report.notice).toMatch(/Generated offline/i);
    expect(report.devicesTested.length).toBe(project.devices.length);
    expect(report.logicPathsCovered.length).toBe(project.logicBlocks.length);
    expect(report.summary.scenarios).toBe(results.length);
    expect(report.summary.checks).toBeGreaterThan(0);
    expect(report.alarmsProven.some((a) => a.proven)).toBe(true);
    expect(report.status).toBe("pass");
  });

  it("summarizes HMI widget binding coverage from scenario timelines", () => {
    let project = createSimProject({ name: "HMI Coverage", processType: "skid", now: NOW });
    const scenario = addScenarioFromTemplate(project, "start-motor", NOW);
    expect(scenario.ok).toBe(true);
    if (!scenario.ok) return;
    project = scenario.project;
    const coveredTag = scenario.data!.expectedTags[0]!.tag;

    const screen = addHmiScreen(project, "Overview", NOW);
    expect(screen.ok).toBe(true);
    if (!screen.ok) return;
    project = screen.project;
    const widget = addHmiWidget(project, screen.data!.id, {
      kind: "indicator",
      label: "Run Command",
      tag: coveredTag,
    }, NOW);
    expect(widget.ok).toBe(true);
    if (!widget.ok) return;
    project = widget.project;

    const report = generateSimReport(project, [runScenario(project, scenario.data!)], { now: NOW });

    expect(report.hmiWidgetCoverage).toMatchObject({
      screens: 1,
      widgets: 1,
      boundWidgets: 1,
      liveBoundWidgets: 1,
      scenarioCoveredWidgets: 1,
      missingBindings: [],
    });
  });

  it("collects failed expectations", () => {
    const { project, results } = runAll();
    // Force a failure into one result.
    const broken = structuredClone(results);
    broken[0]!.status = "fail";
    broken[0]!.checks[0]!.passed = false;
    broken[0]!.summary.failed = 1;
    broken[0]!.summary.passed = broken[0]!.summary.total - 1;
    const report = generateSimReport(project, broken, { now: NOW });
    expect(report.failedExpectations.length).toBeGreaterThan(0);
    expect(report.status).toBe("fail");
  });

  it("serializes to JSON and CSV", () => {
    const { project, results } = runAll();
    const report = generateSimReport(project, results, { now: NOW });
    const json = reportToJson(report);
    expect(JSON.parse(json).project.name).toBe("Report Test");
    const csv = reportToCsv(report);
    expect(csv).toContain("ESCO Simulation Lab Test Report");
    expect(csv).toContain("HMI widgets bound");
    expect(csv.split("\r\n").length).toBeGreaterThan(3);
  });

  it("saves a report pointer into the project", () => {
    const { project, results } = runAll();
    const report = generateSimReport(project, results, { now: NOW });
    const { project: next, ref } = saveReportRef(project, report, undefined, NOW);
    expect(next.reports).toHaveLength(1);
    expect(ref.status).toBe("pass");
  });
});
