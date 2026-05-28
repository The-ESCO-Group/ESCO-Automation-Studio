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

describe("Expanded compares - NEQ / LEQ / GEQ", () => {
  const run = (type: string, a: string, b: string) =>
    registry.get(type)!.execute(node(type, a, b), contextFor(new TagMemory(), true));

  it("NEQ passes when A != B", () => {
    expect(run("NEQ", "5", "6")).toBe(true);
    expect(run("NEQ", "5", "5")).toBe(false);
  });

  it("LEQ passes when A <= B", () => {
    expect(run("LEQ", "5", "5")).toBe(true);
    expect(run("LEQ", "6", "5")).toBe(false);
  });

  it("GEQ passes when A >= B", () => {
    expect(run("GEQ", "5", "5")).toBe(true);
    expect(run("GEQ", "4", "5")).toBe(false);
  });
});

describe("Math - ADD / SUB / MUL / DIV", () => {
  const run = (type: string, a: string, b: string): number => {
    const memory = new TagMemory();
    registry.get(type)!.execute(node(type, a, b, "Dest"), contextFor(memory, true));
    return memory.readNumber("Dest");
  };

  it("computes the four operations", () => {
    expect(run("ADD", "3", "4")).toBe(7);
    expect(run("SUB", "10", "4")).toBe(6);
    expect(run("MUL", "3", "4")).toBe(12);
    expect(run("DIV", "12", "4")).toBe(3);
  });

  it("DIV by zero is safe (yields 0)", () => {
    expect(run("DIV", "5", "0")).toBe(0);
  });

  it("does nothing when the rung is false", () => {
    const memory = new TagMemory();
    memory.write("Dest", 99);
    registry.get("ADD")!.execute(node("ADD", "1", "2", "Dest"), contextFor(memory, false));
    expect(memory.readNumber("Dest")).toBe(99);
  });
});

describe("Latches - OTL / OTU", () => {
  it("OTL sets true and is retentive; OTU clears", () => {
    const memory = new TagMemory();
    const otl = registry.get("OTL")!;
    const otu = registry.get("OTU")!;

    otl.execute(node("OTL", "Latch"), contextFor(memory, true));
    expect(memory.readBool("Latch")).toBe(true);
    // Rung false leaves the latch set (retentive).
    otl.execute(node("OTL", "Latch"), contextFor(memory, false));
    expect(memory.readBool("Latch")).toBe(true);
    // OTU clears only while its rung is true.
    otu.execute(node("OTU", "Latch"), contextFor(memory, false));
    expect(memory.readBool("Latch")).toBe(true);
    otu.execute(node("OTU", "Latch"), contextFor(memory, true));
    expect(memory.readBool("Latch")).toBe(false);
  });
});

describe("ONS - One Shot", () => {
  const ons = registry.get("ONS")!;

  it("passes true once on a false→true edge, then false while held", () => {
    const memory = new TagMemory();
    expect(ons.execute(node("ONS", "OneShot"), contextFor(memory, true))).toBe(true); // edge
    expect(ons.execute(node("ONS", "OneShot"), contextFor(memory, true))).toBe(false); // held
    expect(ons.execute(node("ONS", "OneShot"), contextFor(memory, true))).toBe(false);
  });

  it("re-arms after the rung goes false, then fires on the next edge", () => {
    const memory = new TagMemory();
    ons.execute(node("ONS", "OneShot"), contextFor(memory, true)); // fire
    ons.execute(node("ONS", "OneShot"), contextFor(memory, false)); // re-arm
    expect(ons.execute(node("ONS", "OneShot"), contextFor(memory, true))).toBe(true); // fires again
  });

  it("never fires while the rung is false", () => {
    const memory = new TagMemory();
    expect(ons.execute(node("ONS", "OneShot"), contextFor(memory, false))).toBe(false);
  });
});

