import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  type PlcProject,
} from "@esco/core";
import { createLadderRoutine, createNode, tagOperand, type LadderRoutine } from "@esco/ladder";
import {
  deviceConnectionView,
  generateDeviceTags,
  planDeviceTags,
  type DeviceProfile,
} from "./index";

function baseProject(): { project: PlcProject; routineId: string } {
  const project = createProject("Devices");
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

function controllerTagNames(project: PlcProject): string[] {
  return project.controllers[0]!.controllerTags.map((tag) => tag.name);
}

describe("planDeviceTags", () => {
  it("composes vendor-neutral tag names from prefix + signal suffix", () => {
    const profile: DeviceProfile = { kind: "motor", prefix: "M101" };
    expect(planDeviceTags(profile).map((p) => p.tagName)).toEqual([
      "M101_StartPB",
      "M101_StopPB",
      "M101_RunCmd",
      "M101_Run",
      "M101_Overload",
      "M101_Fault",
    ]);
  });

  it("uses a custom signal set when supplied", () => {
    const profile: DeviceProfile = {
      kind: "analog-sensor",
      prefix: "AT7",
      signals: [{ suffix: "PV", dataType: "REAL", direction: "input", description: "pH" }],
    };
    const plan = planDeviceTags(profile);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.tagName).toBe("AT7_PV");
    expect(plan[0]!.dataType).toBe("REAL");
  });
});

describe("generateDeviceTags", () => {
  it("creates controller tags for a device profile", () => {
    const { project } = baseProject();
    const result = generateDeviceTags(project, { profile: { kind: "valve", prefix: "DV201" } });
    expect(result.ok).toBe(true);
    expect(result.data!.created).toEqual([
      "DV201_OpenCmd",
      "DV201_CloseCmd",
      "DV201_Open",
      "DV201_Closed",
      "DV201_Fault",
    ]);
    expect(controllerTagNames(result.project)).toEqual(expect.arrayContaining(result.data!.created));
    expect(result.data!.skipped).toHaveLength(0);
  });

  it("skips a colliding tag instead of overwriting existing work", () => {
    let { project } = baseProject();
    // Pre-create one of the tags the generator would emit.
    project = generateDeviceTags(project, {
      profile: { kind: "motor", prefix: "M101", signals: [{ suffix: "Run", dataType: "BOOL", direction: "input" }] },
    }).project;
    const result = generateDeviceTags(project, { profile: { kind: "motor", prefix: "M101" } });
    expect(result.ok).toBe(true);
    expect(result.data!.skipped.map((s) => s.tagName)).toContain("M101_Run");
    expect(result.warnings?.some((w) => w.includes("M101_Run"))).toBe(true);
    // The pre-existing tag is not duplicated.
    expect(controllerTagNames(result.project).filter((n) => n === "M101_Run")).toHaveLength(1);
  });

  it("fails when the device prefix is blank", () => {
    const { project } = baseProject();
    const result = generateDeviceTags(project, { profile: { kind: "motor", prefix: "  " } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/prefix is required/i);
  });
});

describe("deviceConnectionView", () => {
  it("links device tags to the ladder logic that references them", () => {
    const { project, routineId } = baseProject();
    const profile: DeviceProfile = { kind: "motor", prefix: "M101" };
    const generated = generateDeviceTags(project, { profile });
    expect(generated.ok).toBe(true);

    // Wire one device tag (M101_Run) into a rung: XIC(M101_Run) OTE(Light).
    const next = withRung(generated.project, routineId, [
      createNode("XIC", [tagOperand("tag", "M101_Run")]),
      createNode("OTE", [tagOperand("tag", "Light")]),
    ]);

    const view = deviceConnectionView(next, profile);
    expect(view.prefix).toBe("M101");
    expect(view.referenceCount).toBe(1);
    const runTag = view.tags.find((t) => t.tagName === "M101_Run")!;
    expect(runTag.references).toHaveLength(1);
    expect(runTag.references[0]!.instructionType).toBe("XIC");
    // Tags wired up but never used in logic are surfaced.
    expect(view.unusedTags).toContain("M101_StartPB");
    expect(view.unusedTags).not.toContain("M101_Run");
  });
});

/** Append a single rung carrying the given nodes to a routine's ladder. */
function withRung(project: PlcProject, routineId: string, nodes: ReturnType<typeof createNode>[]): PlcProject {
  return {
    ...project,
    controllers: project.controllers.map((controller) => ({
      ...controller,
      programs: controller.programs.map((program) => ({
        ...program,
        routines: program.routines.map((routine) => {
          if (routine.id !== routineId) return routine;
          const ladder = routine.ladder as LadderRoutine;
          return {
            ...routine,
            ladder: {
              ...ladder,
              rungs: [
                ...ladder.rungs,
                { id: `rung-${ladder.rungs.length}`, routineId: ladder.id, number: ladder.rungs.length, root: { id: `branch-${ladder.rungs.length}`, nodes } },
              ],
            },
          };
        }),
      })),
    })),
  };
}
