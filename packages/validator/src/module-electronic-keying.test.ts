import { describe, expect, it } from "vitest";
import { createController, createProject, type IoModule } from "@esco/core";
import { createDefaultEngine } from "./index";

/** Build a single-controller project, returning the controller so tests can add modules. */
function projectWithController() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

let moduleSeq = 0;
function ioModule(name: string, electronicKeying?: string): IoModule {
  return {
    id: `mod-${moduleSeq++}`,
    name,
    ...(electronicKeying === undefined ? {} : { electronicKeying }),
  };
}

const keyingFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "module-electronic-keying");

describe("module-electronic-keying", () => {
  it("accepts each valid keying value, including imported custom metadata", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("ExactMod", "ExactMatch"),
      ioModule("CompatMod", "CompatibleModule"),
      ioModule("DisabledMod", "Disabled"),
      ioModule("CustomMod", "Custom"),
    );
    expect(keyingFindings(project)).toHaveLength(0);
  });

  it("leaves a module with no keying attribute alone (inherits the catalog default)", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("NoKeying"));
    expect(keyingFindings(project)).toHaveLength(0);
  });

  it("flags an out-of-set keying value", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("BadMod", "MostlyMatch"));
    const findings = keyingFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('"BadMod"');
    expect(findings[0].message).toContain("MostlyMatch");
    expect(findings[0].message).toContain("ExactMatch, CompatibleModule, Disabled, Custom");
    expect(findings[0].target).toBe("Ctrl/BadMod");
  });

  it("rejects a wrong-case value (keying is a fixed enumerated token)", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("LowerMod", "exactmatch"),
      ioModule("SpacedMod", "Exact Match"),
    );
    const findings = keyingFindings(project);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.target)).toEqual(["Ctrl/LowerMod", "Ctrl/SpacedMod"]);
  });

  it("reports one finding per offending module", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Good", "Disabled"),
      ioModule("Bad1", "Nope"),
      ioModule("Bad2", ""),
    );
    const findings = keyingFindings(project);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.target)).toEqual(["Ctrl/Bad1", "Ctrl/Bad2"]);
  });
});
