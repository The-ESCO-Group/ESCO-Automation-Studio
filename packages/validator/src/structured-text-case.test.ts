import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createDefaultEngine } from "./index";

function projectWithStructuredText(source: string) {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "CalcST", "structured-text");
  routine.structuredText = source;
  program.routines.push(routine);
  controller.controllerTags.push(
    createTag(controller.id, "Count", "DINT"),
    createTag(controller.id, "Mode", "DINT"),
    createTag(controller.id, "Level", "REAL"),
    createTag(controller.id, "Done", "BOOL"),
    createTag(controller.id, "Message", "STRING"),
    createTag(controller.id, "Timer1", "TIMER"),
  );
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

const caseFindingsFor = (source: string) =>
  createDefaultEngine()
    .run(projectWithStructuredText(source))
    .filter((finding) => finding.ruleId === "structured-text-case-label");

const allCaseFindingsFor = (source: string) =>
  createDefaultEngine()
    .run(projectWithStructuredText(source))
    .filter((finding) => finding.ruleId.startsWith("structured-text-case"));

const caseExpressionFindingsFor = (source: string) =>
  createDefaultEngine()
    .run(projectWithStructuredText(source))
    .filter((finding) => finding.ruleId === "structured-text-case-expression");

const caseSelectorTypeFindingsFor = (source: string) =>
  createDefaultEngine()
    .run(projectWithStructuredText(source))
    .filter((finding) => finding.ruleId === "structured-text-case-selector-type");

const caseRealSelectorFindingsFor = (source: string) =>
  createDefaultEngine()
    .run(projectWithStructuredText(source))
    .filter((finding) => finding.ruleId === "structured-text-case-real-selector");

describe("structured-text-case", () => {
  it("accepts Studio-style immediate CASE selector labels and ranges", () => {
    const findings = allCaseFindingsFor(`
CASE Count OF
  DINT#1, 16#2: Done := TRUE;
  3..4: Done := FALSE;
ELSE
  Done := FALSE;
END_CASE;

CASE Level OF
  REAL#3.5..REAL#4.5: Done := TRUE;
ELSE
  Done := FALSE;
END_CASE;
`);
    expect(findings).toHaveLength(0);
  });

  it("flags CASE labels that are tags, expressions, or malformed ranges", () => {
    const findings = caseFindingsFor(`
CASE Count OF
  Mode: Done := TRUE;
  Count + 1: Done := FALSE;
  4..: Done := FALSE;
END_CASE;
`);
    expect(findings).toHaveLength(3);
    expect(findings.map((finding) => finding.message).join("\n")).toContain('CASE selector label "Mode"');
    expect(findings.map((finding) => finding.message).join("\n")).toContain('CASE selector label "Count+1"');
    expect(findings.map((finding) => finding.message).join("\n")).toContain('CASE selector label "4.."');
  });

  it("checks nested CASE selector labels during Verify", () => {
    const findings = caseFindingsFor(`
CASE Count OF
  1:
    CASE Mode OF
      Count + 1: Done := TRUE;
      2: Done := FALSE;
    END_CASE;
ELSE
  Done := FALSE;
END_CASE;
`);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('CASE selector label "Count+1"');
  });

  it("flags CASE selector labels that obviously do not match the expression type", () => {
    const findings = caseSelectorTypeFindingsFor(`
CASE Count OF
  1.5: Done := TRUE;
  REAL#2.0: Done := FALSE;
  3.5..4.5: Done := FALSE;
END_CASE;

CASE Level OF
  DINT#1: Done := TRUE;
END_CASE;

CASE DINT#1 OF
  REAL#1.0: Done := TRUE;
END_CASE;
`);
    expect(findings).toHaveLength(5);
    const messages = findings.map((finding) => finding.message).join("\n");
    expect(messages).toContain('CASE selector label "1.5" must match DINT expression "Count"');
    expect(messages).toContain('CASE selector label "REAL#2.0" must match DINT expression "Count"');
    expect(messages).toContain('CASE selector label "3.5..4.5" must match DINT expression "Count"');
    expect(messages).toContain('CASE selector label "DINT#1" must match REAL expression "Level"');
    expect(messages).toContain('CASE selector label "REAL#1.0" must match DINT expression "DINT#1"');
  });

  it("warns when REAL CASE expressions use exact selector values instead of ranges", () => {
    const findings = caseRealSelectorFindingsFor(`
CASE Level OF
  REAL#1.0, 2.0: Done := TRUE;
  3.0..4.0: Done := FALSE;
  DINT#5: Done := FALSE;
END_CASE;

CASE REAL#1.0 OF
  REAL#1.0: Done := TRUE;
  REAL#1.0..REAL#1.5: Done := FALSE;
END_CASE;
`);
    expect(findings).toHaveLength(3);
    expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
    const messages = findings.map((finding) => finding.message).join("\n");
    expect(messages).toContain('CASE selector label "REAL#1.0" is an exact REAL match for "Level"');
    expect(messages).toContain('CASE selector label "2.0" is an exact REAL match for "Level"');
    expect(messages).toContain('CASE selector label "REAL#1.0" is an exact REAL match for "REAL#1.0"');
    expect(messages).not.toContain("3.0..4.0");
    expect(messages).not.toContain("DINT#5");
    expect(messages).not.toContain("REAL#1.0..REAL#1.5");
  });

  it("flags CASE expressions that resolve to nonnumeric values", () => {
    const findings = caseExpressionFindingsFor(`
CASE Timer1.ACC OF
  0..10: Done := TRUE;
END_CASE;

CASE Done OF
  1: Done := TRUE;
END_CASE;

CASE Message OF
  1: Done := FALSE;
END_CASE;

CASE Timer1.DN OF
  1: Done := FALSE;
END_CASE;

CASE 'RUN' OF
  1: Done := TRUE;
END_CASE;
`);
    expect(findings).toHaveLength(4);
    const messages = findings.map((finding) => finding.message).join("\n");
    expect(messages).toContain('CASE expression "Done" resolves to BOOL');
    expect(messages).toContain('CASE expression "Message" resolves to STRING');
    expect(messages).toContain('CASE expression "Timer1.DN" resolves to BOOL');
    expect(messages).toContain('CASE expression "\'RUN\'" resolves to STRING');
  });
});
