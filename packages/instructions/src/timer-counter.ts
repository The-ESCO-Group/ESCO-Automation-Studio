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

/**
 * TOF - Timer Off Delay.
 * While the rung is true, DN is held true and ACC is held at 0 (EN true, TT
 * false). When the rung goes false, the timer runs: ACC accumulates elapsed
 * milliseconds toward PRE; DN/TT stay true while ACC < PRE and drop once
 * ACC >= PRE. Uses the deltaMs scan-time model like TON.
 */
export const TOF: InstructionDefinition = {
  type: "TOF",
  displayName: "Timer Off Delay",
  category: "timer",
  description: "DN is true while the rung is true; when it goes false, times PRE then drops DN.",
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
      ctx.writeNumber(`${timer}.ACC`, 0);
      ctx.writeBool(`${timer}.EN`, true);
      ctx.writeBool(`${timer}.TT`, false);
      ctx.writeBool(`${timer}.DN`, true);
    } else {
      let acc = ctx.readNumber(`${timer}.ACC`);
      if (acc < pre) acc = Math.min(acc + ctx.deltaMs, pre);
      const timing = acc < pre;
      ctx.writeNumber(`${timer}.ACC`, acc);
      ctx.writeBool(`${timer}.EN`, false);
      ctx.writeBool(`${timer}.TT`, timing);
      ctx.writeBool(`${timer}.DN`, timing);
    }
    return ctx.rungIn;
  },
  render: { symbol: "TOF", style: "box" },
};

/**
 * RTO - Retentive Timer On.
 * Accumulates time while the rung is true (EN/TT true, DN sets at ACC >= PRE),
 * but unlike TON it retains ACC and DN when the rung goes false — it only clears
 * EN/TT. A RES instruction on the same tag clears the retained ACC/DN.
 */
export const RTO: InstructionDefinition = {
  type: "RTO",
  displayName: "Retentive Timer On",
  category: "timer",
  description: "Like TON but retains ACC and DN when the rung goes false; RES clears it.",
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
      ctx.writeBool(`${timer}.EN`, false);
      ctx.writeBool(`${timer}.TT`, false);
      // ACC and DN are retained across the false rung (the point of RTO).
    }
    return ctx.rungIn;
  },
  render: { symbol: "RTO", style: "box" },
};

/**
 * CTD - Count Down.
 * Operands: counter (COUNTER tag), preset (literal or DINT).
 * Members written: <counter>.PRE, .ACC, .CD, .DN.
 * ACC decrements only on a false→true transition of the rung (rising edge), the
 * mirror of CTU; ACC is retentive. DN is modelled as ACC >= PRE (the same
 * accumulated comparison Logix uses), simplified — UN/OV are not modelled here.
 */
export const CTD: InstructionDefinition = {
  type: "CTD",
  displayName: "Count Down",
  category: "counter",
  description: "Decrements ACC on each rising edge of the rung; DN reflects ACC ≥ PRE.",
  operands: [
    { name: "counter", label: "Counter", required: true, allowedTypes: ["COUNTER"], direction: "write" },
    { name: "preset", label: "Preset", required: true, allowedTypes: ["DINT"], direction: "read" },
  ],
  validate: requireOperands(["counter", "preset"]),
  execute: (node, ctx) => {
    const counter = operandValue(node, 0);
    const pre = ctx.numeric(operandValue(node, 1));
    ctx.writeNumber(`${counter}.PRE`, pre);

    const previousCD = ctx.readBool(`${counter}.CD`);
    let acc = ctx.readNumber(`${counter}.ACC`);
    if (ctx.rungIn && !previousCD) {
      acc -= 1;
      ctx.writeNumber(`${counter}.ACC`, acc);
    }
    ctx.writeBool(`${counter}.CD`, ctx.rungIn);
    ctx.writeBool(`${counter}.DN`, acc >= pre);
    return ctx.rungIn;
  },
  render: { symbol: "CTD", style: "box" },
};

/**
 * RES - Reset. Operand: a TIMER or COUNTER tag.
 * While the rung is true it clears ACC to 0 and every status bit (timer:
 * EN/TT/DN; counter: CU/CD/DN/OV/UN); it has no effect while the rung is false.
 * Writing members that don't apply to the actual structure type is harmless in
 * the flat tag image, so one definition covers both timers and counters.
 */
export const RES: InstructionDefinition = {
  type: "RES",
  displayName: "Reset",
  category: "program-control",
  description: "Clears a TIMER/COUNTER's ACC and status bits while the rung is true.",
  operands: [
    {
      name: "structure",
      label: "Timer/Counter",
      required: true,
      allowedTypes: ["TIMER", "COUNTER"],
      direction: "write",
    },
  ],
  validate: requireOperands(["structure"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const tag = operandValue(node, 0);
      ctx.writeNumber(`${tag}.ACC`, 0);
      for (const bit of ["EN", "TT", "DN", "CU", "CD", "OV", "UN"]) {
        ctx.writeBool(`${tag}.${bit}`, false);
      }
    }
    return ctx.rungIn;
  },
  render: { symbol: "--(RES)--", style: "coil" },
};
