import { describe, expect, it } from "vitest";
import {
  createDefaultRegistry,
  type InstructionRuntimeContext,
} from "@esco/instructions";
import {
  addRung,
  appendInstruction,
  createLadderRoutine,
  createNode,
  setOperandValue,
  tagOperand,
} from "@esco/ladder";
import { TagMemory } from "./tag-memory";
import { RungExecutor } from "./rung-executor";
import { collectOutputTags, createRuntime } from "./build";
import type { TagDescriptor } from "./runtime";
import { buildDemoLadderRoutine, createDemoRuntime } from "./demo";

const registry = createDefaultRegistry();

/** A runtime context backed by a real TagMemory, as the executor builds one. */
function contextFor(memory: TagMemory, rungIn: boolean): InstructionRuntimeContext {
  return {
    rungIn,
    readBool: (path) => memory.readBool(path),
    writeBool: (path, value) => memory.writeBool(path, value),
  };
}

describe("XIC - Examine If Closed", () => {
  const xic = registry.get("XIC")!;
  const node = createNode("XIC", [tagOperand("tag", "A")]);

  it("passes when the tag is true and rung is in", () => {
    const memory = new TagMemory();
    memory.writeBool("A", true);
    expect(xic.execute(node, contextFor(memory, true))).toBe(true);
  });

  it("does not pass when the tag is false", () => {
    const memory = new TagMemory();
    memory.writeBool("A", false);
    expect(xic.execute(node, contextFor(memory, true))).toBe(false);
  });

  it("cannot pass when rung-in is already false", () => {
    const memory = new TagMemory();
    memory.writeBool("A", true);
    expect(xic.execute(node, contextFor(memory, false))).toBe(false);
  });
});

describe("XIO - Examine If Open", () => {
  const xio = registry.get("XIO")!;
  const node = createNode("XIO", [tagOperand("tag", "A")]);

  it("passes when the tag is false and rung is in", () => {
    const memory = new TagMemory();
    memory.writeBool("A", false);
    expect(xio.execute(node, contextFor(memory, true))).toBe(true);
  });

  it("does not pass when the tag is true", () => {
    const memory = new TagMemory();
    memory.writeBool("A", true);
    expect(xio.execute(node, contextFor(memory, true))).toBe(false);
  });

  it("cannot pass when rung-in is already false", () => {
    const memory = new TagMemory();
    memory.writeBool("A", false);
    expect(xio.execute(node, contextFor(memory, false))).toBe(false);
  });
});

describe("OTE - Output Energize", () => {
  const ote = registry.get("OTE")!;
  const node = createNode("OTE", [tagOperand("tag", "Out")]);

  it("writes true to its tag when the rung is true", () => {
    const memory = new TagMemory();
    expect(ote.execute(node, contextFor(memory, true))).toBe(true);
    expect(memory.readBool("Out")).toBe(true);
  });

  it("writes false to its tag when the rung is false", () => {
    const memory = new TagMemory();
    memory.writeBool("Out", true);
    expect(ote.execute(node, contextFor(memory, false))).toBe(false);
    expect(memory.readBool("Out")).toBe(false);
  });
});

describe("RungExecutor - seal-in motor starter", () => {
  const executor = new RungExecutor(registry);
  const [rung] = buildDemoLadderRoutine().rungs;

  /** Scan the rung once against persistent memory; return MotorRun afterwards. */
  function scan(memory: TagMemory): boolean {
    executor.execute(rung, memory);
    return memory.readBool("MotorRun");
  }

  it("energizes MotorRun when StartPB=true and StopPB=false", () => {
    const memory = new TagMemory();
    memory.writeBool("StartPB", true);
    expect(scan(memory)).toBe(true);
  });

  it("seals in: MotorRun stays on after StartPB is released", () => {
    const memory = new TagMemory();
    memory.writeBool("StartPB", true);
    expect(scan(memory)).toBe(true); // latched on

    memory.writeBool("StartPB", false); // release the start button
    expect(scan(memory)).toBe(true); // held by the seal-in branch
  });

  it("StopPB drops MotorRun and the seal-in cannot re-latch it", () => {
    const memory = new TagMemory();
    memory.writeBool("StartPB", true);
    scan(memory); // on
    memory.writeBool("StartPB", false);

    memory.writeBool("StopPB", true);
    expect(scan(memory)).toBe(false); // stop breaks the rung

    memory.writeBool("StopPB", false); // release stop, start still off
    expect(scan(memory)).toBe(false); // stays off — seal-in was broken
  });

  it("does not start from the seal-in branch alone (MotorRun off, no Start)", () => {
    const memory = new TagMemory();
    expect(scan(memory)).toBe(false);
  });
});

