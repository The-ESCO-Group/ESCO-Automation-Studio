import type { InstructionDefinition } from "./types";
import { operandValue } from "./operands";

function requireOperands(names: string[]) {
  return (node: { operands: { value: string }[] }): string[] =>
    names.flatMap((name, index) =>
      node.operands[index]?.value ? [] : [`Operand '${name}' is required.`],
    );
}

const DINT_MIN = -2147483648;
const DINT_MAX = 2147483647;

function dint(value: number): number {
  return Math.trunc(value) | 0;
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
 * Members written: <counter>.PRE, .ACC, .CU, .DN, .OV.
 * ACC increments only on a false→true transition of the rung (rising edge);
 * DN sets when ACC >= PRE. ACC is retentive (not reset by a false rung). OV
 * latches when ACC wraps past the upper DINT limit; RES clears it.
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
    let acc = dint(ctx.readNumber(`${counter}.ACC`));
    if (ctx.rungIn && !previousCU) {
      const next = acc + 1;
      if (next > DINT_MAX) ctx.writeBool(`${counter}.OV`, true);
      acc = dint(next);
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
 * Members written: <counter>.PRE, .ACC, .CD, .DN, .UN.
 * ACC decrements only on a false→true transition of the rung (rising edge), the
 * mirror of CTU; ACC is retentive. DN is modelled as ACC >= PRE (the same
 * accumulated comparison Logix uses). UN latches when ACC wraps past the lower
 * DINT limit; RES clears it.
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
    let acc = dint(ctx.readNumber(`${counter}.ACC`));
    if (ctx.rungIn && !previousCD) {
      const next = acc - 1;
      if (next < DINT_MIN) ctx.writeBool(`${counter}.UN`, true);
      acc = dint(next);
      ctx.writeNumber(`${counter}.ACC`, acc);
    }
    ctx.writeBool(`${counter}.CD`, ctx.rungIn);
    ctx.writeBool(`${counter}.DN`, acc >= pre);
    return ctx.rungIn;
  },
  render: { symbol: "CTD", style: "box" },
};

/**
 * RES - Reset. Operand: a TIMER, COUNTER, or CONTROL tag.
 * While the rung is true it clears the structure's accumulator/position to 0 and
 * every status bit, then has no effect while the rung is false. The cleared
 * members cover all three structures Logix lets RES target:
 *   - TIMER:   .ACC; bits EN/TT/DN
 *   - COUNTER: .ACC; bits CU/CD/DN/OV/UN
 *   - CONTROL: .POS; bits EN/EU/DN/EM/ER/UL/IN/FD (used by SQO/SQI/SQL, BSL/BSR,
 *              FFL/FFU/LFL/LFU and FAL/FSC) — but never .LEN, which is the
 *              configured length and is left intact, matching the controller.
 * Writing members or bits that don't apply to the actual structure type is
 * harmless in the flat tag image, so one definition covers all three. RES on a
 * CONTROL is the standard way to restart a sequencer or empty a FIFO/LIFO: it
 * zeroes the position the file/sequencer instructions read on their next scan.
 */
export const RES: InstructionDefinition = {
  type: "RES",
  displayName: "Reset",
  category: "program-control",
  description: "Clears a TIMER/COUNTER/CONTROL's ACC or POS and status bits while the rung is true.",
  operands: [
    {
      name: "structure",
      label: "Timer/Counter/Control",
      required: true,
      allowedTypes: ["TIMER", "COUNTER", "CONTROL"],
      direction: "write",
    },
  ],
  validate: requireOperands(["structure"]),
  execute: (node, ctx) => {
    if (ctx.rungIn) {
      const tag = operandValue(node, 0);
      ctx.writeNumber(`${tag}.ACC`, 0);
      ctx.writeNumber(`${tag}.POS`, 0);
      for (const bit of ["EN", "TT", "DN", "CU", "CD", "OV", "UN", "EU", "EM", "ER", "UL", "IN", "FD"]) {
        ctx.writeBool(`${tag}.${bit}`, false);
      }
    }
    return ctx.rungIn;
  },
  render: { symbol: "--(RES)--", style: "coil" },
};
