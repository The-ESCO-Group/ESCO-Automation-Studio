import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

/**
 * Offline-simulation coverage for STRING operands on the relational/equality
 * comparators EQU/NEQ/GRT/LES/LEQ/GEQ (move-compare.ts). A controller dispatches
 * these on the operand's data type and compares STRING operands character by
 * character; the numeric-only comparators in basic-math.test.ts pin the numeric
 * path, while this suite pins the string path and the inference that selects it.
 *
 * The regression guarded here: under plain numeric coercion every non-numeric
 * string reads as 0, so any two distinct strings (e.g. "OPEN" vs "CLOSED") would
 * compare equal — silently wrong. String-aware comparison keeps them distinct.
 */

const registry = createDefaultRegistry();

/** Build a `type(sourceA, sourceB)` rung gating an OTE coil and return the coil state. */
function compareCoil(
  type: string,
  sourceA: string,
  sourceB: string,
  seed?: Record<string, string>,
): boolean {
  const routine = createLadderRoutine();
  routine.rungs.push(
    createRung(routine.id, 0, [
      createNode(type, [tagOperand("sourceA", sourceA), tagOperand("sourceB", sourceB)]),
      createNode("OTE", [tagOperand("tag", "Coil")]),
    ]),
  );
  const runtime = new PlcRuntime(registry);
  runtime.loadRoutine(routine);
  for (const [tag, value] of Object.entries(seed ?? {})) runtime.writeTag(tag, value);
  runtime.scanOnce(0);
  return runtime.readTag("Coil") === true;
}

function cmpExpressionCoil(expression: string, seed: Record<string, string>): boolean {
  const routine = createLadderRoutine();
  routine.rungs.push(
    createRung(routine.id, 0, [
      createNode("CMP", [tagOperand("expression", expression)]),
      createNode("OTE", [tagOperand("tag", "Coil")]),
    ]),
  );
  const runtime = new PlcRuntime(registry);
  runtime.loadRoutine(routine);
  for (const [tag, value] of Object.entries(seed)) runtime.writeTag(tag, value);
  runtime.scanOnce(0);
  return runtime.readTag("Coil") === true;
}

describe("relational comparators over STRING operands", () => {
  it("compares a STRING tag against a quoted string literal", () => {
    // The classic state check: EQU(State, 'RUNNING').
    expect(compareCoil("EQU", "State", "'RUNNING'", { State: "RUNNING" })).toBe(true);
    expect(compareCoil("EQU", "State", "'RUNNING'", { State: "STOPPED" })).toBe(false);
    expect(compareCoil("NEQ", "State", "'RUNNING'", { State: "STOPPED" })).toBe(true);
    // The literal may be on either source, and double quotes work too.
    expect(compareCoil("EQU", "\"RUNNING\"", "State", { State: "RUNNING" })).toBe(true);
  });

  it("does not coerce distinct STRING tags to equal numbers (the pre-fix bug)", () => {
    expect(compareCoil("EQU", "A", "B", { A: "OPEN", B: "CLOSED" })).toBe(false);
    expect(compareCoil("NEQ", "A", "B", { A: "OPEN", B: "CLOSED" })).toBe(true);
    expect(compareCoil("EQU", "A", "B", { A: "OPEN", B: "OPEN" })).toBe(true);
  });

  it("orders strings lexicographically by character (GRT/LES/GEQ/LEQ)", () => {
    expect(compareCoil("LES", "'APPLE'", "'BANANA'")).toBe(true);
    expect(compareCoil("GRT", "'BANANA'", "'APPLE'")).toBe(true);
    expect(compareCoil("LES", "'AB'", "'ABC'")).toBe(true); // a prefix is "less"
    expect(compareCoil("GEQ", "'ABC'", "'ABC'")).toBe(true);
    expect(compareCoil("LEQ", "'ABC'", "'ABC'")).toBe(true);
  });

  it("keeps comparing two numeric operands numerically", () => {
    // Numeric literals never trigger string mode: 9 < 10, even though "9" > "10".
    expect(compareCoil("LES", "9", "10")).toBe(true);
    // Numeric-valued tags read as finite numbers, so they stay on the numeric path.
    expect(compareCoil("GRT", "A", "B", { A: "12", B: "3" })).toBe(true);
  });

  it("executes CMP expressions that compare two STRING tags", () => {
    expect(cmpExpressionCoil("Have = Want", { Have: "RUN", Want: "RUN" })).toBe(true);
    expect(cmpExpressionCoil("Have = Want", { Have: "IDLE", Want: "RUN" })).toBe(false);
    expect(cmpExpressionCoil("(Have < Want)", { Have: "IDLE", Want: "RUN" })).toBe(true);
    expect(cmpExpressionCoil("Have <> Want", { Have: "IDLE", Want: "RUN" })).toBe(true);
  });
});
