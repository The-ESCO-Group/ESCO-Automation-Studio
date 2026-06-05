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
function ioModule(name: string, slot: number | undefined, parent?: { module?: string; portId?: string }): IoModule {
  return {
    id: `mod-${moduleSeq++}`,
    name,
    slot,
    parentModule: parent?.module,
    parentPortId: parent?.portId,
  };
}

const conflictFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "module-slot-conflict");

describe("module-slot-conflict", () => {
  it("does not flag modules occupying distinct slots in the local chassis", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("DI", 1), ioModule("DO", 2));
    expect(conflictFindings(project)).toHaveLength(0);
  });

  it("flags a second module placed at an already-occupied slot", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("DI", 4), ioModule("Clash", 4));
    const findings = conflictFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('"Clash"');
    expect(findings[0].message).toContain("slot 4");
    expect(findings[0].message).toContain('"DI"');
    expect(findings[0].message).toContain("the local chassis");
    expect(findings[0].target).toBe("Ctrl/Clash");
  });

  it("reports one finding per extra module beyond the first occupant", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("DI", 3), ioModule("B", 3), ioModule("C", 3));
    const findings = conflictFindings(project);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.target)).toEqual(["Ctrl/B", "Ctrl/C"]);
  });

  it("does not flag the same slot number under different parents", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("RemoteA", 0, { module: "AdapterA", portId: "1" }),
      ioModule("RemoteB", 0, { module: "AdapterB", portId: "1" }),
    );
    expect(conflictFindings(project)).toHaveLength(0);
  });

  it("flags a collision under the same parent module and names the parent", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("RemoteA", 5, { module: "Adapter", portId: "1" }),
      ioModule("RemoteB", 5, { module: "Adapter", portId: "1" }),
    );
    const findings = conflictFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('parent module "Adapter"');
    expect(findings[0].message).toContain('"RemoteB"');
  });

  it("skips modules that occupy no slot (network-addressed devices)", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("EN2T_A", undefined), ioModule("EN2T_B", undefined));
    expect(conflictFindings(project)).toHaveLength(0);
  });
});