describe("RES - Reset", () => {
  const res = registry.get("RES")!;

  it("clears a TIMER's ACC and status bits when the rung is true", () => {
    const memory = new TagMemory();
    memory.write("T.ACC", 500);
    memory.writeBool("T.EN", true);
    memory.writeBool("T.TT", true);
    memory.writeBool("T.DN", true);
    res.execute(node("RES", "T"), contextFor(memory, true));
    expect(memory.readNumber("T.ACC")).toBe(0);
    expect(memory.readBool("T.EN")).toBe(false);
    expect(memory.readBool("T.TT")).toBe(false);
    expect(memory.readBool("T.DN")).toBe(false);
  });

  it("clears a COUNTER's ACC and DN when the rung is true", () => {
    const memory = new TagMemory();
    memory.write("C.ACC", 7);
    memory.writeBool("C.DN", true);
    res.execute(node("RES", "C"), contextFor(memory, true));
    expect(memory.readNumber("C.ACC")).toBe(0);
    expect(memory.readBool("C.DN")).toBe(false);
  });

  it("has no effect when the rung is false", () => {
    const memory = new TagMemory();
    memory.write("T.ACC", 500);
    res.execute(node("RES", "T"), contextFor(memory, false));
    expect(memory.readNumber("T.ACC")).toBe(500);
  });
});

describe("TOF - Timer Off Delay", () => {
  const tof = registry.get("TOF")!;

  it("holds DN true and ACC at 0 while the rung is true", () => {
    const memory = new TagMemory();
    tof.execute(node("TOF", "T", "1000"), contextFor(memory, true, 250));
    expect(memory.readBool("T.DN")).toBe(true);
    expect(memory.readNumber("T.ACC")).toBe(0);
    expect(memory.readBool("T.EN")).toBe(true);
  });

  it("times after the rung goes false and drops DN once ACC ≥ PRE", () => {
    const memory = new TagMemory();
    tof.execute(node("TOF", "T", "1000"), contextFor(memory, true, 250)); // DN true, ACC 0
    // First false scan: still timing → DN stays true.
    tof.execute(node("TOF", "T", "1000"), contextFor(memory, false, 250));
    expect(memory.readNumber("T.ACC")).toBe(250);
    expect(memory.readBool("T.DN")).toBe(true);
    expect(memory.readBool("T.TT")).toBe(true);
    // Three more false scans reach PRE (4 × 250 = 1000) → DN drops.
    tof.execute(node("TOF", "T", "1000"), contextFor(memory, false, 250));
    tof.execute(node("TOF", "T", "1000"), contextFor(memory, false, 250));
    tof.execute(node("TOF", "T", "1000"), contextFor(memory, false, 250));
    expect(memory.readNumber("T.ACC")).toBe(1000);
    expect(memory.readBool("T.DN")).toBe(false);
    expect(memory.readBool("T.TT")).toBe(false);
  });
});

describe("RTO - Retentive Timer On", () => {
  const rto = registry.get("RTO")!;

  it("retains ACC across a false rung and resumes accumulating", () => {
    const memory = new TagMemory();
    rto.execute(node("RTO", "T", "1000"), contextFor(memory, true, 300));
    expect(memory.readNumber("T.ACC")).toBe(300);
    // Rung false: ACC retained (the point of RTO), EN/TT cleared.
    rto.execute(node("RTO", "T", "1000"), contextFor(memory, false, 300));
    expect(memory.readNumber("T.ACC")).toBe(300);
    expect(memory.readBool("T.EN")).toBe(false);
    expect(memory.readBool("T.TT")).toBe(false);
    // Resume: continues from 300.
    rto.execute(node("RTO", "T", "1000"), contextFor(memory, true, 300));
    expect(memory.readNumber("T.ACC")).toBe(600);
  });

  it("sets DN at PRE, retains DN when false, and RES clears it", () => {
    const memory = new TagMemory();
    const res = registry.get("RES")!;
    for (let i = 0; i < 4; i++) {
      rto.execute(node("RTO", "T", "1000"), contextFor(memory, true, 300)); // 300,600,900,1000
    }
    expect(memory.readNumber("T.ACC")).toBe(1000);
    expect(memory.readBool("T.DN")).toBe(true);
    // DN retained even with the rung false.
    rto.execute(node("RTO", "T", "1000"), contextFor(memory, false, 300));
    expect(memory.readBool("T.DN")).toBe(true);
    // RES clears ACC and DN.
    res.execute(node("RES", "T"), contextFor(memory, true));
    expect(memory.readNumber("T.ACC")).toBe(0);
    expect(memory.readBool("T.DN")).toBe(false);
  });
});

