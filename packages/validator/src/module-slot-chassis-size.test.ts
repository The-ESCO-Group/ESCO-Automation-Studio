import { describe, expect, it } from "vitest";
import { createController, createProject, type IoModule } from "@esco/core";
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
  slot?: number,
  parent?: { module?: string; portId?: string },
  ports?: IoModule["ports"],
): IoModule {
  return {
    id: `mod-${moduleSeq++}`,
    name,
    slot,
    parentModule: parent?.module,
    parentPortId: parent?.portId,
    ports,
  };
}

const chassisSizeFindings = (project: ReturnType<typeof projectWithController>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((finding) => finding.ruleId === "module-slot-chassis-size");

describe("module-slot-chassis-size", () => {
  it("accepts module slots inside the parent chassis bus size", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Local", 0, undefined, [{ id: "1", type: "Ethernet", busSize: 4 }]),
      ioModule("DI", 3, { module: "Local", portId: "1" }),
    );

    expect(chassisSizeFindings(project)).toHaveLength(0);
  });

  it("flags slots outside the parent chassis bus size", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Local", 0, undefined, [{ id: "1", type: "Backplane", busSize: 4 }]),
      ioModule("TooFar", 4, { module: "Local", portId: "1" }),
      ioModule("Negative", -1, { module: "Local", portId: "1" }),
    );

    const findings = chassisSizeFindings(project);
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.target)).toEqual(["Ctrl/TooFar", "Ctrl/Negative"]);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("slot 4");
    expect(findings[0].message).toContain("4 slots");
    expect(findings[0].message).toContain("valid slots 0-3");
  });

  it("resolves parent module names case-insensitively like Logix identifiers", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Local", 0, undefined, [{ id: "1", type: "Backplane", busSize: 2 }]),
      ioModule("Remote", 1, { module: "local", portId: "1" }),
    );

    expect(chassisSizeFindings(project)).toHaveLength(0);
  });

  it("skips modules when the parent bus size is unknown", () => {
    const { project, controller } = projectWithController();
    controller.ioConfiguration.modules.push(
      ioModule("Adapter", 0, undefined, [{ id: "1", type: "Backplane" }]),
      ioModule("Remote", 99, { module: "Adapter", portId: "1" }),
      ioModule("NoParent", 99, { module: "Missing", portId: "1" }),
      ioModule("NoPortBinding", 99, { module: "Adapter" }),
    );

    expect(chassisSizeFindings(project)).toHaveLength(0);
  });
});
