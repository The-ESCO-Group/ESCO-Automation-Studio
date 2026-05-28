/** Branded id helpers used across the PLC domain model. */

let counter = 0;

/**
 * Create a reasonably unique id with an optional prefix.
 * Uses crypto.randomUUID when available, with a monotonic fallback.
 */
export function createId(prefix = "id"): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${(counter++).toString(36)}`;
  return `${prefix}_${uuid}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
