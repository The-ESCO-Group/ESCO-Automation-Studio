import { describe, expect, it } from "vitest";
import { createDefaultRegistry, parseNumericLiteral, type InstructionRuntimeContext } from "@esco/instructions";
import { createNode, tagOperand } from "@esco/ladder";
import { TagMemory } from "./tag-memory";

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

describe("COUNTER status bits", () => {
  it("CTU wraps at the signed DINT upper limit and latches OV until RES", () => {
    const memory = new TagMemory();
    const ctu = registry.get("CTU")!;
    const res = registry.get("RES")!;

    memory.write("C.ACC", 2147483647);
    ctu.execute(node("CTU", "C", "0"), contextFor(memory, true));

    expect(memory.readNumber("C.ACC")).toBe(-2147483648);
    expect(memory.readBool("C.OV")).toBe(true);
    expect(memory.readBool("C.UN")).toBe(false);
    expect(memory.readBool("C.DN")).toBe(false);

    ctu.execute(node("CTU", "C", "0"), contextFor(memory, false));
    ctu.execute(node("CTU", "C", "0"), contextFor(memory, true));
    expect(memory.readNumber("C.ACC")).toBe(-2147483647);
    expect(memory.readBool("C.OV")).toBe(true);

    res.execute(node("RES", "C"), contextFor(memory, true));
    expect(memory.readNumber("C.ACC")).toBe(0);
    expect(memory.readBool("C.OV")).toBe(false);
  });

  it("CTD wraps at the signed DINT lower limit and latches UN until RES", () => {
    const memory = new TagMemory();
    const ctd = registry.get("CTD")!;
    const res = registry.get("RES")!;

    memory.write("C.ACC", -2147483648);
    ctd.execute(node("CTD", "C", "0"), contextFor(memory, true));

    expect(memory.readNumber("C.ACC")).toBe(2147483647);
    expect(memory.readBool("C.UN")).toBe(true);
    expect(memory.readBool("C.OV")).toBe(false);
    expect(memory.readBool("C.DN")).toBe(true);

    ctd.execute(node("CTD", "C", "0"), contextFor(memory, false));
    ctd.execute(node("CTD", "C", "0"), contextFor(memory, true));
    expect(memory.readNumber("C.ACC")).toBe(2147483646);
    expect(memory.readBool("C.UN")).toBe(true);

    res.execute(node("RES", "C"), contextFor(memory, true));
    expect(memory.readNumber("C.ACC")).toBe(0);
    expect(memory.readBool("C.UN")).toBe(false);
  });
});
