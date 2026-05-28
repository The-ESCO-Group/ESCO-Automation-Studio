import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();
const STRING_ASCII = [
  "CONCAT", "DELETE", "FIND", "INSERT", "LEFT", "LEN", "MID", "RIGHT", "LOWER", "UPPER",
  "ACI", "ACB", "AEX", "ASC", "ABL", "ACL", "ACN", "AHL", "ARD", "ARL", "ASR", "AWA", "AWT",
];

describe("string/ASCII instructions", () => {
  it("are all registered as model-only", () => {
    for (const type of STRING_ASCII) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.modelOnly).toBe(true);
    }
  });

  it("pass the rung condition through without crashing", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "En")]),
        createNode("CONCAT", [tagOperand("op0", "A"), tagOperand("op1", "B"), tagOperand("op2", "Dest")]),
        createNode("ARD", [tagOperand("op0", "Channel0"), tagOperand("op1", "Buf")]),
        createNode("OTE", [tagOperand("operand", "Done")]),
      ]),
    );
    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);
    rt.writeTag("En", true);
    expect(() => rt.scanOnce(0)).not.toThrow();
    expect(rt.readTag("Done")).toBe(true); // model-only string/ASCII pass condition through
  });
});
