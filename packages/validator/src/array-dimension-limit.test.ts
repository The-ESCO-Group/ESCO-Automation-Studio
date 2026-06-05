import { describe, expect, it } from "vitest";
import {
  createController,
  createProject,
  createTag,
  type AddOnInstruction,
  type PlcProject,
  type Program,
  type UserDefinedType,
} from "@esco/core";
import { createDefaultEngine } from "./index";

const limitFindings = (proj: PlcProject) =>
  createDefaultEngine().run(proj).filter((f) => f.ruleId === "array-dimension-limit");

/** A project with one controller; callers push tags/UDTs/AOIs onto it. */
function baseProject(): { project: PlcProject; controller: ReturnType<typeof createController> } {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

describe("array-dimension-limit", () => {
  it("flags a controller tag declared with four dimensions", () => {
    const { project, controller } = baseProject();
    controller.controllerTags.push(
      createTag(controller.id, "Grid4D", "DINT", { dimensions: [2, 2, 2, 2] }),
    );
    const findings = limitFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('Controller tag "Grid4D"');
    expect(findings[0].message).toContain("4 dimensions");
    expect(findings[0].message).toContain("at most 3 dimensions");
    expect(findings[0].target).toBe("Ctrl");
  });

  it("does not flag a three-dimensional array (the Logix maximum)", () => {
    const { project, controller } = baseProject();
    controller.controllerTags.push(
      createTag(controller.id, "Grid3D", "DINT", { dimensions: [4, 4, 4] }),
    );
    expect(limitFindings(project)).toHaveLength(0);
  });

  it("flags an over-rank program tag with the program in the target", () => {
    const { project, controller } = baseProject();
    const program: Program = {
      id: "prog-1",
      controllerId: controller.id,
      name: "MainProgram",
      routines: [],
      programTags: [
        createTag(controller.id, "Buf", "REAL", {
          scope: "program",
          programId: "prog-1",
          dimensions: [1, 2, 3, 4],
        }),
      ],
    };
    controller.programs.push(program);
    const findings = limitFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Program tag "Buf"');
    expect(findings[0].target).toBe("Ctrl/MainProgram");
  });

  it("flags an over-rank UDT member", () => {
    const { project, controller } = baseProject();
    const udt: UserDefinedType = {
      id: "udt-1",
      name: "Recipe",
      members: [
        { name: "Setpoints", dataType: "REAL", dimensions: [2, 2, 2, 2] },
        { name: "Ok", dataType: "BOOL" },
      ],
    };
    controller.dataTypes.push(udt);
    const findings = limitFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Member of "Recipe" "Setpoints"');
    expect(findings[0].target).toBe("Ctrl/Recipe");
  });

  it("flags an over-rank AOI local tag", () => {
    const { project, controller } = baseProject();
    const aoi: AddOnInstruction = {
      id: "aoi-1",
      name: "Scaler",
      parameters: [],
      localTags: [
        { name: "Work", dataType: "DINT", dimensions: [2, 2, 2, 2, 2] },
      ],
      routineNames: [],
    };
    controller.addOnInstructions.push(aoi);
    const findings = limitFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Local tag of "Scaler" "Work"');
    expect(findings[0].message).toContain("5 dimensions");
    expect(findings[0].target).toBe("Ctrl/Scaler");
  });

  it("does not flag scalar tags or members", () => {
    const { project, controller } = baseProject();
    controller.controllerTags.push(createTag(controller.id, "Count", "DINT"));
    controller.dataTypes.push({
      id: "udt-1",
      name: "Simple",
      members: [{ name: "Flag", dataType: "BOOL" }],
    });
    expect(limitFindings(project)).toHaveLength(0);
  });
});
