import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createTag, type Tag } from "@esco/core";
import { createDefaultEngine } from "./index";

/** A project carrying the supplied controller-scope tags. */
function projectWithControllerTags() {
  const project = createProject("RpiCtl");
  const controller = createController(project.id, "RpiCtl");
  project.controllers.push(controller);
  return { project, controller };
}

const findingsFor = (project: ReturnType<typeof projectWithControllerTags>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "consumed-tag-rpi");

/** A consumed tag with the given RPI (omitted when undefined). */
function consumedTag(controllerId: string, name: string, rpi?: number): Tag {
  const tag = createTag(controllerId, name, "DINT");
  tag.consumed = true;
  tag.consumeInfo = { producer: "RemoteCtl", remoteTag: "SourceTag" };
  if (rpi !== undefined) tag.consumeInfo.rpi = rpi;
  return tag;
}

describe("consumed-tag-rpi", () => {
  it("accepts a consumed tag with a positive RPI", () => {
    const { project, controller } = projectWithControllerTags();
    controller.controllerTags.push(consumedTag(controller.id, "Mirror", 20));
    expect(findingsFor(project)).toHaveLength(0);
  });

  it("ignores a consumed tag with no RPI (inherits the default)", () => {
    const { project, controller } = projectWithControllerTags();
    controller.controllerTags.push(consumedTag(controller.id, "Mirror"));
    expect(findingsFor(project)).toHaveLength(0);
  });

  it("ignores an ordinary tag that is not consumed", () => {
    const { project, controller } = projectWithControllerTags();
    const tag = createTag(controller.id, "Plain", "DINT");
    // A stray RPI on a non-consumed tag is meaningless and must not be flagged.
    tag.consumeInfo = { rpi: 0 };
    controller.controllerTags.push(tag);
    expect(findingsFor(project)).toHaveLength(0);
  });

  it("flags a consumed tag with a zero RPI", () => {
    const { project, controller } = projectWithControllerTags();
    controller.controllerTags.push(consumedTag(controller.id, "Mirror", 0));
    const findings = findingsFor(project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.target).toBe("RpiCtl/Mirror");
  });

  it("flags a consumed tag with a negative RPI", () => {
    const { project, controller } = projectWithControllerTags();
    controller.controllerTags.push(consumedTag(controller.id, "Mirror", -5));
    expect(findingsFor(project)).toHaveLength(1);
  });

  it("flags a program-scoped consumed tag with a non-positive RPI and targets the program", () => {
    const { project, controller } = projectWithControllerTags();
    const program = createProgram(controller.id, "Line1");
    program.programTags.push(consumedTag(controller.id, "Mirror", 0));
    controller.programs.push(program);
    const findings = findingsFor(project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.target).toBe("RpiCtl/Line1/Mirror");
  });
});
