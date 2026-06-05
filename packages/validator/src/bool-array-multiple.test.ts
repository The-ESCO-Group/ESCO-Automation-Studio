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

const boolFindings = (proj: PlcProject) =>
  createDefaultEngine().run(proj).filter((f) => f.ruleId === "bool-array-multiple");

/** A project with one controller; callers push tags/UDTs/AOIs onto it. */
function baseProject(): { project: PlcProject; controller: ReturnType<typeof createController> } {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  project.controllers.push(controller);
  return { project, controller };
}

describe("bool-array-multiple", () => {
  it("flags a controller BOOL array whose dimension is not a multiple of 32", () => {
    const { project, controller } = baseProject();
    controller.controllerTags.push(
      createTag(controller.id, "Flags", "BOOL", { dimensions: [10] }),
    );
    const findings = boolFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('Controller tag "Flags"');
    expect(findings[0].message).toContain("BOOL array of 10");
    expect(findings[0].message).toContain("multiple of 32");
    expect(findings[0].target).toBe("Ctrl");
  });

  it("accepts a BOOL array whose dimension is a multiple of 32", () => {
    const { project, controller } = baseProject();
    controller.controllerTags.push(createTag(controller.id, "Bits", "BOOL", { dimensions: [64] }));
    expect(boolFindings(project)).toHaveLength(0);
  });

  it("ignores a scalar BOOL tag", () => {
    const { project, controller } = baseProject();
    controller.controllerTags.push(createTag(controller.id, "Run", "BOOL"));
    expect(boolFindings(project)).toHaveLength(0);
  });

  it("ignores a non-BOOL array of a non-multiple-of-32 size", () => {
    const { project, controller } = baseProject();
    controller.controllerTags.push(createTag(controller.id, "Buf", "DINT", { dimensions: [10] }));
    expect(boolFindings(project)).toHaveLength(0);
  });

  it("flags a program-scoped BOOL array with the program in the target", () => {
    const { project, controller } = baseProject();
    const program: Program = {
      id: "prog-1",
      controllerId: controller.id,
      name: "MainProgram",
      routines: [],
      programTags: [
        createTag(controller.id, "Steps", "BOOL", {
          scope: "program",
          programId: "prog-1",
          dimensions: [33],
        }),
      ],
    };
    controller.programs.push(program);
    const findings = boolFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Program tag "Steps"');
    expect(findings[0].target).toBe("Ctrl/MainProgram");
  });

  it("flags a BOOL array UDT member", () => {
    const { project, controller } = baseProject();
    const udt: UserDefinedType = {
      id: "udt-1",
      name: "Recipe",
      members: [
        { name: "Stages", dataType: "BOOL", dimensions: [40] },
        { name: "Ok", dataType: "BOOL" },
      ],
    };
    controller.dataTypes.push(udt);
    const findings = boolFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Member of "Recipe" "Stages"');
    expect(findings[0].target).toBe("Ctrl/Recipe");
  });

  it("flags a BOOL array AOI local tag", () => {
    const { project, controller } = baseProject();
    const aoi: AddOnInstruction = {
      id: "aoi-1",
      name: "Scaler",
      parameters: [],
      localTags: [{ name: "Work", dataType: "BOOL", dimensions: [16] }],
      routineNames: [],
    };
    controller.addOnInstructions.push(aoi);
    const findings = boolFindings(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Local tag of "Scaler" "Work"');
    expect(findings[0].target).toBe("Ctrl/Scaler");
  });

  it("matches the BOOL type case-insensitively", () => {
    const { project, controller } = baseProject();
    controller.controllerTags.push(createTag(controller.id, "Mixed", "bool", { dimensions: [5] }));
    expect(boolFindings(project)).toHaveLength(1);
  });

  it("leaves multi-dimensional BOOL arrays to other checks", () => {
    const { project, controller } = baseProject();
    controller.controllerTags.push(
      createTag(controller.id, "Grid", "BOOL", { dimensions: [10, 10] }),
    );
    expect(boolFindings(project)).toHaveLength(0);
  });
});
