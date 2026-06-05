import { describe, expect, it } from "vitest";
import { addDevice, addHmiScreen, addHmiWidget, createSimProject } from "./project";
import { addScenarioFromTemplate } from "./scenarios";
import { summarizeFindings, validateSimProject } from "./validation";

const NOW = () => "2026-01-01T00:00:00.000Z";

describe("Simulation validation", () => {
  it("passes a well-formed seeded project (no errors)", () => {
    const project = createSimProject({ name: "Clean", processType: "skid", now: NOW });
    const findings = validateSimProject(project);
    expect(summarizeFindings(findings).errors).toBe(0);
  });

  it("flags an empty device map", () => {
    const project = createSimProject({ name: "Empty", processType: "skid", seedDefaults: false, now: NOW });
    const findings = validateSimProject(project);
    expect(findings.some((f) => f.ruleId === "device-map-empty")).toBe(true);
  });

  it("flags duplicate device tags", () => {
    const project = createSimProject({ name: "Dup", processType: "skid", seedDefaults: false, now: NOW });
    const a = addDevice(project, { kind: "motor", tag: "M1" }, NOW);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    // Force a duplicate directly in state to exercise the rule.
    const corrupted = structuredClone(a.project);
    corrupted.devices.push(structuredClone(corrupted.devices[0]!));
    const findings = validateSimProject(corrupted);
    expect(findings.some((f) => f.ruleId === "device-tag-duplicate")).toBe(true);
  });

  it("flags invalid scaling", () => {
    const project = createSimProject({ name: "Scale", processType: "pump-station", now: NOW });
    const corrupted = structuredClone(project);
    const tag = corrupted.devices.flatMap((d) => d.tags).find((t) => t.scaling)!;
    tag.scaling = { rawMin: 0, rawMax: 0, euMin: 0, euMax: 0 };
    const findings = validateSimProject(corrupted);
    expect(findings.some((f) => f.ruleId === "tag-scaling-invalid")).toBe(true);
  });

  it("flags an impossible scenario expectation (unknown tag)", () => {
    const base = createSimProject({ name: "Scn", processType: "skid", now: NOW });
    const added = addScenarioFromTemplate(base, "start-motor", NOW);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const corrupted = structuredClone(added.project);
    corrupted.scenarios[0]!.expectedTags[0]!.tag = "DoesNotExist";
    const findings = validateSimProject(corrupted);
    expect(findings.some((f) => f.ruleId === "scenario-expectation-impossible")).toBe(true);
  });

  it("flags unknown engineering units as info", () => {
    const project = createSimProject({ name: "Units", processType: "pump-station", now: NOW });
    const corrupted = structuredClone(project);
    corrupted.devices[0]!.tags[0]!.units = "furlongs";
    const findings = validateSimProject(corrupted);
    expect(findings.some((f) => f.ruleId === "tag-unit-unknown")).toBe(true);
  });

  it("flags HMI widgets bound to missing virtual tags", () => {
    let project = createSimProject({ name: "Bad HMI", processType: "skid", now: NOW });
    const screen = addHmiScreen(project, "Overview", NOW);
    expect(screen.ok).toBe(true);
    if (!screen.ok) return;
    project = screen.project;
    const widget = addHmiWidget(project, screen.data!.id, {
      kind: "indicator",
      label: "Missing",
      tag: "NoSuchVirtualTag",
    }, NOW);
    expect(widget.ok).toBe(true);
    if (!widget.ok) return;

    const findings = validateSimProject(widget.project);

    expect(findings.some((f) => f.ruleId === "hmi-widget-missing-tag" && f.severity === "error")).toBe(true);
  });
});
