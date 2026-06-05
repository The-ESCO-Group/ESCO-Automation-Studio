import { describe, expect, it } from "vitest";
import { createController, createProject, type IoModule, type ModuleConnection } from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a single-controller project, returning the controller so tests can add modules. */
function projectWithController() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

let moduleSeq = 0;
function ioModule(name: string, connections?: ModuleConnection[]): IoModule {
  return {
    id: `mod-${moduleSeq++}`,
    name,
    ...(connections === undefined ? {} : { connections }),
  };
}

const rpiFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "module-connection-rpi");

describe("module-connection-rpi", () => {
  it("accepts a positive connection RPI", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("AnalogIn", [{ name: "Input", rpi: 20000, type: "Input" }]),
    );
    expect(rpiFindings(project)).toHaveLength(0);
  });

  it("leaves a connection with no RPI attribute alone (inherits the connection default)", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("NoRpi", [{ name: "Input", type: "Input" }]));
    expect(rpiFindings(project)).toHaveLength(0);
  });

  it("leaves a module with no connections alone", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("Bare"));
    expect(rpiFindings(project)).toHaveLength(0);
  });

  it("flags a zero RPI", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("ZeroMod", [{ name: "Output", rpi: 0, type: "Output" }]),
    );
    const findings = rpiFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('"ZeroMod"');
    expect(findings[0].message).toContain('connection "Output"');
    expect(findings[0].message).toContain("0 µs");
    expect(findings[0].target).toBe("Ctrl/ZeroMod");
  });

  it("flags a negative RPI", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("NegMod", [{ name: "Input", rpi: -5000, type: "Input" }]),
    );
    const findings = rpiFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("-5000 µs");
  });

  it("names the offending connection generically when it has no name", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("AnonMod", [{ rpi: 0 }]));
    const findings = rpiFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("a connection with");
  });

  it("reports one finding per offending connection", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("MultiMod", [
        { name: "Input", rpi: 10000, type: "Input" },
        { name: "Output", rpi: 0, type: "Output" },
        { name: "Config", rpi: -1, type: "Standard" },
      ]),
    );
    const findings = rpiFindings(project);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.target === "Ctrl/MultiMod")).toBe(true);
  });
});
