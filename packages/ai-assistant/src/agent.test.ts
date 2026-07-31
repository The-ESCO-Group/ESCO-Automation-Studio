import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  type PlcProject,
} from "@esco/core";
import { createLadderRoutine } from "@esco/ladder";
import { addRungFromText, generateLargeProject } from "@esco/project-actions";
import {
  applyAction,
  applyPlan,
  buildAgentContext,
  executeReadTool,
  isWriteTool,
  runAgent,
  WRITE_TOOL_TO_KIND,
  writeToolToAction,
  type ModelCaller,
  type ModelReply,
} from "./index";

function baseProject(): { project: PlcProject; routineId: string } {
  const project = createProject("Test");
  const controller = createController(project.id, "Ctrl");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  routine.ladder = createLadderRoutine();
  program.mainRoutineId = routine.id;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return { project, routineId: routine.id };
}

/** A mock model that replays a fixed script of replies (one per loop turn). */
function scriptedCaller(script: ModelReply[]): ModelCaller {
  let i = 0;
  return async () => script[Math.min(i++, script.length - 1)]!;
}

describe("agent tools: whitelist mapping", () => {
  it("every write tool maps to a kind that applyAction dispatches", () => {
    const { project } = baseProject();
    for (const [tool, kind] of Object.entries(WRITE_TOOL_TO_KIND)) {
      expect(isWriteTool(tool)).toBe(true);
      const action = writeToolToAction(tool, {});
      expect(action.kind).toBe(kind);
      // Applying with empty input may fail validation, but must NOT be "unknown/blocked".
      const outcome = applyAction(project, action);
      expect(outcome.error ?? "").not.toMatch(/Unknown or blocked/);
    }
  });

  it("rejects an unknown action kind", () => {
    const { project } = baseProject();
    const outcome = applyAction(project, { id: "x", kind: "evalJavascript", label: "", description: "", input: {} });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/Unknown or blocked/);
  });

  it("keeps generated program/routine ids stable for follow-up actions", () => {
    const { project } = baseProject();
    const controllerId = project.controllers[0]!.id;
    const createProgramAction = writeToolToAction("create_program", {
      controllerId,
      name: "Pump_Cell",
    });
    const programId = (createProgramAction.input as { programId?: string }).programId;
    expect(programId).toMatch(/^prog_/);

    const createRoutineAction = writeToolToAction("create_routine", {
      programId,
      name: "Main",
    });
    const routineId = (createRoutineAction.input as { routineId?: string }).routineId;
    expect(routineId).toMatch(/^rtn_/);

    const applied = applyPlan(project, {
      id: "plan_stable_ids",
      title: "Program scaffold",
      explanation: "Create an offline program scaffold with a main routine.",
      actions: [
        createProgramAction,
        createRoutineAction,
        writeToolToAction("set_program_properties", {
          programId,
          name: "Pump_Cell",
          mainRoutineId: routineId,
        }),
      ],
      warnings: [],
    });

    expect(applied.ok).toBe(true);
    const program = applied.project.controllers[0]!.programs.find((candidate) => candidate.id === programId);
    expect(program?.routines[0]?.id).toBe(routineId);
    expect(program?.mainRoutineId).toBe(routineId);
  });
});

