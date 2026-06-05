import { describe, expect, it } from "vitest";
import { createController, createProject, type PlcProject } from "@esco/core";
import { setControllerProperties } from "./index";

interface Fixture {
  project: PlcProject;
  controllerId: string;
}

/** A controller that already carries imported communication-path metadata. */
function fixture(): Fixture {
  const project = createProject("Test");
  const controller = createController(project.id, "DemoController");
  controller.commDriver = "AB_ETHIP-1";
  controller.commPath = "AB_ETHIP-1\\10.0.0.1\\Backplane\\0";
  project.controllers.push(controller);
  return { project, controllerId: controller.id };
}

function controllerOf(result: { project: PlcProject }, controllerId: string) {
  const controller = result.project.controllers.find((candidate) => candidate.id === controllerId);
  if (!controller) throw new Error("controller missing from result");
  return controller;
}

describe("setControllerProperties: communication path/driver editing", () => {
  it("persists an edited communication driver and path", () => {
    const f = fixture();
    const result = setControllerProperties(f.project, {
      controllerId: f.controllerId,
      name: "DemoController",
      commDriver: "AB_ETHIP-2",
      commPath: "AB_ETHIP-2\\192.168.1.10\\Backplane\\3",
    });
    expect(result.ok).toBe(true);
    const controller = controllerOf(result, f.controllerId);
    expect(controller.commDriver).toBe("AB_ETHIP-2");
    expect(controller.commPath).toBe("AB_ETHIP-2\\192.168.1.10\\Backplane\\3");
  });

  it("clears the authored value when a blank string is supplied", () => {
    const f = fixture();
    const result = setControllerProperties(f.project, {
      controllerId: f.controllerId,
      name: "DemoController",
      commDriver: "   ",
      commPath: "",
    });
    expect(result.ok).toBe(true);
    const controller = controllerOf(result, f.controllerId);
    expect(controller.commDriver).toBeUndefined();
    expect(controller.commPath).toBeUndefined();
  });

  it("preserves existing path metadata when the fields are omitted", () => {
    const f = fixture();
    const result = setControllerProperties(f.project, {
      controllerId: f.controllerId,
      name: "DemoController",
    });
    expect(result.ok).toBe(true);
    const controller = controllerOf(result, f.controllerId);
    expect(controller.commDriver).toBe("AB_ETHIP-1");
    expect(controller.commPath).toBe("AB_ETHIP-1\\10.0.0.1\\Backplane\\0");
  });

  it("rejects communication drivers with illegal characters", () => {
    const f = fixture();
    for (const commDriver of ["AB ETHIP 1", "AB\\ETHIP", "drv*1"]) {
      const result = setControllerProperties(f.project, {
        controllerId: f.controllerId,
        name: "DemoController",
        commDriver,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Communication driver/);
    }
  });

  it("rejects malformed communication paths", () => {
    const f = fixture();
    const cases: Array<[string, RegExp]> = [
      ["\\Backplane\\0", /start or end with a backslash/],
      ["AB_ETHIP-1\\Backplane\\", /start or end with a backslash/],
      ["AB_ETHIP-1\\\\Backplane\\0", /blank segment/],
      ["AB_ETHIP-1\\Backplane" + String.fromCharCode(1) + "0", /control characters/],
    ];
    for (const [commPath, reason] of cases) {
      const result = setControllerProperties(f.project, {
        controllerId: f.controllerId,
        name: "DemoController",
        commPath,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(reason);
    }
  });

  it("accepts a well-formed Studio 5000 communication path", () => {
    const f = fixture();
    const result = setControllerProperties(f.project, {
      controllerId: f.controllerId,
      name: "DemoController",
      commPath: "AB_ETHIP-1\\192.168.1.10\\Backplane\\0",
    });
    expect(result.ok).toBe(true);
    expect(controllerOf(result, f.controllerId).commPath).toBe(
      "AB_ETHIP-1\\192.168.1.10\\Backplane\\0",
    );
  });
});
