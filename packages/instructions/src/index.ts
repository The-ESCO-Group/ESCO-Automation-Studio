import { InstructionRegistry } from "./registry";
import { ONS, OTE, OTL, OTU, XIC, XIO } from "./bit";
import { CTD, CTU, RES, RTO, TOF, TON } from "./timer-counter";
import { EQU, GEQ, GRT, LEQ, LES, MOV, NEQ } from "./move-compare";
import { ADD, DIV, MUL, SUB } from "./math";
import { ABS, AND, CLR, LIM, MEQ, MOD, NEG, NOT, OR, SQR, XOR } from "./compute";
import { AFI, NOP } from "./program-control";

export * from "./types";
export * from "./registry";
export * from "./operands";
export * from "./bit";
export * from "./timer-counter";
export * from "./move-compare";
export * from "./math";
export * from "./compute";
export * from "./program-control";

/** Default registry seeded with the supported instruction set. */
export function createDefaultRegistry(): InstructionRegistry {
  const registry = new InstructionRegistry();
  for (const def of [
    XIC, XIO, OTE, OTL, OTU, ONS,
    TON, TOF, RTO, CTU, CTD, RES,
    MOV, EQU, GRT, LES, NEQ, LEQ, GEQ,
    ADD, SUB, MUL, DIV,
    AND, OR, XOR, NOT, MOD, SQR, NEG, ABS, CLR, LIM, MEQ,
    NOP, AFI,
  ]) {
    registry.register(def);
  }
  return registry;
}
