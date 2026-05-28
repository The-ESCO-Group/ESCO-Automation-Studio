import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

/**
 * TON - Timer On Delay (non-retentive).
 * Operands: timer (TIMER tag), preset (ms, literal or DINT).
 * Members written: <timer>.PRE, .ACC, .EN, .TT, .DN.
 * While the rung is true, ACC accumulates elapsed milliseconds toward PRE; DN
 * latches when ACC >= PRE. When the rung goes false, everything resets to 0.
 */
export const TON: InstructionDefinition = {
  type: "TON",
  displayName: "Timer On Delay",
  category: "timer",
  description: "Accumulates time while the rung is true; DN sets when ACC ≥ PRE.",
  operands: [
    { name: "timer", label: "Timer", required: true, allowedTypes: ["TIMER"], direction: "write" },
    { name: "preset", label: "Preset (ms)", required: true, allowedTypes: ["DINT"], direction: "read" },
  ],
  validate: requireOperands(["timer", "preset"]),
  execute: (node, ctx) => {
    const timer = operandValue(node, 0);
    const pre = ctx.numeric(operandValue(node, 1));
    ctx.writeNumber(`${timer}.PRE`, pre);

    if (ctx.rungIn) {
      let acc = ctx.readNumber(`${timer}.ACC`);
      if (acc < pre) acc = Math.min(acc + ctx.deltaMs, pre);
      const done = acc >= pre;
      ctx.writeNumber(`${timer}.ACC`, acc);
      ctx.writeBool(`${timer}.EN`, true);
      ctx.writeBool(`${timer}.DN`, done);
      ctx.writeBool(`${timer}.TT`, !done);
    } else {
      ctx.writeNumber(`${timer}.ACC`, 0);
      ctx.writeBool(`${timer}.EN`, false);
      ctx.writeBool(`${timer}.TT`, false);
      ctx.writeBool(`${timer}.DN`, false);
    }
    return ctx.rungIn;
  },
  render: { symbol: "TON", style: "box" },
};

/**
 * CTU - Count Up.
 * Operands: counter (COUNTER tag), preset (literal or DINT).
 * Members written: <counter>.PRE, .ACC, .CU, .DN.
 * ACC increments only on a false→true transition of the rung (rising edge);
 * DN sets when ACC >= PRE. ACC is retentive (not reset by a false rung).
 */
export const CTU: InstructionDefinition = {
  type: "CTU",
  displayName: "Count Up",
  category: "counter",
  description: "Increments ACC on each rising edge of the rung; DN sets when ACC ≥ PRE.",
  operands: [
    { name: "counter", label: "Counter", required: true, allowedTypes: ["COUNTER"], direction: "write" },
    { name: "preset", label: "Preset", required: true, allowedTypes: ["DINT"], direction: "read" },
  ],
  validate: requireOperands(["counter", "preset"]),
  execute: (node, ctx) => {
    const counter = operandValue(node, 0);
    const pre = ctx.numeric(operandValue(node, 1));
    ctx.writeNumber(`${counter}.PRE`, pre);

    const previousCU = ctx.readBool(`${counter}.CU`);
    let acc = ctx.readNumber(`${counter}.ACC`);
    if (ctx.rungIn && !previousCU) {
      acc += 1;
      ctx.writeNumber(`${counter}.ACC`, acc);
    }
    ctx.writeBool(`${counter}.CU`, ctx.rungIn);
    ctx.writeBool(`${counter}.DN`, acc >= pre);
    return ctx.rungIn;
  },
  render: { symbol: "CTU", style: "box" },
};
