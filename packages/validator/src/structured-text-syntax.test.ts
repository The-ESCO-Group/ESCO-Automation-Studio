import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine } from "@esco/core";
import { createDefaultEngine } from "./index";

function projectWithStructuredText(source: string) {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "CalcST", "structured-text");
  routine.structuredText = source;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

const findingsFor = (source: string) =>
  createDefaultEngine()
    .run(projectWithStructuredText(source))
    .filter((finding) => finding.ruleId === "structured-text-syntax");

describe("structured-text-syntax", () => {
  it("flags structural Structured Text problems during project Verify", () => {
    const findings = findingsFor("IF Start THEN\n  Done := TRUE;");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].target).toBe("Ctrl/MainProgram/CalcST");
    expect(findings[0].message).toContain("line 1");
    expect(findings[0].message).toContain("END_IF");
  });

  it("does not flag structurally valid Structured Text", () => {
    expect(findingsFor("IF Start THEN\n  Done := TRUE;\nEND_IF;")).toHaveLength(0);
  });
});
