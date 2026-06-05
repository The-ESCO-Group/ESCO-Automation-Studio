import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject } from "@esco/core";
import { programTestEditsReviewReport } from "./program-test-edits-review";

describe("programTestEditsReviewReport", () => {
  it("flags a program carrying pending online test edits with offline boundaries", () => {
    const project = createProject("Test Edits Review");
    const controller = createController(project.id, "LineCtl");
    const program = createProgram(controller.id, "Filler");
    program.safetyClass = "Standard";
    program.testEdits = true;
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = programTestEditsReviewReport(project);
    expect(report.programCount).toBe(1);
    expect(report.pendingTestEditsCount).toBe(1);
    expect(report.warnings).toHaveLength(1);
    const row = report.rows[0];
    expect(row).toMatchObject({
      controllerName: "LineCtl",
      programName: "Filler",
      safetyClass: "Standard",
      pendingTestEdits: true,
      status: "pending-edits",
      onlineSessionModelled: false,
      testEditAssemblyModelled: false,
      testEditAcceptCancelModelled: false,
      pendingEditLogicExecutionModelled: false,
    });
    expect(row.boundaries).toContain("no-test-edit-assembly");
    expect(row.boundaries).toContain("no-test-edit-accept-cancel");
    expect(row.message).toContain("cannot accept, cancel, or assemble");
  });

  it("reviews a program with no pending test edits as clean (no warning)", () => {
    const project = createProject("Clean");
    const controller = createController(project.id, "LineCtl");
    const program = createProgram(controller.id, "Mixer");
    controller.programs.push(program);
    project.controllers.push(controller);

    const report = programTestEditsReviewReport(project);
    expect(report.programCount).toBe(1);
    expect(report.pendingTestEditsCount).toBe(0);
    expect(report.warnings).toHaveLength(0);
    expect(report.rows[0]).toMatchObject({
      programName: "Mixer",
      pendingTestEdits: false,
      status: "no-pending-edits",
    });
    expect(report.rows[0].message).toContain("no pending online test edits");
  });

  it("counts pending test edits across multiple programs and controllers", () => {
    const project = createProject("Multi");
    const c1 = createController(project.id, "CtlA");
    const pending = createProgram(c1.id, "Pending");
    pending.testEdits = true;
    const clean = createProgram(c1.id, "Clean");
    c1.programs.push(pending, clean);

    const c2 = createController(project.id, "CtlB");
    const pending2 = createProgram(c2.id, "Pending2");
    pending2.testEdits = true;
    c2.programs.push(pending2);

    project.controllers.push(c1, c2);

    const report = programTestEditsReviewReport(project);
    expect(report.programCount).toBe(3);
    expect(report.pendingTestEditsCount).toBe(2);
    expect(report.warnings).toHaveLength(2);
    expect(report.rows.filter((row) => row.status === "pending-edits")).toHaveLength(2);
  });

  it("returns an empty report for a project with no programs", () => {
    const project = createProject("Empty");
    const controller = createController(project.id, "LineCtl");
    project.controllers.push(controller);

    const report = programTestEditsReviewReport(project);
    expect(report.programCount).toBe(0);
    expect(report.pendingTestEditsCount).toBe(0);
    expect(report.warnings).toHaveLength(0);
    expect(report.rows).toHaveLength(0);
  });
});
