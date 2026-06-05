import { describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine, createTag } from "@esco/core";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { createDefaultEngine } from "./index";

/**
 * A project whose Main routine references `path` via an XIC, with `tag` declared
 * at controller scope using the given declared data type.
 */
function projectBitRef(path: string, tag: { name: string; type: string }) {
  const project = createProject("BitCtl");
  const controller = createController(project.id, "BitCtl");
  controller.controllerTags.push(createTag(controller.id, tag.name, tag.type, { value: 0 }));
  const program = createProgram(controller.id, "MainProgram");
  const routine = createRoutine(program.id, "Main", "ladder");
  program.mainRoutineId = routine.id;
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(ladder.id, 0, [createNode("XIC", [tagOperand("tag", path)])]));
  routine.ladder = ladder;
  program.routines.push(routine);
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

const bitFindings = (project: ReturnType<typeof projectBitRef>) =>
  createDefaultEngine()
    .run(project)
    .filter((f) => f.ruleId === "bit-index-out-of-range" || f.ruleId === "invalid-bit-reference");

describe("bit-level addressing parity with Studio 5000 verify", () => {
  it("accepts an in-range bit on each integer width", () => {
    expect(bitFindings(projectBitRef("Flags.7", { name: "Flags", type: "SINT" }))).toEqual([]);
    expect(bitFindings(projectBitRef("Flags.15", { name: "Flags", type: "INT" }))).toEqual([]);
    expect(bitFindings(projectBitRef("Flags.31", { name: "Flags", type: "DINT" }))).toEqual([]);
    expect(bitFindings(projectBitRef("Flags.63", { name: "Flags", type: "LINT" }))).toEqual([]);
  });

  it("flags a bit number at or above the type's width", () => {
    const findings = bitFindings(projectBitRef("Status.32", { name: "Status", type: "DINT" }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe("bit-index-out-of-range");
    expect(findings[0]!.message).toContain("Bit 32 is out of range");
    expect(findings[0]!.message).toContain("bits 0–31");
  });

  it("uses the declared width, not the simulator's DINT storage, for smaller integers", () => {
    const findings = bitFindings(projectBitRef("Status.8", { name: "Status", type: "SINT" }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe("bit-index-out-of-range");
    expect(findings[0]!.message).toContain("SINT has bits 0–7");
  });

  it("flags bit access on a non-integer type", () => {
    const findings = bitFindings(projectBitRef("Level.3", { name: "Level", type: "REAL" }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe("invalid-bit-reference");
    expect(findings[0]!.message).toContain("bit access requires an integer type");
  });

  it("flags bit access on a BOOL (already a single bit)", () => {
    const findings = bitFindings(projectBitRef("Run.0", { name: "Run", type: "BOOL" }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe("invalid-bit-reference");
  });

  it("validates a bit on an integer member of a structured tag", () => {
    const findings = bitFindings(projectBitRef("Cycle.PRE.40", { name: "Cycle", type: "TIMER" }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe("bit-index-out-of-range");
    expect(findings[0]!.message).toContain("Cycle.PRE");
  });
});
