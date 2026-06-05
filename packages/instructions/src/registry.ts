import type { InstructionDefinition } from "./types";

export { instructionFidelity, instructionFidelityLabel, supportLevel } from "./types";

/** Every instruction is defined exactly once and registered here. */
export class InstructionRegistry {
  private byType = new Map<string, InstructionDefinition>();

  register(def: InstructionDefinition): void {
    if (this.byType.has(def.type)) {
      throw new Error(`Instruction already registered: ${def.type}`);
    }
    this.byType.set(def.type, def);
  }

  get(type: string): InstructionDefinition | undefined {
    return this.byType.get(type);
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  all(): InstructionDefinition[] {
    return [...this.byType.values()];
  }
}
