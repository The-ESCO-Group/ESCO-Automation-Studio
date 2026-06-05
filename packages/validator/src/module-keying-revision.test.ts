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
function ioModule(
  name: string,
  electronicKeying?: string,
  majorRevision?: string,
  minorRevision?: string,
): IoModule {
  return {
    id: `mod-${moduleSeq++}`,
    name,
    ...(electronicKeying === undefined ? {} : { electronicKeying }),
    ...(majorRevision === undefined ? {} : { majorRevision }),
    ...(minorRevision === undefined ? {} : { minorRevision }),
  };
}

const revisionFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "module-keying-revision");

describe("module-keying-revision", () => {
  it("accepts an ExactMatch module that carries both revisions", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("ExactMod", "ExactMatch", "33", "11"));
    expect(revisionFindings(project)).toHaveLength(0);
  });

  it("accepts a CompatibleModule module that carries both revisions", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("CompatMod", "CompatibleModule", "5", "1"));
    expect(revisionFindings(project)).toHaveLength(0);
  });

  it("leaves a Disabled-keyed module alone even with no revision", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("DisabledMod", "Disabled"));
    expect(revisionFindings(project)).toHaveLength(0);
  });

  it("leaves an imported Custom-keyed module alone even with no revision", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("CustomMod", "Custom"));
    expect(revisionFindings(project)).toHaveLength(0);
  });

  it("leaves a module with no keying attribute alone (inherits the catalog default)", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("NoKeying"));
    expect(revisionFindings(project)).toHaveLength(0);
  });

  it("does not double-report an out-of-set keying value (left to module-electronic-keying)", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("BadMod", "MostlyMatch"));
    expect(revisionFindings(project)).toHaveLength(0);
  });

  it("flags an ExactMatch module missing both revisions", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("ExactMod", "ExactMatch"));
    const findings = revisionFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('"ExactMod"');
    expect(findings[0].message).toContain("ExactMatch");
    expect(findings[0].message).toContain("no module revision");
    expect(findings[0].target).toBe("Ctrl/ExactMod");
  });

  it("flags an ExactMatch module missing only the minor revision", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("ExactMod", "ExactMatch", "33"));
    const findings = revisionFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("no minor revision");
  });

  it("flags a CompatibleModule module missing only the major revision", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("CompatMod", "CompatibleModule", undefined, "11"),
    );
    const findings = revisionFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("no major revision");
  });

  it("treats a whitespace-only revision as missing", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("ExactMod", "ExactMatch", "  ", "  "));
    expect(revisionFindings(project)).toHaveLength(1);
  });

  it("reports one finding per offending module", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Good", "ExactMatch", "33", "11"),
      ioModule("Bad1", "ExactMatch"),
      ioModule("Bad2", "CompatibleModule"),
    );
    const findings = revisionFindings(project);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.target)).toEqual(["Ctrl/Bad1", "Ctrl/Bad2"]);
  });
});
