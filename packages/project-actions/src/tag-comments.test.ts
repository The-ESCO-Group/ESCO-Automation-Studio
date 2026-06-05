import { describe, expect, it } from "vitest";
import { createController, createProject, createTag, type Tag } from "@esco/core";
import { getAllTags, setTagComments, setTagEngineeringUnits } from "./index";
import { tagCommentPreview, tagCommentRows } from "./tag-comments";

function tag(comments: Tag["comments"]): Tag {
  return {
    id: "tag_motor",
    controllerId: "ctrl",
    name: "Motor",
    dataType: "MOTOR_UDT",
    scope: "controller",
    comments,
  };
}

describe("tag comment display rows", () => {
  it("projects Logix member and array-element comment operands into full tag paths", () => {
    expect(tagCommentRows(tag([
      { operand: ".Speed", text: "Commanded speed" },
      { operand: "[2]", text: "Third array element" },
      { operand: "FaultCode", text: "Fault code member" },
    ]))).toEqual([
      { tagName: "Motor", operand: ".Speed", path: "Motor.Speed", text: "Commanded speed" },
      { tagName: "Motor", operand: "[2]", path: "Motor[2]", text: "Third array element" },
      { tagName: "Motor", operand: "FaultCode", path: "Motor.FaultCode", text: "Fault code member" },
    ]);
  });

  it("builds a compact preview with a remaining-comment count", () => {
    expect(tagCommentPreview(tag([
      { operand: ".Speed", text: "Commanded speed" },
      { operand: ".Running", text: "Running feedback" },
      { operand: ".Faulted", text: "Faulted status" },
    ]), 2)).toBe("Motor.Speed: Commanded speed; Motor.Running: Running feedback; +1 more");
  });

  it("returns an empty preview when no comments are present", () => {
    expect(tagCommentRows(tag(undefined))).toEqual([]);
    expect(tagCommentPreview(tag([]))).toBe("");
  });
});

describe("tag annotation actions", () => {
  function projectWithTag() {
    const project = createProject("Annotations");
    const controller = createController(project.id, "C1");
    controller.controllerTags.push(createTag(controller.id, "Motor", "DINT"));
    project.controllers.push(controller);
    return project;
  }

  it("sets and clears tag comments immutably", () => {
    const project = projectWithTag();
    const result = setTagComments(project, {
      name: "Motor",
      comments: [
        { operand: ".Speed", text: "Commanded speed" },
        { operand: "[0]", text: "First element" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.project).not.toBe(project);
    expect(getAllTags(result.project).find((entry) => entry.name === "Motor")?.comments).toEqual([
      { operand: ".Speed", text: "Commanded speed" },
      { operand: "[0]", text: "First element" },
    ]);

    const cleared = setTagComments(result.project, { name: "Motor", comments: [] });
    expect(cleared.ok).toBe(true);
    expect(getAllTags(cleared.project).find((entry) => entry.name === "Motor")?.comments).toBeUndefined();
  });

  it("sets engineering units and rejects duplicate or malformed operands", () => {
    const project = projectWithTag();
    const result = setTagEngineeringUnits(project, {
      name: "Motor",
      engineeringUnits: [
        { operand: "", text: "rpm" },
        { operand: ".Speed", text: "Hz" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(getAllTags(result.project).find((entry) => entry.name === "Motor")?.engineeringUnits).toEqual([
      { operand: "", text: "rpm" },
      { operand: ".Speed", text: "Hz" },
    ]);

    const duplicate = setTagEngineeringUnits(result.project, {
      name: "Motor",
      engineeringUnits: [
        { operand: ".Speed", text: "Hz" },
        { operand: ".Speed", text: "RPM" },
      ],
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toMatch(/Duplicate engineering unit operand/);

    const malformed = setTagComments(result.project, {
      name: "Motor",
      comments: [{ operand: "Bad Operand", text: "No spaces" }],
    });
    expect(malformed.ok).toBe(false);
    expect(malformed.error).toMatch(/Invalid tag comment operand/);
  });
});
