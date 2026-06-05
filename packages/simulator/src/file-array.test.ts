import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand, type LadderRoutine } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();

function singleRung(type: string, operands: [string, string][]): LadderRoutine {
  const ladder = createLadderRoutine();
  ladder.rungs.push(
    createRung(ladder.id, 0, [createNode(type, operands.map(([n, v]) => tagOperand(n, v)))]),
  );
  return ladder;
}

function run(routine: LadderRoutine): PlcRuntime {
  const rt = new PlcRuntime(registry);
  rt.loadRoutine(routine);
  return rt;
}

describe("file/array instructions are registered", () => {
  it("registers file/array/search/stack instructions as executable", () => {
    for (const type of ["AVE", "STD", "SRT", "FAL", "FSC", "SIZE", "FFL", "FFU", "LFL", "LFU"]) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.modelOnly).toBeFalsy();
    }
  });
});

describe("AVE / STD / SRT execute over array elements", () => {
  it("AVE averages Length elements into Dest", () => {
    const rt = run(singleRung("AVE", [["array", "Arr"], ["dest", "Avg"], ["control", "Ctl"], ["length", "3"]]));
    rt.writeTag("Arr[0]", 10);
    rt.writeTag("Arr[1]", 20);
    rt.writeTag("Arr[2]", 30);
    rt.writeTag("Arr[3]", 999); // beyond Length — ignored
    rt.scanOnce(0);
    expect(rt.readTag("Avg")).toBe(20);
  });

  it("STD computes the sample standard deviation", () => {
    const rt = run(singleRung("STD", [["array", "Arr"], ["dest", "Sd"], ["control", "Ctl"], ["length", "3"]]));
    rt.writeTag("Arr[0]", 1);
    rt.writeTag("Arr[1]", 2);
    rt.writeTag("Arr[2]", 3);
    rt.scanOnce(0);
    expect(rt.readTag("Sd")).toBe(1); // mean 2, sample variance ((1)+(0)+(1))/2 = 1
  });

  it("honors an expression-driven starting element for file operations", () => {
    const rt = run(singleRung("AVE", [["array", "Arr[Index+1]"], ["dest", "Avg"], ["control", "Ctl"], ["length", "2"]]));
    rt.writeTag("Index", 1);
    rt.writeTag("Arr[2]", 10);
    rt.writeTag("Arr[3]", 30);
    rt.scanOnce(0);
    expect(rt.readTag("Avg")).toBe(20);
  });

  it("SRT sorts Length elements ascending in place", () => {
    const rt = run(singleRung("SRT", [["array", "Arr"], ["control", "Ctl"], ["length", "3"]]));
    rt.writeTag("Arr[0]", 30);
    rt.writeTag("Arr[1]", 10);
    rt.writeTag("Arr[2]", 20);
    rt.scanOnce(0);
    expect(rt.readTag("Arr[0]")).toBe(10);
    expect(rt.readTag("Arr[1]")).toBe(20);
    expect(rt.readTag("Arr[2]")).toBe(30);
    // SRT drives its CONTROL just like AVE/STD: enabled, done, with .LEN/.POS set.
    expect(rt.readTag("Ctl.EN")).toBe(true);
    expect(rt.readTag("Ctl.DN")).toBe(true);
    expect(rt.readTag("Ctl.ER")).toBe(false);
    expect(rt.readTag("Ctl.LEN")).toBe(3);
    expect(rt.readTag("Ctl.POS")).toBe(3);
  });

  it("SRT de-energises its CONTROL on a false rung", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "En")]),
        createNode("SRT", [tagOperand("array", "Arr"), tagOperand("control", "Ctl"), tagOperand("length", "2")]),
      ]),
    );
    const rt = run(ladder);
    rt.writeTag("Arr[0]", 20);
    rt.writeTag("Arr[1]", 10);
    rt.writeTag("En", true);
    rt.scanOnce(0);
    expect(rt.readTag("Arr[0]")).toBe(10);
    expect(rt.readTag("Ctl.DN")).toBe(true);
    rt.writeTag("En", false);
    rt.scanOnce(0);
    expect(rt.readTag("Ctl.EN")).toBe(false);
    expect(rt.readTag("Ctl.DN")).toBe(false);
  });

  it("does not execute when the rung is false", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "En")]),
        createNode("AVE", [tagOperand("array", "Arr"), tagOperand("dest", "Avg"), tagOperand("control", "Ctl"), tagOperand("length", "2")]),
      ]),
    );
    const rt = run(ladder);
    rt.writeTag("Arr[0]", 4);
    rt.writeTag("Arr[1]", 6);
    rt.scanOnce(0);
    expect(rt.readTag("Avg")).toBe(false); // En false → no write
    rt.writeTag("En", true);
    rt.scanOnce(0);
    expect(rt.readTag("Avg")).toBe(5);
  });
});

