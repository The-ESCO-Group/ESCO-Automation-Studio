import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createDefaultEngine } from "./index";

function projectWithStructuredText(source: string) {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  controller.controllerTags.push(
    createTag(controller.id, "Start", "BOOL"),
    createTag(controller.id, "Done", "BOOL"),
    createTag(controller.id, "Level", "DINT"),
    createTag(controller.id, "Msg", "STRING"),
    createTag(controller.id, "Motor", "MotorUdt"),
    createTag(controller.id, "Timer1", "TIMER"),
    createTag(controller.id, "Values", "DINT", { dimensions: [2] }),
  );
  controller.dataTypes.push(
    {
      id: "udt-motor",
      name: "MotorUdt",
      members: [
        { name: "Run", dataType: "BOOL" },
        { name: "Faults", dataType: "BOOL", dimensions: [2] },
        { name: "Drive", dataType: "DriveUdt" },
      ],
    },
    { id: "udt-drive", name: "DriveUdt", members: [{ name: "Ready", dataType: "BOOL" }] },
  );

  const program = createProgram(controller.id, "MainProgram");
  program.programTags.push(createTag(controller.id, "Temp", "DINT", { scope: "program", programId: program.id }));
  program.parameters = [{ name: "Mode", dataType: "DINT", usage: "Input" }];
  const routine = createRoutine(program.id, "CalcST", "structured-text");
  routine.structuredText = source;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

function projectWithQualifiedStructuredText(source: string) {
  const project = projectWithStructuredText(source);
  const controller = project.controllers[0]!;
  const remote = createProgram(controller.id, "RemoteProgram");
  remote.programTags.push(
    createTag(controller.id, "RemoteValue", "DINT", { scope: "program", programId: remote.id }),
    createTag(controller.id, "RemoteMotor", "MotorUdt", { scope: "program", programId: remote.id }),
  );
  controller.programs.push(remote);
  return project;
}

const undefinedTagFindings = (source: string) =>
  createDefaultEngine()
    .run(projectWithStructuredText(source))
    .filter((finding) => finding.ruleId === "undefined-tag");

describe("structured-text-references", () => {
  it("accepts defined controller tags, program tags, and program parameters", () => {
    const findings = undefinedTagFindings("IF Start THEN\n  Done := Temp > Mode;\nEND_IF;");
    expect(findings).toHaveLength(0);
  });

  it("accepts known structured members, UDT members, and in-range array elements", () => {
    const findings = createDefaultEngine()
      .run(projectWithStructuredText("Done := Motor.Run AND Motor.Drive.Ready AND Timer1.DN;\nLevel := Values[1];"))
      .filter((finding) => ["undefined-tag", "unknown-member", "array-index-out-of-range"].includes(finding.ruleId));
    expect(findings).toHaveLength(0);
  });

  it("accepts string relational expressions without treating literals as tags", () => {
    const findings = createDefaultEngine()
      .run(projectWithStructuredText("IF Msg = 'RUN' THEN\n  Done := Msg <> 'Fault';\nEND_IF;"))
      .filter((finding) => ["undefined-tag", "unknown-member"].includes(finding.ruleId));
    expect(findings).toHaveLength(0);
  });

  it("accepts non-retentive assignment syntax without treating it as an array subscript", () => {
    const findings = createDefaultEngine()
      .run(projectWithStructuredText("Done [:=] TRUE;\nLevel[:=] Level + 1;\nMsg [:=] 'RUN';"))
      .filter((finding) => ["undefined-tag", "unknown-member", "array-index-on-scalar"].includes(finding.ruleId));
    expect(findings).toHaveLength(0);
  });

  it("flags undefined Structured Text tag references during project Verify", () => {
    const findings = undefinedTagFindings("IF MissingStart THEN\n  Done := TRUE;\nEND_IF;");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].target).toBe("Ctrl/MainProgram/CalcST");
    expect(findings[0].message).toContain('line 1');
    expect(findings[0].message).toContain('undefined tag "MissingStart"');
  });

  it("flags unknown Structured Text UDT and predefined members", () => {
    const findings = createDefaultEngine()
      .run(projectWithStructuredText("Done := Motor.BadFlag OR Timer1.BadBit;"))
      .filter((finding) => finding.ruleId === "unknown-member");
    expect(findings).toHaveLength(2);
    expect(findings[0].message).toContain('member "BadFlag"');
    expect(findings[1].message).toContain('member "BadBit"');
  });

  it("flags obvious out-of-range ST array and member-array references", () => {
    const findings = createDefaultEngine()
      .run(projectWithStructuredText("Level := Values[2];\nDone := Motor.Faults[2];"))
      .filter((finding) => finding.ruleId === "array-index-out-of-range");
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.message).join("\n")).toContain("Values");
    expect(findings.map((finding) => finding.message).join("\n")).toContain("Motor.Faults");
  });

  it("flags scalar tags and members that are indexed in ST", () => {
    const findings = createDefaultEngine()
      .run(projectWithStructuredText("Done := Start[0] OR Motor.Run[0];"))
      .filter((finding) => finding.ruleId === "array-index-on-scalar");
    expect(findings).toHaveLength(2);
  });

  it("ignores comments, strings, labels, declarations, and call names", () => {
    const source = [
      "VAR",
      "  LocalCounter : DINT;",
      "END_VAR",
      "GhostLabel:",
      "Msg := 'MissingInString'; // MissingInComment",
      "IF ABS(Level) > 0 THEN",
      "  MyBlock(Input := Start, Output => Done);",
      "END_IF;",
    ].join("\n");
    expect(undefinedTagFindings(source)).toHaveLength(0);
  });

  it("does not treat the first JSR operand as a tag reference", () => {
    const findings = undefinedTagFindings("JSR(CalcSub, 1, Level, Done);");
    expect(findings).toHaveLength(0);
  });

  it("accepts program-qualified references to another program local tag", () => {
    const findings = createDefaultEngine()
      .run(projectWithQualifiedStructuredText("Done := Program:RemoteProgram.RemoteValue > 0 AND Program:RemoteProgram.RemoteMotor.Run;"))
      .filter((finding) => ["undefined-tag", "unknown-member"].includes(finding.ruleId));
    expect(findings).toHaveLength(0);
  });

  it("flags missing tags inside program-qualified references", () => {
    const findings = createDefaultEngine()
      .run(projectWithQualifiedStructuredText("Done := Program:RemoteProgram.MissingValue > 0;"))
      .filter((finding) => finding.ruleId === "undefined-tag");
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("Program:RemoteProgram.MissingValue");
  });

  it("flags unknown programs inside program-qualified references", () => {
    const findings = createDefaultEngine()
      .run(projectWithQualifiedStructuredText("Done := Program:NoSuchProgram.RemoteValue > 0;"))
      .filter((finding) => finding.ruleId === "undefined-tag");
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('unknown program "NoSuchProgram"');
  });
});
