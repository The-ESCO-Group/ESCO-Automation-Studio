import { createDefaultRegistry, type InstructionRegistry } from "@esco/instructions";
import { parseL5X } from "./parseL5X";
import { toDomainProject, type ImportResult } from "./toDomainProject";

export * from "./parseL5X";
export * from "./parseRungText";
export * from "./extractController";
export * from "./extractTags";
export * from "./extractRoutines";
export * from "./structuredText";
export * from "./extractPrograms";
export * from "./extractStructure";
export * from "./toDomainProject";
export * from "./exportL5X";

/**
 * Import an L5X (RSLogix 5000 export) XML string into the internal project
 * model. Returns the project plus warnings for anything imported with caveats
 * (unsupported instructions, branch logic). Throws an `Error` for invalid input.
 */
export function importL5X(
  xml: string,
  registry?: InstructionRegistry,
): ImportResult {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const start = now();
  const root = parseL5X(xml);
  const result = toDomainProject(root, registry ?? createDefaultRegistry());
  result.summary.durationMs = Math.round((now() - start) * 100) / 100;
  return result;
}
