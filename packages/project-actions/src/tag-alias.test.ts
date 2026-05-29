import { describe, expect, it } from "vitest";
import { createController, createProject, createTag, type PlcProject } from "@esco/core";
import { getAllTags, setTagAlias } from "./index";

/** A project with the given controller tags (name, dataType). */
function projectWith(tags: Array<[string, string]>): PlcProject {
  const project = createProject("Cell");
  const controller = createController(project.id, "C1");
  for (const [name, dataType] of tags) {
    controller.controllerTags.push(createTag(controller.id, name, dataType));
  }
  return { ...project, controllers: [controller] };
}

const alias = (project: PlcProject, name: string) =>
  getAllTags(project).find((tag) => tag.name === name)?.aliasFor;

describe("setTagAlias", () => {
  it("aliases a tag to an existing base tag", () => {
    const project = projectWith([
      ["StartPB", "BOOL"],
      ["Local_Start", "BOOL"],
    ]);
    const result = setTagAlias(project, { name: "Local_Start", aliasFor: "StartPB" });
    expect(result.ok).toBe(true);
    expect(alias(result.project, "Local_Start")).toBe("StartPB");
  });

  it("aliases to a member path when its base tag exists", () => {
    const project = projectWith([
      ["MotorData", "MotorUdt"],
      ["MotorRun", "BOOL"],
    ]);
    const result = setTagAlias(project, { name: "MotorRun", aliasFor: "MotorData.Run" });
    expect(result.ok).toBe(true);
    expect(alias(result.project, "MotorRun")).toBe("MotorData.Run");
  });

  it("clears the alias when aliasFor is blank", () => {
    const start = projectWith([
      ["StartPB", "BOOL"],
      ["Local_Start", "BOOL"],
    ]);
    const aliased = setTagAlias(start, { name: "Local_Start", aliasFor: "StartPB" });
    const cleared = setTagAlias(aliased.project, { name: "Local_Start", aliasFor: "  " });
    expect(cleared.ok).toBe(true);
    expect(alias(cleared.project, "Local_Start")).toBeUndefined();
  });

  it("rejects an unknown tag and an unknown base tag", () => {
    const project = projectWith([["StartPB", "BOOL"]]);
    expect(setTagAlias(project, { name: "Ghost", aliasFor: "StartPB" }).ok).toBe(false);
    expect(setTagAlias(project, { name: "StartPB", aliasFor: "Missing" }).ok).toBe(false);
  });

  it("rejects aliasing a tag to itself (directly or via a member path)", () => {
    const project = projectWith([["StartPB", "BOOL"]]);
    expect(setTagAlias(project, { name: "StartPB", aliasFor: "StartPB" }).ok).toBe(false);
    expect(setTagAlias(project, { name: "StartPB", aliasFor: "StartPB.X" }).ok).toBe(false);
  });

  it("rejects an alias cycle", () => {
    const base = projectWith([
      ["A", "BOOL"],
      ["B", "BOOL"],
    ]);
    const aToB = setTagAlias(base, { name: "A", aliasFor: "B" });
    expect(aToB.ok).toBe(true);
    const bToA = setTagAlias(aToB.project, { name: "B", aliasFor: "A" });
    expect(bToA.ok).toBe(false);
    expect(bToA.error).toMatch(/cycle/i);
  });
});
