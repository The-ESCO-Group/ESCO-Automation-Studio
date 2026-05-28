import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  type PlcProject,
} from "@esco/core";
import { createLadderRoutine } from "@esco/ladder";
import { addRungFromText } from "@esco/project-actions";
import {
  applyPlan,
  counterPlan,
  explainRoutine,
  fixUndefinedPlan,
  motorStarterPlan,
  runAssistant,
  timerPlan,
} from "./index";

function baseProject(): { project: PlcProject; routineId: string } {
  const project = createProject("Test");
  const controller = createController(project.id, "DemoController");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  routine.ladder = createLadderRoutine();
  program.mainRoutineId = routine.id;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return { project, routineId: routine.id };
}

/** A project that already has the motor starter applied. */
function motorProject(): { project: PlcProject; routineId: string } {
  const base = baseProject();
  const result = applyPlan(base.project, motorStarterPlan(base.project, { routineId: base.routineId }));
  return { project: result.project, routineId: base.routineId };
}

describe("AI assistant: explanations", () => {
  it("explains the selected rung", () => {
    const { project, routineId } = motorProject();
    const text = runAssistant({ prompt: "explain rung", project, selection: { routineId } }).message;
    expect(text).toMatch(/MotorRun/);
    expect(text).toMatch(/Tags written/);
  });

  it("explains the routine", () => {
    const { project, routineId } = motorProject();
    const text = explainRoutine({ prompt: "explain routine", project, selection: { routineId } });
    expect(text).toMatch(/MainRoutine/);
    expect(text).toMatch(/1 rung/);
  });

  it("returns help text for an unsupported prompt", () => {
    const { project } = baseProject();
    const result = runAssistant({ prompt: "hello there", project });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/explain rung/);
    expect(result.plan).toBeUndefined();
  });
});

describe("AI assistant: plan generation", () => {
  it("generates a motor starter plan", () => {
    const { project, routineId } = baseProject();
    const result = runAssistant({ prompt: "generate motor starter", project, selection: { routineId } });
    expect(result.plan).toBeDefined();
    const kinds = result.plan!.actions.map((a) => a.kind);
    expect(kinds.filter((k) => k === "createTag")).toHaveLength(3);
    expect(kinds).toContain("addRungFromText");
  });

  it("generates a timer plan with a TIMER tag", () => {
    const { project, routineId } = baseProject();
    const plan = timerPlan(project, { routineId });
    expect(plan.actions.some((a) => a.label.includes("TIMER"))).toBe(true);
    expect(plan.actions.some((a) => a.kind === "addRungFromText")).toBe(true);
  });

  it("generates a counter plan with a COUNTER tag", () => {
    const { project, routineId } = baseProject();
    const plan = counterPlan(project, { routineId });
    expect(plan.actions.some((a) => a.label.includes("COUNTER"))).toBe(true);
  });

  it("proposes creating undefined tags with inferred types", () => {
    const base = baseProject();
    const withGhost = addRungFromText(base.project, {
      routineId: base.routineId,
      text: "XIC(StartPB)TON(GhostTimer,1000)",
    }).project;
    const plan = fixUndefinedPlan(withGhost);
    const labels = plan.actions.map((a) => a.label);
    expect(labels).toContain("Create tag StartPB (BOOL)");
    expect(labels).toContain("Create tag GhostTimer (TIMER)");
  });
});

describe("AI assistant: apply", () => {
  it("applies the motor starter through project-actions and validates cleanly", () => {
    const { project, routineId } = baseProject();
    const plan = motorStarterPlan(project, { routineId });
    const result = applyPlan(project, plan);
    expect(result.ok).toBe(true);
    // Every supported tag is defined → no error-severity findings.
    expect(result.findings.filter((f) => f.severity === "error")).toHaveLength(0);
    // The seal-in rung was added.
    const routine = result.project.controllers[0]!.programs[0]!.routines[0]!;
    expect((routine.ladder as { rungs: unknown[] }).rungs).toHaveLength(1);
  });

  it("does not mutate the original project before/after apply", () => {
    const { project, routineId } = baseProject();
    const snapshot = JSON.stringify(project);
    const plan = motorStarterPlan(project, { routineId });
    runAssistant({ prompt: "generate motor starter", project, selection: { routineId } });
    applyPlan(project, plan);
    expect(JSON.stringify(project)).toBe(snapshot);
  });
});
