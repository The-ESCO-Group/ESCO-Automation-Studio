import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createDefaultEngine } from "./index";

function projectWithStructuredText(source: string) {
  const project = createProject("Cell");
  const controller = createController(project.id, "Ctrl");
  const aliasTimer = createTag(controller.id, "AliasTimer", "ALIAS");
  aliasTimer.aliasFor = "Unit.Timer";
  const aliasTimerStatus = createTag(controller.id, "AliasTimerStatus", "ALIAS");
  aliasTimerStatus.aliasFor = "Timer1.ACC";
  const aliasUnit = createTag(controller.id, "AliasUnit", "ALIAS");
  aliasUnit.aliasFor = "Unit";
  const aliasChainTimer = createTag(controller.id, "AliasChainTimer", "ALIAS");
  aliasChainTimer.aliasFor = "AliasTimer";
  const aliasRemoteTimer = createTag(controller.id, "AliasRemoteTimer", "ALIAS");
  aliasRemoteTimer.aliasFor = "Program:RemoteProgram.RemoteUnit.Timer";
  controller.controllerTags.push(
    createTag(controller.id, "Level", "DINT"),
    createTag(controller.id, "RunFlag", "BOOL"),
    createTag(controller.id, "Temp", "DINT"),
    createTag(controller.id, "BoolBuffer", "BOOL", { dimensions: [3] }),
    createTag(controller.id, "SeqArray", "DINT", { dimensions: [4] }),
    createTag(controller.id, "SeqDest", "DINT"),
    createTag(controller.id, "SeqCtl", "CONTROL"),
    createTag(controller.id, "SeqPos", "DINT"),
    createTag(controller.id, "Fifo", "DINT", { dimensions: [4] }),
    createTag(controller.id, "Channel", "STRING"),
    createTag(controller.id, "Message", "STRING"),
    createTag(controller.id, "StringBuffer", "STRING", { dimensions: [3] }),
    createTag(controller.id, "Timer1", "TIMER"),
    createTag(controller.id, "TimerArray", "TIMER", { dimensions: [2] }),
    createTag(controller.id, "Unit", "UnitUdt"),
    createTag(controller.id, "MessageCtrl", "MESSAGE"),
    createTag(controller.id, "Shot", "FBD_ONESHOT"),
    aliasTimer,
    aliasTimerStatus,
    aliasUnit,
    aliasChainTimer,
    aliasRemoteTimer,
  );
  controller.dataTypes.push({
    id: "udt-unit",
    name: "UnitUdt",
    members: [
      { name: "Speed", dataType: "DINT" },
      { name: "Timer", dataType: "TIMER" },
      { name: "TimerSlots", dataType: "TIMER", dimensions: [2] },
    ],
  });

  const program = createProgram(controller.id, "MainProgram");
  const localAliasTimer = createTag(controller.id, "LocalAliasTimer", "ALIAS", { scope: "program", programId: program.id });
  localAliasTimer.aliasFor = "Unit.Timer";
  program.programTags.push(localAliasTimer);
  const routine = createRoutine(program.id, "CalcST", "structured-text");
  routine.structuredText = source;
  program.routines.push(routine);
  const remoteProgram = createProgram(controller.id, "RemoteProgram");
  const remoteAliasTimer = createTag(controller.id, "RemoteAliasTimer", "ALIAS", { scope: "program", programId: remoteProgram.id });
  remoteAliasTimer.aliasFor = "RemoteUnit.Timer";
  remoteProgram.programTags.push(
    createTag(controller.id, "RemoteUnit", "UnitUdt", { scope: "program", programId: remoteProgram.id }),
    createTag(controller.id, "RemoteLevel", "DINT", { scope: "program", programId: remoteProgram.id }),
    remoteAliasTimer,
  );
  controller.programs.push(program, remoteProgram);
  project.controllers.push(controller);
  return project;
}

function instructionFindings(source: string) {
  return createDefaultEngine()
    .run(projectWithStructuredText(source))
    .filter((finding) =>
      ["st-instruction-validation", "missing-operand", "model-only-instruction", "invalid-write-target", "operand-type-mismatch"].includes(
        finding.ruleId,
      ),
    );
}

