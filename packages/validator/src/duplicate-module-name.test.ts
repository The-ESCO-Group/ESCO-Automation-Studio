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
function ioModule(name: string, slot?: number, parent?: { module?: string; portId?: string }): IoModule {
  return {
    id: `mod-${moduleSeq++}`,
    name,
    slot,
    parentModule: parent?.module,
    parentPortId: parent?.portId,
  };
}

const nameFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "duplicate-module-name");

describe("duplicate-module-name", () => {
  it("does not flag modules with distinct names", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("DI", 1), ioModule("DO", 2));
    expect(nameFindings(project)).toHaveLength(0);
  });

  it("flags a second module reusing an existing name", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("Pump", 1), ioModule("Pump", 2));
    const findings = nameFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('"Pump"');
    expect(findings[0].target).toBe("Ctrl/Pump");
  });

  it("treats names differing only in case as a collision", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("Pump", 1), ioModule("PUMP", 2));
    const findings = nameFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('"PUMP"');
    expect(findings[0].message).toContain('"Pump"');
  });

  it("catches a name collision between network-addressed modules with no slot", () => {
    // Both are addressed by IP, so they occupy no slot and module-slot-conflict
    // never sees them — the name check is the only thing that flags the clash.
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("EN2T"), ioModule("EN2T"));
    const findings = nameFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].target).toBe("Ctrl/EN2T");
  });

  it("reports one finding per extra module beyond the first occupant", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("Drive", 1), ioModule("Drive", 2), ioModule("Drive", 3));
    const findings = nameFindings(project);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.target === "Ctrl/Drive")).toBe(true);
  });

  it("ignores modules with a blank name rather than reporting them as a clash", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("", 1), ioModule("  ", 2));
    expect(nameFindings(project)).toHaveLength(0);
  });

  it("does not collide names across different controllers", () => {
    const project = createProject("Cell");
    const a = createController(project.id, "CtrlA");
    const b = createController(project.id, "CtrlB");
    a.ioConfiguration.modules.push(ioModule("DI", 1));
    b.ioConfiguration.modules.push(ioModule("DI", 1));
    project.controllers.push(a, b);
    expect(nameFindings(project)).toHaveLength(0);
  });
});
