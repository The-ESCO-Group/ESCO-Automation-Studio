import { describe, expect, it } from "vitest";
import { PlcRuntime } from "@esco/simulator";
import { createLogicBlock } from "./logic-templates";
import type { SimIdCounter } from "./ids";
import type { SimLogicBlock } from "./types";

function counter(): SimIdCounter {
  return { _idSeq: 0 };
}

function runtimeFor(block: SimLogicBlock): PlcRuntime {
  const rt = new PlcRuntime();
  for (const spec of block.requiredTags) {
    rt.defineTag({ name: spec.name, dataType: spec.dataType, role: spec.role, initialValue: spec.initial });
  }
  rt.loadRoutine(block.routine);
  rt.start();
  return rt;
}

describe("ESCO logic templates run against virtual tags", () => {
  it("converts Celsius to Fahrenheit", () => {
    const block = createLogicBlock(counter(), "c-to-f", { celsius: "TempC", fahrenheit: "TempF" });
    const rt = runtimeFor(block);
    rt.writeTag("TempC", 100);
    rt.scanOnce(10);
    expect(rt.readTag("TempF")).toBeCloseTo(212, 5);
  });

  it("converts Fahrenheit to Celsius", () => {
    const block = createLogicBlock(counter(), "f-to-c", { fahrenheit: "TempF", celsius: "TempC" });
    const rt = runtimeFor(block);
    rt.writeTag("TempF", 212);
    rt.scanOnce(10);
    expect(rt.readTag("TempC")).toBeCloseTo(100, 5);
  });

  it("debounces an input over the configured stable-scan window", () => {
    const block = createLogicBlock(counter(), "debounce-input", { input: "In", output: "Out", stableScans: "3" });
    const rt = runtimeFor(block);
    rt.writeTag("In", true);
    rt.scanOnce(10);
    expect(rt.readTag("Out")).toBe(false);
    rt.scanOnce(10);
    expect(rt.readTag("Out")).toBe(false);
    rt.scanOnce(10);
    expect(rt.readTag("Out")).toBe(true);
    // Dropping the input resets immediately.
    rt.writeTag("In", false);
    rt.scanOnce(10);
    expect(rt.readTag("Out")).toBe(false);
  });

  it("counts rising edges with the start counter", () => {
    const block = createLogicBlock(counter(), "motor-start-counter", { run: "Run", starts: "Starts" });
    const rt = runtimeFor(block);
    rt.writeTag("Run", true);
    rt.scanOnce(10);
    expect(rt.readTag("Starts")).toBe(1);
    rt.scanOnce(10); // still true, no new edge
    expect(rt.readTag("Starts")).toBe(1);
    rt.writeTag("Run", false);
    rt.scanOnce(10);
    rt.writeTag("Run", true);
    rt.scanOnce(10);
    expect(rt.readTag("Starts")).toBe(2);
  });

  it("ANDs permissives into a ready output", () => {
    const block = createLogicBlock(counter(), "permissive-chain", { permissives: "A,B", output: "Ready" });
    const rt = runtimeFor(block);
    rt.writeTag("A", true);
    rt.writeTag("B", true);
    rt.scanOnce(10);
    expect(rt.readTag("Ready")).toBe(true);
    rt.writeTag("A", false);
    rt.scanOnce(10);
    expect(rt.readTag("Ready")).toBe(false);
  });

  it("triggers an alarm on an analog high limit", () => {
    const block = createLogicBlock(counter(), "alarm-trigger", { source: "PV", mode: "high", limit: "50", alarm: "Alm" });
    const rt = runtimeFor(block);
    rt.writeTag("PV", 60);
    rt.scanOnce(10);
    expect(rt.readTag("Alm")).toBe(true);
    rt.writeTag("PV", 40);
    rt.scanOnce(10);
    expect(rt.readTag("Alm")).toBe(false);
  });

  it("seals in a motor holding circuit and drops on stop or trip", () => {
    const block = createLogicBlock(counter(), "motor-holding-interlocks", {
      start: "StartPB",
      stop: "StopPB",
      runCmd: "RunCmd",
      trips: "Overload",
    });
    const rt = runtimeFor(block);
    rt.writeTag("StartPB", true);
    rt.scanOnce(10);
    expect(rt.readTag("RunCmd")).toBe(true);
    rt.writeTag("StartPB", false); // released — should seal in
    rt.scanOnce(10);
    expect(rt.readTag("RunCmd")).toBe(true);
    rt.writeTag("Overload", true); // trip
    rt.scanOnce(10);
    expect(rt.readTag("RunCmd")).toBe(false);
  });

  it("produces inspectable, deterministic metadata", () => {
    const a = createLogicBlock(counter(), "c-to-f", { celsius: "TempC", fahrenheit: "TempF" });
    const b = createLogicBlock(counter(), "c-to-f", { celsius: "TempC", fahrenheit: "TempF" });
    expect(a.id).toBe(b.id); // deterministic ids from a fresh counter
    expect(a.metadata.rungs).toHaveLength(2);
    expect(a.metadata.rungs[0]!.text).toContain("MUL");
  });
});
