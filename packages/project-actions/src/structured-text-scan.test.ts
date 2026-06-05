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
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { defaultValues, outputTags, scanProject, traceScan } from "./index";

function stProject(source: string): { project: PlcProject; routineId: string } {
  const project = createProject("ST Scan");
  const controller = createController(project.id, "Ctl");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainST", "structured-text");
  routine.structuredText = source;
  program.mainRoutineId = routine.id;
  program.routines.push(routine);

  controller.controllerTags.push(
    createTag(controller.id, "Start", "BOOL"),
    createTag(controller.id, "Stop", "BOOL"),
    createTag(controller.id, "MotorRun", "BOOL"),
    createTag(controller.id, "BoolSrc", "BOOL", { dimensions: [3] }),
    createTag(controller.id, "BoolDst", "BOOL", { dimensions: [3] }),
    createTag(controller.id, "Count", "DINT"),
    createTag(controller.id, "Index", "DINT"),
    createTag(controller.id, "Sum", "DINT"),
    createTag(controller.id, "InValue", "DINT"),
    createTag(controller.id, "Temp", "DINT"),
    createTag(controller.id, "SeqTable", "DINT", { dimensions: [4] }),
    createTag(controller.id, "SeqDest", "DINT"),
    createTag(controller.id, "SeqCtl", "CONTROL"),
    createTag(controller.id, "SeqPos", "DINT"),
    createTag(controller.id, "Fifo", "DINT", { dimensions: [4] }),
    createTag(controller.id, "FifoCtl", "CONTROL"),
    createTag(controller.id, "Timer1", "TIMER"),
    createTag(controller.id, "Shot", "FBD_ONESHOT"),
    createTag(controller.id, "Channel", "STRING"),
    createTag(controller.id, "Message", "STRING"),
    createTag(controller.id, "StringSrc", "STRING", { dimensions: [3] }),
    createTag(controller.id, "StringDst", "STRING", { dimensions: [3] }),
  );
  controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
  controller.programs.push(program);
  project.controllers.push(controller);
  return { project, routineId: routine.id };
}