describe("PlcRuntime.scanOnce - seal-in across scans", () => {
  it("latches and unlatches like a real motor starter", () => {
    const runtime = createDemoRuntime();
    expect(runtime.readTag("MotorRun")).toBe(false); // power-up

    // Press Start (Stop clear) -> motor runs.
    runtime.writeTag("StartPB", true);
    runtime.scanOnce();
    expect(runtime.readTag("MotorRun")).toBe(true);

    // Release Start -> motor stays running (sealed in).
    runtime.writeTag("StartPB", false);
    runtime.scanOnce();
    expect(runtime.readTag("MotorRun")).toBe(true);

    // Press Stop -> motor drops.
    runtime.writeTag("StopPB", true);
    runtime.scanOnce();
    expect(runtime.readTag("MotorRun")).toBe(false);

    // Release Stop with Start off -> motor stays off.
    runtime.writeTag("StopPB", false);
    runtime.scanOnce();
    expect(runtime.readTag("MotorRun")).toBe(false);

    // Reset returns every tag to its power-up value.
    runtime.reset();
    expect(runtime.readTag("StartPB")).toBe(false);
    expect(runtime.readTag("StopPB")).toBe(false);
    expect(runtime.readTag("MotorRun")).toBe(false);
  });

  it("classifies MotorRun as an output and the push buttons as inputs", () => {
    const runtime = createDemoRuntime();
    const roleOf = (name: string) =>
      runtime.tags().find((t) => t.name === name)?.role;

    expect(roleOf("StartPB")).toBe("input");
    expect(roleOf("StopPB")).toBe("input");
    expect(roleOf("MotorRun")).toBe("output");
  });
});

describe("Edited ladder execution (editor pipeline)", () => {
  const inputs = (...names: string[]): TagDescriptor[] =>
    names.map((name) => ({
      name,
      dataType: "BOOL",
      role: "input" as const,
      initialValue: false,
    }));

  it("builds and runs XIC(StartPB) XIO(StopPB) OTE(MotorRun) from edit helpers", () => {
    let routine = addRung(createLadderRoutine());
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "StartPB");
    routine = appendInstruction(routine, rungId, "XIO", "StopPB");
    routine = appendInstruction(routine, rungId, "OTE", "MotorRun");

    expect(collectOutputTags(routine, registry).has("MotorRun")).toBe(true);

    const runtime = createRuntime({
      registry,
      routine,
      tags: [
        ...inputs("StartPB", "StopPB"),
        { name: "MotorRun", dataType: "BOOL", role: "output", initialValue: false },
      ],
    });

    runtime.writeTag("StartPB", true);
    runtime.scanOnce();
    expect(runtime.readTag("MotorRun")).toBe(true);

    runtime.writeTag("StopPB", true);
    runtime.scanOnce();
    expect(runtime.readTag("MotorRun")).toBe(false);
  });

  it("reflects an edited operand tag name", () => {
    let routine = addRung(createLadderRoutine());
    const rungId = routine.rungs[0]!.id;
    routine = appendInstruction(routine, rungId, "XIC", "StartPB");
    routine = appendInstruction(routine, rungId, "OTE", "MotorRun");

    // Rename the XIC operand from StartPB -> Run.
    const xicId = routine.rungs[0]!.root.nodes[0]!.id;
    routine = setOperandValue(routine, rungId, xicId, "Run");

    const runtime = createRuntime({
      registry,
      routine,
      tags: [
        ...inputs("Run"),
        { name: "MotorRun", dataType: "BOOL", role: "output", initialValue: false },
      ],
    });

    runtime.writeTag("Run", true);
    runtime.scanOnce();
    expect(runtime.readTag("MotorRun")).toBe(true);
  });
});
