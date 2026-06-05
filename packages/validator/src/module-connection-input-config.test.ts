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

const inputConfigFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "module-connection-input-config");

describe("module-connection-input-config", () => {
  it("accepts valid input connection type and production trigger tokens", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("AnalogIn", [
        { name: "Input", type: "Input", inputConnectionType: "Multicast", inputProductionTrigger: "Cyclic" },
        { name: "Data", type: "Input", inputConnectionType: "Unicast", inputProductionTrigger: "COS" },
        { name: "App", type: "Input", inputConnectionType: "Null", inputProductionTrigger: "Application" },
      ]),
    );
    expect(inputConfigFindings(project)).toHaveLength(0);
  });

  it("leaves a connection with neither attribute alone (inherits the connection default)", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("NoQoS", [{ name: "Input", type: "Input" }]));
    expect(inputConfigFindings(project)).toHaveLength(0);
  });

  it("leaves a module with no connections alone", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("Bare"));
    expect(inputConfigFindings(project)).toHaveLength(0);
  });

  it("flags an out-of-set input connection type", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("BadType", [{ name: "Input", type: "Input", inputConnectionType: "Broadcast" }]),
    );
    const findings = inputConfigFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('"BadType"');
    expect(findings[0].message).toContain('connection "Input"');
    expect(findings[0].message).toContain('"Broadcast"');
    expect(findings[0].message).toContain("Multicast, Unicast, Null");
    expect(findings[0].target).toBe("Ctrl/BadType");
  });

  it("flags an out-of-set input production trigger", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("BadTrigger", [{ name: "Input", type: "Input", inputProductionTrigger: "OnDemand" }]),
    );
    const findings = inputConfigFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('"OnDemand"');
    expect(findings[0].message).toContain("Cyclic, COS, Application");
  });

  it("rejects a valid token in the wrong case (Logix stores fixed enumerated tokens)", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("WrongCase", [
        { name: "Input", type: "Input", inputConnectionType: "multicast", inputProductionTrigger: "cyclic" },
      ]),
    );
    expect(inputConfigFindings(project)).toHaveLength(2);
  });

  it("names the offending connection generically when it has no name", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("AnonMod", [{ inputConnectionType: "Broadcast" }]),
    );
    const findings = inputConfigFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("a connection with");
  });

  it("reports one finding per offending attribute and connection", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("MultiMod", [
        { name: "Good", type: "Input", inputConnectionType: "Multicast", inputProductionTrigger: "Cyclic" },
        { name: "BothBad", type: "Input", inputConnectionType: "Broadcast", inputProductionTrigger: "OnDemand" },
      ]),
    );
    const findings = inputConfigFindings(project);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.target === "Ctrl/MultiMod")).toBe(true);
  });
});
