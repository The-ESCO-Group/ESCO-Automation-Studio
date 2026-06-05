import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
} from "@esco/core";
import {
  createLadderRoutine,
  createNode,
  createRung,
  tagOperand,
  type LadderNode,
} from "@esco/ladder";
import { createDefaultEngine } from "./index";

/** A one-controller project whose MainRoutine contains the given nodes + typed tags. */
function projectWithNodes(nodes: LadderNode[], tags: { name: string; type: string }[]): PlcProject {
  const project = createProject("Test");
  const controller = createController(project.id, "DemoController");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = routine.id;

  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(ladder.id, 0, nodes));
  routine.ladder = ladder;

  program.routines.push(routine);
  controller.programs.push(program);
  for (const tag of tags) {
    controller.controllerTags.push(createTag(controller.id, tag.name, tag.type, { value: false }));
  }
  project.controllers.push(controller);
  return project;
}

/** A one-controller project whose MainRoutine references `refTag` via an XIC. */
function projectReferencing(refTag: string, definedTags: string[]): PlcProject {
  const project = createProject("Test");
  const controller = createController(project.id, "DemoController");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = routine.id;

  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [
      createNode("XIC", [tagOperand("tag", refTag)]),
      createNode("OTE", [tagOperand("tag", "MotorRun")]),
    ]),
  );
  routine.ladder = ladder;

  program.routines.push(routine);
  controller.programs.push(program);
  for (const name of definedTags) {
    controller.controllerTags.push(createTag(controller.id, name, "BOOL", { value: false }));
  }
  project.controllers.push(controller);
  return project;
}

describe("undefined-tag rule", () => {
  it("flags a ladder operand with no matching tag", () => {
    const findings = createDefaultEngine().run(projectReferencing("Ghost", ["MotorRun"]));
    const undefinedFindings = findings.filter((f) => f.ruleId === "undefined-tag");
    expect(undefinedFindings.length).toBeGreaterThan(0);
    expect(undefinedFindings.some((f) => f.message.includes("Ghost"))).toBe(true);
  });

  it("passes when every operand tag is defined", () => {
    const findings = createDefaultEngine().run(
      projectReferencing("StartPB", ["StartPB", "MotorRun"]),
    );
    expect(findings.filter((f) => f.ruleId === "undefined-tag")).toHaveLength(0);
  });
});