describe("FAL / FSC execute array expressions with CONTROL.POS", () => {
  it("FAL ALL mode evaluates every element on the enable edge and writes dynamic destinations", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "En")]),
        createNode("FAL", [
          tagOperand("control", "Ctl"),
          tagOperand("length", "3"),
          tagOperand("position", "0"),
          tagOperand("mode", "ALL"),
          tagOperand("expression", "Src[Ctl.POS] + Offset"),
          tagOperand("dest", "Dest[Ctl.POS]"),
        ]),
      ]),
    );
    const rt = run(ladder);
    rt.writeTag("Src[0]", 10);
    rt.writeTag("Src[1]", 20);
    rt.writeTag("Src[2]", 30);
    rt.writeTag("Offset", 1);

    rt.writeTag("En", true);
    rt.scanOnce(0);
    expect(rt.readTag("Dest[0]")).toBe(11);
    expect(rt.readTag("Dest[1]")).toBe(21);
    expect(rt.readTag("Dest[2]")).toBe(31);
    expect(rt.readTag("Ctl.POS")).toBe(3);
    expect(rt.readTag("Ctl.LEN")).toBe(3);
    expect(rt.readTag("Ctl.DN")).toBe(true);
    expect(rt.readTag("Ctl.ER")).toBe(false);

    rt.writeTag("Src[0]", 99);
    rt.scanOnce(0);
    expect(rt.readTag("Dest[0]")).toBe(11); // held true: ALL mode does not restart
  });

  it("FAL numeric mode distributes work across scans while enabled", () => {
    const rt = run(
      singleRung("FAL", [
        ["control", "Ctl"],
        ["length", "4"],
        ["position", "0"],
        ["mode", "2"],
        ["expression", "Src[Ctl.POS] * 2"],
        ["dest", "Dest[Ctl.POS]"],
      ]),
    );
    for (let i = 0; i < 4; i += 1) rt.writeTag(`Src[${i}]`, i + 1);

    rt.scanOnce(0);
    expect(rt.readTag("Dest[0]")).toBe(2);
    expect(rt.readTag("Dest[1]")).toBe(4);
    expect(rt.readTag("Dest[2]")).toBe(false);
    expect(rt.readTag("Ctl.POS")).toBe(2);
    expect(rt.readTag("Ctl.DN")).toBe(false);

    rt.scanOnce(0);
    expect(rt.readTag("Dest[2]")).toBe(6);
    expect(rt.readTag("Dest[3]")).toBe(8);
    expect(rt.readTag("Ctl.POS")).toBe(4);
    expect(rt.readTag("Ctl.DN")).toBe(true);
  });

  it("FSC ALL mode stops at the matching element and sets FD/IN", () => {
    const rt = run(
      singleRung("FSC", [
        ["control", "Ctl"],
        ["length", "4"],
        ["position", "0"],
        ["mode", "ALL"],
        ["expression", "Src[Ctl.POS] = Target"],
      ]),
    );
    rt.writeTag("Src[0]", 10);
    rt.writeTag("Src[1]", 20);
    rt.writeTag("Src[2]", 30);
    rt.writeTag("Target", 20);

    rt.scanOnce(0);
    expect(rt.readTag("Ctl.POS")).toBe(1);
    expect(rt.readTag("Ctl.FD")).toBe(true);
    expect(rt.readTag("Ctl.IN")).toBe(true);
    expect(rt.readTag("Ctl.DN")).toBe(false);

    rt.writeTag("Target", 99);
    rt.writeTag("Ctl.IN", false);
    rt.scanOnce(0);
    expect(rt.readTag("Ctl.POS")).toBe(4);
    expect(rt.readTag("Ctl.DN")).toBe(true);
  });

  it("FSC compares string tags by character instead of coercing them to zero", () => {
    const rt = run(
      singleRung("FSC", [
        ["control", "Ctl"],
        ["length", "3"],
        ["position", "0"],
        ["mode", "ALL"],
        ["expression", "Codes[Ctl.POS] = Wanted"],
      ]),
    );
    rt.writeTag("Codes[0]", "IDLE");
    rt.writeTag("Codes[1]", "RUN");
    rt.writeTag("Codes[2]", "STOP");
    rt.writeTag("Wanted", "RUN");

    rt.scanOnce(0);

    expect(rt.readTag("Ctl.POS")).toBe(1);
    expect(rt.readTag("Ctl.FD")).toBe(true);
    expect(rt.readTag("Ctl.IN")).toBe(true);
  });
});

