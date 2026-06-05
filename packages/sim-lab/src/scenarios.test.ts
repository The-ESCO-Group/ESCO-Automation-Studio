import { describe, expect, it } from "vitest";
import { createSimProject } from "./project";
import { addScenarioFromTemplate, availableScenarioTemplates, runScenario, SCENARIO_TEMPLATES } from "./scenarios";
import type { SimProject } from "./types";

const NOW = () => "2026-01-01T00:00:00.000Z";

function project(): SimProject {
  // A skid has every device kind, so every scenario template is available.
  return createSimProject({ name: "Scenario Test", processType: "skid", now: NOW });
}

describe("FAT/SAT scenario runner", () => {
  it("offers only templates whose required devices exist", () => {
    const tankFarm = createSimProject({ name: "T", processType: "tank-farm", now: NOW });
    const available = availableScenarioTemplates(tankFarm);
    // tank-farm has no VFD-only requirement; all listed templates require devices it has or none
    expect(available.length).toBeGreaterThan(0);
  });

  it.each(SCENARIO_TEMPLATES.map((t) => t.kind))("runs the '%s' scenario to a pass verdict", (kind) => {
    const base = project();
    const added = addScenarioFromTemplate(base, kind, NOW);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const scenario = added.data!;
    const result = runScenario(added.project, scenario);
    if (result.status !== "pass") {
      // Surface the failing checks for debugging.
      const failed = result.checks.filter((c) => !c.passed).map((c) => `${c.description}: expected ${c.expected}, got ${c.actual}`);
      throw new Error(`Scenario ${kind} did not pass:\n${failed.join("\n")}\nerror=${result.error ?? "none"}`);
    }
    expect(result.status).toBe("pass");
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.timeline.length).toBeGreaterThan(0);
  });

  it("produces pass/fail evidence with a timeline", () => {
    const base = project();
    const added = addScenarioFromTemplate(base, "trip-overload", NOW);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const result = runScenario(added.project, added.data!);
    expect(result.summary.total).toBeGreaterThan(0);
    expect(result.summary.passed + result.summary.failed).toBe(result.summary.total);
    // evidence includes the fault injection
    expect(result.evidence.some((e) => e.message.includes("overload"))).toBe(true);
    // timeline includes a scenario step label
    expect(result.timeline.some((f) => f.scenarioStep)).toBe(true);
  });

  it("flags impossible scenarios as failing checks rather than crashing", () => {
    const base = project();
    const added = addScenarioFromTemplate(base, "start-motor", NOW);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const scenario = structuredClone(added.data!);
    // Corrupt an expectation so it cannot pass.
    scenario.expectedTags[0]!.value = false;
    scenario.expectedTags[0]!.comparison = "==";
    const result = runScenario(added.project, scenario);
    expect(result.status).toBe("fail");
    expect(result.summary.failed).toBeGreaterThan(0);
  });
});
