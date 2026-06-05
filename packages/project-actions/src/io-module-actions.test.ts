import { createController, createProject, createTag } from "@esco/core";
import { describe, expect, it } from "vitest";
import { addIoModule } from "./io-module-actions";

function projectWithController() {
  const project = createProject("I/O setup");
  const controller = createController(project.id, "MainCtl");
  return { project: { ...project, controllers: [controller] }, controller };
}

describe("addIoModule setup tags", () => {
  it("creates an offline I/O module and controller-scoped setup tags atomically", () => {
    const { project, controller } = projectWithController();

    const result = addIoModule(project, {
      controllerId: controller.id,
      name: "FIT_101",
      catalogNumber: "Magnetic Flow Meter",
      slot: 2,
      setupTags: [
        {
          name: "FIT_101_Flow_Raw",
          dataType: "REAL",
          description: "Offline flow raw value",
          externalAccess: "read-only",
        },
        {
          name: "FIT_101_TareCmd",
          dataType: "BOOL",
          description: "Offline tare command placeholder",
          externalAccess: "read-write",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.setupTagNames).toEqual(["FIT_101_Flow_Raw", "FIT_101_TareCmd"]);

    const nextController = result.project.controllers[0]!;
    expect(nextController.ioConfiguration.modules).toHaveLength(1);
    expect(nextController.controllerTags.map((tag) => [tag.name, tag.dataType, tag.externalAccess])).toEqual([
      ["FIT_101_Flow_Raw", "REAL", "read-only"],
      ["FIT_101_TareCmd", "BOOL", "read-write"],
    ]);
    expect(nextController.controllerTags[0]?.description).toBe("Offline flow raw value");
  });

  it("rejects setup tags that collide with existing controller tags", () => {
    const { project, controller } = projectWithController();
    const projectWithTag = {
      ...project,
      controllers: [
        {
          ...controller,
          controllerTags: [createTag(controller.id, "FIT_101_Fault", "BOOL")],
        },
      ],
    };

    const result = addIoModule(projectWithTag, {
      controllerId: controller.id,
      name: "FIT_101",
      catalogNumber: "Magnetic Flow Meter",
      slot: 2,
      setupTags: [{ name: "FIT_101_Fault", dataType: "BOOL" }],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("already exists");
    expect(result.project.controllers[0]?.ioConfiguration.modules).toHaveLength(0);
    expect(result.project.controllers[0]?.controllerTags).toHaveLength(1);
  });
});
