import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand, type LadderNode } from "@esco/ladder";
import { createDefaultEngine } from "./index";

const REVIEW_RULES = new Set([
  "model-only-instruction",
  "missing-operand",
  "undefined-tag",
  "invalid-write-target",
  "operand-type-mismatch",
]);

function projectWithNodes(nodes: LadderNode[], tags: { name: string; type: string }[] = []) {
  const project = createProject("ModelOnlyReview");
  const controller = createController(project.id, "Ctrl");
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "MainRoutine", "ladder");
  const ladder = createLadderRoutine();

  program.mainRoutineId = routine.id;
  ladder.rungs.push(createRung(ladder.id, 0, nodes));
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  for (const tag of tags) controller.controllerTags.push(createTag(controller.id, tag.name, tag.type));
  project.controllers.push(controller);
  return project;
}

function reviewFindings(nodes: LadderNode[], tags: { name: string; type: string }[] = []) {
  return createDefaultEngine()
    .run(projectWithNodes(nodes, tags))
    .filter((finding) => REVIEW_RULES.has(finding.ruleId));
}

describe("model-only review operand validation", () => {
  it("type-checks opted-in process loop backing tags while preserving model-only status", () => {
    const findings = reviewFindings(
      [
        createNode("PID", [tagOperand("loop", "LoopDint")]),
        createNode("PID", [tagOperand("loop", "PidLoop")]),
      ],
      [
        { name: "LoopDint", type: "DINT" },
        { name: "PidLoop", type: "PID" },
      ],
    );

    expect(findings.filter((finding) => finding.ruleId === "model-only-instruction")).toHaveLength(2);
    expect(findings.some((finding) =>
      finding.ruleId === "operand-type-mismatch" &&
      finding.message.includes('PID operand "loop" expects PID') &&
      finding.message.includes('"LoopDint" is DINT'),
    )).toBe(true);
    expect(findings.some((finding) =>
      finding.ruleId === "operand-type-mismatch" &&
      finding.message.includes("PidLoop"),
    )).toBe(false);
  });

  it("checks PhaseManager phase and request-control backing tag types", () => {
    const findings = reviewFindings(
      [
        createNode("PCMD", [tagOperand("phase", "MixerPhase")]),
        createNode("PXRQ", [tagOperand("phaseInstruction", "MixerPhase")]),
        createNode("PXRQ", [tagOperand("phaseInstruction", "PhaseReq")]),
      ],
      [
        { name: "MixerPhase", type: "EQUIPMENT_PHASE" },
        { name: "PhaseReq", type: "PHASE_INSTRUCTION" },
      ],
    );

    expect(findings.filter((finding) => finding.ruleId === "model-only-instruction")).toHaveLength(3);
    expect(findings.some((finding) =>
      finding.ruleId === "operand-type-mismatch" &&
      finding.message.includes('PXRQ operand "phaseInstruction" expects PHASE_INSTRUCTION') &&
      finding.message.includes('"MixerPhase" is EQUIPMENT_PHASE'),
    )).toBe(true);
    expect(findings.some((finding) =>
      finding.ruleId === "operand-type-mismatch" &&
      finding.message.includes("PhaseReq"),
    )).toBe(false);
  });

  it("flags missing, literal, and undefined safety backing operands", () => {
    const findings = reviewFindings([
      createNode("ESTOP", []),
      createNode("DIN", [tagOperand("safety", "5")]),
      createNode("RESET", [tagOperand("safety", "GhostSafety")]),
    ]);

    expect(findings.filter((finding) => finding.ruleId === "model-only-instruction")).toHaveLength(3);
    expect(findings.some((finding) =>
      finding.ruleId === "missing-operand" &&
      finding.message.includes('ESTOP is missing required model-only review operand "safety"'),
    )).toBe(true);
    expect(findings.some((finding) =>
      finding.ruleId === "invalid-write-target" &&
      finding.message.includes('DIN operand "safety" must be a writable tag, not the literal "5"'),
    )).toBe(true);
    expect(findings.some((finding) =>
      finding.ruleId === "undefined-tag" &&
      finding.message.includes('Undefined tag "GhostSafety"'),
    )).toBe(true);
  });

  it("type-checks opted-in safety backing tags while preserving review-only status", () => {
    const findings = reviewFindings(
      [
        createNode("ESTOP", [tagOperand("safety", "EStop1")]),
        createNode("DCS", [tagOperand("safety", "EStop1")]),
        createNode("DCS", [tagOperand("safety", "DoorGate")]),
        createNode("ROUT", [tagOperand("safety", "SafeOutput")]),
      ],
      [
        { name: "EStop1", type: "ESTOP" },
        { name: "DoorGate", type: "DCS" },
        { name: "SafeOutput", type: "ROUT" },
      ],
    );

    expect(findings.filter((finding) => finding.ruleId === "model-only-instruction")).toHaveLength(4);
    expect(findings.some((finding) =>
      finding.ruleId === "operand-type-mismatch" &&
      finding.message.includes('DCS operand "safety" expects DCS') &&
      finding.message.includes('"EStop1" is ESTOP'),
    )).toBe(true);
    expect(findings.some((finding) =>
      finding.ruleId === "operand-type-mismatch" &&
      finding.message.includes("DoorGate"),
    )).toBe(false);
    expect(findings.some((finding) =>
      finding.ruleId === "operand-type-mismatch" &&
      finding.message.includes("SafeOutput"),
    )).toBe(false);
  });
});