/** A one-program project with the given program-scoped tags (alias supported). */
function projectWithProgramTags(
  tags: { name: string; type: string; aliasFor?: string }[],
): PlcProject {
  const project = createProject("Test");
  const controller = createController(project.id, "DemoController");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = routine.id;
  routine.ladder = createLadderRoutine();
  program.routines.push(routine);
  for (const t of tags) {
    const tag = createTag(controller.id, t.name, t.type, { scope: "program", programId: program.id });
    if (t.aliasFor) tag.aliasFor = t.aliasFor;
    program.programTags.push(tag);
  }
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

describe("double-coil rule", () => {
  it("flags a BOOL driven by two OTE coils", () => {
    const project = projectWithNodes(
      [
        createNode("OTE", [tagOperand("tag", "MotorRun")]),
        createNode("OTE", [tagOperand("tag", "MotorRun")]),
      ],
      [{ name: "MotorRun", type: "BOOL" }],
    );
    expect(createDefaultEngine().run(project).some((f) => f.ruleId === "double-coil")).toBe(true);
  });

  it("does not flag a single coil", () => {
    const project = projectWithNodes(
      [createNode("OTE", [tagOperand("tag", "MotorRun")])],
      [{ name: "MotorRun", type: "BOOL" }],
    );
    expect(createDefaultEngine().run(project).some((f) => f.ruleId === "double-coil")).toBe(false);
  });
});

describe("program-tag rules", () => {
  it("flags a duplicate program tag", () => {
    const project = projectWithProgramTags([
      { name: "Flag", type: "BOOL" },
      { name: "Flag", type: "BOOL" },
    ]);
    expect(createDefaultEngine().run(project).some((f) => f.ruleId === "duplicate-program-tag")).toBe(true);
  });

  it("flags an alias whose target is missing, accepts one that resolves", () => {
    const missing = projectWithProgramTags([{ name: "MotorCmd", type: "ALIAS", aliasFor: "Ghost" }]);
    expect(createDefaultEngine().run(missing).some((f) => f.ruleId === "alias-target-missing")).toBe(true);

    const resolved = projectWithProgramTags([
      { name: "Run", type: "BOOL" },
      { name: "MotorCmd", type: "ALIAS", aliasFor: "Run" },
    ]);
    expect(createDefaultEngine().run(resolved).some((f) => f.ruleId === "alias-target-missing")).toBe(false);
  });
});

/** Build a controller project with controller/program tags, UDTs, and one rung. */
function controllerProject(opts: {
  controllerTags?: { name: string; type: string; aliasFor?: string }[];
  programTags?: { name: string; type: string }[];
  udts?: { name: string; members: (string | { name: string; dataType: string; dimension?: number })[] }[];
  nodes: LadderNode[];
}): PlcProject {
  const project = createProject("Test");
  const controller = createController(project.id, "Ctrl");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(ladder.id, 0, opts.nodes));
  routine.ladder = ladder;
  program.routines.push(routine);
  for (const t of opts.programTags ?? []) {
    program.programTags.push(createTag(controller.id, t.name, t.type, { scope: "program", programId: program.id }));
  }
  controller.programs.push(program);
  for (const t of opts.controllerTags ?? []) {
    const tag = createTag(controller.id, t.name, t.type);
    if (t.aliasFor) tag.aliasFor = t.aliasFor;
    controller.controllerTags.push(tag);
  }
  for (const u of opts.udts ?? []) {
    controller.dataTypes.push({
      id: `udt-${u.name}`,
      name: u.name,
      members: u.members.map((m) =>
        typeof m === "string"
          ? { name: m, dataType: "BOOL" }
          : {
              name: m.name,
              dataType: m.dataType,
              ...(m.dimension && m.dimension > 0 ? { dimension: m.dimension } : {}),
            },
      ),
    });
  }
  project.controllers.push(controller);
  return project;
}