describe("CTD - Count Down", () => {
  const ctd = registry.get("CTD")!;

  it("decrements ACC only on a rising edge of the rung", () => {
    const memory = new TagMemory();
    memory.write("C.ACC", 5);
    ctd.execute(node("CTD", "C", "0"), contextFor(memory, true)); // edge → 4
    expect(memory.readNumber("C.ACC")).toBe(4);
    ctd.execute(node("CTD", "C", "0"), contextFor(memory, true)); // held → no change
    expect(memory.readNumber("C.ACC")).toBe(4);
    ctd.execute(node("CTD", "C", "0"), contextFor(memory, false)); // falling edge
    ctd.execute(node("CTD", "C", "0"), contextFor(memory, true)); // edge → 3
    expect(memory.readNumber("C.ACC")).toBe(3);
  });
});

describe("NOP / AFI - program-control utilities", () => {
  it("NOP passes the rung condition through unchanged", () => {
    expect(registry.get("NOP")!.execute(node("NOP"), contextFor(new TagMemory(), true))).toBe(true);
    expect(registry.get("NOP")!.execute(node("NOP"), contextFor(new TagMemory(), false))).toBe(false);
  });

  it("AFI always evaluates false", () => {
    expect(registry.get("AFI")!.execute(node("AFI"), contextFor(new TagMemory(), true))).toBe(false);
    expect(registry.get("AFI")!.execute(node("AFI"), contextFor(new TagMemory(), false))).toBe(false);
  });
});

describe("Integration - XIC(Btn) ONS(OneShot) CTU(Counter1, 5)", () => {
  it("counts exactly once per button press, however long it is held", () => {
    const rung = singleRung([
      node("XIC", "Btn"),
      node("ONS", "OneShot"),
      node("CTU", "Counter1", "5"),
    ]);
    const executor = new RungExecutor(registry);
    const memory = new TagMemory();

    // Hold the button for several scans → counts once.
    memory.writeBool("Btn", true);
    executor.execute(rung, memory);
    executor.execute(rung, memory);
    executor.execute(rung, memory);
    expect(memory.readNumber("Counter1.ACC")).toBe(1);

    // Release and press again → second count.
    memory.writeBool("Btn", false);
    executor.execute(rung, memory);
    memory.writeBool("Btn", true);
    executor.execute(rung, memory);
    expect(memory.readNumber("Counter1.ACC")).toBe(2);
  });
});

describe("Integration - RTO retained, RES on a later rung clears it", () => {
  it("accumulates RTO time, then a reset rung clears the retained value", () => {
    const base = createLadderRoutine();
    const routine = {
      ...base,
      rungs: [
        createRung(base.id, 0, [node("XIC", "Run"), node("RTO", "T", "1000")]),
        createRung(base.id, 1, [node("XIC", "ResetBtn"), node("RES", "T")]),
      ],
    };
    const runtime = createRuntime({ registry, routine, tags: [] });

    runtime.writeTag("Run", true);
    runtime.scanOnce(300); // ACC 300
    runtime.scanOnce(300); // ACC 600
    expect(runtime.readTag("T.ACC")).toBe(600);

    // Press reset: rung 0 bumps ACC, then rung 1 (RES) clears it within the scan.
    runtime.writeTag("ResetBtn", true);
    runtime.scanOnce(300);
    expect(runtime.readTag("T.ACC")).toBe(0);
  });
});
