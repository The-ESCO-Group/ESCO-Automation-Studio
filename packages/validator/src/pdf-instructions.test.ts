import { describe, expect, it } from "vitest";
import {
  createController,
  createProgram,
  createProject,
  createRoutine,
  createTag,
  type PlcProject,
} from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand, type LadderNode } from "@esco/ladder";
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

const node = (type: string, ...operands: [string, string][]) =>
  createNode(type, operands.map(([name, value]) => tagOperand(name, value)));

describe("PDF instructions are recognized by the validator (not unsupported)", () => {
  it("an executable compare alias with valid operands produces no unsupported/error finding", () => {
    const project = projectWithNodes(
      [node("EQ", ["sourceA", "A"], ["sourceB", "B"]), node("OTE", ["tag", "Out"])],
      [
        { name: "A", type: "DINT" },
        { name: "B", type: "DINT" },
        { name: "Out", type: "BOOL" },
      ],
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "unsupported-instruction")).toBe(false);
    expect(findings.some((f) => f.severity === "error")).toBe(false);
  });

  it("model-only variants report a model-only info finding, never unsupported", () => {
    const project = projectWithNodes(
      [
        node("XIC", ["tag", "In"]),
        node("TONR", ["timer", "T"], ["preset", "1000"]),
        node("CTUD", ["counter", "C"], ["preset", "5"]),
        node("OSRI", ["shot", "Shot"]),
        node("REF"),
        node("JXR", ["routine", "ExtRtn"]),
      ],
      [
        { name: "In", type: "BOOL" },
        { name: "Shot", type: "FBD_ONESHOT" },
      ],
    );
    const findings = createDefaultEngine().run(project);
    expect(findings.some((f) => f.ruleId === "unsupported-instruction")).toBe(false);
    expect(findings.some((f) => f.severity === "error")).toBe(false);
    expect(findings.some((f) => f.ruleId === "model-only-instruction" && f.message.includes("OSRI"))).toBe(false);
    const modelOnly = findings.filter((f) => f.ruleId === "model-only-instruction");
    for (const type of ["TONR", "CTUD", "REF", "JXR"]) {
      expect(modelOnly.some((f) => f.message.includes(type)), `${type} model-only info`).toBe(true);
    }
  });

  it("no PDF candidate is ever flagged unsupported-instruction", () => {
    const candidates = [
      "MOVE", "LIMIT",
      "EQ", "NE", "GT", "GE", "LT", "LE",
      "ACOS", "ASIN", "ATAN", "ATAN2", "EXPT", "TRUNC", "SQRT",
      "TO_BCD", "BCD_TO",
      "BAND", "BOR", "BXOR", "BNOT",
      "TONR", "TOFR", "RTOR", "CTUD", "OSRI", "OSFI", "BTDT", "MVMT",
      "ASO", "BPT", "TPT", "LV", "JXR", "REF", "UNK",
    ];
    for (const type of candidates) {
      const project = projectWithNodes([node(type)], []);
      const findings = createDefaultEngine().run(project);
      const unsupported = findings.filter(
        (f) => f.ruleId === "unsupported-instruction" && f.message.includes(type),
      );
      expect(unsupported, `${type} must not be unsupported`).toHaveLength(0);
    }
  });
});