describe("Structured Text offline scan", () => {
  it("executes scalar assignments and IF/ELSIF/ELSE flow during a scheduled scan", () => {
    const { project } = stProject(`
IF Start AND NOT Stop THEN
  MotorRun := TRUE;
  Count := Count + 1;
ELSIF Stop THEN
  MotorRun := FALSE;
ELSE
  Message := 'idle';
END_IF;
`);

    const first = scanProject(project, { ...defaultValues(project), Start: true }).data!.values;
    expect(first.MotorRun).toBe(true);
    expect(first.Count).toBe(1);
    expect(first.Message).toBe("");

    const second = scanProject(project, { ...first, Start: false, Stop: false }).data!.values;
    expect(second.MotorRun).toBe(true);
    expect(second.Count).toBe(1);
    expect(second.Message).toBe("idle");

    const stopped = scanProject(project, { ...second, Stop: true }).data!.values;
    expect(stopped.MotorRun).toBe(false);
    expect(stopped.Count).toBe(1);
  });

  it("executes ST conditions with the Logix ampersand AND operator", () => {
    const { project } = stProject(`
IF Start & NOT Stop THEN
  MotorRun := TRUE;
  Count := Count + 1;
ELSE
  MotorRun := FALSE;
END_IF;
`);

    const values = scanProject(project, { ...defaultValues(project), Start: true, Stop: false }).data!.values;
    expect(values.MotorRun).toBe(true);
    expect(values.Count).toBe(1);

    const stopped = scanProject(project, { ...values, Stop: true }).data!.values;
    expect(stopped.MotorRun).toBe(false);
    expect(stopped.Count).toBe(1);
  });

  it("executes simple ST string relational comparisons", () => {
    const { project } = stProject(`
IF (Message = 'RUN') THEN
  MotorRun := TRUE;
  Count := 1;
ELSIF Message < 'RUN' THEN
  Count := 2;
ELSIF Message <> 'run' THEN
  Count := 3;
ELSE
  Count := 4;
END_IF;
`);

    const running = scanProject(project, { ...defaultValues(project), Message: "RUN" }).data!.values;
    expect(running.MotorRun).toBe(true);
    expect(running.Count).toBe(1);

    const earlier = scanProject(project, { ...defaultValues(project), Message: "IDLE" }).data!.values;
    expect(earlier.MotorRun).toBe(false);
    expect(earlier.Count).toBe(2);

    const later = scanProject(project, { ...defaultValues(project), Message: "STOP" }).data!.values;
    expect(later.Count).toBe(3);

    const caseSensitive = scanProject(project, { ...defaultValues(project), Message: "run" }).data!.values;
    expect(caseSensitive.Count).toBe(4);
  });

  it("executes ST string comparisons inside logical BOOL expressions", () => {
    const { project } = stProject(`
IF Message = 'RUN' AND Start THEN
  MotorRun := TRUE;
  Count := 1;
ELSIF NOT (Message = 'STOP') OR Stop THEN
  Count := 2;
ELSE
  Count := 3;
END_IF;
`);

    const running = scanProject(project, { ...defaultValues(project), Message: "RUN", Start: true }).data!.values;
    expect(running.MotorRun).toBe(true);
    expect(running.Count).toBe(1);

    const idle = scanProject(project, { ...defaultValues(project), Message: "IDLE", Start: false, Stop: false }).data!.values;
    expect(idle.MotorRun).toBe(false);
    expect(idle.Count).toBe(2);

    const stoppedByInput = scanProject(project, { ...defaultValues(project), Message: "STOP", Stop: true }).data!.values;
    expect(stoppedByInput.Count).toBe(2);

    const stopped = scanProject(project, { ...defaultValues(project), Message: "STOP", Stop: false }).data!.values;
    expect(stopped.Count).toBe(3);
  });

  it("assigns BOOL results from simple ST string comparisons", () => {
    const { project } = stProject("MotorRun := Message = 'READY';");

    expect(scanProject(project, { ...defaultValues(project), Message: "READY" }).data!.values.MotorRun).toBe(true);
    expect(scanProject(project, { ...defaultValues(project), Message: "ready" }).data!.values.MotorRun).toBe(false);
  });

  it("assigns results from ST string comparisons combined with BOOL operands", () => {
    const { project } = stProject(`
MotorRun := Message = 'READY' AND Start;
Count := Message <> 'FAULT' AND Start;
`);

    const ready = scanProject(project, { ...defaultValues(project), Message: "READY", Start: true }).data!.values;
    expect(ready.MotorRun).toBe(true);
    expect(ready.Count).toBe(1);

    const notStarted = scanProject(project, { ...defaultValues(project), Message: "READY", Start: false }).data!.values;
    expect(notStarted.MotorRun).toBe(false);
    expect(notStarted.Count).toBe(0);

    const faulted = scanProject(project, { ...defaultValues(project), Message: "FAULT", Start: true }).data!.values;
    expect(faulted.MotorRun).toBe(false);
    expect(faulted.Count).toBe(0);
  });

  it("executes Studio non-retentive ST assignment syntax as scan-time writes", () => {
    const { project, routineId } = stProject(`
IF Start THEN
  MotorRun [:=] TRUE;
  Count[:=] Count + 1;
  Message [:=] 'running';
ELSE
  MotorRun [:=] FALSE;
END_IF;
`);

    const running = scanProject(project, { ...defaultValues(project), Start: true }).data!.values;
    expect(running.MotorRun).toBe(true);
    expect(running.Count).toBe(1);
    expect(running.Message).toBe("running");
    expect([...outputTags(project, routineId)]).toEqual(expect.arrayContaining(["MotorRun", "Count", "Message"]));

    const stopped = scanProject(project, { ...running, Start: false }).data!.values;
    expect(stopped.MotorRun).toBe(false);
    expect(stopped.Count).toBe(1);
    expect(stopped.Message).toBe("running");
  });

  it("keeps program-scoped ST tags isolated through qualified value paths", () => {
    const project = createProject("ST Scoped");
    const controller = createController(project.id, "Ctl");
    const program = createProgram(controller.id, "Mixer");
    const routine = createRoutine(program.id, "MainST", "structured-text");
    routine.structuredText = "IF LocalIn THEN LocalOut := TRUE; END_IF;";
    program.mainRoutineId = routine.id;
    program.routines.push(routine);
    program.programTags.push(
      createTag(controller.id, "LocalIn", "BOOL", { scope: "program", programId: program.id }),
      createTag(controller.id, "LocalOut", "BOOL", { scope: "program", programId: program.id }),
    );
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [program.id]));
    controller.programs.push(program);
    project.controllers.push(controller);

    const values = scanProject(project, {
      ...defaultValues(project),
      "Program:Mixer.LocalIn": true,
    }).data!.values;

    expect(values["Program:Mixer.LocalOut"]).toBe(true);
    expect(values.LocalOut).toBeUndefined();
  });

  it("reports ST assignment destinations as outputs and trace writes", () => {
    const { project, routineId } = stProject("MotorRun := Start; Count := Count + 1;");

    expect(outputTags(project, routineId)).toEqual(new Set(["MotorRun", "Count"]));

    const result = traceScan(project, { ...defaultValues(project), Start: true });
    expect(result.values.MotorRun).toBe(true);
    expect(result.trace.filter((entry) => entry.instruction === "ST_ASSIGN")).toHaveLength(2);
    expect(result.trace.some((entry) => entry.writes.some((write) => write.path === "MotorRun" && write.value === true))).toBe(true);
  });

  it("executes bounded FOR loops and reports loop-index writes", () => {
    const { project } = stProject(`
Sum := 0;
FOR Index := 0 TO 3 DO
  Sum := Sum + Index;
END_FOR;
`);

    const result = traceScan(project, defaultValues(project));
    expect(result.values.Sum).toBe(6);
    expect(result.values.Index).toBe(3);
    expect(result.trace.filter((entry) => entry.instruction === "ST_FOR_INDEX")).toHaveLength(4);
  });

  it("executes WHILE and REPEAT loops with EXIT support", () => {
    const whileProject = stProject(`
Count := 0;
WHILE Count < 10 DO
  Count := Count + 1;
  IF Count >= 3 THEN
    EXIT;
  END_IF;
END_WHILE;
`);
    const whileValues = scanProject(whileProject.project, defaultValues(whileProject.project)).data!.values;
    expect(whileValues.Count).toBe(3);

    const repeatProject = stProject(`
Count := 0;
REPEAT
  Count := Count + 1;
UNTIL Count >= 4
END_REPEAT;
`);
    const repeatValues = scanProject(repeatProject.project, defaultValues(repeatProject.project)).data!.values;
    expect(repeatValues.Count).toBe(4);
  });

  it("executes CASE selections with comma labels, ranges, and ELSE", () => {
    const commaProject = stProject(`
Count := 2;
CASE Count OF
  0: Sum := 10;
  1, 2: Sum := 20;
  3..5: Sum := 30;
ELSE
  Sum := 40;
END_CASE;
`);
    expect(scanProject(commaProject.project, defaultValues(commaProject.project)).data!.values.Sum).toBe(20);
    expect(outputTags(commaProject.project, commaProject.routineId)).toContain("Sum");

    const rangeProject = stProject(`
Count := 4;
CASE Count OF
  0: Sum := 10;
  1, 2: Sum := 20;
  3..5:
    Sum := 30;
ELSE
  Sum := 40;
END_CASE;
`);
    expect(scanProject(rangeProject.project, defaultValues(rangeProject.project)).data!.values.Sum).toBe(30);

    const elseProject = stProject(`
Count := 9;
CASE Count OF
  0: Sum := 10;
  1, 2: Sum := 20;
  3..5: Sum := 30;
ELSE
  Sum := 40;
END_CASE;
`);
    expect(scanProject(elseProject.project, defaultValues(elseProject.project)).data!.values.Sum).toBe(40);
  });

  it("keeps CASE branch bodies intact when they write program-qualified tags", () => {
    const project = createProject("ST CASE Qualified");
    const controller = createController(project.id, "Ctl");
    const main = createProgram(controller.id, "MainProgram");
    const remote = createProgram(controller.id, "RemoteProgram");
    const routine = createRoutine(main.id, "MainST", "structured-text");
    routine.structuredText = `
Count := 2;
CASE Count OF
  DINT#1: Sum := 10;
  16#2:
    Program:RemoteProgram.RemoteValue := 77;
    Sum := 20;
  3.5..4.5: Sum := 30;
ELSE
  Sum := 40;
END_CASE;
`;
    main.mainRoutineId = routine.id;
    main.routines.push(routine);
    remote.programTags.push(createTag(controller.id, "RemoteValue", "DINT", { scope: "program", programId: remote.id }));
    controller.controllerTags.push(createTag(controller.id, "Count", "DINT"), createTag(controller.id, "Sum", "DINT"));
    controller.tasks.push(createContinuousTask(controller.id, "MainTask", [main.id]));
    controller.programs.push(main, remote);
    project.controllers.push(controller);

    const values = scanProject(project, defaultValues(project)).data!.values;
    expect(values.Sum).toBe(20);
    expect(values["Program:RemoteProgram.RemoteValue"]).toBe(77);
    expect([...outputTags(project, routine.id)]).toEqual(expect.arrayContaining(["Program:RemoteProgram.RemoteValue", "Sum"]));
  });

  it("executes ST JSR/SBR/RET calls to Structured Text subroutines", () => {
    const { project, routineId } = stProject("JSR(ScaleST, 1, Count, Sum);");
    const program = project.controllers[0]!.programs[0]!;
    const helper = createRoutine(program.id, "ScaleST", "structured-text");
    helper.structuredText = `
SBR(InValue);
IF InValue > 0 THEN
  Temp := InValue * 2;
  RET(Temp);
END_IF;
Temp := 99;
RET(Temp);
`;
    program.routines.push(helper);

    expect(outputTags(project, routineId)).toContain("Sum");
    const result = traceScan(project, { ...defaultValues(project), Count: 7 });

    expect(result.values.Sum).toBe(14);
    expect(result.values.Temp).toBe(14);
    expect(result.trace.some((entry) => entry.instruction === "ST_JSR")).toBe(true);
    expect(result.trace.some((entry) => entry.instruction === "ST_SBR" && entry.writes.some((write) => write.path === "InValue" && write.value === 7))).toBe(true);
    expect(result.trace.some((entry) => entry.instruction === "ST_RET")).toBe(true);
  });

  it("executes ST JSR calls to ladder subroutines with SBR/RET parameters", () => {
    const { project } = stProject("JSR(LadderSub, 1, Count, Sum);");
    const program = project.controllers[0]!.programs[0]!;
    const helperRoutine = createRoutine(program.id, "LadderSub", "ladder");
    const ladder = createLadderRoutine();
    const node = (type: string, ...operands: string[]) =>
      createNode(type, operands.map((value, index) => tagOperand(`op${index}`, value)));
    helperRoutine.ladder = {
      ...ladder,
      rungs: [
        createRung(ladder.id, 0, [node("SBR", "InValue")]),
        createRung(ladder.id, 1, [node("ADD", "InValue", "1", "Temp")]),
        createRung(ladder.id, 2, [node("RET", "Temp")]),
      ],
    };
    program.routines.push(helperRoutine);

    const values = scanProject(project, { ...defaultValues(project), Count: 4 }).data!.values;

    expect(values.Sum).toBe(5);
    expect(values.Temp).toBe(5);
  });

  it("executes registered Studio instruction calls from Structured Text", () => {
    const { project, routineId } = stProject(`
MOV(5, Count);
ADD(Count, 7, Sum);
CONCAT('Hi', '!', Message);
TON(Timer1, 500);
`);

    const outputs = outputTags(project, routineId);
    expect(outputs).toContain("Count");
    expect(outputs).toContain("Sum");
    expect(outputs).toContain("Message");
    expect(outputs).toContain("Timer1");
    const result = traceScan(project, defaultValues(project), { deltaMs: 250 });

    expect(result.values.Count).toBe(5);
    expect(result.values.Sum).toBe(12);
    expect(result.values.Message).toBe("Hi!");
    expect(result.values["Message.LEN"]).toBe(3);
    expect(result.values["Timer1.PRE"]).toBe(500);
    expect(result.values["Timer1.ACC"]).toBe(250);
    expect(result.values["Timer1.EN"]).toBe(true);
    expect(result.trace.some((entry) => entry.instruction === "ST_MOV")).toBe(true);
    expect(result.trace.some((entry) => entry.instruction === "ST_ADD")).toBe(true);
    expect(result.trace.some((entry) => entry.instruction === "ST_CONCAT")).toBe(true);
    expect(result.trace.some((entry) => entry.instruction === "ST_TON")).toBe(true);
  });

  it("executes FBD_ONESHOT OSRI/OSFI calls from Structured Text", () => {
    const rising = stProject("OSRI(Shot);");
    let values = scanProject(rising.project, {
      ...defaultValues(rising.project),
      "Shot.InputBit": false,
    }).data!.values;
    expect(values["Shot.OutputBit"]).toBe(false);

    values = scanProject(rising.project, { ...values, "Shot.InputBit": true }).data!.values;
    expect(values["Shot.OutputBit"]).toBe(true);

    values = scanProject(rising.project, values).data!.values;
    expect(values["Shot.OutputBit"]).toBe(false);

    const falling = stProject("OSFI(Shot);");
    values = scanProject(falling.project, {
      ...defaultValues(falling.project),
      "Shot.InputBit": true,
    }).data!.values;
    expect(values["Shot.OutputBit"]).toBe(false);

    values = scanProject(falling.project, { ...values, "Shot.InputBit": false }).data!.values;
    expect(values["Shot.OutputBit"]).toBe(true);
  });

  it("executes value-preserving ST COP and FLL calls for BOOL and STRING arrays", () => {
    const { project, routineId } = stProject(`
COP(BoolSrc, BoolDst, 2);
FLL(Message, StringDst, 2);
`);

    expect([...outputTags(project, routineId)]).toEqual(expect.arrayContaining(["BoolDst", "StringDst"]));

    const result = traceScan(project, {
      ...defaultValues(project),
      "BoolSrc[0]": true,
      "BoolSrc[1]": false,
      Message: "ready",
    });

    expect(result.values["BoolDst[0]"]).toBe(true);
    expect(result.values["BoolDst[1]"]).toBe(false);
    expect(result.values["StringDst[0]"]).toBe("ready");
    expect(result.values["StringDst[1]"]).toBe("ready");
    expect(result.trace.find((entry) => entry.instruction === "ST_COP")?.writes).toEqual([
      { path: "BoolDst[0]", value: true },
      { path: "BoolDst[1]", value: false },
    ]);
  });

  it("maps named ST instruction arguments onto registry operands", () => {
    const { project, routineId } = stProject(`
MOV(Dest => Count, Source := 5);
ADD(Dest => Sum, SourceB := 7, SourceA := Count);
CONCAT(Dest => Message, SourceB := '!', SourceA := 'Hi');
`);

    const outputs = outputTags(project, routineId);
    expect(outputs).toContain("Count");
    expect(outputs).toContain("Sum");
    expect(outputs).toContain("Message");

    const result = traceScan(project, defaultValues(project));
    expect(result.values.Count).toBe(5);
    expect(result.values.Sum).toBe(12);
    expect(result.values.Message).toBe("Hi!");
    expect(result.trace.find((entry) => entry.instruction === "ST_ADD")?.operands).toEqual(["Count", "7", "Sum"]);
  });

  it("executes registered ST calls with omitted optional operands", () => {
    const { project, routineId } = stProject(`
SQO(SeqTable, 16#FFFF, SeqDest, SeqCtl, 3, );
FFL(Count, Fifo, FifoCtl, 3, );
ARD(Channel, Message, );
`);

    const outputs = outputTags(project, routineId);
    expect([...outputs]).toEqual(expect.arrayContaining(["SeqDest", "SeqCtl", "Fifo", "FifoCtl", "Channel", "Message"]));

    const result = traceScan(project, {
      ...defaultValues(project),
      "SeqTable[1]": 0x1234,
      Count: 77,
      Channel: "ABCDE",
    });

    expect(result.values.SeqDest).toBe(0x1234);
    expect(result.values["SeqCtl.POS"]).toBe(1);
    expect(result.values["Fifo[0]"]).toBe(77);
    expect(result.values["FifoCtl.POS"]).toBe(1);
    expect(result.values.Message).toBe("ABCDE");
    expect(result.values.Channel).toBe("");
    expect(result.trace.find((entry) => entry.instruction === "ST_SQO")?.operands).toEqual([
      "SeqTable",
      "16#FFFF",
      "SeqDest",
      "SeqCtl",
      "3",
      "",
    ]);
    expect(result.trace.find((entry) => entry.instruction === "ST_FFL")?.operands).toEqual(["Count", "Fifo", "FifoCtl", "3", ""]);
    expect(result.trace.find((entry) => entry.instruction === "ST_ARD")?.operands).toEqual(["Channel", "Message", ""]);
  });

  it("maps explicit optional ST position operands through the registry", () => {
    const { project, routineId } = stProject("SQO(SeqTable, 16#FFFF, SeqDest, SeqCtl, 3, SeqPos);");

    expect([...outputTags(project, routineId)]).toEqual(expect.arrayContaining(["SeqDest", "SeqCtl", "SeqPos"]));

    const result = traceScan(project, {
      ...defaultValues(project),
      "SeqTable[3]": 0x88,
      SeqPos: 2,
    });

    expect(result.values.SeqDest).toBe(0x88);
    expect(result.values["SeqCtl.POS"]).toBe(3);
    expect(result.values.SeqPos).toBe(3);
    expect(result.trace.find((entry) => entry.instruction === "ST_SQO")?.operands).toEqual([
      "SeqTable",
      "16#FFFF",
      "SeqDest",
      "SeqCtl",
      "3",
      "SeqPos",
    ]);
  });
});
