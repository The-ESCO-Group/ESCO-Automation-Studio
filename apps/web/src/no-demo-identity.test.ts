import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Production-UI guard: the HMI (and the rest of the web app) must NOT ship with a
 * baked-in demo project, operator, or alarm identity. Operator comes from the
 * runtime session (fallback "Guest"), project name from the HMI/project model,
 * and alarm counts from the real alarm runtime (fallback 0). This test fails the
 * build if any of those demo literals creep back into shipped source, so the
 * removal can never silently regress.
 */
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Forbidden demo-identity literals that must never appear in production source. */
const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: "demo project slug Packaging_Line_01", pattern: /Packaging_Line_01/ },
  { label: "demo project name Packaging Line 01", pattern: /Packaging Line 01/ },
  { label: "hardcoded operator name Neel", pattern: /\bNeel\b/ },
];

/** Recursively collect shipped .ts/.tsx files, skipping tests and build output. */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue; // tests legitimately reference the literals
    files.push(full);
  }
  return files;
}

describe("no demo identity baked into production UI", () => {
  const files = collectSourceFiles(SRC_DIR);

  it("scans a non-trivial number of source files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const { label, pattern } of FORBIDDEN) {
    it(`contains no ${label}`, () => {
      const offenders = files.filter((file) => pattern.test(readFileSync(file, "utf8")));
      expect(offenders, `Demo identity "${label}" found in: ${offenders.join(", ")}`).toEqual([]);
    });
  }
});
