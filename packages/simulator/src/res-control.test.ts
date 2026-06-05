import { describe, expect, it } from "vitest";
import { createDefaultRegistry, parseNumericLiteral, type InstructionRuntimeContext } from "@esco/instructions";
import { createNode, tagOperand } from "@esco/ladder";
import { TagMemory } from "./tag-memory";

/**
 * RES on a CONTROL structure is the standard way to restart a sequencer
 * (SQO/SQI/SQL) or empty a FIFO/LIFO/shift stack. It must clear the CONTROL's
 * .POS and status bits — the position the file/sequencer instructions read on
 * their next scan — while leaving the configured .LEN intact, matching the
 * controller. (RES on TIMER/COUNTER is covered by simulator.test.ts and
 * counter-status.test.ts.)
 */

const registry = createDefaultRegistry();

const node = (type: string, ...operands: string[]) =>
  createNode(type, operands.map((value, index) => tagOperand(`op${index}`, value)));

function contextFor(memory: TagMemory, rungIn: boolean): InstructionRuntimeContext {
  return {
    rungIn,
    deltaMs: 0,
    readBool: (path) => memory.readBool(path),
    writeBool: (path, value) => memory.writeBool(path, value),
    readNumber: (path) => memory.readNumber(path),
    writeNumber: (path, value) => memory.write(path, value),
    readString: (path) => String(memory.read(path) ?? ""),
    writeString: (path, value) => memory.write(path, value),
    numeric: (operand) => parseNumericLiteral(operand) ?? memory.readNumber(operand.trim()),
  };
}

describe("RES on a CONTROL structure", () => {
  const res = registry.get("RES")!;

  it("declares CONTROL as an allowed operand type", () => {
    expect(res.operands[0]?.allowedTypes).toContain("CONTROL");
  });

  it("clears .POS and the CONTROL status bits but leaves .LEN intact", () => {
    const memory = new TagMemory();
    memory.write("Ctl.POS", 3);
    memory.write("Ctl.LEN", 4);
    for (const bit of ["EN", "EU", "DN", "EM", "ER", "UL", "IN", "FD"]) {
      memory.writeBool(`Ctl.${bit}`, true);
    }

    res.execute(node("RES", "Ctl"), contextFor(memory, true));

    expect(memory.readNumber("Ctl.POS")).toBe(0);
    expect(memory.readNumber("Ctl.LEN")).toBe(4); // configured length is preserved
    for (const bit of ["EN", "EU", "DN", "EM", "ER", "UL", "IN", "FD"]) {
      expect(memory.readBool(`Ctl.${bit}`), bit).toBe(false);
    }
  });

  it("has no effect while the rung is false", () => {
    const memory = new TagMemory();
    memory.write("Ctl.POS", 2);
    memory.writeBool("Ctl.DN", true);

    res.execute(node("RES", "Ctl"), contextFor(memory, false));

    expect(memory.readNumber("Ctl.POS")).toBe(2);
    expect(memory.readBool("Ctl.DN")).toBe(true);
  });

  it("restarts a sequencer: SQO advances POS, RES zeroes it, the next edge steps to 1 again", () => {
    const memory = new TagMemory();
    const sqo = registry.get("SQO")!;
    // Seq[1..3] hold distinct step values; mask -1 passes every bit.
    memory.write("Seq[1]", 11);
    memory.write("Seq[2]", 22);
    memory.write("Seq[3]", 33);

    const step = () => {
      sqo.execute(node("SQO", "Seq", "-1", "Out", "Ctl", "3"), contextFor(memory, false));
      sqo.execute(node("SQO", "Seq", "-1", "Out", "Ctl", "3"), contextFor(memory, true));
    };

    step();
    expect(memory.readNumber("Ctl.POS")).toBe(1);
    expect(memory.readNumber("Out")).toBe(11);
    step();
    expect(memory.readNumber("Ctl.POS")).toBe(2);
    expect(memory.readNumber("Out")).toBe(22);

    // RES restarts the sequencer at the top.
    res.execute(node("RES", "Ctl"), contextFor(memory, true));
    expect(memory.readNumber("Ctl.POS")).toBe(0);
    expect(memory.readNumber("Ctl.LEN")).toBe(3); // length survives the reset

    // The next false->true edge steps back to position 1.
    step();
    expect(memory.readNumber("Ctl.POS")).toBe(1);
    expect(memory.readNumber("Out")).toBe(11);
  });
});
