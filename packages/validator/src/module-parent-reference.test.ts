import { describe, expect, it } from "vitest";
import { createController, createProject, type IoModule, type IoPort, type PlcProject } from "@esco/core";
import { createDefaultEngine } from "./index";

function projectWithController() {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

let moduleSeq = 0;
function ioModule(
  name: string,
  opts: { parentModule?: string; parentPortId?: string; ports?: IoPort[] } = {},
): IoModule {
  return {
    id: `mod-${moduleSeq++}`,
    name,
    parentModule: opts.parentModule,
    parentPortId: opts.parentPortId,
    ports: opts.ports,
  };
}

const findings = (project: PlcProject) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "module-parent-reference");

describe("module-parent-reference", () => {
  it("does not flag a child that resolves to an existing parent", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Local"),
      ioModule("DI", { parentModule: "Local" }),
    );
    expect(findings(project)).toHaveLength(0);
  });

  it("skips a root module that names no parent", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("Local"));
    expect(findings(project)).toHaveLength(0);
  });

  it("flags a child whose named parent does not exist", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("DI", { parentModule: "Ghost" }));
    const result = findings(project);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("error");
    expect(result[0].message).toContain("does not exist");
    expect(result[0].message).toContain('"Ghost"');
    expect(result[0].target).toBe("Ctrl/DI");
  });

  it("flags a child that binds to a port its parent does not expose", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Local", { ports: [{ id: "0" }] }),
      ioModule("DI", { parentModule: "Local", parentPortId: "7" }),
    );
    const result = findings(project);
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("exposes no such port");
    expect(result[0].target).toBe("Ctrl/DI");
  });

  it("accepts a child bound to a port the parent does expose", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Local", { ports: [{ id: "0" }] }),
      ioModule("DI", { parentModule: "Local", parentPortId: "0" }),
    );
    expect(findings(project)).toHaveLength(0);
  });

  it("resolves the parent name case-insensitively", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Local"),
      ioModule("DI", { parentModule: "local" }),
    );
    expect(findings(project)).toHaveLength(0);
  });

  it("treats a module naming itself as a self-reference root rather than a dangle", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(ioModule("Local", { parentModule: "Local" }));
    expect(findings(project)).toHaveLength(0);
  });
});
