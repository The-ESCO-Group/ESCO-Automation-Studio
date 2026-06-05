import { describe, expect, it } from "vitest";
import {
  createContinuousTask,
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
} from "@esco/core";
import {
  addRung,
  appendInstruction,
  createLadderRoutine,
  createNode,
  createRung,
  tagOperand,
  type LadderRoutine,
} from "@esco/ladder";
import { buildRuntime, controllerTaskStatusReport, scanProject } from "@esco/project-actions";
import {
  powerUpImage,
  programTagPath,
  resolveValuePath,
  runtimeTagInfos,
  runtimeToExecutableProject,
} from "./runtime-loader";

const AT = "2026-06-03T12:00:00.000Z";

function ladderAndStProject(): PlcProject {
  const project = createProject("Loader Line");
  const controller = createController(project.id, "LoaderCtl");

  const main = createProgram(controller.id, "MainProgram");
  const ladderRoutine = createRoutine(main.id, "MainRoutine", "ladder");
  let ladder = addRung(createLadderRoutine());
  const rungId = ladder.rungs[0]!.id;
  ladder = appendInstruction(ladder, rungId, "XIC", "StartPB");
  ladder = appendInstruction(ladder, rungId, "OTE", "MotorRun");
  ladderRoutine.ladder = ladder;
  main.mainRoutineId = ladderRoutine.id;
  main.routines.push(ladderRoutine);

  const aux = createProgram(controller.id, "AuxProgram");
  const stRoutine = createRoutine(aux.id, "AuxRoutine", "structured-text");
  stRoutine.structuredText = "Count := Count + 1;";
  aux.mainRoutineId = stRoutine.id;
  aux.routines.push(stRoutine);

  controller.programs.push(main, aux);
  controller.tasks.push(createContinuousTask(controller.id, "MainTask", [main.id, aux.id]));
  controller.controllerTags.push(
    createTag(controller.id, "StartPB", "BOOL", { value: false }),
    createTag(controller.id, "MotorRun", "BOOL", { value: false }),
    createTag(controller.id, "Count", "DINT", { value: 0 }),
  );
  project.controllers.push(controller);
  return project;
}

function udtAndAoiProject(): PlcProject {
  const project = createProject("Metadata Line");
  const controller = createController(project.id, "MetaCtl");
  controller.dataTypes.push({
    id: "udt-motor-status",
    name: "MotorStatus",
    family: "NoFamily",
    members: [
      { name: "Running", dataType: "BOOL", description: "Run feedback" },
      { name: "Speed", dataType: "DINT", radix: "Decimal" },
    ],
  });

  const aoiRoutine = createRoutine("aoi-DBL", "Logic", "ladder");
  const aoiLadder = createLadderRoutine();
  aoiLadder.rungs.push(
    createRung(aoiLadder.id, 0, [
      createNode("ADD", [
        tagOperand("sourceA", "In"),
        tagOperand("sourceB", "In"),
        tagOperand("dest", "Out"),
      ]),
    ]),
  );
  aoiRoutine.ladder = aoiLadder;
  controller.addOnInstructions.push({
    id: "aoi-DBL",
    name: "DBL",
    revision: "1.0",
    parameters: [
      { name: "In", dataType: "DINT", usage: "Input" },
      { name: "Out", dataType: "DINT", usage: "Output" },
    ],
    localTags: [{ name: "Scratch", dataType: "DINT" }],
    routineNames: ["Logic"],
    routines: [aoiRoutine],
  });

  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(ladder.id, 0, [createNode("DBL", [tagOperand("instance", "DBL_01")])]));
  routine.ladder = ladder;
  program.mainRoutineId = routine.id;
  program.routines.push(routine);
  controller.programs.push(program);
  controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
  controller.controllerTags.push(
    createTag(controller.id, "Motor", "MotorStatus"),
    createTag(controller.id, "DBL_01", "DBL"),
  );
  project.controllers.push(controller);
  return project;
}

describe("runtimeToExecutableProject", () => {
  it("rebuilds an executable ladder AST from flattened rung text", () => {
    const runtime = buildRuntime(ladderAndStProject(), { builtAt: AT }).runtime!;
    const project = runtimeToExecutableProject(runtime);

    const controller = project.controllers[0]!;
    expect(controller.programs).toHaveLength(2);

    const ladderRoutine = controller.programs
      .flatMap((program) => program.routines)
      .find((routine) => routine.language === "ladder")!;
    const ladder = ladderRoutine.ladder as { rungs: { root: { nodes: { instructionType: string }[] } }[] };
    expect(ladder.rungs).toHaveLength(1);
    expect(ladder.rungs[0]!.root.nodes.map((node) => node.instructionType)).toEqual(["XIC", "OTE"]);
  });

  it("preserves the task scan set so the scan engine schedules the same routines", () => {
    const runtime = buildRuntime(ladderAndStProject(), { builtAt: AT }).runtime!;
    const project = runtimeToExecutableProject(runtime);
    const scheduled = controllerTaskStatusReport(project).scheduledRoutineIds;
    expect(scheduled).toHaveLength(2);
  });

  it("produces a project the scan engine executes (ladder + ST share tag memory)", () => {
    const runtime = buildRuntime(ladderAndStProject(), { builtAt: AT }).runtime!;
    const project = runtimeToExecutableProject(runtime);

    let values = powerUpImage(project, runtime);
    values.StartPB = true;
    for (let i = 0; i < 3; i += 1) {
      values = scanProject(project, values, { deltaMs: 10 }).data!.values;
    }
    expect(values.MotorRun).toBe(true);
    expect(values.Count).toBe(3);
  });

  it("restores UDT and AOI metadata before tag layout and scans are initialized", () => {
    const build = buildRuntime(udtAndAoiProject(), { builtAt: AT });
    expect(build.ok, build.errors.join("\n")).toBe(true);
    const runtime = build.runtime!;
    const project = runtimeToExecutableProject(runtime);
    const controller = project.controllers[0]!;

    expect(controller.dataTypes[0]).toMatchObject({
      name: "MotorStatus",
      members: [{ name: "Running", dataType: "BOOL" }, { name: "Speed", dataType: "DINT" }],
    });
    expect(controller.addOnInstructions[0]).toMatchObject({
      name: "DBL",
      parameters: [{ name: "In", usage: "Input" }, { name: "Out", usage: "Output" }],
      localTags: [{ name: "Scratch", dataType: "DINT" }],
      routineNames: ["Logic"],
    });
    const restoredAoiLadder = controller.addOnInstructions[0]?.routines?.[0]?.ladder as LadderRoutine | undefined;
    expect(restoredAoiLadder?.rungs[0]?.root.nodes[0]?.instructionType).toBe("ADD");

    let values = powerUpImage(project, runtime);
    expect(values["Motor.Running"]).toBe(false);
    expect(values["Motor.Speed"]).toBe(0);
    expect(values["DBL_01.In"]).toBe(0);
    expect(values["DBL_01.Out"]).toBe(0);

    values["DBL_01.In"] = 8;
    values = scanProject(project, values, { deltaMs: 10 }).data!.values;
    expect(values["DBL_01.Out"]).toBe(16);
  });
});

