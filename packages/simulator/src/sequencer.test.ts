import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@esco/instructions";
import { createLadderRoutine, createNode, createRung, tagOperand, type LadderRoutine } from "@esco/ladder";
import { PlcRuntime } from "./runtime";

const registry = createDefaultRegistry();

function routine(nodes: ReturnType<typeof createNode>[]): LadderRoutine {
  const ladder = createLadderRoutine();
  ladder.rungs.push(createRung(ladder.id, 0, nodes));
  return ladder;
}

function node(type: string, operands: [string, string][]) {
  return createNode(type, operands.map(([name, value]) => tagOperand(name, value)));
}

function runtimeFor(ladder: LadderRoutine): PlcRuntime {
  const rt = new PlcRuntime(registry);
  rt.loadRoutine(ladder);
  return rt;
}

describe("sequencer instructions are executable", () => {
  it("registers SQO/SQI/SQC/SQL as executable", () => {
    for (const type of ["SQO", "SQI", "SQC", "SQL"]) {
      expect(registry.has(type)).toBe(true);
      expect(registry.get(type)?.category).toBe("sequencer");
      expect(registry.get(type)?.modelOnly).toBeFalsy();
    }
  });
});

describe("SQO - Sequencer Output", () => {
  it("advances on false-to-true edges, masks array data into destination, and wraps after Length", () => {
    const rt = runtimeFor(
      routine([
        node("XIC", [["operand", "Enable"]]),
        node("SQO", [
          ["array", "Seq"],
          ["mask", "16#0F"],
          ["dest", "Out"],
          ["control", "Ctl"],
          ["length", "3"],
        ]),
      ]),
    );
    rt.writeTag("Seq[1]", 0x0a);
    rt.writeTag("Seq[2]", 0x05);
    rt.writeTag("Seq[3]", 0x0c);
    rt.writeTag("Out", 0xf0);

    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Ctl.POS")).toBe(1);
    expect(rt.readTag("Ctl.LEN")).toBe(3);
    expect(rt.readTag("Ctl.EN")).toBe(true);
    expect(rt.readTag("Ctl.DN")).toBe(false);
    expect(rt.readTag("Out")).toBe(0xfa);

    rt.scanOnce(0);
    expect(rt.readTag("Ctl.POS")).toBe(1); // held true: no new edge

    rt.writeTag("Enable", false);
    rt.scanOnce(0);
    expect(rt.readTag("Ctl.EN")).toBe(false);
    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Ctl.POS")).toBe(2);
    expect(rt.readTag("Out")).toBe(0xf5);

    rt.writeTag("Enable", false);
    rt.scanOnce(0);
    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Ctl.POS")).toBe(3);
    expect(rt.readTag("Ctl.DN")).toBe(true);
    expect(rt.readTag("Out")).toBe(0xfc);

    rt.writeTag("Enable", false);
    rt.scanOnce(0);
    rt.writeTag("Enable", true);
    rt.scanOnce(0);
    expect(rt.readTag("Ctl.POS")).toBe(1);
  });
});

describe("SQI - Sequencer Input", () => {
  it("compares source and array values through the mask at Control.POS", () => {
    const rt = runtimeFor(
      routine([
        node("SQI", [
          ["array", "Seq"],
          ["mask", "16#0F"],
          ["source", "Inputs"],
          ["control", "Ctl"],
          ["length", "4"],
        ]),
        node("OTE", [["operand", "Matched"]]),
      ]),
    );
    rt.writeTag("Ctl.POS", 2);
    rt.writeTag("Seq[2]", 0xa5);
    rt.writeTag("Inputs", 0xb5);
    rt.scanOnce(0);
    expect(rt.readTag("Matched")).toBe(true);
    expect(rt.readTag("Ctl.ER")).toBe(false);

    rt.writeTag("Inputs", 0xb6);
    rt.scanOnce(0);
    expect(rt.readTag("Matched")).toBe(false);
  });
});

describe("SQC - Sequencer Compare", () => {
  it("executes as a legacy masked compare and gates downstream output", () => {
    const rt = runtimeFor(
      routine([
        node("SQC", [
          ["array", "Seq"],
          ["mask", "16#0F"],
          ["source", "Inputs"],
          ["control", "Ctl"],
          ["length", "4"],
        ]),
        node("OTE", [["operand", "Matched"]]),
      ]),
    );
    rt.writeTag("Ctl.POS", 3);
    rt.writeTag("Seq[3]", 0x3c);
    rt.writeTag("Inputs", 0x4c);
    rt.scanOnce(0);

    expect(rt.readTag("Matched")).toBe(true);
    expect(rt.readTag("Ctl.LEN")).toBe(4);
    expect(rt.readTag("Ctl.POS")).toBe(3);
    expect(rt.readTag("Ctl.DN")).toBe(false);
    expect(rt.readTag("Ctl.ER")).toBe(false);

    rt.writeTag("Inputs", 0x4d);
    rt.scanOnce(0);
    expect(rt.readTag("Matched")).toBe(false);
  });
});

describe("SQL - Sequencer Load", () => {
  it("loads source values into the table at the advanced Control.POS", () => {
    const rt = runtimeFor(
      routine([
        node("XIC", [["operand", "Capture"]]),
        node("SQL", [
          ["array", "Seq"],
          ["source", "Sample"],
          ["control", "Ctl"],
          ["length", "2"],
        ]),
      ]),
    );

    rt.writeTag("Sample", 11);
    rt.writeTag("Capture", true);
    rt.scanOnce(0);
    expect(rt.readTag("Ctl.POS")).toBe(1);
    expect(rt.readTag("Seq[1]")).toBe(11);

    rt.writeTag("Capture", false);
    rt.scanOnce(0);
    rt.writeTag("Sample", 22);
    rt.writeTag("Capture", true);
    rt.scanOnce(0);
    expect(rt.readTag("Ctl.POS")).toBe(2);
    expect(rt.readTag("Seq[2]")).toBe(22);
  });
});
