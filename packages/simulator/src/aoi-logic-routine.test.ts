import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import type { AddOnInstruction, Routine } from "@esco/core";
import { PlcRuntime } from "./runtime";

/**
 * An AOI's executable body is its routine named "Logic" — the routine the
 * controller scans every cycle. Prescan, Postscan, and EnableInFalseRoutine are
 * scan-phase helpers the offline engine never runs. Because the order routines
 * appear in an L5X is not guaranteed, the executor must pick "Logic" by name and
 * must not run whichever routine happens to be listed first. These tests lock in
 * that selection so a misordered export can't make the simulator execute the
 * wrong AOI body.
 */

const registry = createDefaultRegistry();

/** A ladder routine that writes `Out = constant` (a sentinel we can detect). */
function constantRoutine(name: string, constant: number): Routine {
  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [
      createNode("MOV", [tagOperand("source", String(constant)), tagOperand("dest", "Out")]),
    ]),
  );
  return { id: `r-${name}`, programId: "p", name, language: "ladder", ladder };
}

/** A ladder routine that computes `Out = In + In` — the real doubling body. */
function doublerRoutine(name: string): Routine {
  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [
      createNode("ADD", [
        tagOperand("sourceA", "In"),
        tagOperand("sourceB", "In"),
        tagOperand("dest", "Out"),
      ]),
    ]),
  );
  return { id: `r-${name}`, programId: "p", name, language: "ladder", ladder };
}

/** A "doubler" AOI whose routines are supplied (and ordered) by the caller. */
function doublerAoi(routines: Routine[]): AddOnInstruction {
  return {
    id: "aoi-DBL",
    name: "DBL",
    parameters: [
      { name: "In", dataType: "DINT", usage: "Input" },
      { name: "Out", dataType: "DINT", usage: "Output" },
    ],
    localTags: [],
    routineNames: routines.map((routine) => routine.name),
    routines,
  };
}

/** A main routine that calls AOI `type` on `instance`, gated by `En`. */
function callerRoutine(type: string, instance: string) {
  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [
      createNode("XIC", [tagOperand("operand", "En")]),
      createNode(type, [tagOperand("instance", instance)]),
    ]),
  );
  return ladder;
}

describe("add-on-instruction routine selection", () => {
  it('runs the routine named "Logic" even when it is not listed first', () => {
    const rt = new PlcRuntime(registry);
    // EnableInFalseRoutine is listed first and would clobber Out with a sentinel;
    // it must NOT run as the AOI body.
    rt.loadAddOnInstructions([
      doublerAoi([constantRoutine("EnableInFalseRoutine", 999), doublerRoutine("Logic")]),
    ]);
    rt.loadRoutine(callerRoutine("DBL", "DBL_01"));
    rt.writeTag("En", true);
    rt.writeTag("DBL_01.In", 21);

    rt.scanOnce(0);

    expect(rt.readTag("DBL_01.Out")).toBe(42);
  });

  it('matches the "Logic" routine case-insensitively', () => {
    const rt = new PlcRuntime(registry);
    rt.loadAddOnInstructions([
      doublerAoi([constantRoutine("Prescan", 999), doublerRoutine("logic")]),
    ]);
    rt.loadRoutine(callerRoutine("DBL", "DBL_01"));
    rt.writeTag("En", true);
    rt.writeTag("DBL_01.In", 5);

    rt.scanOnce(0);

    expect(rt.readTag("DBL_01.Out")).toBe(10);
  });

  it("falls back to the only ladder routine when none is named Logic", () => {
    const rt = new PlcRuntime(registry);
    rt.loadAddOnInstructions([doublerAoi([doublerRoutine("Body")])]);
    rt.loadRoutine(callerRoutine("DBL", "DBL_01"));
    rt.writeTag("En", true);
    rt.writeTag("DBL_01.In", 9);

    rt.scanOnce(0);

    expect(rt.readTag("DBL_01.Out")).toBe(18);
  });
});
