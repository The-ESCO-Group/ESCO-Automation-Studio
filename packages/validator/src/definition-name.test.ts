import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  type AddOnInstruction,
  type PlcProject,
  type UserDefinedType,
} from "@esco/core";
import { createDefaultEngine } from "./index";

/**
 * Build a project whose single controller carries the given containers. Programs
 * are passed as [programName, ...routineNames] tuples; tasks/UDTs/AOIs by name.
 */
function project(opts: {
  tasks?: string[];
  programs?: [string, ...string[]][];
  udts?: string[];
  aois?: string[];
}): PlcProject {
  const proj = createProject("Cell");
  const controller = createController(proj.id, "Ctrl");
  for (const name of opts.tasks ?? []) {
    controller.tasks.push(createContinuousTask(controller.id, name));
  }
  for (const [programName, ...routineNames] of opts.programs ?? []) {
    const program = createProgram(controller.id, programName);
    for (const routineName of routineNames) {
      program.routines.push(createRoutine(program.id, routineName));
    }
    controller.programs.push(program);
  }
  for (const name of opts.udts ?? []) {
    const udt: UserDefinedType = { id: `udt-${name}`, name, members: [] };
    controller.dataTypes.push(udt);
  }
  for (const name of opts.aois ?? []) {
    const aoi: AddOnInstruction = {
      id: `aoi-${name}`,
      name,
      parameters: [],
      localTags: [],
      routineNames: ["Logic"],
    };
    controller.addOnInstructions.push(aoi);
  }
  proj.controllers.push(controller);
  return proj;
}

const nameFindings = (proj: PlcProject) =>
  createDefaultEngine().run(proj).filter((f) => f.ruleId === "invalid-definition-name");

describe("invalid-definition-name", () => {
  it("flags a task name that is not a valid Logix identifier", () => {
    const findings = nameFindings(project({ tasks: ["Main-Task"] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('Task "Main-Task"');
    expect(findings[0].target).toBe("Ctrl/Main-Task");
  });

  it("flags a malformed program name and routine name", () => {
    const findings = nameFindings(project({ programs: [["1Prog", "Good", "Bad Routine"]] }));
    expect(findings).toHaveLength(2);
    const program = findings.find((f) => f.message.includes('Program "1Prog"'));
    const routine = findings.find((f) => f.message.includes('Routine "Bad Routine"'));
    expect(program?.target).toBe("Ctrl/1Prog");
    expect(routine?.target).toBe("Ctrl/1Prog/Bad Routine");
  });

  it("flags malformed data type and AOI names", () => {
    const findings = nameFindings(project({ udts: ["My__Udt"], aois: ["Scale_"] }));
    expect(findings).toHaveLength(2);
    expect(findings.some((f) => f.message.includes('Data type "My__Udt"'))).toBe(true);
    expect(findings.some((f) => f.message.includes('Add-On Instruction "Scale_"'))).toBe(true);
  });

  it("flags a definition name longer than 40 characters", () => {
    const findings = nameFindings(project({ programs: [["P".repeat(41)]] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("limit is 40");
  });

  it("does not flag valid task, program, routine, UDT, and AOI names", () => {
    const findings = nameFindings(
      project({
        tasks: ["MainTask"],
        programs: [["MainProgram", "MainRoutine", "_Init"]],
        udts: ["Motor_Udt"],
        aois: ["Scale"],
      }),
    );
    expect(findings).toHaveLength(0);
  });
});
