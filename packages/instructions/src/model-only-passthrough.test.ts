import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "./index";
import { supportLevel } from "./registry";
import type { InstructionDefinition, InstructionRuntimeContext } from "./types";

/**
 * Offline-safety invariant for the WHOLE model-only family.
 *
 * Every model-only instruction (process, motion, message, alarm, safety, phase,
 * sequencer-compare, ...) must have an execute that is a strict pass-through: it
 * returns the rung-in condition unchanged and never touches tag memory or any
 * scan mutator. Closed-loop / motion / messaging / alarm behaviour has no
 * controller-faithful offline execution, so faking any of it — even a single tag
 * write — would silently mislead an engineer reviewing logic offline.
 *
 * Existing tests (simulator/advanced-model-only.test.ts, the per-family
 * cross-reference tests, process-review-operands.test.ts) pin this for a
 * hand-maintained list of types. That list drifts as new model-only families are
 * registered. This test instead enumerates the entire default registry and holds
 * the contract for every `modelOnly` definition automatically — so a newly added
 * family that forgets the pass-through executor fails here immediately.
 */

/** A runtime context whose every mutator throws — any side effect fails the test. */
function strictContext(rungIn: boolean): InstructionRuntimeContext {
  const mustNotMutate = (label: string) => (): never => {
    throw new Error(`model-only instruction attempted a side effect: ${label}`);
  };
  return {
    rungIn,
    deltaMs: 10,
    readBool: () => false,
    writeBool: mustNotMutate("writeBool"),
    readNumber: () => 0,
    writeNumber: mustNotMutate("writeNumber"),
    readString: () => "",
    writeString: mustNotMutate("writeString"),
    numeric: () => 0,
    arrayDimension: () => undefined,
    callRoutine: mustNotMutate("callRoutine"),
    runFor: mustNotMutate("runFor"),
    requestReturn: mustNotMutate("requestReturn"),
    requestBreak: mustNotMutate("requestBreak"),
    requestJump: mustNotMutate("requestJump"),
    mcrActive: () => false,
    enterMcr: mustNotMutate("enterMcr"),
    exitMcr: mustNotMutate("exitMcr"),
  };
}

function sampleNode(def: InstructionDefinition) {
  return {
    id: `n-${def.type}`,
    instructionType: def.type,
    operands: def.operands.map((operand) => ({
      name: operand.name,
      kind: "tag" as const,
      value: `${def.type}_${operand.name}`,
    })),
  };
}

describe("model-only instructions: registry-wide pass-through invariant", () => {
  const registry = createDefaultRegistry();
  const modelOnly = registry.all().filter((def) => def.modelOnly);

  it("registers a non-trivial set of model-only instructions", () => {
    // Guards against the filter silently matching nothing (which would make
    // every assertion below vacuously pass).
    expect(modelOnly.length).toBeGreaterThan(10);
  });

  it("classifies every model-only instruction as support level 'model-only'", () => {
    for (const def of modelOnly) {
      expect(supportLevel(def), def.type).toBe("model-only");
    }
  });

  it("returns the rung-in condition unchanged and never mutates tag memory", () => {
    for (const def of modelOnly) {
      for (const rungIn of [true, false]) {
        const result = def.execute(sampleNode(def), strictContext(rungIn));
        expect(result, `${def.type} (rungIn=${rungIn})`).toBe(rungIn);
      }
    }
  });
});