describe("powerUpImage", () => {
  function setpointProject(): PlcProject {
    const project = createProject("Init");
    const controller = createController(project.id, "C");
    const program = createProgram(controller.id, "P");
    const routine = createRoutine(program.id, "R", "structured-text");
    routine.structuredText = "Setpoint := Setpoint;";
    program.mainRoutineId = routine.id;
    program.routines.push(routine);
    controller.programs.push(program);
    controller.tasks.push(createContinuousTask(controller.id, "T", [program.id]));
    controller.controllerTags.push(createTag(controller.id, "Setpoint", "DINT", { value: 42 }));
    project.controllers.push(controller);
    return project;
  }

  function programSetpointProject(): PlcProject {
    const project = createProject("Program Init");
    const controller = createController(project.id, "C");
    const program = createProgram(controller.id, "Mixer");
    const routine = createRoutine(program.id, "R", "structured-text");
    routine.structuredText = "LocalSetpoint := LocalSetpoint;";
    program.mainRoutineId = routine.id;
    program.routines.push(routine);
    program.programTags.push(
      createTag(controller.id, "LocalSetpoint", "DINT", { scope: "program", programId: program.id, value: 55 }),
    );
    controller.programs.push(program);
    controller.tasks.push(createContinuousTask(controller.id, "T", [program.id]));
    project.controllers.push(controller);
    return project;
  }

  it("uses compiled authored power-up values for tracked paths", () => {
    const runtime = buildRuntime(setpointProject(), { builtAt: AT }).runtime!;
    const rebuilt = runtimeToExecutableProject(runtime);
    expect(powerUpImage(rebuilt, runtime).Setpoint).toBe(42);
  });

  it("uses compiled authored power-up values for program-scoped tracked paths", () => {
    const runtime = buildRuntime(programSetpointProject(), { builtAt: AT }).runtime!;
    const rebuilt = runtimeToExecutableProject(runtime);
    expect(powerUpImage(rebuilt, runtime)["Program:Mixer.LocalSetpoint"]).toBe(55);
  });

  it("honors a controller-scope scalar power-up value declared by the runtime", () => {
    const runtime = buildRuntime(setpointProject(), { builtAt: AT }).runtime!;
    runtime.tags.find((tag) => tag.name === "Setpoint")!.initialValue = 7;
    const rebuilt = runtimeToExecutableProject(runtime);
    expect(powerUpImage(rebuilt, runtime).Setpoint).toBe(7);
  });

  it("lets per-tag runtime initial values override the compiled initial value map", () => {
    const runtime = buildRuntime(programSetpointProject(), { builtAt: AT }).runtime!;
    runtime.initialValues["Program:Mixer.LocalSetpoint"] = 12;
    runtime.tags.find((tag) => tag.path === "Program:Mixer.LocalSetpoint")!.initialValue = 88;
    const rebuilt = runtimeToExecutableProject(runtime);
    expect(powerUpImage(rebuilt, runtime)["Program:Mixer.LocalSetpoint"]).toBe(88);
  });
});

describe("path helpers", () => {
  it("normalizes program path forms to the canonical value path", () => {
    expect(resolveValuePath("Motor")).toBe("Motor");
    expect(resolveValuePath("P1::Acc")).toBe("Program:P1.Acc");
    expect(resolveValuePath("P1::Acc.Member")).toBe("Program:P1.Acc.Member");
    expect(resolveValuePath("Program:P1.Acc")).toBe("Program:P1.Acc");
    expect(programTagPath("P1", "Acc")).toBe("Program:P1.Acc");
  });

  it("describes runtime tags with canonical paths and scope", () => {
    const runtime = buildRuntime(ladderAndStProject(), { builtAt: AT }).runtime!;
    const infos = runtimeTagInfos(runtime);
    const motor = infos.find((info) => info.name === "MotorRun")!;
    expect(motor).toMatchObject({ scope: "controller", path: "MotorRun", dataType: "BOOL" });
  });
});