describe("agent loop: safety", () => {
  it("proposes a plan WITHOUT mutating the input project (no silent mutation)", async () => {
    const { project, routineId } = baseProject();
    const snapshot = JSON.stringify(project);
    const caller = scriptedCaller([
      { content: [{ type: "tool_use", id: "t1", name: "create_tag", input: { name: "StartPB", dataType: "BOOL" } }], stop_reason: "tool_use" },
      { content: [{ type: "tool_use", id: "t2", name: "add_rung_from_text", input: { routineId, text: "XIC(StartPB)OTE(MotorRun)" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Proposed a start rung." }], stop_reason: "end_turn" },
    ]);

    const result = await runAgent({ caller, project, prompt: "add a start", selection: { routineId } });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(project)).toBe(snapshot); // input project untouched
    expect(result.plan.actions.map((a) => a.kind)).toEqual(["createTag", "addRungFromText"]);
  });

  it("rejects tools that are not in the whitelist", async () => {
    const { project } = baseProject();
    const caller = scriptedCaller([
      { content: [{ type: "tool_use", id: "t1", name: "exec_shell", input: { cmd: "rm -rf /" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" },
    ]);
    const result = await runAgent({ caller, project, prompt: "hack" });
    expect(result.plan.actions).toHaveLength(0);
    expect(result.transcript.some((e) => e.role === "error" && /Blocked/.test(e.text))).toBe(true);
  });

  it("rejects unregistered HMI element write tools before queuing actions", async () => {
    const { project } = baseProject();
    const caller = scriptedCaller([
      {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "add_hmi_registered_element",
            input: { surfaceKind: "screen", surfaceId: "screen_1", typeId: "vendor.custom-gauge" },
          },
        ],
        stop_reason: "tool_use",
      },
      { content: [{ type: "text", text: "That element type is not registered." }], stop_reason: "end_turn" },
    ]);

    const result = await runAgent({ caller, project, prompt: "add custom HMI gauge" });

    expect(result.plan.actions).toHaveLength(0);
    expect(result.transcript.some((entry) => /not registered/i.test(entry.text))).toBe(true);
  });

  it("runs read-only without proposing any actions", async () => {
    const { project } = baseProject();
    const caller = scriptedCaller([
      { content: [{ type: "tool_use", id: "t1", name: "get_project_overview", input: {} }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "This project has one routine." }], stop_reason: "end_turn" },
    ]);
    const result = await runAgent({ caller, project, prompt: "what is here?" });
    expect(result.ok).toBe(true);
    expect(result.plan.actions).toHaveLength(0);
    expect(result.transcript.some((e) => e.role === "assistant")).toBe(true);
  });

  it("reports Studio 5000 handoff readiness as a read-only tool", () => {
    const { project } = baseProject();
    const text = executeReadTool(project, "get_studio5000_handoff_readiness", {});
    expect(text).toContain("Studio 5000 handoff readiness");
    expect(text).toContain("Export L5X");
    expect(text).toContain("physical controller upload/download");
  });

  it("surfaces a model/transport error without throwing", async () => {
    const { project } = baseProject();
    const caller: ModelCaller = async () => {
      throw new Error("Invalid or missing API key (401).");
    };
    const result = await runAgent({ caller, project, prompt: "x" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
  });
});

describe("apply: validation + immutability", () => {
  it("applies a proposed plan through project-actions and always returns findings", async () => {
    const { project, routineId } = baseProject();
    const caller = scriptedCaller([
      { content: [{ type: "tool_use", id: "t1", name: "create_tag", input: { name: "StartPB", dataType: "BOOL" } }], stop_reason: "tool_use" },
      { content: [{ type: "tool_use", id: "t2", name: "add_rung_from_text", input: { routineId, text: "XIC(StartPB)OTE(MotorRun)" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" },
    ]);
    const result = await runAgent({ caller, project, prompt: "add", selection: { routineId } });

    const before = JSON.stringify(project);
    const applied = applyPlan(project, result.plan);
    expect(applied.ok).toBe(true);
    expect(applied.project).not.toBe(project);
    expect(JSON.stringify(project)).toBe(before); // applyPlan never mutates input
    expect(Array.isArray(applied.findings)).toBe(true); // validation ran
    // MotorRun was never created → a validation finding exists.
    expect(applied.findings.some((f) => /MotorRun/i.test(`${f.message} ${f.target ?? ""}`))).toBe(true);
  });
});

describe("agent context: size guard", () => {
  it("summarizes a large project instead of inlining every rung", () => {
    const large = generateLargeProject({ programs: 4, routinesPerProgram: 20, rungsPerRoutine: 6 });
    const result = buildAgentContext(large);
    expect(result.summarized).toBe(true);
    expect(result.text).toMatch(/Large project/);
  });

  it("inlines the selected routine for a small project", () => {
    const { project, routineId } = baseProject();
    const withRung = addRungFromText(project, { routineId, text: "XIC(Start)OTE(Run)" }).project;
    const result = buildAgentContext(withRung, { routineId });
    expect(result.summarized).toBe(false);
    expect(result.text).toMatch(/Selected routine/);
  });
});
