import { describe, expect, it } from "vitest";
import { collectAllTags } from "./tags";
import { createCandySorterDemoProject, CANDY_SORTER_DEMO_NAME, CANDY_SORTER_DEMO_TAGS } from "./candy-sorter";
import { generateSimReport } from "./report";
import { runScenario } from "./scenarios";
import { validateSimProject } from "./validation";

const NOW = () => "2026-06-04T12:00:00.000Z";

describe("Candy sorter Simulation Lab demo", () => {
  it("creates an offline 5-count candy sorter project", () => {
    const project = createCandySorterDemoProject(NOW);
    const tags = collectAllTags(project).map((tag) => tag.name);

    expect(project.name).toBe(CANDY_SORTER_DEMO_NAME);
    expect(project.processType).toBe("packaging-line");
    expect(project.offlineOnly).toBe(true);
    expect(project.devices.map((device) => device.tag)).toEqual([
      "CV101",
      "DV201",
      "DV202",
      "PK301",
      "PE101",
      "CASE101",
      "ESTOP",
      "SEQ501",
    ]);
    expect(project.scenarios).toHaveLength(4);
    expect(project.logicBlocks.map((block) => block.name)).toContain("CV101 Conveyor Holding With Jam Interlock");
    expect(project.hmiScreens[0]?.name).toBe("Candy Sorter Overview");
    expect(tags).toContain(CANDY_SORTER_DEMO_TAGS.kitKatBoxCount);
    expect(tags).toContain(CANDY_SORTER_DEMO_TAGS.hersheyBoxCount);
    expect(tags).toContain(CANDY_SORTER_DEMO_TAGS.jamAlarm);
  });

  it("has no validation errors or impossible scenario references", () => {
    const project = createCandySorterDemoProject(NOW);
    expect(validateSimProject(project).filter((finding) => finding.severity === "error")).toEqual([]);
  });

  it("passes every included FAT scenario and report", () => {
    const project = createCandySorterDemoProject(NOW);
    const results = project.scenarios.map((scenario) => runScenario(project, scenario));
    const report = generateSimReport(project, results);

    expect(results.map((result) => result.status)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(report.status).toBe("pass");
    expect(report.summary.scenariosPassed).toBe(4);
    expect(report.summary.checksPassed).toBe(report.summary.checks);
    expect(report.hmiWidgetCoverage.boundWidgets).toBeGreaterThan(0);
    expect(report.hmiWidgetCoverage.liveBoundWidgets).toBe(report.hmiWidgetCoverage.boundWidgets);
    expect(report.hmiWidgetCoverage.missingBindings).toEqual([]);
  });
});
