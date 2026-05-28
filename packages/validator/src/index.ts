import { ValidationEngine } from "./engine";
import { defaultRules } from "./rules";

export * from "./types";
export * from "./engine";
export * from "./rules";

export function createDefaultEngine(): ValidationEngine {
  const engine = new ValidationEngine();
  for (const rule of defaultRules) {
    engine.add(rule);
  }
  return engine;
}