describe("SIZE executes from declared array metadata", () => {
  it("writes the requested array dimension size while the rung is true", () => {
    const rt = run(singleRung("SIZE", [["source", "Arr"], ["dimension", "0"], ["size", "Sz"]]));
    rt.defineTag({ name: "Arr", dataType: "DINT", role: "internal", initialValue: 0, dimension: 8 });
    rt.scanOnce(0);
    expect(rt.readTag("Sz")).toBe(8);
  });

  it("returns 0 when the requested dimension is not modelled", () => {
    const rt = run(singleRung("SIZE", [["source", "Arr"], ["dimension", "1"], ["size", "Sz"]]));
    rt.defineTag({ name: "Arr", dataType: "DINT", role: "internal", initialValue: 0, dimension: 8 });
    rt.scanOnce(0);
    expect(rt.readTag("Sz")).toBe(0);
  });

  it("reports each declared dimension for multi-dimensional arrays", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(createRung(ladder.id, 0, [
      createNode("SIZE", [tagOperand("source", "Matrix"), tagOperand("dimension", "0"), tagOperand("size", "Rows")]),
      createNode("SIZE", [tagOperand("source", "Matrix"), tagOperand("dimension", "1"), tagOperand("size", "Cols")]),
    ]));
    const rt = new PlcRuntime(registry);
    rt.loadRoutine(ladder);
    rt.defineTag({ name: "Matrix", dataType: "DINT", role: "internal", initialValue: 0, dimensions: [2, 3] });
    rt.scanOnce(0);
    expect(rt.readTag("Rows")).toBe(2);
    expect(rt.readTag("Cols")).toBe(3);
  });
});