describe("tag scope, members, and aliases", () => {
  it("a program tag shadows a controller tag of the same name", () => {
    // Controller Shared:DINT shadowed by program Shared:BOOL; XIC expects BOOL.
    const project = controllerProject({
      controllerTags: [{ name: "Shared", type: "DINT" }],
      programTags: [{ name: "Shared", type: "BOOL" }],
      nodes: [createNode("XIC", [tagOperand("tag", "Shared")])],
    });
    expect(createDefaultEngine().run(project).some((f) => f.ruleId === "operand-type-mismatch")).toBe(false);
  });

  it("flags an unknown member on a structured (TIMER) tag, accepts a real one", () => {
    const bad = controllerProject({
      controllerTags: [{ name: "Timer1", type: "TIMER" }],
      nodes: [createNode("XIC", [tagOperand("tag", "Timer1.XYZ")])],
    });
    expect(createDefaultEngine().run(bad).some((f) => f.ruleId === "unknown-member" && f.message.includes("XYZ"))).toBe(true);

    const good = controllerProject({
      controllerTags: [{ name: "Timer1", type: "TIMER" }],
      nodes: [createNode("XIC", [tagOperand("tag", "Timer1.DN")])],
    });
    expect(createDefaultEngine().run(good).some((f) => f.ruleId === "unknown-member")).toBe(false);
  });

  it("recognises ALARM_DIGITAL/ALARM_ANALOG members, flags unknown ones", () => {
    // ALMD/ALMA are model-only, but their control tags can be referenced by
    // ordinary instructions (e.g. XIC of an alarm status bit), which are validated.
    const good = controllerProject({
      controllerTags: [
        { name: "MotorAlarm", type: "ALARM_DIGITAL" },
        { name: "LevelAlarm", type: "ALARM_ANALOG" },
      ],
      nodes: [
        createNode("XIC", [tagOperand("tag", "MotorAlarm.InAlarm")]),
        createNode("XIC", [tagOperand("tag", "MotorAlarm.Acked")]),
        createNode("XIC", [tagOperand("tag", "LevelAlarm.HHInAlarm")]),
      ],
    });
    expect(createDefaultEngine().run(good).some((f) => f.ruleId === "unknown-member")).toBe(false);

    const bad = controllerProject({
      controllerTags: [{ name: "MotorAlarm", type: "ALARM_DIGITAL" }],
      nodes: [createNode("XIC", [tagOperand("tag", "MotorAlarm.Nope")])],
    });
    expect(createDefaultEngine().run(bad).some((f) => f.ruleId === "unknown-member" && f.message.includes("Nope"))).toBe(true);
  });

  it("recognises MOTION_INSTRUCTION status members, flags unknown ones", () => {
    // Motion instructions are model-only, but their Motion Control status tags
    // are read by ordinary (validated) instructions to sequence motion, e.g. an
    // XIC of the .DN / .ER status bits after an MAM.
    const good = controllerProject({
      controllerTags: [{ name: "MoveCtl", type: "MOTION_INSTRUCTION" }],
      nodes: [
        createNode("XIC", [tagOperand("tag", "MoveCtl.DN")]),
        createNode("XIC", [tagOperand("tag", "MoveCtl.ER")]),
        createNode("XIC", [tagOperand("tag", "MoveCtl.PC")]),
      ],
    });
    expect(createDefaultEngine().run(good).some((f) => f.ruleId === "unknown-member")).toBe(false);

    const bad = controllerProject({
      controllerTags: [{ name: "MoveCtl", type: "MOTION_INSTRUCTION" }],
      nodes: [createNode("XIC", [tagOperand("tag", "MoveCtl.Nope")])],
    });
    expect(createDefaultEngine().run(bad).some((f) => f.ruleId === "unknown-member" && f.message.includes("Nope"))).toBe(true);
  });

  it("recognises EQUIPMENT_PHASE / PHASE_INSTRUCTION members, flags unknown ones", () => {
    // The equipment-phase blocks (PCMD/PATT/PXRQ/…) are model-only, but the phase
    // and PXRQ control tags they own are read by ordinary (validated) ladder to
    // gate sequence flow, e.g. an XIC of MyPhase.Complete or of a PXRQ control's
    // .DN. Their structures must be modelled so those members are recognised.
    const good = controllerProject({
      controllerTags: [
        { name: "MyPhase", type: "EQUIPMENT_PHASE" },
        { name: "PhaseReq", type: "PHASE_INSTRUCTION" },
      ],
      nodes: [
        createNode("XIC", [tagOperand("tag", "MyPhase.Running")]),
        createNode("XIC", [tagOperand("tag", "MyPhase.Complete")]),
        createNode("XIC", [tagOperand("tag", "PhaseReq.DN")]),
        createNode("XIC", [tagOperand("tag", "PhaseReq.ER")]),
      ],
    });
    expect(createDefaultEngine().run(good).some((f) => f.ruleId === "unknown-member")).toBe(false);

    const bad = controllerProject({
      controllerTags: [{ name: "MyPhase", type: "EQUIPMENT_PHASE" }],
      nodes: [createNode("XIC", [tagOperand("tag", "MyPhase.Nope")])],
    });
    expect(createDefaultEngine().run(bad).some((f) => f.ruleId === "unknown-member" && f.message.includes("Nope"))).toBe(true);
  });

  it("flags an unknown member on a UDT tag, accepts a defined one", () => {
    const bad = controllerProject({
      controllerTags: [{ name: "Motor", type: "MotorUdt" }],
      udts: [{ name: "MotorUdt", members: ["Status", "Cmd"] }],
      nodes: [createNode("XIC", [tagOperand("tag", "Motor.Bogus")])],
    });
    expect(createDefaultEngine().run(bad).some((f) => f.ruleId === "unknown-member")).toBe(true);

    const good = controllerProject({
      controllerTags: [{ name: "Motor", type: "MotorUdt" }],
      udts: [{ name: "MotorUdt", members: ["Status", "Cmd"] }],
      nodes: [createNode("XIC", [tagOperand("tag", "Motor.Status")])],
    });
    expect(createDefaultEngine().run(good).some((f) => f.ruleId === "unknown-member")).toBe(false);
  });

  it("checks UDT member-array bounds and accepts in-range member elements", () => {
    const bad = controllerProject({
      controllerTags: [{ name: "Motor", type: "MotorUdt" }],
      udts: [{ name: "MotorUdt", members: [{ name: "Faults", dataType: "BOOL", dimension: 2 }] }],
      nodes: [createNode("XIC", [tagOperand("tag", "Motor.Faults[2]")])],
    });
    expect(createDefaultEngine().run(bad).some((f) => f.ruleId === "array-index-out-of-range")).toBe(true);

    const good = controllerProject({
      controllerTags: [{ name: "Motor", type: "MotorUdt" }],
      udts: [{ name: "MotorUdt", members: [{ name: "Faults", dataType: "BOOL", dimension: 2 }] }],
      nodes: [createNode("XIC", [tagOperand("tag", "Motor.Faults[1]")])],
    });
    const findings = createDefaultEngine().run(good);
    expect(findings.some((f) => f.ruleId === "array-index-out-of-range")).toBe(false);
    expect(findings.some((f) => f.ruleId === "unknown-member")).toBe(false);
  });

  it("validates nested UDT member paths", () => {
    const bad = controllerProject({
      controllerTags: [{ name: "Motor", type: "MotorUdt" }],
      udts: [
        { name: "MotorUdt", members: [{ name: "Drive", dataType: "DriveUdt" }] },
        { name: "DriveUdt", members: ["Ready"] },
      ],
      nodes: [createNode("XIC", [tagOperand("tag", "Motor.Drive.Bogus")])],
    });
    expect(createDefaultEngine().run(bad).some((f) => f.ruleId === "unknown-member" && f.message.includes("Bogus"))).toBe(true);

    const good = controllerProject({
      controllerTags: [{ name: "Motor", type: "MotorUdt" }],
      udts: [
        { name: "MotorUdt", members: [{ name: "Drive", dataType: "DriveUdt" }] },
        { name: "DriveUdt", members: ["Ready"] },
      ],
      nodes: [createNode("XIC", [tagOperand("tag", "Motor.Drive.Ready")])],
    });
    expect(createDefaultEngine().run(good).some((f) => f.ruleId === "unknown-member")).toBe(false);
  });

  it("resolves an alias to its base type (no undefined / type mismatch)", () => {
    const project = controllerProject({
      controllerTags: [
        { name: "Run", type: "BOOL" },
        { name: "MotorCmd", type: "ALIAS", aliasFor: "Run" },
      ],
      nodes: [createNode("XIC", [tagOperand("tag", "MotorCmd")])],
    });
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "undefined-tag")).toBe(false);
    expect(findings.some((f) => f.ruleId === "operand-type-mismatch")).toBe(false);
  });

  it("resolves an alias to a UDT member path for operand type checks", () => {
    const project = controllerProject({
      controllerTags: [
        { name: "Motor", type: "MotorUdt" },
        { name: "MotorRun", type: "BOOL", aliasFor: "Motor.Run" },
      ],
      udts: [{ name: "MotorUdt", members: ["Run"] }],
      nodes: [createNode("XIC", [tagOperand("tag", "MotorRun")])],
    });
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "undefined-tag")).toBe(false);
    expect(findings.some((f) => f.ruleId === "unknown-member")).toBe(false);
    expect(findings.some((f) => f.ruleId === "operand-type-mismatch")).toBe(false);
  });
});

