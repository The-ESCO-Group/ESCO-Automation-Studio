import { describe, expect, it } from "vitest";
import { createController, createProject, type IoModule, type IoPort } from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a single-controller project, returning the controller so tests can add modules. */
function projectWithController() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

let moduleSeq = 0;
function ioModule(name: string, ports: IoPort[]): IoModule {
  return { id: `mod-${moduleSeq++}`, name, ports };
}

const snnFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "module-safety-network-number");

describe("module-safety-network-number", () => {
  it("accepts a well-formed, non-zero Safety Network Number", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("SafetyMod", [{ id: "A", safetyNetwork: "16#0000_05a2_4567_89ab" }]),
    );
    expect(snnFindings(project)).toHaveLength(0);
  });

  it("leaves a port with no Safety Network Number alone (standard port)", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("StdMod", [{ id: "A", type: "ICP" }]));
    expect(snnFindings(project)).toHaveLength(0);
  });

  it("treats a whitespace-only Safety Network Number as absent", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("Mod", [{ id: "A", safetyNetwork: "  " }]));
    expect(snnFindings(project)).toHaveLength(0);
  });

  it("ignores underscore grouping when validating the payload", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Mod", [{ id: "A", safetyNetwork: "16#05a2456789ab" }]),
    );
    expect(snnFindings(project)).toHaveLength(0);
  });

  it("flags a value with no 16# radix prefix", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Mod", [{ id: "A", safetyNetwork: "0000_05a2_4567_89ab" }]),
    );
    const findings = snnFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("not a valid 16# hexadecimal value");
    expect(findings[0].target).toBe("Ctrl/Mod");
  });

  it("flags a value with non-hex characters", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Mod", [{ id: "A", safetyNetwork: "16#0000_05g2_4567_89ab" }]),
    );
    const findings = snnFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("not a valid 16# hexadecimal value");
  });

  it("flags a value with an empty hexadecimal payload", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("Mod", [{ id: "A", safetyNetwork: "16#" }]));
    expect(snnFindings(project)).toHaveLength(1);
  });

  it("flags a value that exceeds the 64-bit range", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Mod", [{ id: "A", safetyNetwork: "16#0000_05a2_4567_89ab_0" }]),
    );
    const findings = snnFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("64-bit");
  });

  it("flags an unset (all-zero) Safety Network Number", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Mod", [{ id: "A", safetyNetwork: "16#0000_0000_0000_0000" }]),
    );
    const findings = snnFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("all-zero");
  });

  it("includes the port id in the message when present", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Mod", [{ id: "2", safetyNetwork: "16#0000_0000_0000_0000" }]),
    );
    expect(snnFindings(project)[0].message).toContain("port 2");
  });

  it("checks every port and reports one finding per offending port", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Multi", [
        { id: "A", safetyNetwork: "16#0000_05a2_4567_89ab" },
        { id: "B", safetyNetwork: "16#0000_0000_0000_0000" },
        { id: "C", safetyNetwork: "not-hex" },
      ]),
    );
    const findings = snnFindings(project);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.target)).toEqual(["Ctrl/Multi", "Ctrl/Multi"]);
  });
});
