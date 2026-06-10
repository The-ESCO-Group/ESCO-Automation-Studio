/**
 * Test-only helper: parse "65 00 04 00" style hex dumps into bytes.
 * Not exported from the package index.
 */
export function hexToBytes(hex: string): Uint8Array {
  const pairs = hex.trim().split(/\s+/).filter(Boolean);
  return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)));
}
