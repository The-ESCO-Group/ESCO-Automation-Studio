import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand, type LadderRoutine } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();

function node(type: string, operands: [string, string][]) {
  return createNode(type, operands.map(([name, value]) => tagOperand(name, value)));
}

/** Rung: DTR(Source, Mask, Reference) drives OTE(Out). */
function dtrRuntime(mask: string): { rt: PlcRuntime; enable: (on: boolean) => void } {
  const ladder: LadderRoutine = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [
      node("XIC", [["tag", "Enable"]]),
      node("DTR", [["source", "Source"], ["mask", mask], ["reference", "Ref"]]),
      node("OTE", [["tag", "Out"]]),
    ]),
  );
  const rt = new PlcRuntime(registry);
  rt.loadRoutine(ladder);
  rt.writeTag("Enable", true);
  return { rt, enable: (on: boolean) => rt.writeTag("Enable", on) };
}

describe("DTR - Data Transitional", () => {
  it("registers as an executable compare instruction (not model-only)", () => {
    expect(registry.has("DTR")).toBe(true);
    expect(registry.get("DTR")?.category).toBe("compare");
    expect(registry.get("DTR")?.modelOnly).toBeFalsy();
  });

  it("pulses true for one scan when the masked Source changes, then records it", () => {
    const { rt } = dtrRuntime("16#FFFF");
    rt.writeTag("Source", 0);
    rt.writeTag("Ref", 0);

    // Source matches Reference: no transition.
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(false);
    expect(rt.readTag("Ref")).toBe(0);

    // Source changes: true for exactly this scan, Reference captures the value.
    rt.writeTag("Source", 5);
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(true);
    expect(rt.readTag("Ref")).toBe(5);

    // Held: masked Source now equals Reference, so it clears.
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(false);

    // A further change pulses once more.
    rt.writeTag("Source", 9);
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(true);
    expect(rt.readTag("Ref")).toBe(9);
  });

  it("only compares the masked bits — changes outside the mask are ignored", () => {
    const { rt } = dtrRuntime("16#00FF");
    rt.writeTag("Source", 0);
    rt.writeTag("Ref", 0);
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(false);

    // Flip only bits above the mask: masked value is unchanged → no transition.
    rt.writeTag("Source", 0x0100);
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(false);
    expect(rt.readTag("Ref")).toBe(0);

    // Flip a masked bit: transition fires and Reference stores the masked value.
    rt.writeTag("Source", 0x0103);
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(true);
    expect(rt.readTag("Ref")).toBe(0x03);
  });

  it("does not update Reference while the rung is false", () => {
    const { rt, enable } = dtrRuntime("16#FFFF");
    rt.writeTag("Source", 7);
    rt.writeTag("Ref", 0);

    // Rung false: instruction false, Reference untouched even though Source differs.
    enable(false);
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(false);
    expect(rt.readTag("Ref")).toBe(0);

    // Re-enable: the still-pending change is detected on the first true scan.
    enable(true);
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(true);
    expect(rt.readTag("Ref")).toBe(7);
  });
});
