/**
 * Deterministic id helpers for the Simulation Lab.
 *
 * The shared `createId` uses crypto.randomUUID, which is non-deterministic.
 * Simulation Lab artifacts (projects, devices, scenarios, reports) must
 * serialize and replay identically for reproducible tests and evidence, so we
 * use a project-scoped monotonic counter instead.
 */

/** A model that carries the next deterministic id counter. */
export interface SimIdCounter {
  _idSeq: number;
}

/** Allocate the next deterministic id with a stable prefix (mutates the counter). */
export function nextSimId(counter: SimIdCounter, prefix: string): string {
  counter._idSeq += 1;
  return `${prefix}_${counter._idSeq}`;
}

/** Convert an arbitrary label into a safe, uppercase tag-friendly token. */
export function slugTag(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  if (cleaned.length === 0) return "TAG";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** Convert a label into a safe lowercase identifier (for ids/keys). */
export function slugId(label: string): string {
  return slugTag(label).toLowerCase();
}