describe("operand validation for the new instructions", () => {
  it("flags a missing required operand", () => {
    // TON with only the timer operand — preset is missing.
    const project = projectWithNodes(
      [createNode("TON", [tagOperand("timer", "Timer1")])],
      [{ name: "Timer1", type: "TIMER" }],
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "missing-operand")).toBe(true);
  });

  it("flags an operand whose tag has the wrong data type", () => {
    // TON's timer operand points at a BOOL tag instead of a TIMER.
    const project = projectWithNodes(
      [createNode("TON", [tagOperand("timer", "NotATimer"), tagOperand("preset", "3000")])],
      [{ name: "NotATimer", type: "BOOL" }],
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "operand-type-mismatch")).toBe(true);
  });

  it("accepts a correctly typed TON with a numeric preset literal", () => {
    const project = projectWithNodes(
      [createNode("TON", [tagOperand("timer", "Timer1"), tagOperand("preset", "3000")])],
      [{ name: "Timer1", type: "TIMER" }],
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.filter((f) => f.ruleId === "operand-type-mismatch")).toHaveLength(0);
    expect(findings.filter((f) => f.ruleId === "undefined-tag")).toHaveLength(0);
    expect(findings.filter((f) => f.ruleId === "missing-operand")).toHaveLength(0);
  });
});