describe("FIFO / LIFO stack instructions execute bounded offline semantics", () => {
  it("FFL loads on false-to-true edges, advances POS, and stops at Length", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "En")]),
        createNode("FFL", [
          tagOperand("source", "In"),
          tagOperand("fifo", "Q"),
          tagOperand("control", "Ctl"),
          tagOperand("length", "2"),
        ]),
      ]),
    );
    const rt = run(ladder);

    rt.writeTag("In", 10);
    rt.writeTag("En", true);
    rt.scanOnce(0);
    expect(rt.readTag("Q[0]")).toBe(10);
    expect(rt.readTag("Ctl.POS")).toBe(1);
    expect(rt.readTag("Ctl.EM")).toBe(false);
    expect(rt.readTag("Ctl.DN")).toBe(false);

    rt.writeTag("In", 99);
    rt.scanOnce(0);
    expect(rt.readTag("Q[1]")).toBe(false); // held true: no second load

    rt.writeTag("En", false);
    rt.scanOnce(0);
    expect(rt.readTag("Ctl.EN")).toBe(false);
    rt.writeTag("En", true);
    rt.scanOnce(0);
    expect(rt.readTag("Q[1]")).toBe(99);
    expect(rt.readTag("Ctl.POS")).toBe(2);
    expect(rt.readTag("Ctl.DN")).toBe(true);

    rt.writeTag("En", false);
    rt.scanOnce(0);
    rt.writeTag("In", 123);
    rt.writeTag("En", true);
    rt.scanOnce(0);
    expect(rt.readTag("Q[2]")).toBe(false);
    expect(rt.readTag("Ctl.POS")).toBe(2);
  });

  it("FFU unloads first-in-first-out and shifts remaining elements down", () => {
    const ladder = createLadderRoutine();
    ladder.rungs.push(
      createRung(ladder.id, 0, [
        createNode("XIC", [tagOperand("operand", "Unload")]),
        createNode("FFU", [
          tagOperand("fifo", "Q"),
          tagOperand("dest", "Out"),
          tagOperand("control", "Ctl"),
          tagOperand("length", "3"),
        ]),
      ]),
    );
    const rt = run(ladder);
    rt.writeTag("Q[0]", 10);
    rt.writeTag("Q[1]", 20);
    rt.writeTag("Ctl.POS", 2);

    rt.writeTag("Unload", true);
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(10);
    expect(rt.readTag("Q[0]")).toBe(20);
    expect(rt.readTag("Q[1]")).toBe(0);
    expect(rt.readTag("Ctl.POS")).toBe(1);
    expect(rt.readTag("Ctl.EM")).toBe(false);

    rt.writeTag("Unload", false);
    rt.scanOnce(0);
    rt.writeTag("Unload", true);
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(20);
    expect(rt.readTag("Ctl.POS")).toBe(0);
    expect(rt.readTag("Ctl.EM")).toBe(true);
  });

  it("LFU unloads the most recently loaded element", () => {
    const rt = run(singleRung("LFU", [["lifo", "S"], ["dest", "Out"], ["control", "Ctl"], ["length", "3"]]));
    rt.writeTag("S[0]", 10);
    rt.writeTag("S[1]", 20);
    rt.writeTag("Ctl.POS", 2);
    rt.scanOnce(0);
    expect(rt.readTag("Out")).toBe(20);
    expect(rt.readTag("S[1]")).toBe(0);
    expect(rt.readTag("Ctl.POS")).toBe(1);
  });

  it("LFL loads on an enable edge with independent LIFO metadata", () => {
    const rt = run(singleRung("LFL", [["source", "In"], ["lifo", "S"], ["control", "Ctl"], ["length", "2"]]));
    rt.writeTag("In", 42);

    rt.scanOnce(0);

    expect(rt.readTag("S[0]")).toBe(42);
    expect(rt.readTag("Ctl.EN")).toBe(true);
    expect(rt.readTag("Ctl.POS")).toBe(1);
    expect(rt.readTag("Ctl.EM")).toBe(false);
    expect(rt.readTag("Ctl.DN")).toBe(false);
    expect(rt.readTag("Ctl.ER")).toBe(false);
  });

  it("FFL sets ER without DN for negative Length and does not write the FIFO", () => {
    const rt = run(singleRung("FFL", [["source", "In"], ["fifo", "Q"], ["control", "Ctl"], ["length", "-1"]]));
    rt.writeTag("In", 77);

    rt.scanOnce(0);

    expect(rt.readTag("Q[0]")).toBe(false);
    expect(rt.readTag("Ctl.EN")).toBe(true);
    expect(rt.readTag("Ctl.LEN")).toBe(-1);
    expect(rt.readTag("Ctl.POS")).toBe(0);
    expect(rt.readTag("Ctl.ER")).toBe(true);
    expect(rt.readTag("Ctl.DN")).toBe(false);
  });

  it("FFU sets ER without DN for negative Length and does not unload data", () => {
    const rt = run(singleRung("FFU", [["fifo", "Q"], ["dest", "Out"], ["control", "Ctl"], ["length", "-1"]]));
    rt.writeTag("Q[0]", 55);
    rt.writeTag("Ctl.POS", 1);

    rt.scanOnce(0);

    expect(rt.readTag("Out")).toBe(false);
    expect(rt.readTag("Q[0]")).toBe(55);
    expect(rt.readTag("Ctl.EU")).toBe(true);
    expect(rt.readTag("Ctl.LEN")).toBe(-1);
    expect(rt.readTag("Ctl.POS")).toBe(1);
    expect(rt.readTag("Ctl.ER")).toBe(true);
    expect(rt.readTag("Ctl.DN")).toBe(false);
  });
});
