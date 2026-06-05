import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createTag, type Tag } from "@esco/core";
import { createDefaultEngine } from "./index";

/**
 * A project carrying the supplied controller-scope tags. Produced/consumed
 * roles are set directly on the tags (the factory does not expose them) to
 * mirror imported read-only connection metadata.
 */
function projectWithControllerTags(...tags: Tag[]) {
  const project = createProject("ConnCtl");
  const controller = createController(project.id, "ConnCtl");
  controller.controllerTags.push(...tags);
  project.controllers.push(controller);
  return { project, controller };
}

const findingsFor = (project: ReturnType<typeof projectWithControllerTags>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "produced-consumed-tag");

function producedTag(controllerId: string, name: string, produceCount = 4): Tag {
  const tag = createTag(controllerId, name, "DINT");
  tag.produced = true;
  tag.produceInfo = { produceCount };
  return tag;
}

function consumedTag(controllerId: string, name: string): Tag {
  const tag = createTag(controllerId, name, "DINT");
  tag.consumed = true;
  tag.consumeInfo = { producer: "RemoteCtl", remoteTag: "SourceTag" };
  return tag;
}

describe("produced-consumed-tag", () => {
  it("accepts a fully configured produced tag", () => {
    const { project, controller } = projectWithControllerTags();
    controller.controllerTags.push(producedTag(controller.id, "Beacon"));
    expect(findingsFor(project)).toHaveLength(0);
  });

  it("accepts a fully configured consumed tag", () => {
    const { project, controller } = projectWithControllerTags();
    controller.controllerTags.push(consumedTag(controller.id, "Mirror"));
    expect(findingsFor(project)).toHaveLength(0);
  });

  it("ignores ordinary tags that are neither produced nor consumed", () => {
    const { project, controller } = projectWithControllerTags();
    controller.controllerTags.push(createTag(controller.id, "Plain", "DINT"));
    expect(findingsFor(project)).toHaveLength(0);
  });

  it("flags a consumed tag with no producing controller", () => {
    const { project, controller } = projectWithControllerTags();
    const tag = consumedTag(controller.id, "Mirror");
    tag.consumeInfo = { remoteTag: "SourceTag" };
    controller.controllerTags.push(tag);
    const findings = findingsFor(project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("producing controller");
    expect(findings[0]!.target).toBe("ConnCtl/Mirror");
  });

  it("flags a consumed tag with no remote tag", () => {
    const { project, controller } = projectWithControllerTags();
    const tag = consumedTag(controller.id, "Mirror");
    tag.consumeInfo = { producer: "RemoteCtl" };
    controller.controllerTags.push(tag);
    const findings = findingsFor(project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("remote tag");
  });

  it("flags a consumed tag with no connection metadata at all", () => {
    const { project, controller } = projectWithControllerTags();
    const tag = createTag(controller.id, "Mirror", "DINT");
    tag.consumed = true;
    controller.controllerTags.push(tag);
    expect(findingsFor(project)).toHaveLength(2);
  });

  it("flags a produced tag whose consumer count is out of range", () => {
    const { project, controller } = projectWithControllerTags();
    controller.controllerTags.push(producedTag(controller.id, "TooMany", 257));
    controller.controllerTags.push(producedTag(controller.id, "Zero", 0));
    const findings = findingsFor(project);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.message.includes("consumers"))).toBe(true);
  });

  it("accepts the boundary consumer counts 1 and 256", () => {
    const { project, controller } = projectWithControllerTags();
    controller.controllerTags.push(producedTag(controller.id, "Min", 1));
    controller.controllerTags.push(producedTag(controller.id, "Max", 256));
    expect(findingsFor(project)).toHaveLength(0);
  });

  it("flags a tag marked both produced and consumed", () => {
    const { project, controller } = projectWithControllerTags();
    const tag = producedTag(controller.id, "Both");
    tag.consumed = true;
    tag.consumeInfo = { producer: "RemoteCtl", remoteTag: "SourceTag" };
    controller.controllerTags.push(tag);
    const findings = findingsFor(project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("both produced and consumed");
  });

  it("flags a program-scoped produced tag as wrongly scoped", () => {
    const project = createProject("ConnCtl");
    const controller = createController(project.id, "ConnCtl");
    const program = createProgram(controller.id, "Line1");
    const tag = producedTag(controller.id, "Beacon");
    tag.scope = "program";
    tag.programId = program.id;
    program.programTags.push(tag);
    controller.programs.push(program);
    project.controllers.push(controller);
    const findings = findingsFor(project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("controller-scoped");
    expect(findings[0]!.target).toBe("ConnCtl/Line1/Beacon");
  });
});
