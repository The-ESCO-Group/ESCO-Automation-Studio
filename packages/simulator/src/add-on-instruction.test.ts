import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import type { AddOnInstruction, Routine } from "@esco/core";
import { PlcRuntime } from "./runtime";

/**
 * Add-On Instruction execution path: only an UNPROTECTED AOI with an imported
 * RLL (ladder) routine runs its logic offline. A source-protected AOI, or one
 * whose logic is non-ladder (ST / FBD / SFC), is never executed — it stays a
 * safe model-only pass-through that touches no tag memory. These tests lock in
 * that hardening boundary so a future change can't silently start "simulating"
 * logic the offline engine cannot faithfully reproduce.
 */

const registry = createDefaultRegistry();

/** A ladder routine that computes `Out = In + In` — the AOI's doubling logic. */
function doublerLogic(name: string): Routine {
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

/** Build a "doubler" AOI (In → Out = 2*In) with the given options. */
function doublerAoi(
  options: { name?: string; protected?: boolean; nonLadder?: boolean } = {},
): AddOnInstruction {
  const name = options.name ?? "DBL";
  const routine: Routine = options.nonLadder
    ? {
        id: `r-${name}`,
        programId: "p",
        name: "Logic",
        language: "structured-text",
        structuredText: "Out := In * 2;",
      }
    : doublerLogic("Logic");
  return {
    id: `aoi-${name}`,
    name,
    protected: options.protected,
    parameters: [
      { name: "In", dataType: "DINT", usage: "Input" },
      { name: "Out", dataType: "DINT", usage: "Output" },
    ],
    localTags: [],
    routineNames: ["Logic"],
    routines: [routine],
  };
}

/** A main routine that calls AOI `type` on instance `instance`, gated by `En`. */
function callerRoutine(type: string, instance: string) {
  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [
      createNode("XIC", [tagOperand("operand", "En")]),
      createNode(type, [tagOperand("instance", instance)]),
      createNode("OTE", [tagOperand("operand", "Done")]),
    ]),
  );
  return ladder;
}

describe("add-on-instruction execution", () => {
  it("runs an unprotected RLL AOI and copies its Output parameter back to the instance", () => {
    const rt = new PlcRuntime(registry);
    rt.loadAddOnInstructions([doublerAoi()]);
    rt.loadRoutine(callerRoutine("DBL", "DBL_01"));
    rt.writeTag("En", true);
    rt.writeTag("DBL_01.In", 21);

    rt.scanOnce(0);

    expect(rt.readTag("DBL_01.Out")).toBe(42);
    expect(rt.readTag("Done")).toBe(true); // rung condition passes through the AOI
  });

  it("does NOT execute a source-protected AOI, but still passes the rung condition through", () => {
    const rt = new PlcRuntime(registry);
    rt.loadAddOnInstructions([doublerAoi({ protected: true })]);
    rt.loadRoutine(callerRoutine("DBL", "DBL_01"));
    rt.writeTag("En", true);
    rt.writeTag("DBL_01.In", 21);

    rt.scanOnce(0);

    // Output untouched: protected logic is never reverse-engineered offline.
    expect(rt.readTag("DBL_01.Out")).not.toBe(42);
    expect(rt.readTag("Done")).toBe(true); // model-only pass-through energises downstream
  });

  it("does NOT execute a non-ladder (ST/FBD) AOI, but still passes the rung condition through", () => {
    const rt = new PlcRuntime(registry);
    rt.loadAddOnInstructions([doublerAoi({ nonLadder: true })]);
    rt.loadRoutine(callerRoutine("DBL", "DBL_01"));
    rt.writeTag("En", true);
    rt.writeTag("DBL_01.In", 21);

    rt.scanOnce(0);

    expect(rt.readTag("DBL_01.Out")).not.toBe(42);
    expect(rt.readTag("Done")).toBe(true);
  });

  it("only runs the AOI while its calling rung is true", () => {
    const rt = new PlcRuntime(registry);
    rt.loadAddOnInstructions([doublerAoi()]);
    rt.loadRoutine(callerRoutine("DBL", "DBL_01"));
    rt.writeTag("En", false);
    rt.writeTag("DBL_01.In", 21);

    rt.scanOnce(0);

    expect(rt.readTag("DBL_01.Out")).not.toBe(42); // rung false → AOI not invoked
    expect(rt.readTag("Done")).toBe(false);
  });

  it("keeps each AOI instance's data independent", () => {
    const rt = new PlcRuntime(registry);
    rt.loadAddOnInstructions([doublerAoi()]);
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [createNode("DBL", [tagOperand("instance", "A")])]),
      createRung(ladder.id, 1, [createNode("DBL", [tagOperand("instance", "B")])]),
    );
    rt.loadRoutine(ladder);
    rt.writeTag("A.In", 5);
    rt.writeTag("B.In", 10);

    rt.scanOnce(0);

    expect(rt.readTag("A.Out")).toBe(10);
    expect(rt.readTag("B.Out")).toBe(20);
  });

  it("terminates a self-referential (recursive) AOI via the call-depth guard", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("ADD", [tagOperand("a", "In"), tagOperand("b", "In"), tagOperand("dest", "Out")]),
        createNode("REC", [tagOperand("instance", "Rec_inner")]),
      ]),
    );
    const recursive: AddOnInstruction = {
      id: "aoi-REC",
      name: "REC",
      parameters: [
        { name: "In", dataType: "DINT", usage: "Input" },
        { name: "Out", dataType: "DINT", usage: "Output" },
      ],
      localTags: [],
      routineNames: ["Logic"],
      routines: [{ id: "r-REC", programId: "p", name: "Logic", language: "ladder", ladder }],
    };

    const rt = new PlcRuntime(registry);
    rt.loadAddOnInstructions([recursive]);
    rt.loadRoutine(callerRoutine("REC", "Rec_01"));
    rt.writeTag("En", true);
    rt.writeTag("Rec_01.In", 3);

    // The depth guard caps recursion: the scan must terminate (no hang / stack
    // overflow) and leave a finite, defined value rather than crashing. The exact
    // output isn't a guarantee — nested same-AOI calls share the unqualified
    // parameter tags (In/Out), so recursion clobbers the doubling result.
    expect(() => rt.scanOnce(0)).not.toThrow();
    expect(Number.isFinite(rt.readTag("Rec_01.Out") as number)).toBe(true);
  });
});
