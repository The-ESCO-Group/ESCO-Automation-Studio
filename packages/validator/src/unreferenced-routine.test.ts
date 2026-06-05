import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/**
 * Build a single program named "Ctrl" with a Main routine, plus any extra
 * routines the caller supplies. The Main routine carries the given JSR target
 * names (one JSR per name); pass none for a Main that calls nothing.
 */
function projectWithRoutines(jsrTargets: string[], extraRoutineNames: string[]) {
  const project = createProject("LineCtl");
  const controller = createController(project.id, "LineCtl");
  const program = createProgram(controller.id, "Ctrl");

  const main = createRoutine(program.id, "Main", "ladder");
  const ladder = createLadderRoutine();
  jsrTargets.forEach((name, i) => {
    ladder.rungs.push(createRung(`r${i}`, i, [createNode("JSR", [tagOperand("routine", name)])]));
  });
  main.ladder = ladder;
  program.mainRoutineId = main.id;
  program.routines.push(main);

  for (const name of extraRoutineNames) {
    const routine = createRoutine(program.id, name, "ladder");
    routine.ladder = createLadderRoutine();
    program.routines.push(routine);
  }

  controller.programs.push(program);
  project.controllers.push(controller);
  return { project, program };
}

const unreferenced = (project: ReturnType<typeof projectWithRoutines>["project"]) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "unreferenced-routine");

describe("unreferenced-routine", () => {
  it("flags a routine that is neither main/fault nor called by any JSR", () => {
    const { project } = projectWithRoutines([], ["Orphan"]);
    const findings = unreferenced(project);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain('"Orphan"');
    expect(findings[0].target).toBe("LineCtl/Ctrl/Orphan");
  });

  it("does not flag a routine reached by a JSR (case-insensitively)", () => {
    const { project } = projectWithRoutines(["helper"], ["Helper"]);
    expect(unreferenced(project)).toHaveLength(0);
  });

  it("does not flag a routine executed only by a FOR loop", () => {
    const { project, program } = projectWithRoutines([], ["LoopBody"]);
    const main = program.routines.find((r) => r.name === "Main")!;
    // FOR(routine, index, initial, terminal, step) — operand 0 names the routine.
    (main.ladder as ReturnType<typeof createLadderRoutine>).rungs.push(
      createRung("rfor", 0, [
        createNode("FOR", [
          tagOperand("routine", "LoopBody"),
          tagOperand("index", "i"),
          tagOperand("initial", "0"),
          tagOperand("terminal", "10"),
          tagOperand("step", "1"),
        ]),
      ]),
    );
    expect(unreferenced(project)).toHaveLength(0);
  });

  it("never flags the program's main routine", () => {
    const { project } = projectWithRoutines([], []);
    expect(unreferenced(project)).toHaveLength(0);
  });

  it("does not flag the configured fault routine", () => {
    const { project, program } = projectWithRoutines([], ["FaultHandler"]);
    program.faultRoutineId = program.routines.find((r) => r.name === "FaultHandler")!.id;
    expect(unreferenced(project)).toHaveLength(0);
  });

  it("does not flag a routine called only from imported Structured Text", () => {
    const { project, program } = projectWithRoutines([], ["StHelper"]);
    const main = program.routines.find((r) => r.name === "Main")!;
    main.structuredText = "JSR(StHelper, 0);";
    expect(unreferenced(project)).toHaveLength(0);
  });

  it("stays silent when the program has no resolvable main routine", () => {
    const { project, program } = projectWithRoutines([], ["Orphan"]);
    program.mainRoutineId = undefined;
    expect(unreferenced(project)).toHaveLength(0);
  });
});
