import type { PlcProject } from "@esco/core";

/**
 * L5X import entry point (stub).
 *
 * Part 5 of the plan moves `server/plc-logic-parser.ts` from the reference
 * IO-Truth-Engine project into this package and fleshes out the extractor /
 * mapping pipeline. For now this throws so callers fail loudly rather than
 * silently importing nothing.
 */
export function parseL5X(_xml: string): PlcProject {
  throw new Error("parseL5X is not implemented yet (planned for Part 5).");
}
