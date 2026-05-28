import { describe, expect, it } from "vitest";
import {
  createDefaultRegistry,
  isNumericLiteral,
  type InstructionRuntimeContext,
} from "@esco/instructions";
import {
  addRung,
  appendInstruction,
  createLadderRoutine,
  createNode,
  createRung,
  setOperandValue,
  tagOperand,
  type LadderRung,
} from "@esco/ladder";
import { TagMemory } from "./tag-memory";
import { RungExecutor } from "./rung-executor";
import { collectOutputTags, createRuntime } from "./build";
import type { TagDescriptor } from "./runtime";
import { buildDemoLadderRoutine, createDemoRuntime } from "./demo";

const registry = createDefaultRegistry();

/** A runtime context backed by a real TagMemory, as the executor builds one. */
function contextFor(
  memory: TagMemory,
  rungIn: boolean,
  deltaMs = 0,
): InstructionRuntimeContext {
  return {
    rungIn,
    deltaMs,
    readBool: (path) => memory.readBool(path),
    writeBool: (path, value) => memory.writeBool(path, value),
    readNumber: (path) => memory.readNumber(path),
    writeNumber: (path, value) => memory.write(path, value),
    numeric: (operand) =>
      isNumericLiteral(operand) ? Number(operand.trim()) : memory.readNumber(operand.trim()),
  };
}

/** Build a one-rung routine from raw nodes, for executing a small ladder. */
function singleRung(nodes: ReturnType<typeof createNode>[]): LadderRung {
  const routine = createLadderRoutine();
  return createRung(routine.id, 0, nodes);
}

const node = (type: string, ...operands: string[]) =>
  createNode(type, operands.map((value, i) => tagOperand(`op${i}`, value)));

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

describe("MOV - Move", () => {
  const mov = registry.get("MOV")!;

  it("copies Source to Dest when the rung is true", () => {
    const memory = new TagMemory();
    mov.execute(node("MOV", "123", "Dest"), contextFor(memory, true));
    expect(memory.readNumber("Dest")).toBe(123);
  });

  it("does nothing when the rung is false", () => {
    const memory = new TagMemory();
    memory.write("Dest", 7);
    mov.execute(node("MOV", "123", "Dest"), contextFor(memory, false));
    expect(memory.readNumber("Dest")).toBe(7);
  });

  it("resolves a tag source", () => {
    const memory = new TagMemory();
    memory.write("Src", 42);
    mov.execute(node("MOV", "Src", "Dest"), contextFor(memory, true));
    expect(memory.readNumber("Dest")).toBe(42);
  });
});

describe("EQU / GRT / LES - comparisons", () => {
  const run = (type: string, a: string, b: string, rungIn = true) =>
    registry.get(type)!.execute(node(type, a, b), contextFor(new TagMemory(), rungIn));

  it("EQU passes when A == B", () => {
    expect(run("EQU", "5", "5")).toBe(true);
    expect(run("EQU", "5", "6")).toBe(false);
  });

  it("GRT passes when A > B", () => {
    expect(run("GRT", "6", "5")).toBe(true);
    expect(run("GRT", "5", "6")).toBe(false);
  });

  it("LES passes when A < B", () => {
    expect(run("LES", "4", "5")).toBe(true);
    expect(run("LES", "5", "4")).toBe(false);
  });

  it("never passes when the rung is already false", () => {
    expect(run("EQU", "5", "5", false)).toBe(false);
  });
});

describe("TON - Timer On Delay", () => {
  const ton = registry.get("TON")!;

  it("accumulates time and sets DN when ACC >= PRE", () => {
    const memory = new TagMemory();
    ton.execute(node("TON", "Timer1", "3000"), contextFor(memory, true, 1000));
    expect(memory.readNumber("Timer1.ACC")).toBe(1000);
    expect(memory.readBool("Timer1.EN")).toBe(true);
    expect(memory.readBool("Timer1.TT")).toBe(true);
    expect(memory.readBool("Timer1.DN")).toBe(false);

    ton.execute(node("TON", "Timer1", "3000"), contextFor(memory, true, 1000));
    ton.execute(node("TON", "Timer1", "3000"), contextFor(memory, true, 1000));
    expect(memory.readNumber("Timer1.ACC")).toBe(3000);
    expect(memory.readBool("Timer1.DN")).toBe(true);
    expect(memory.readBool("Timer1.TT")).toBe(false);
  });

  it("resets when the rung goes false (non-retentive)", () => {
    const memory = new TagMemory();
    ton.execute(node("TON", "Timer1", "3000"), contextFor(memory, true, 1000));
    ton.execute(node("TON", "Timer1", "3000"), contextFor(memory, false, 1000));
    expect(memory.readNumber("Timer1.ACC")).toBe(0);
    expect(memory.readBool("Timer1.EN")).toBe(false);
    expect(memory.readBool("Timer1.TT")).toBe(false);
    expect(memory.readBool("Timer1.DN")).toBe(false);
  });
});

describe("CTU - Count Up", () => {
  const ctu = registry.get("CTU")!;

  it("increments only on a false-to-true transition", () => {
    const memory = new TagMemory();
    ctu.execute(node("CTU", "Counter1", "2"), contextFor(memory, true));
    expect(memory.readNumber("Counter1.ACC")).toBe(1);
    // Held true — no new edge, no increment.
    ctu.execute(node("CTU", "Counter1", "2"), contextFor(memory, true));
    expect(memory.readNumber("Counter1.ACC")).toBe(1);
    // Falling then rising edge — increments again and reaches PRE.
    ctu.execute(node("CTU", "Counter1", "2"), contextFor(memory, false));
    ctu.execute(node("CTU", "Counter1", "2"), contextFor(memory, true));
    expect(memory.readNumber("Counter1.ACC")).toBe(2);
    expect(memory.readBool("Counter1.DN")).toBe(true);
  });
});

describe("Integration - XIC(StartPB) TON(Timer1, 3000)", () => {
  it("scans until Timer1.DN becomes true", () => {
    const rung = singleRung([
      node("XIC", "StartPB"),
      node("TON", "Timer1", "3000"),
    ]);
    const executor = new RungExecutor(registry);
    const memory = new TagMemory();
    memory.writeBool("StartPB", true);

    let scans = 0;
    while (!memory.readBool("Timer1.DN") && scans < 100) {
      executor.execute(rung, memory, 500); // advance 500ms per scan
      scans += 1;
    }
    expect(memory.readBool("Timer1.DN")).toBe(true);
    expect(memory.readNumber("Timer1.ACC")).toBe(3000);
    expect(scans).toBe(6); // 6 * 500ms = 3000ms
  });
});

describe("Integration - XIC(StartPB) MOV(123, SomeDint)", () => {
  it("moves the value only while StartPB is true", () => {
    const rung = singleRung([
      node("XIC", "StartPB"),
      node("MOV", "123", "SomeDint"),
    ]);
    const executor = new RungExecutor(registry);
    const memory = new TagMemory();

    executor.execute(rung, memory); // StartPB false -> MOV inhibited
    expect(memory.readNumber("SomeDint")).toBe(0);

    memory.writeBool("StartPB", true);
    executor.execute(rung, memory);
    expect(memory.readNumber("SomeDint")).toBe(123);
  });
});
