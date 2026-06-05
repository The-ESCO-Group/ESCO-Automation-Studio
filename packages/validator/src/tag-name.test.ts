import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createTag, type PlcProject } from "@esco/core";
import { createDefaultEngine } from "./index";

/** A project with one controller tag and one program tag of the given names. */
function projectWithTagNames(controllerTagName: string, programTagName: string): PlcProject {
  const project = createProject("Names");
  const controller = createController(project.id, "Ctrl");
  controller.controllerTags.push(createTag(controller.id, controllerTagName, "DINT", { value: 0 }));
  const program = createProgram(controller.id, "MainProgram");
  program.programTags.push(
    createTag(controller.id, programTagName, "DINT", { scope: "program", programId: program.id }),
  );
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

const nameFindings = (project: PlcProject) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "invalid-tag-name");

describe("a tag name must be a legal Logix identifier", () => {
  it("accepts well-formed controller and program tag names", () => {
    expect(nameFindings(projectWithTagNames("Motor_Run_1", "_Internal2"))).toEqual([]);
  });

  it.each([
    ["1stTag", "begin with a letter or underscore"],
    ["Motor-Run", "letters, digits, and underscores"],
    ["Motor__Run", "consecutive underscores"],
    ["MotorRun_", "end with an underscore"],
    ["A".repeat(41), "limit is 40"],
  ])("flags %s", (badName, fragment) => {
    const findings = nameFindings(projectWithTagNames(badName, "Ok"));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.message).toContain(fragment);
  });

  it("flags an invalid program-scoped tag name", () => {
    const findings = nameFindings(projectWithTagNames("Ok", "Bad Name"));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.target).toContain("MainProgram");
  });
});
