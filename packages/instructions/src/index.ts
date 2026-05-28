import { InstructionRegistry } from "./registry";
import { OTE, XIC, XIO } from "./bit";

export * from "./types";
export * from "./registry";
export * from "./bit";

/** Default registry seeded with the MVP bit instructions. */
export function createDefaultRegistry(): InstructionRegistry {
  const registry = new InstructionRegistry();
  for (const def of [XIC, XIO, OTE]) {
    registry.register(def);
  }
  return registry;
}