describe("structured-text-instructions", () => {
  it("accepts complete positional and named registered instruction calls", () => {
    const findings = instructionFindings(`
MOV(Dest => Level, Source := 5);
ADD(Level, 1, Temp);
CPT(Dest => Level, Expression := ABS(Temp - 4));
TON(Timer1, 100);
FLL(RunFlag, BoolBuffer, 2);
FLL(Message, StringBuffer, 2);
`);

    expect(findings).toHaveLength(0);
  });

  it("flags unknown named operands, missing required operands, and invalid expression operands", () => {
    const findings = instructionFindings(`
MOV(Source := 5);
ADD(SourceA := Level, SourceC := 1, Dest => Temp);
CPT(Dest => Level, Expression := BAD(Temp));
`);
    const text = findings.map((finding) => finding.message).join("\n");

    expect(text).toContain('MOV is missing required operand "dest"');
    expect(text).toContain('Unknown named operand "SourceC" for ADD');
    expect(text).toContain("ADD is missing required operand \"sourceB\"");
    expect(text).toContain("CPT: Operand 'expression' must be a safe numeric expression.");
  });

  it("flags invalid ST instruction write targets and simple tag type mismatches", () => {
    const findings = instructionFindings(`
MOV(Source := 5, Dest => 7);
ADD(SourceA := Level, SourceB := 1, Dest => Temp + 1);
TON(Level, 100);
`);
    const text = findings.map((finding) => finding.message).join("\n");

    expect(text).toContain('MOV operand "dest" must be a writable tag path, not "7"');
    expect(text).toContain('ADD operand "dest" must be a writable tag path, not "Temp+1"');
    expect(text).toContain('TON operand "timer" expects TIMER, but tag "Level" is DINT');
  });

  it("infers ST instruction operand types through members, arrays, and program-qualified paths", () => {
    const findings = instructionFindings(`
TON(Unit.Timer, 100);
TON(Unit.TimerSlots[1], 100);
TON(TimerArray[0], 100);
TON(Program:RemoteProgram.RemoteUnit.Timer, 100);
TON(Timer1.ACC, 100);
TON(Unit.Speed, 100);
TON(Program:RemoteProgram.RemoteLevel, 100);
`);
    const text = findings.map((finding) => finding.message).join("\n");

    expect(text).not.toContain("Unit.Timer");
    expect(text).not.toContain("Unit.TimerSlots[1]");
    expect(text).not.toContain("TimerArray[0]");
    expect(text).not.toContain("RemoteUnit.Timer");
    expect(text).toContain('TON operand "timer" expects TIMER, but tag "Timer1.ACC" is DINT');
    expect(text).toContain('TON operand "timer" expects TIMER, but tag "Unit.Speed" is DINT');
    expect(text).toContain('TON operand "timer" expects TIMER, but tag "Program:RemoteProgram.RemoteLevel" is DINT');
  });

  it("resolves ST instruction operand types through alias chains and alias suffixes", () => {
    const findings = instructionFindings(`
TON(AliasTimer, 100);
TON(AliasUnit.Timer, 100);
TON(AliasChainTimer, 100);
TON(AliasRemoteTimer, 100);
TON(LocalAliasTimer, 100);
TON(Program:RemoteProgram.RemoteAliasTimer, 100);
TON(AliasTimerStatus, 100);
TON(AliasTimer.ACC, 100);
`);
    const text = findings.map((finding) => finding.message).join("\n");

    expect(text).not.toContain('tag "AliasTimer"');
    expect(text).not.toContain("AliasUnit.Timer");
    expect(text).not.toContain("AliasChainTimer");
    expect(text).not.toContain("AliasRemoteTimer");
    expect(text).not.toContain("LocalAliasTimer");
    expect(text).not.toContain("RemoteAliasTimer");
    expect(text).toContain('TON operand "timer" expects TIMER, but tag "AliasTimerStatus" is DINT');
    expect(text).toContain('TON operand "timer" expects TIMER, but tag "AliasTimer.ACC" is DINT');
  });

  it("accepts omitted optional operands in registered Structured Text instruction calls", () => {
    const findings = instructionFindings(`
SQO(SeqArray, 16#FFFF, SeqDest, SeqCtl, 3);
SQO(SeqArray, 16#FFFF, SeqDest, SeqCtl, 3, );
SQO(Array := SeqArray, Mask := 16#FFFF, Dest => SeqDest, Control => SeqCtl, Length := 3);
SQO(Array := SeqArray, Mask := 16#FFFF, Dest => SeqDest, Control => SeqCtl, Length := 3, Position => SeqPos);
FFL(Level, Fifo, SeqCtl, 3, );
ARD(Channel, Message, );
`);

    expect(findings).toHaveLength(0);
  });

  it("reports model-only registered calls from Structured Text as review-only", () => {
    const findings = instructionFindings("MSG(MessageCtrl);");

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("model-only-instruction");
    expect(findings[0].message).toContain("MSG is recognized but model-only");
    expect(findings[0].message).toContain("fidelity: Model-only");
  });

  it("accepts OSRI/OSFI FBD_ONESHOT calls and rejects bad scalar operands", () => {
    const ok = instructionFindings(`
OSRI(Shot);
OSFI(Shot);
`);
    expect(ok).toHaveLength(0);

    const bad = instructionFindings("OSRI(RunFlag);");
    expect(bad.some((finding) => finding.ruleId === "operand-type-mismatch" && finding.message.includes("FBD_ONESHOT"))).toBe(true);
    expect(bad.some((finding) => finding.ruleId === "model-only-instruction")).toBe(false);
  });
});
