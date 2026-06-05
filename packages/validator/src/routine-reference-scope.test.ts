import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/**
 * Build a two-program project. ProgA's Main contains a single JSR whose routine
 * operand is `jsrTarget`; ProgB owns a routine named "Helper". This exercises
 * the Logix rule that a JSR resolves only against routines in its own program.
 */
function projectWithJsr(jsrTarget: string) {
  const project = createProject("LineCtl");
  const controller = createController(project.id, "LineCtl");

  const progA = createProgram(controller.id, "ProgA");
  const mainA = createRoutine(progA.id, "Main", "ladder");
  const ladderA = createLadderRoutine();
  ladderA.rungs.push(createRung("r0", 0, [createNode("JSR", [tagOperand("routine", jsrTarget)])]));
  mainA.ladder = ladderA;
  progA.mainRoutineId = mainA.id;
  progA.routines.push(mainA);

  const progB = createProgram(controller.id, "ProgB");
  const mainB = createRoutine(progB.id, "Main", "ladder");
  mainB.ladder = createLadderRoutine();
  progB.mainRoutineId = mainB.id;
  const helperB = createRoutine(progB.id, "Helper", "ladder");
  helperB.ladder = createLadderRoutine();
  progB.routines.push(mainB, helperB);

  controller.programs.push(progA, progB);
  project.controllers.push(controller);
  return project;
}

describe("JSR routine reference scope", () => {
  it("flags a JSR that targets a routine in another program", () => {
    const project = projectWithJsr("Helper");
    const findings = createDefaultEngine().run(project);
    const unknown = findings.filter((f) => f.ruleId === "unknown-routine");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].message).toContain('"Helper"');
    expect(unknown[0].target).toBe("LineCtl/ProgA/Main");
  });

  it("does not flag a JSR that targets a routine in the same program", () => {
    const project = projectWithJsr("Main");
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "unknown-routine")).toBe(false);
  });
});

describe("program-qualified tag reference scope", () => {
  function projectWithQualifiedOperand(operand: string, remoteType = "BOOL") {
    const project = createProject("LineCtl");
    const controller = createController(project.id, "LineCtl");
    controller.controllerTags.push(createTag(controller.id, "Seen", "BOOL"));

    const progA = createProgram(controller.id, "ProgA");
    const mainA = createRoutine(progA.id, "Main", "ladder");
    const ladderA = createLadderRoutine();
    ladderA.rungs.push(
      createRung("r0", 0, [
        createNode("XIC", [tagOperand("tag", operand)]),
        createNode("OTE", [tagOperand("tag", "Seen")]),
      ]),
    );
    mainA.ladder = ladderA;
    progA.mainRoutineId = mainA.id;
    progA.routines.push(mainA);

    const progB = createProgram(controller.id, "ProgB");
    progB.programTags.push(createTag(controller.id, "Remote", remoteType, { scope: "program", programId: progB.id }));
    controller.programs.push(progA, progB);
    project.controllers.push(controller);
    return project;
  }

  it("accepts a reference to another program's local tag", () => {
    const findings = createDefaultEngine().run(projectWithQualifiedOperand("Program:ProgB.Remote"));
    expect(findings.some((f) => f.ruleId === "undefined-tag")).toBe(false);
    expect(findings.some((f) => f.ruleId === "operand-type-mismatch")).toBe(false);
  });

  it("flags an unknown program in a qualified tag reference", () => {
    const findings = createDefaultEngine().run(projectWithQualifiedOperand("Program:Missing.Remote"));
    expect(findings.some((f) => f.ruleId === "undefined-tag" && f.message.includes("unknown program"))).toBe(true);
  });

  it("flags a missing local tag in a qualified tag reference", () => {
    const findings = createDefaultEngine().run(projectWithQualifiedOperand("Program:ProgB.Missing"));
    expect(findings.some((f) => f.ruleId === "undefined-tag" && f.message.includes("Program:ProgB.Missing"))).toBe(true);
  });

  it("type-checks simple qualified tag references", () => {
    const findings = createDefaultEngine().run(projectWithQualifiedOperand("Program:ProgB.Remote", "DINT"));
    expect(findings.some((f) => f.ruleId === "operand-type-mismatch")).toBe(true);
  });
});
