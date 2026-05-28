import { InstructionRegistry } from "./registry";
import { OTE, OTL, OTU, XIC, XIO } from "./bit";
import { CTU, TON } from "./timer-counter";
import { EQU, GEQ, GRT, LEQ, LES, MOV, NEQ } from "./move-compare";
import { ADD, DIV, MUL, SUB } from "./math";

export * from "./types";
export * from "./registry";
export * from "./operands";
export * from "./bit";
export * from "./timer-counter";
export * from "./move-compare";
export * from "./math";

/** Default registry seeded with the supported instruction set. */
export function createDefaultRegistry(): InstructionRegistry {
  const registry = new InstructionRegistry();
  for (const def of [
    XIC, XIO, OTE, OTL, OTU,
    TON, CTU,
    MOV, EQU, GRT, LES, NEQ, LEQ, GEQ,
    ADD, SUB, MUL, DIV,
  ]) {
    registry.register(def);
  }
  return registry;
}
