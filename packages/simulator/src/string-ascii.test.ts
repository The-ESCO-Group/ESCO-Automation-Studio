import { describe, expect, it } from "vitest";
import { createDefaultRegistry, supportLevel } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();
const EXECUTABLE_STRING_ASCII = [
  "CONCAT", "DELETE", "FIND", "INSERT", "LEFT", "LEN", "MID", "RIGHT", "LOWER", "UPPER",
  "ACI", "ACB", "AEX", "ASC", "ABL", "ACL", "ACN", "ARD", "ARL", "ASR", "AWA", "AWT",
  "DTOS", "RTOS", "STOD", "STOR",
];
const MODEL_ONLY_ASCII = [
  "AHL",
];

describe("string/ASCII instructions", () => {
  it("registers scalar and channel-buffer string operations as executable and hardware handshake as model-only", () => {
    for (const type of EXECUTABLE_STRING_ASCII) {
      expect(registry.has(type)).toBe(true);
      expect(supportLevel(registry.get(type))).toBe("executable");
    }
    for (const type of MODEL_ONLY_ASCII) {
      expect(registry.has(type)).toBe(true);
      expect(supportLevel(registry.get(type))).toBe("model-only");
    }
  });

  it("executes common string manipulation instructions over scalar string tags", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(createRung(ladder.id, 0, [
      createNode("CONCAT", [tagOperand("sourceA", "A"), tagOperand("sourceB", "B"), tagOperand("dest", "Concat")]),
    ]));
    ladder.rungs.push(createRung(ladder.id, 1, [
      createNode("DELETE", [tagOperand("source", "Source"), tagOperand("qty", "2"), tagOperand("start", "3"), tagOperand("dest", "Deleted")]),
    ]));
    ladder.rungs.push(createRung(ladder.id, 2, [
      createNode("INSERT", [tagOperand("sourceA", "Source"), tagOperand("sourceB", "B"), tagOperand("start", "3"), tagOperand("dest", "Inserted")]),
    ]));
    ladder.rungs.push(createRung(ladder.id, 3, [
      createNode("FIND", [tagOperand("source", "Source"), tagOperand("search", "\"B\""), tagOperand("start", "1"), tagOperand("result", "Found")]),
    ]));
    ladder.rungs.push(createRung(ladder.id, 4, [
      createNode("MID", [tagOperand("source", "Source"), tagOperand("qty", "3"), tagOperand("start", "2"), tagOperand("dest", "Mid")]),
    ]));
    ladder.rungs.push(createRung(ladder.id, 5, [
      createNode("LEFT", [tagOperand("source", "Source"), tagOperand("qty", "2"), tagOperand("dest", "Left")]),
      createNode("RIGHT", [tagOperand("source", "Source"), tagOperand("qty", "2"), tagOperand("dest", "Right")]),
      createNode("LEN", [tagOperand("source", "Source"), tagOperand("dest", "Len")]),
    ]));
    ladder.rungs.push(createRung(ladder.id, 6, [
      createNode("LOWER", [tagOperand("source", "Mixed"), tagOperand("dest", "Lower")]),
      createNode("UPPER", [tagOperand("source", "Mixed"), tagOperand("dest", "Upper")]),
    ]));
    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);
    rt.writeTag("A", "Hi");
    rt.writeTag("B", "There");
    rt.writeTag("Source", "ABCDE");
    rt.writeTag("Mixed", "AbC");

    rt.scanOnce(0);

    expect(rt.readTag("Concat")).toBe("HiThere");
    expect(rt.readTag("Concat.LEN")).toBe(7);
    expect(rt.readTag("Deleted")).toBe("ABE");
    expect(rt.readTag("Inserted")).toBe("ABThereCDE");
    expect(rt.readTag("Found")).toBe(2);
    expect(rt.readTag("Mid")).toBe("BCD");
    expect(rt.readTag("Left")).toBe("AB");
    expect(rt.readTag("Right")).toBe("DE");
    expect(rt.readTag("Len")).toBe(5);
    expect(rt.readTag("Lower")).toBe("abc");
    expect(rt.readTag("Upper")).toBe("ABC");
  });

  it("keeps STRING .LEN synchronized for defined, direct-written, and instruction-written tags", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(createRung(ladder.id, 0, [
      createNode("CONCAT", [tagOperand("sourceA", "Message"), tagOperand("sourceB", "\"!\""), tagOperand("dest", "Out")]),
    ]));
    const rt = new PlcRuntime(registry);
    rt.defineTag({ name: "Message", dataType: "STRING", role: "internal", initialValue: "BOOT" });
    rt.loadRoutine(ladder);

    expect(rt.readTag("Message.LEN")).toBe(4);

    rt.writeTag("Message", "READY");
    expect(rt.readTag("Message.LEN")).toBe(5);

    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe("READY!");
    expect(rt.readTag("Out.LEN")).toBe(6);

    rt.reset();
    expect(rt.readTag("Message")).toBe("BOOT");
    expect(rt.readTag("Message.LEN")).toBe(4);
  });

  it("treats uninitialized STRING reads as empty text, not boolean false text", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(createRung(ladder.id, 0, [
      createNode("LEN", [tagOperand("source", "MissingString"), tagOperand("dest", "Len")]),
      createNode("CONCAT", [tagOperand("sourceA", "MissingString"), tagOperand("sourceB", "\"OK\""), tagOperand("dest", "Joined")]),
    ]));
    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);

    rt.scanOnce(0);

    expect(rt.readTag("Len")).toBe(0);
    expect(rt.readTag("Joined")).toBe("OK");
    expect(rt.readTag("Joined.LEN")).toBe(2);
  });

  it("executes simple ASCII conversions without serial port access", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(createRung(ladder.id, 0, [
      createNode("ACI", [tagOperand("source", "NumberText"), tagOperand("dest", "Number")]),
      createNode("ASC", [tagOperand("source", "Letters"), tagOperand("dest", "Code")]),
      createNode("AEX", [tagOperand("source", "Letters"), tagOperand("index", "2"), tagOperand("qty", "2"), tagOperand("dest", "Extracted")]),
      createNode("ACN", [tagOperand("sourceA", "Letters"), tagOperand("sourceB", "\"!\""), tagOperand("dest", "AsciiConcat")]),
    ]));
    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);
    rt.writeTag("NumberText", "42");
    rt.writeTag("Letters", "ABCD");

    rt.scanOnce(0);

    expect(rt.readTag("Number")).toBe(42);
    expect(rt.readTag("Code")).toBe(65);
    expect(rt.readTag("Extracted")).toBe("BC");
    expect(rt.readTag("AsciiConcat")).toBe("ABCD!");
  });

  it("truncates ACI to an integer rather than writing a float", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(createRung(ladder.id, 0, [
      createNode("ACI", [tagOperand("source", "FloatText"), tagOperand("dest", "Number")]),
    ]));
    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);
    rt.writeTag("FloatText", "42.7");

    rt.scanOnce(0);

    // ASCII to Integer stops at the integer value; the controller writes 42, not 42.7.
    expect(rt.readTag("Number")).toBe(42);
  });

  it("compares two string tags with ASR and passes the rung only when they match", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(createRung(ladder.id, 0, [
      createNode("ASR", [tagOperand("sourceA", "Have"), tagOperand("sourceB", "Want")]),
      createNode("OTE", [tagOperand("operand", "Match")]),
    ]));
    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);
    rt.writeTag("Have", "RUN");
    rt.writeTag("Want", "RUN");
    rt.scanOnce(0);
    expect(rt.readTag("Match")).toBe(true); // identical ASCII text -> rung true

    rt.writeTag("Want", "run"); // ASR is case-sensitive, like Logix
    rt.scanOnce(16);
    expect(rt.readTag("Match")).toBe(false);
  });

  it("converts between numbers and strings (DTOS/RTOS/STOD/STOR) offline", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(createRung(ladder.id, 0, [
      createNode("DTOS", [tagOperand("source", "IntVal"), tagOperand("dest", "IntText")]),
      createNode("RTOS", [tagOperand("source", "RealVal"), tagOperand("dest", "RealText")]),
      createNode("STOD", [tagOperand("source", "IntStr"), tagOperand("dest", "ParsedInt")]),
      createNode("STOR", [tagOperand("source", "RealStr"), tagOperand("dest", "ParsedReal")]),
    ]));
    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);
    rt.writeTag("IntVal", 24);
    rt.writeTag("RealVal", 3.5);
    rt.writeTag("IntStr", "42.9");
    rt.writeTag("RealStr", "3.14");

    rt.scanOnce(0);

    expect(rt.readTag("IntText")).toBe("24");
    expect(rt.readTag("RealText")).toBe("3.5");
    expect(rt.readTag("ParsedInt")).toBe(42); // truncated to a DINT
    expect(rt.readTag("ParsedReal")).toBeCloseTo(3.14);
  });

  it("models serial ASCII channel buffers with STRING tags", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(createRung(ladder.id, 0, [
      createNode("ACB", [tagOperand("channel", "Channel"), tagOperand("result", "CountBefore")]),
      createNode("ABL", [tagOperand("channel", "Channel"), tagOperand("result", "LineLen")]),
      createNode("ARL", [tagOperand("channel", "Channel"), tagOperand("dest", "Line")]),
      createNode("ARD", [tagOperand("channel", "Channel"), tagOperand("dest", "Chunk"), tagOperand("qty", "3")]),
      createNode("AWT", [tagOperand("channel", "Channel"), tagOperand("source", "Tx")]),
      createNode("AWA", [tagOperand("channel", "Channel"), tagOperand("source", "\"!\"")]),
      createNode("ACB", [tagOperand("channel", "Channel"), tagOperand("result", "CountAfter")]),
    ]));
    const clear = createLadderRoutine();
    clear.rungs.push(createRung(clear.id, 0, [
      createNode("ACL", [tagOperand("channel", "Channel")]),
      createNode("ACB", [tagOperand("channel", "Channel"), tagOperand("result", "CountAfter")]),
    ]));

    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);
    rt.writeTag("Channel", "READY\r\nabcde");
    rt.writeTag("Tx", "OK");
    rt.scanOnce(0);

    expect(rt.readTag("CountBefore")).toBe(12);
    expect(rt.readTag("LineLen")).toBe(7);
    expect(rt.readTag("Line")).toBe("READY");
    expect(rt.readTag("Chunk")).toBe("abc");
    expect(rt.readTag("Channel")).toBe("deOK!\r\n");
    expect(rt.readTag("CountAfter")).toBe(7);

    rt.loadRoutine(clear);
    rt.scanOnce(0);
    expect(rt.readTag("Channel")).toBe("");
    expect(rt.readTag("CountAfter")).toBe(0);
  });

  it("hardware handshake ASCII instructions remain model-only pass-through", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "En")]),
        createNode("AHL", [tagOperand("channel", "Channel0")]),
        createNode("OTE", [tagOperand("operand", "Done")]),
      ]),
    );
    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);
    rt.writeTag("En", true);
    expect(() => rt.scanOnce(0)).not.toThrow();
    expect(rt.readTag("Done")).toBe(true); // model-only handshake passes condition through
  });
});