describe("JSR/SBR/RET parameter validation", () => {
  function projectWithSubroutine(
    mainNodes: LadderNode[],
    subRungs: LadderNode[][],
    tags: { name: string; type: string }[],
  ): PlcProject {
    const project = createProject("RoutineParams");
    const controller = createController(project.id, "Ctrl");
    const program = createProgram(controller.id, "MainProgram");
    const main = createRoutine(program.id, "Main", "ladder");
    const sub = createRoutine(program.id, "Sub", "ladder");
    program.mainRoutineId = main.id;

    const mainLadder = createLadderRoutine();
    mainLadder.rungs.push(createRung(mainLadder.id, 0, mainNodes));
    main.ladder = mainLadder;

    const subLadder = createLadderRoutine();
    subRungs.forEach((nodes, index) => subLadder.rungs.push(createRung(subLadder.id, index, nodes)));
    sub.ladder = subLadder;

    program.routines.push(main, sub);
    controller.programs.push(program);
    for (const tag of tags) controller.controllerTags.push(createTag(controller.id, tag.name, tag.type));
    project.controllers.push(controller);
    return project;
  }

  it("accepts matching Studio-style JSR input count, SBR inputs, and RET returns", () => {
    const project = projectWithSubroutine(
      [createNode("JSR", [
        tagOperand("routine", "Sub"),
        tagOperand("op1", "2"),
        tagOperand("op2", "A"),
        tagOperand("op3", "B"),
        tagOperand("op4", "Result"),
      ])],
      [
        [createNode("SBR", [tagOperand("op0", "InA"), tagOperand("op1", "InB")])],
        [createNode("RET", [tagOperand("op0", "Sum")])],
      ],
      ["A", "B", "Result", "InA", "InB", "Sum"].map((name) => ({ name, type: "DINT" })),
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "instruction-validation")).toBe(false);
    expect(findings.some((f) => f.ruleId === "undefined-tag")).toBe(false);
  });

  it("flags JSR/SBR count mismatches and literal return destinations", () => {
    const project = projectWithSubroutine(
      [createNode("JSR", [
        tagOperand("routine", "Sub"),
        tagOperand("op1", "1"),
        tagOperand("op2", "A"),
        tagOperand("op3", "5"),
      ])],
      [
        [createNode("SBR", [tagOperand("op0", "InA"), tagOperand("op1", "InB")])],
        [createNode("RET", [tagOperand("op0", "Sum")])],
      ],
      ["A", "InA", "InB", "Sum"].map((name) => ({ name, type: "DINT" })),
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "instruction-validation" && f.message.includes("SBR accepts 2"))).toBe(true);
    expect(findings.some((f) => f.ruleId === "invalid-write-target" && f.message.includes('"5"'))).toBe(true);
  });
});
