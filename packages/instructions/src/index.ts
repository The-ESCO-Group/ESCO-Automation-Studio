import { InstructionRegistry } from "./registry";
import { OTE, XIC, XIO } from "./bit";
import { CTU, TON } from "./timer-counter";
import { EQU, GRT, LES, MOV } from "./move-compare";

export * from "./types";
export * from "./registry";
export * from "./operands";
export * from "./bit";
export * from "./timer-counter";
export * from "./move-compare";

/** Default registry seeded with the MVP instruction set. */
export function createDefaultRegistry(): InstructionRegistry {
  const registry = new InstructionRegistry();
  for (const def of [XIC, XIO, OTE, TON, CTU, MOV, EQU, GRT, LES]) {
    registry.register(def);
  }
  return registry;
}
